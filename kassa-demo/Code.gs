/**
 * Клуб: учёт доходов и расходов — бэкенд на Google Apps Script.
 *
 * Главное правило безопасности: сервер НИКОГДА не доверяет тому, кто «назвался»
 * в запросе. Пользователь определяется только по подписанному токену.
 * Чужие личные записи не читаются в ответ вообще — они не попадают на устройство.
 */

// ---------- Настройки ----------
var SHEET_PEOPLE = 'Люди';
var SHEET_OPS = 'Операции';
var SHEET_CATS = 'Категории';

var H_PEOPLE = ['id', 'имя', 'pin_хеш', 'роль', 'активен', 'версия'];
var H_OPS = ['id', 'дата', 'тип', 'сумма', 'категория', 'подкатегория', 'заметка',
  'раздел', 'автор_id', 'создано', 'изменено', 'deleted'];
var H_CATS = ['id', 'раздел', 'владелец_id', 'тип', 'название', 'цвет', 'родитель_id', 'активна'];

var TOKEN_DAYS = 30;          // срок жизни входа
var MAX_FAILS = 5;            // неверных попыток до блокировки
var LOCK_SECONDS = 15 * 60;   // блокировка на 15 минут

var TYPES = ['расход', 'доход'];
var SECTIONS = ['club', 'personal'];

// Стартовые категории: [название, цвет, [подкатегории]]
var START_CATS = {
  club: {
    'расход': [
      ['Аренда зала', '#3A6EA5'], ['Инвентарь', '#4C956C'], ['Экипировка', '#2A9D8F'],
      ['Зарплата тренеров', '#7A5C99'],
      ['Соревнования', '#D1495B', ['Взносы', 'Проезд', 'Питание']],
      ['Реклама', '#E09F3E'],
      ['Развлечения', '#C06C84', ['Боулинг', 'Праздники', 'Выезды']],
      ['Прочее', '#8D99AE']
    ],
    'доход': [
      ['Абонементы и взносы', '#1F8A5B'], ['Сданные деньги за соревнования', '#D1495B'],
      ['Сданные деньги за экипировку', '#2A9D8F'], ['Спонсоры', '#E09F3E'], ['Прочее', '#8D99AE']
    ]
  },
  personal: {
    'расход': [
      ['Еда', '#E09F3E'], ['Транспорт', '#3A6EA5'], ['Подписки', '#7A5C99'], ['Учёба', '#2A9D8F'],
      ['Развлечения', '#C06C84'], ['Здоровье', '#D1495B'], ['Одежда', '#4C956C'], ['Прочее', '#8D99AE']
    ],
    'доход': [
      ['Стипендия', '#3A6EA5'], ['Подработка', '#E09F3E'], ['Заказы (сайты)', '#1F8A5B'], ['Прочее', '#8D99AE']
    ]
  }
};

// ---------- Меню в таблице ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Клуб')
    .addItem('Первоначальная настройка', 'menuSetup')
    .addItem('Добавить человека', 'menuAddPerson')
    .addItem('Сбросить PIN человеку', 'menuResetPin')
    .addToUi();
}

function menuSetup() {
  SpreadsheetApp.getUi().alert(setup());
}

function menuAddPerson() {
  var ui = SpreadsheetApp.getUi();
  var name = askUi_('Добавить человека', 'Имя (так человек будет входить в приложение):');
  if (name === null) return;
  var role = askUi_('Роль', 'Напиши admin (полный доступ) или member (участник):');
  if (role === null) return;
  var pin = askUi_('PIN', 'Личный PIN — ровно 6 цифр. Сообщи его человеку лично:');
  if (pin === null) return;
  try {
    addPersonCore(name, role.trim().toLowerCase(), pin);
    ui.alert('Готово: «' + name.trim() + '» добавлен(а). PIN в таблице хранится только как хеш.');
  } catch (e) {
    ui.alert('Не получилось: ' + (e.userMessage || e.message));
  }
}

function menuResetPin() {
  var ui = SpreadsheetApp.getUi();
  var name = askUi_('Сбросить PIN', 'Имя человека:');
  if (name === null) return;
  var pin = askUi_('Новый PIN', 'Новый PIN — ровно 6 цифр:');
  if (pin === null) return;
  try {
    resetPinCore(name, pin);
    ui.alert('Готово. Новый PIN установлен, все старые входы этого человека отключены.');
  } catch (e) {
    ui.alert('Не получилось: ' + (e.userMessage || e.message));
  }
}

function askUi_(title, text) {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
  return r.getSelectedButton() === ui.Button.OK ? r.getResponseText() : null;
}

// ---------- Первоначальная настройка ----------
function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, SHEET_PEOPLE, H_PEOPLE, [1, 3]);
  ensureSheet_(ss, SHEET_OPS, H_OPS, [1, 2, 5, 6, 9, 10, 11]);
  ensureSheet_(ss, SHEET_CATS, H_CATS, [1, 3, 7]);

  // Секреты — в Script Properties (скрытые настройки скрипта), не в таблице и не в коде.
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PIN_SALT')) props.setProperty('PIN_SALT', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('TOKEN_SECRET')) props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());

  var hasClubCats = readAll_(SHEET_CATS, H_CATS).some(function (c) { return c['раздел'] === 'club'; });
  if (!hasClubCats) seedCats_('club', '');
  return 'Настройка готова. Теперь добавь себя через меню «Клуб» → «Добавить человека» с ролью admin.';
}

function ensureSheet_(ss, name, headers, textCols) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    // Пустой стандартный лист переименовываем, а не удаляем.
    var sheets = ss.getSheets();
    var first = sheets[0];
    var isDefault = sheets.length === 1 && /^(Лист1|Sheet1)$/.test(first.getName()) && first.getLastRow() === 0;
    sh = isDefault ? first.setName(name) : ss.insertSheet(name);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // Текстовый формат, чтобы таблица не превращала id и даты в числа/даты по-своему.
  textCols.forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); });
}

function seedCats_(section, ownerId) {
  var sh = sheet_(SHEET_CATS);
  var rows = [];
  TYPES.forEach(function (type) {
    START_CATS[section][type].forEach(function (c) {
      var id = newId_('c');
      rows.push([id, section, ownerId, type, c[0], c[1], '', true]);
      (c[2] || []).forEach(function (sub) {
        rows.push([newId_('c'), section, ownerId, type, sub, c[1], id, true]);
      });
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, H_CATS.length).setValues(rows);
}

// ---------- Люди ----------
function addPersonCore(name, role, pin) {
  return withLock_(function () {
    name = cleanText_(name, 40);
    if (!name) fail('Имя не может быть пустым');
    if (['admin', 'member'].indexOf(role) < 0) fail('Роль должна быть admin или member');
    if (!/^\d{6}$/.test(String(pin || '').trim())) fail('PIN должен состоять ровно из 6 цифр');
    if (findPersonByName_(name)) fail('Человек с таким именем уже есть');
    var id = newId_('u');
    sheet_(SHEET_PEOPLE).appendRow([id, name, hashPin_(id, String(pin).trim()), role, true, 1]);
    seedCats_('personal', id);
    return id;
  });
}

function resetPinCore(name, pin) {
  return withLock_(function () {
    if (!/^\d{6}$/.test(String(pin || '').trim())) fail('PIN должен состоять ровно из 6 цифр');
    var p = findPersonByName_(name);
    if (!p) fail('Человек не найден');
    p['pin_хеш'] = hashPin_(String(p.id), String(pin).trim());
    p['версия'] = (Number(p['версия']) || 1) + 1; // старые токены перестают работать
    writeRow_(SHEET_PEOPLE, H_PEOPLE, p);
    CacheService.getScriptCache().remove(loginKey_(name) + '_lock');
  });
}

function findPersonByName_(name) {
  var n = normName_(name);
  return readAll_(SHEET_PEOPLE, H_PEOPLE).filter(function (p) { return normName_(p['имя']) === n; })[0] || null;
}

function normName_(s) { return String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' '); }

// ---------- Веб-приложение ----------
function doGet() {
  return ContentService.createTextOutput('Сервер клуба работает. Открывай приложение, а не эту ссылку.');
}

/**
 * Все запросы приходят POST'ом с Content-Type: text/plain и JSON в теле.
 * Почему text/plain: такой запрос браузер считает «простым» и не шлёт
 * предварительный OPTIONS-запрос (CORS preflight), который Apps Script не умеет обрабатывать.
 */
function doPost(e) {
  var res;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = handle_(req);
  } catch (err) {
    if (err && err.userMessage) {
      res = { ok: false, error: err.userMessage, code: err.code };
    } else {
      console.error(err);
      res = { ok: false, error: 'Ошибка на сервере. Попробуй ещё раз.', code: 'server' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  var action = String(req.action || '');
  if (action === 'login') return withLock_(function () { return login_(req.name, req.pin); });

  var user = authUser_(req.token); // без верного токена дальше не пройти
  switch (action) {
    case 'sync': return sync_(user);
    case 'saveOp': return withLock_(function () { return saveOp_(user, req.op); });
    case 'deleteOp': return withLock_(function () { return deleteOp_(user, req.id); });
    case 'saveCat': return withLock_(function () { return saveCat_(user, req.cat); });
    default: fail('Неизвестное действие', 'bad');
  }
}

// ---------- Вход и токены ----------
function login_(name, pin) {
  name = String(name || '').trim();
  pin = String(pin || '').trim();
  if (!name || !/^\d{6}$/.test(pin)) fail('Введи имя и PIN из 6 цифр', 'bad');

  var cache = CacheService.getScriptCache();
  var key = loginKey_(name);
  if (cache.get(key + '_lock')) fail('Слишком много попыток, попробуй через 15 минут', 'locked');

  var p = findPersonByName_(name);
  var good = p && isTrue_(p['активен']) && safeEq_(String(p['pin_хеш']), hashPin_(String(p.id), pin));
  if (!good) {
    var n = Number(cache.get(key + '_fails') || 0) + 1;
    if (n >= MAX_FAILS) {
      cache.put(key + '_lock', '1', LOCK_SECONDS);
      cache.remove(key + '_fails');
      fail('Слишком много попыток, попробуй через 15 минут', 'locked');
    }
    cache.put(key + '_fails', String(n), LOCK_SECONDS);
    // Одно сообщение и для «нет такого имени», и для «неверный PIN» — так нельзя узнать, кто есть в клубе.
    fail('Неверное имя или PIN', 'badpin');
  }
  cache.remove(key + '_fails');
  return { ok: true, token: makeToken_(p), user: userOut_(p) };
}

function loginKey_(name) { return 'login_' + sha256Hex_(normName_(name)).slice(0, 32); }

// Токен: id.версия.срок.подпись — подпись HMAC-SHA256 с секретом из Script Properties.
function makeToken_(p) {
  var body = String(p.id) + '.' + (Number(p['версия']) || 1) + '.' + (Date.now() + TOKEN_DAYS * 864e5);
  return body + '.' + sign_(body);
}

function authUser_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 4) fail('Нужно войти заново', 'auth');
  var body = parts.slice(0, 3).join('.');
  if (!safeEq_(sign_(body), parts[3])) fail('Нужно войти заново', 'auth');
  if (Number(parts[2]) < Date.now()) fail('Срок входа истёк, войди заново', 'auth');
  var p = readAll_(SHEET_PEOPLE, H_PEOPLE).filter(function (x) { return String(x.id) === parts[0]; })[0];
  if (!p || !isTrue_(p['активен']) || (Number(p['версия']) || 1) !== Number(parts[1])) fail('Нужно войти заново', 'auth');
  return userOut_(p);
}

function userOut_(p) { return { id: String(p.id), name: String(p['имя']), role: p['роль'] === 'admin' ? 'admin' : 'member' }; }

function sign_(body) {
  var secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!secret) fail('Сервер не настроен: запусти «Первоначальная настройка»', 'server');
  return hex_(Utilities.computeHmacSha256Signature(body, secret));
}

function hashPin_(id, pin) {
  var salt = PropertiesService.getScriptProperties().getProperty('PIN_SALT');
  if (!salt) fail('Сервер не настроен: запусти «Первоначальная настройка»', 'server');
  return sha256Hex_(salt + ':' + id + ':' + pin);
}

function sha256Hex_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

// Сравнение без «раннего выхода», чтобы по времени ответа нельзя было подобрать подпись.
function safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- Данные ----------
function sync_(user) {
  var people = readAll_(SHEET_PEOPLE, H_PEOPLE).map(function (p) { return { id: String(p.id), name: String(p['имя']) }; });
  var cats = readAll_(SHEET_CATS, H_CATS).filter(function (c) { return canSeeCat_(user, c); }).map(catOut_);
  // Фильтр на сервере: клубные + ТОЛЬКО свои личные. Чужие личные дальше этой строки не уходят.
  var ops = readAll_(SHEET_OPS, H_OPS).filter(function (o) {
    return !isTrue_(o.deleted) && (o['раздел'] === 'club' || String(o['автор_id']) === user.id);
  }).map(opOut_);
  return { ok: true, user: user, people: people, cats: cats, ops: ops };
}

function canSeeCat_(user, c) { return c['раздел'] === 'club' || String(c['владелец_id']) === user.id; }

function canEditOp_(user, o) {
  if (o['раздел'] === 'personal') return String(o['автор_id']) === user.id;
  return String(o['автор_id']) === user.id || user.role === 'admin';
}

function saveOp_(user, op) {
  op = op || {};
  var id = cleanId_(op.id);
  var ex = readAll_(SHEET_OPS, H_OPS).filter(function (o) { return String(o.id) === id; })[0];

  // Чужую личную запись сервер «не находит» — не подтверждаем даже факт её существования.
  if (ex && !canEditOp_(user, ex)) fail('Запись не найдена', 'notfound');
  if (ex && isTrue_(ex.deleted)) return { ok: true, op: opOut_(ex) };

  var section = ex ? ex['раздел'] : op.section;
  if (SECTIONS.indexOf(section) < 0) fail('Неизвестный раздел', 'bad');
  var type = String(op.type);
  if (TYPES.indexOf(type) < 0) fail('Тип должен быть «доход» или «расход»', 'bad');
  var amount = Math.round(Number(op.amount) * 100) / 100;
  if (!isFinite(amount) || amount <= 0 || amount > 1e9) fail('Сумма должна быть больше нуля', 'bad');
  var date = cleanDate_(op.date);

  var cats = readAll_(SHEET_CATS, H_CATS);
  var cat = cats.filter(function (c) {
    return String(c.id) === String(op.cat) && c['раздел'] === section && canSeeCat_(user, c) && !c['родитель_id'];
  })[0];
  if (!cat) fail('Категория не найдена', 'bad');
  if (cat['тип'] !== type) fail('Категория не подходит к типу записи', 'bad');
  var sub = '';
  if (op.sub) {
    var s = cats.filter(function (c) { return String(c.id) === String(op.sub) && String(c['родитель_id']) === String(cat.id); })[0];
    if (!s) fail('Подкатегория не найдена', 'bad');
    sub = String(s.id);
  }

  var now = new Date().toISOString();
  var row = {
    _row: ex ? ex._row : 0,
    id: id, 'дата': date, 'тип': type, 'сумма': amount,
    'категория': String(cat.id), 'подкатегория': sub, 'заметка': cleanText_(op.note, 300),
    'раздел': section,
    'автор_id': ex ? String(ex['автор_id']) : user.id, // автор — только из токена
    'создано': ex ? ex['создано'] : now, 'изменено': now, deleted: false
  };
  writeRow_(SHEET_OPS, H_OPS, row);
  return { ok: true, op: opOut_(row) };
}

function deleteOp_(user, id) {
  id = cleanId_(id);
  var ex = readAll_(SHEET_OPS, H_OPS).filter(function (o) { return String(o.id) === id; })[0];
  if (!ex || !canEditOp_(user, ex)) fail('Запись не найдена', 'notfound');
  if (!isTrue_(ex.deleted)) {
    ex.deleted = true; // мягкое удаление: строка остаётся, её можно восстановить
    ex['изменено'] = new Date().toISOString();
    writeRow_(SHEET_OPS, H_OPS, ex);
  }
  return { ok: true, id: id };
}

function saveCat_(user, cat) {
  cat = cat || {};
  var id = cleanId_(cat.id);
  var all = readAll_(SHEET_CATS, H_CATS);
  var ex = all.filter(function (c) { return String(c.id) === id; })[0];
  var name = cleanText_(cat.name, 40);
  var color = /^#[0-9a-fA-F]{6}$/.test(String(cat.color)) ? String(cat.color) : '#8D99AE';
  if (!name) fail('Название не может быть пустым', 'bad');

  if (ex) {
    if (!canSeeCat_(user, ex)) fail('Категория не найдена', 'notfound');
    if (ex['раздел'] === 'club' && user.role !== 'admin') fail('Менять клубные категории может только админ', 'forbidden');
    ex['название'] = name;
    ex['цвет'] = color;
    ex['активна'] = cat.active !== false;
    writeRow_(SHEET_CATS, H_CATS, ex);
    return { ok: true, cat: catOut_(ex) };
  }

  var section = cat.section;
  if (SECTIONS.indexOf(section) < 0) fail('Неизвестный раздел', 'bad');
  var type = String(cat.type);
  if (TYPES.indexOf(type) < 0) fail('Неизвестный тип', 'bad');
  var parent = '';
  if (cat.parent) {
    var p = all.filter(function (c) { return String(c.id) === String(cat.parent); })[0];
    if (!p || !canSeeCat_(user, p) || p['раздел'] !== section || p['родитель_id'] || p['тип'] !== type) {
      fail('Родительская категория не найдена', 'bad');
    }
    parent = String(p.id);
  }
  var owner = section === 'personal' ? user.id : '';
  var dup = all.some(function (c) {
    return c['раздел'] === section && String(c['владелец_id']) === owner && c['тип'] === type &&
      String(c['родитель_id']) === parent && normName_(c['название']) === normName_(name);
  });
  if (dup) fail('Такая категория уже есть', 'bad');
  var row = { id: id, 'раздел': section, 'владелец_id': owner, 'тип': type, 'название': name,
    'цвет': color, 'родитель_id': parent, 'активна': true };
  writeRow_(SHEET_CATS, H_CATS, row);
  return { ok: true, cat: catOut_(row) };
}

function opOut_(o) {
  return {
    id: String(o.id), date: toDateStr_(o['дата']), type: o['тип'], amount: Number(o['сумма']),
    cat: String(o['категория']), sub: String(o['подкатегория'] || ''), note: String(o['заметка'] || ''),
    section: o['раздел'], author: String(o['автор_id']),
    created: String(o['создано'] || ''), updated: String(o['изменено'] || '')
  };
}

function catOut_(c) {
  return {
    id: String(c.id), section: c['раздел'], type: c['тип'], name: String(c['название']),
    color: String(c['цвет'] || '#8D99AE'), parent: String(c['родитель_id'] || ''),
    active: isTrue_(c['активна']), own: !!c['владелец_id']
  };
}

// ---------- Помощники ----------
function fail(msg, code) {
  var e = new Error(msg);
  e.userMessage = msg;
  e.code = code || 'error';
  throw e;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail('Сервер занят, попробуй ещё раз', 'busy');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) fail('Таблица не настроена: запусти «Первоначальная настройка»', 'server');
  return sh;
}

function readAll_(name, headers) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, headers.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

function writeRow_(name, headers, obj) {
  var sh = sheet_(name);
  var row = headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  if (obj._row) sh.getRange(obj._row, 1, 1, headers.length).setValues([row]);
  else sh.appendRow(row);
}

function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function newId_(prefix) { return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16); }

function cleanId_(id) {
  id = String(id || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) fail('Неверный идентификатор', 'bad');
  return id;
}

function cleanDate_(d) {
  d = String(d || '');
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  var dt = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!dt || dt.getUTCDate() !== +m[3] || +m[1] < 2000 || +m[1] > 2100) fail('Неверная дата', 'bad');
  return d;
}

function toDateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}

// Обрезаем длину и защищаемся от «формул в ячейке»: текст, начинающийся с = + - @,
// таблица могла бы выполнить как формулу. Апостроф в начале делает его обычным текстом.
function cleanText_(s, max) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
