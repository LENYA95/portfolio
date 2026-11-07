/* Касса клуба — логика приложения. Чистый JavaScript, без сборщиков. */
'use strict';

const CFG = window.APP_CONFIG || {};
const IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
// На компьютере, пока адрес сервера не вставлен, работаем с имитацией сервера (папка dev).
// DEMO: true — демо для портфолио: тот же код сервера работает на имитации таблицы в браузере посетителя.
const DEMO = !!CFG.DEMO;
const USE_MOCK = DEMO || (IS_LOCAL && !/^https:\/\//.test(CFG.API_URL || ''));

const EXP = 'расход';
const INC = 'доход';

const S = {
  token: null, user: null, people: [], cats: [], ops: [], queue: [],
  section: localStorage.getItem('cf_section') === 'personal' ? 'personal' : 'club',
  tab: 'add', flushing: false, edit: null, loaded: false,
  form: null,
  hist: { q: '', period: 'month', from: '', to: '', cat: '', author: '' },
  charts: { period: 'month', from: '', to: '' },
  setType: EXP,
};

const $ = (sel, root = document) => root.querySelector(sel);
const view = () => $('#view');

// ---------- Форматирование ----------
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const money = (n) => nf.format(n).replace(/ /g, ' ') + ' ₽';
const signed = (op) => (op.type === EXP ? '−' : '+') + money(op.amount);
const pad2 = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => isoDate(new Date());
const ruDate = (s) => (s ? s.split('-').reverse().join('.') : '');
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function dayTitle(s) {
  const d = new Date(s + 'T12:00:00');
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === today()) return `Сегодня, ${ruDate(s)}`;
  if (s === isoDate(y)) return `Вчера, ${ruDate(s)}`;
  return `${ruDate(s)}, ${WD[d.getDay()]}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function parseAmount(s) {
  const n = Number(String(s).replace(/\s| /g, '').replace(',', '.'));
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// ---------- Связь с сервером ----------
let devReady = null;
function loadScript(src) {
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.append(s); });
}
function ensureDev() {
  const [mock, backend] = CFG.MOCK_SCRIPTS || ['../dev/gas-mock.js', '../dev/dev-backend.js'];
  if (!devReady) devReady = loadScript(mock).then(() => loadScript(backend)).then(() => window.DevBackend.ready);
  return devReady;
}

class ApiError extends Error {
  constructor(msg, code, offline) { super(msg); this.code = code; this.offline = !!offline; }
}

/**
 * Запрос к Apps Script. POST + Content-Type: text/plain + JSON в теле:
 * такой запрос браузер отправляет сразу, без предварительного OPTIONS (CORS preflight),
 * который Apps Script не поддерживает.
 */
async function api(action, data = {}) {
  const body = JSON.stringify({ action, token: S.token, ...data });
  let res;
  if (USE_MOCK) {
    await ensureDev();
    try { res = await window.DevBackend.post(body); } // имитация: может «пропасть связь», как в жизни
    catch (e) { throw new ApiError('Нет связи', 'offline', true); }
  } else {
    let r;
    try {
      r = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
    } catch (e) {
      throw new ApiError('Нет связи', 'offline', true);
    }
    try { res = await r.json(); } catch (e) {
      throw new ApiError('Сервер ответил непонятно. Проверь адрес в config.js и доступ «Все»', 'server');
    }
  }
  if (!res.ok) throw new ApiError(res.error || 'Ошибка', res.code);
  return res;
}

// ---------- Хранение на устройстве ----------
const key = (name) => `cf_${name}_${S.user ? S.user.id : 'x'}`;
function saveLocal() {
  localStorage.setItem(key('data'), JSON.stringify({ user: S.user, people: S.people, cats: S.cats, ops: S.ops }));
}
function saveQueue() { localStorage.setItem(key('queue'), JSON.stringify(S.queue)); }
function loadLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(key('data')) || 'null');
    if (d) { S.people = d.people || []; S.cats = d.cats || []; S.ops = d.ops || []; S.loaded = true; }
    S.queue = JSON.parse(localStorage.getItem(key('queue')) || '[]');
  } catch (e) { S.queue = []; }
}

// ---------- Очередь отправки ----------
// Каждое изменение сначала применяется на телефоне и попадает в очередь, потом уходит на сервер.
// У записи постоянный id, поэтому повторная отправка той же записи не создаёт дубль.
function applyLocal(item) {
  if (item.action === 'saveOp') {
    const op = item.data.op;
    const i = S.ops.findIndex((o) => o.id === op.id);
    if (i >= 0) S.ops[i] = { ...S.ops[i], ...op }; else S.ops.push(op);
  } else if (item.action === 'deleteOp') {
    S.ops = S.ops.filter((o) => o.id !== item.data.id);
  } else if (item.action === 'saveCat') {
    const c = item.data.cat;
    const i = S.cats.findIndex((x) => x.id === c.id);
    if (i >= 0) S.cats[i] = { ...S.cats[i], ...c }; else S.cats.push(c);
  }
}

function enqueue(action, data) {
  const item = { qid: newId(), action, data };
  S.queue.push(item);
  applyLocal(item);
  saveQueue(); saveLocal();
  renderStatus();
  // Если отправить не вышло (Wi-Fi есть, а интернета нет) — честно говорим, что запись ждёт на телефоне.
  flush().then(() => {
    if (S.offline && S.queue.some((q) => q.qid === item.qid)) toast('Нет связи, запись сохранена на телефоне. Отправится сама.', 'warn');
  });
  return item;
}

const pendingIds = () => new Set(S.queue.map((q) => (q.data.op && q.data.op.id) || q.data.id || (q.data.cat && q.data.cat.id)));

async function flush() {
  if (S.flushing || !S.token) return;
  S.flushing = true; renderStatus();
  let offline = false;
  try {
    while (S.queue.length) {
      const item = S.queue[0];
      try {
        await api(item.action, item.data);
        S.queue.shift(); saveQueue(); S.offline = false;
      } catch (e) {
        if (e.offline) { offline = true; break; }
        if (e.code === 'auth') { authLost(e.message); return; }
        if (e.code === 'busy' || e.code === 'server') { offline = true; break; } // попробуем позже
        S.queue.shift(); saveQueue();
        toast('Сервер не принял изменение: ' + e.message, 'error');
      }
    }
    if (!offline) await sync();
  } finally {
    S.flushing = false;
    if (offline) S.offline = true; // при успехе флаг снимают api-вызовы выше и sync()
    renderStatus();
  }
}

async function sync() {
  try {
    const r = await api('sync');
    S.user = r.user; S.people = r.people; S.cats = r.cats; S.ops = r.ops; S.loaded = true;
    S.queue.forEach(applyLocal); // неотправленное остаётся видно
    saveLocal();
    S.offline = false;
    render();
  } catch (e) {
    if (e.code === 'auth') authLost(e.message);
    else if (e.offline) S.offline = true;
    else toast(e.message, 'error');
  }
}

function authLost(msg) {
  // Очередь не стираем: после повторного входа она отправится.
  S.token = null;
  localStorage.removeItem('cf_token');
  showLogin(msg || 'Нужно войти заново');
}

// ---------- Права (повторяют серверные — только для удобства интерфейса) ----------
const isAdmin = () => S.user && S.user.role === 'admin';
const canEditOp = (op) => op.section === 'personal' ? op.author === S.user.id : (op.author === S.user.id || isAdmin());
const canEditCat = (c) => c.section === 'personal' || isAdmin();

// ---------- Данные для экранов ----------
const catById = (id) => S.cats.find((c) => c.id === id);
const topCats = (type, onlyActive = true) => S.cats.filter((c) => c.section === S.section && c.type === type && !c.parent && (!onlyActive || c.active));
const subCats = (parentId, onlyActive = true) => S.cats.filter((c) => c.parent === parentId && (!onlyActive || c.active));
const personName = (id) => (S.people.find((p) => p.id === id) || {}).name || 'Неизвестно';
const sectionOps = () => S.ops.filter((o) => o.section === S.section);

function catLabel(op) {
  const c = catById(op.cat), s = op.sub && catById(op.sub);
  return { name: c ? c.name : 'Без категории', sub: s ? s.name : '', color: c ? c.color : '#8D99AE' };
}

function periodRange(kind, from, to) {
  const now = new Date();
  if (kind === 'week') { const s = new Date(); s.setDate(s.getDate() - 6); return [isoDate(s), today()]; }
  if (kind === 'month') return [isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  if (kind === 'custom') return [from || '0000-01-01', to || '9999-12-31'];
  return ['0000-01-01', '9999-12-31'];
}

// ---------- Отрисовка ----------
function showLogin(msg) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#l-error').textContent = msg || '';
  $('#l-pin').value = '';
}

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  render();
}

function render() {
  if ($('#app').hidden) return;
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === S.section)));
  document.querySelectorAll('.tabs button').forEach((b) => { if (b.dataset.v === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  renderStatus();
  destroyCharts();
  if (S.tab === 'add') renderAdd();
  else if (S.tab === 'history') renderHistory();
  else if (S.tab === 'charts') renderCharts();
  else renderSettings();
}

function renderStatus() {
  const el = $('#status');
  if (!el) return;
  const n = S.queue.length;
  el.className = 'status';
  if (n) { el.classList.add('queue'); el.textContent = `Не отправлено: ${n}`; el.title = 'Нажми, чтобы отправить сейчас'; }
  else if (S.flushing) { el.classList.add('busy'); el.textContent = 'Обновляю'; }
  else if (S.offline || !navigator.onLine) { el.classList.add('off'); el.textContent = 'Нет связи'; }
  else { el.textContent = 'Всё сохранено'; el.title = 'Нажми, чтобы обновить'; }
  if (S.flushing && n) el.classList.add('busy');
}

// ----- Вкладка «Добавить» -----
function blankForm(type = EXP) { return { type, cat: '', sub: '', amount: '', date: today(), note: '' }; }

function renderAdd() {
  const f = S.form || (S.form = blankForm());
  const cats = topCats(f.type);
  const subs = f.cat ? subCats(f.cat) : [];
  const word = f.type === EXP ? 'расход' : 'доход';
  view().innerHTML = `
    ${S.edit ? `<div class="edit-bar"><strong>Изменение записи</strong><button class="btn small" data-act="cancelEdit">Отменить</button></div>` : ''}
    <div class="kind" role="radiogroup" aria-label="Тип">
      <button class="exp" role="radio" aria-checked="${f.type === EXP}" data-act="ftype" data-v="${EXP}">Расход</button>
      <button class="inc" role="radio" aria-checked="${f.type === INC}" data-act="ftype" data-v="${INC}">Доход</button>
    </div>
    <label class="amount" style="--kind-c: var(${f.type === EXP ? '--exp' : '--inc'})">
      <span class="sr">Сумма</span>
      <input id="f-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.amount)}" enterkeyhint="done">
      <span class="cur">₽</span>
    </label>
    <p class="label">Категория</p>
    <div class="tiles">
      ${cats.map((c) => `<button class="tile" style="--c:${esc(c.color)}" aria-pressed="${f.cat === c.id}" data-act="fcat" data-v="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
    </div>
    ${cats.length ? '' : `<p class="empty">Категорий пока нет. Добавь их в Настройках.</p>`}
    ${subs.length ? `<div class="chips" aria-label="Подкатегория">
      ${subs.map((s) => `<button class="chip" aria-pressed="${f.sub === s.id}" data-act="fsub" data-v="${esc(s.id)}">${esc(s.name)}</button>`).join('')}
    </div>` : ''}
    <label class="field"><span>Дата</span><input id="f-date" type="date" value="${esc(f.date)}" max="2100-12-31"></label>
    <label class="field"><span>Заметка</span><input id="f-note" maxlength="300" value="${esc(f.note)}" placeholder="${S.section === 'club' ? 'Например: аренда за ноябрь' : 'Необязательно'}"></label>
    <button class="btn primary big" data-act="saveOp">${S.edit ? 'Сохранить изменения' : `Сохранить ${word}`}</button>
  `;
  $('#f-amount').addEventListener('input', (e) => { f.amount = e.target.value; });
  $('#f-date').addEventListener('input', (e) => { f.date = e.target.value; });
  $('#f-note').addEventListener('input', (e) => { f.note = e.target.value; });
}

function saveOp() {
  const f = S.form;
  const amount = parseAmount(f.amount);
  if (!(amount > 0)) { toast('Введи сумму больше нуля', 'error'); $('#f-amount').focus(); return; }
  if (!f.cat) { toast('Выбери категорию', 'error'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { toast('Укажи дату', 'error'); return; }
  const base = S.edit || {};
  const op = {
    id: base.id || newId(), section: base.section || S.section, type: f.type, amount,
    cat: f.cat, sub: f.sub, date: f.date, note: f.note.trim(),
    author: base.author || S.user.id, created: base.created || new Date().toISOString(),
  };
  const wasEdit = !!S.edit;
  enqueue('saveOp', { op });
  const c = catLabel(op);
  S.edit = null;
  S.form = blankForm(f.type);
  S.form.date = f.date; // дату оставляем: часто вносят несколько записей за один день
  if (!navigator.onLine) toast('Нет связи, запись сохранена на телефоне. Отправится сама.', 'warn');
  else toast(`${wasEdit ? 'Изменено' : 'Сохранено'}: ${signed(op)}, ${c.name}`);
  if (wasEdit) { S.tab = 'history'; }
  render();
}

// ----- Вкладка «История» -----
function renderHistory() {
  const h = S.hist;
  const club = S.section === 'club';
  const allTop = S.cats.filter((c) => c.section === S.section && !c.parent);
  view().innerHTML = `
    <input id="h-q" type="search" placeholder="Поиск: заметка, категория${club ? ', автор' : ''}" value="${esc(h.q)}" aria-label="Поиск">
    <div class="filters">
      <select id="h-period" aria-label="Период">
        ${[['week', 'Последние 7 дней'], ['month', 'Этот месяц'], ['all', 'Всё время'], ['custom', 'Свой период']].map(([v, t]) => `<option value="${v}" ${h.period === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select id="h-cat" aria-label="Категория">
        <option value="">Все категории</option>
        ${[EXP, INC].map((t) => `<optgroup label="${t === EXP ? 'Расходы' : 'Доходы'}">${allTop.filter((c) => c.type === t).map((c) => `<option value="${esc(c.id)}" ${h.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}
      </select>
      ${club ? `<select id="h-author" class="wide" aria-label="Кто внёс">
        <option value="">Все участники</option>
        ${S.people.map((p) => `<option value="${esc(p.id)}" ${h.author === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>` : ''}
    </div>
    ${h.period === 'custom' ? `<div class="dates"><label class="field"><span>С</span><input id="h-from" type="date" value="${esc(h.from)}"></label><label class="field"><span>По</span><input id="h-to" type="date" value="${esc(h.to)}"></label></div>` : ''}
    <div id="h-list"></div>
  `;
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('#h-q', 'input', (e) => { h.q = e.target.value; renderHistList(); });
  on('#h-period', 'change', (e) => { h.period = e.target.value; renderHistory(); });
  on('#h-cat', 'change', (e) => { h.cat = e.target.value; renderHistList(); });
  on('#h-author', 'change', (e) => { h.author = e.target.value; renderHistList(); });
  on('#h-from', 'change', (e) => { h.from = e.target.value; renderHistList(); });
  on('#h-to', 'change', (e) => { h.to = e.target.value; renderHistList(); });
  renderHistList();
}

function renderHistList() {
  const h = S.hist;
  const [from, to] = periodRange(h.period, h.from, h.to);
  const q = h.q.trim().toLowerCase();
  const pend = pendingIds();
  const list = sectionOps().filter((o) => {
    if (o.date < from || o.date > to) return false;
    if (h.cat && o.cat !== h.cat) return false;
    if (S.section === 'club' && h.author && o.author !== h.author) return false;
    if (q) {
      const c = catLabel(o);
      const hay = [o.note, c.name, c.sub, S.section === 'club' ? personName(o.author) : ''].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created));

  if (!S.loaded) { $('#h-list').innerHTML = `<p class="empty">Данные ещё не загружены. Нужна связь с интернетом.</p>`; return; }
  if (!list.length) { $('#h-list').innerHTML = `<p class="empty">Записей нет. Измени фильтры или добавь запись на вкладке «Добавить».</p>`; return; }

  const inc = list.filter((o) => o.type === INC).reduce((s, o) => s + o.amount, 0);
  const exp = list.filter((o) => o.type === EXP).reduce((s, o) => s + o.amount, 0);
  const days = {};
  list.forEach((o) => (days[o.date] = days[o.date] || []).push(o));

  $('#h-list').innerHTML = `
    <div class="totals"><span>Записей: <b>${list.length}</b></span><span class="inc-t">+${money(inc)}</span><span class="exp-t">−${money(exp)}</span></div>
    ${Object.keys(days).map((d) => {
      const ops = days[d];
      const bal = ops.reduce((s, o) => s + (o.type === INC ? o.amount : -o.amount), 0);
      return `<div class="day"><div class="day-head"><span>${dayTitle(d)}</span><span>${bal >= 0 ? '+' : '−'}${money(Math.abs(bal))}</span></div>
        ${ops.map((o) => {
          const c = catLabel(o);
          const meta = [
            pend.has(o.id) ? '<span class="pend">не отправлено</span>' : '',
            S.section === 'club' ? esc(personName(o.author)) : '',
            esc(o.note),
          ].filter(Boolean).join(', ');
          return `<button class="op" data-act="openOp" data-v="${esc(o.id)}">
            <span class="op-bar" style="--c:${esc(c.color)}"></span>
            <span class="op-main"><span class="op-cat">${esc(c.name)}${c.sub ? ' › ' + esc(c.sub) : ''}</span>${meta ? `<span class="op-meta">${meta}</span>` : ''}</span>
            <span class="op-amt ${o.type === EXP ? 'exp-t' : 'inc-t'}">${signed(o)}</span>
          </button>`;
        }).join('')}</div>`;
    }).join('')}
  `;
}

function openOp(id) {
  const o = S.ops.find((x) => x.id === id);
  if (!o) return;
  const c = catLabel(o);
  const can = canEditOp(o);
  openSheet(`
    <div class="big-amt ${o.type === EXP ? 'exp-t' : 'inc-t'}">${signed(o)}</div>
    <dl>
      <dt>Категория</dt><dd>${esc(c.name)}${c.sub ? ' › ' + esc(c.sub) : ''}</dd>
      <dt>Дата</dt><dd>${ruDate(o.date)}</dd>
      ${o.note ? `<dt>Заметка</dt><dd>${esc(o.note)}</dd>` : ''}
      ${o.section === 'club' ? `<dt>Внёс</dt><dd>${esc(personName(o.author))}</dd>` : ''}
    </dl>
    <div class="actions">
      ${can ? `<button class="btn big" data-act="editOp" data-v="${esc(o.id)}">Изменить</button>
               <button class="btn big danger" data-act="delOp" data-v="${esc(o.id)}">Удалить</button>`
            : `<p class="note">Изменить эту запись может только тот, кто её внёс, или админ.</p>`}
      <button class="btn big" data-act="closeSheet">Закрыть</button>
    </div>
  `);
}

function editOp(id) {
  const o = S.ops.find((x) => x.id === id);
  if (!o) return;
  closeSheet();
  S.edit = o;
  S.form = { type: o.type, cat: o.cat, sub: o.sub, amount: String(o.amount).replace('.', ','), date: o.date, note: o.note };
  S.tab = 'add';
  render();
}

function delOp(id, btn) {
  if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Точно удалить? Нажми ещё раз'; return; }
  closeSheet();
  enqueue('deleteOp', { id });
  toast('Запись удалена');
  render();
}

// ----- Вкладка «Графики» -----
let charts = [];
function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

function renderCharts() {
  const p = S.charts;
  const [from, to] = periodRange(p.period, p.from, p.to);
  const ops = sectionOps().filter((o) => o.date >= from && o.date <= to);
  const inc = ops.filter((o) => o.type === INC).reduce((s, o) => s + o.amount, 0);
  const exp = ops.filter((o) => o.type === EXP).reduce((s, o) => s + o.amount, 0);
  const bal = inc - exp;

  // Расходы по категориям
  const byCat = {};
  ops.filter((o) => o.type === EXP).forEach((o) => { byCat[o.cat] = (byCat[o.cat] || 0) + o.amount; });
  const catRows = Object.entries(byCat).map(([id, sum]) => ({ c: catById(id) || { name: 'Без категории', color: '#8D99AE' }, sum })).sort((a, b) => b.sum - a.sum);

  // По месяцам: 6 месяцев, заканчивая месяцем конца периода
  const endD = to.startsWith('9999') ? new Date() : new Date(to + 'T12:00:00');
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(endD.getFullYear(), endD.getMonth() - i, 1); months.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`); }
  const mInc = months.map((m) => sectionOps().filter((o) => o.type === INC && o.date.startsWith(m)).reduce((s, o) => s + o.amount, 0));
  const mExp = months.map((m) => sectionOps().filter((o) => o.type === EXP && o.date.startsWith(m)).reduce((s, o) => s + o.amount, 0));

  // Кто вносил (клуб)
  const who = {};
  if (S.section === 'club') ops.forEach((o) => { const w = who[o.author] = who[o.author] || { inc: 0, exp: 0 }; w[o.type === INC ? 'inc' : 'exp'] += o.amount; });
  const whoRows = Object.entries(who).sort((a, b) => (b[1].inc + b[1].exp) - (a[1].inc + a[1].exp));
  const whoMax = Math.max(1, ...whoRows.map(([, w]) => w.inc + w.exp));

  view().innerHTML = `
    <div class="periods" role="radiogroup" aria-label="Период">
      ${[['week', 'Неделя'], ['month', 'Месяц'], ['custom', 'Свой период']].map(([v, t]) => `<button class="chip" aria-pressed="${p.period === v}" data-act="cperiod" data-v="${v}">${t}</button>`).join('')}
    </div>
    ${p.period === 'custom' ? `<div class="dates"><label class="field"><span>С</span><input id="c-from" type="date" value="${esc(p.from)}"></label><label class="field"><span>По</span><input id="c-to" type="date" value="${esc(p.to)}"></label></div>` : ''}
    <div class="board">
      <div><small>Доходы</small><strong class="inc-t">${money(inc)}</strong></div>
      <div><small>Расходы</small><strong class="exp-t">${money(exp)}</strong></div>
      <div class="bal"><small>Баланс за период${p.period === 'custom' && p.from ? `, ${ruDate(from)} — ${p.to ? ruDate(to) : 'сегодня'}` : ''}</small><strong class="${bal < 0 ? 'exp-t' : ''}">${bal < 0 ? '−' : ''}${money(Math.abs(bal))}</strong></div>
    </div>
    <div class="card">
      <h3>Расходы по категориям</h3>
      ${catRows.length ? `<div class="chart-box"><canvas id="ch-pie" aria-label="Круговая диаграмма расходов"></canvas></div>
      <ul class="legend">${catRows.map((r) => `<li><i style="--c:${esc(r.c.color)}"></i><span>${esc(r.c.name)}</span><span>${money(r.sum)}, ${Math.round(r.sum / exp * 100)}%</span></li>`).join('')}</ul>`
      : `<p class="empty">За этот период расходов нет.</p>`}
    </div>
    <div class="card">
      <h3>Доходы и расходы по месяцам</h3>
      <div class="chart-box"><canvas id="ch-bar" aria-label="Столбцы по месяцам"></canvas></div>
      <p class="note">Последние 6 месяцев${p.period === 'custom' && p.to ? ` до ${ruDate(to)}` : ''}.</p>
    </div>
    ${S.section === 'club' ? `<div class="card">
      <h3>Кто вносил записи</h3>
      ${whoRows.length ? `<div class="who">${whoRows.map(([id, w]) => `<div class="who-row">
        <div class="nums"><b>${esc(personName(id))}</b><span><span class="inc-t">+${money(w.inc)}</span>&nbsp; <span class="exp-t">−${money(w.exp)}</span></span></div>
        <div class="who-bar"><i style="width:${w.inc / whoMax * 100}%;background:var(--inc)"></i><i style="width:${w.exp / whoMax * 100}%;background:var(--exp)"></i></div>
      </div>`).join('')}</div>` : `<p class="empty">За этот период записей нет.</p>`}
    </div>` : ''}
  `;
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('change', fn); };
  on('#c-from', (e) => { p.from = e.target.value; renderCharts(); });
  on('#c-to', (e) => { p.to = e.target.value; renderCharts(); });

  if (!window.Chart) {
    document.querySelectorAll('.chart-box').forEach((b) => { b.outerHTML = '<p class="note">Графики появятся, когда будет интернет: библиотека ещё не загружена.</p>'; });
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const textC = css.getPropertyValue('--muted').trim(), lineC = css.getPropertyValue('--line').trim();
  const surf = css.getPropertyValue('--surface').trim();
  Chart.defaults.font.family = css.getPropertyValue('--font');
  Chart.defaults.color = textC;
  const tip = { callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${money(ctx.parsed.y ?? ctx.parsed)}` } };
  if (catRows.length) {
    charts.push(new Chart($('#ch-pie'), {
      type: 'doughnut',
      data: { labels: catRows.map((r) => r.c.name), datasets: [{ data: catRows.map((r) => r.sum), backgroundColor: catRows.map((r) => r.c.color), borderColor: surf, borderWidth: 3 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: tip }, animation: { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500 } },
    }));
  }
  charts.push(new Chart($('#ch-bar'), {
    type: 'bar',
    data: {
      labels: months.map((m) => MONTHS[+m.slice(5) - 1]),
      datasets: [
        { label: 'Доходы', data: mInc, backgroundColor: css.getPropertyValue('--inc').trim(), borderRadius: 4 },
        { label: 'Расходы', data: mExp, backgroundColor: css.getPropertyValue('--exp').trim(), borderRadius: 4 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12 } }, tooltip: tip },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: lineC }, border: { display: false }, ticks: { callback: (v) => v >= 1000 ? nf.format(v / 1000) + 'k' : v } },
      },
      animation: { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500 },
    },
  }));
}

// ----- Вкладка «Настройки» -----
function renderSettings() {
  const t = S.setType;
  const tops = topCats(t, false);
  const club = S.section === 'club';
  const canAddHere = true; // клубные категории может добавлять любой участник
  view().innerHTML = `
    <div class="card me">
      <div><strong>${esc(S.user.name)}</strong><div class="note">${isAdmin() ? 'Админ клуба' : 'Участник клуба'}</div></div>
      <button class="btn small" data-act="logout">Выйти</button>
    </div>

    <div class="card">
      <h3>Категории: ${club ? 'клуб' : 'личные'}</h3>
      <div class="seg" style="margin-bottom:10px">
        <button type="button" aria-selected="${t === EXP}" data-act="settype" data-v="${EXP}">Расходы</button>
        <button type="button" aria-selected="${t === INC}" data-act="settype" data-v="${INC}">Доходы</button>
      </div>
      ${club && !isAdmin() ? '<p class="note">Переименовать, перекрасить или скрыть клубную категорию может только админ. Добавить новую — любой участник.</p>' : ''}
      <ul class="cat-list">
        ${tops.map((c) => catRow(c, false) + subCats(c.id, false).map((s) => catRow(s, true)).join('')).join('')}
      </ul>
      ${canAddHere ? `<div class="add-cat">
        <label class="field wide" style="margin:0"><span>Новая категория</span><input id="nc-name" maxlength="40" placeholder="Например: Сборы"></label>
        <label class="field" style="margin:0"><span>Внутри категории</span>
          <select id="nc-parent"><option value="">Нет, отдельная</option>${topCats(t).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
        </label>
        <label class="field" style="margin:0"><span>Цвет</span><input id="nc-color" type="color" value="#3A6EA5"></label>
        <button class="btn primary wide" data-act="addCat">Добавить категорию</button>
      </div>` : ''}
    </div>

    <div class="card">
      <h3>Экспорт</h3>
      <p class="note" style="margin:0 0 10px">Файл CSV откроется в Excel. ${club ? 'Все записи клуба.' : 'Только твои личные записи.'}</p>
      <button class="btn big" data-act="csv">Скачать CSV: ${club ? 'Клуб' : 'Личное'}</button>
    </div>

    ${S.queue.length ? `<div class="card">
      <h3>Не отправлено: ${S.queue.length}</h3>
      <p class="note" style="margin:0 0 10px">Записи сохранены на телефоне и отправятся сами, когда появится связь.</p>
      <button class="btn big" data-act="flush">Отправить сейчас</button>
    </div>` : ''}

    ${DEMO ? `<div class="card">
      <h3>Демо-версия</h3>
      <p class="note" style="margin:0 0 10px">Записи хранятся только в этом браузере и никуда не отправляются.</p>
      <button class="btn big" data-act="resetDemo">Вернуть исходные записи</button>
    </div>` : ''}

    <p class="note">Светлая или тёмная тема включается так же, как на твоём устройстве.</p>
  `;
  document.querySelectorAll('[data-color]').forEach((el) => el.addEventListener('change', (e) => {
    const c = catById(e.target.dataset.color);
    enqueue('saveCat', { cat: { ...c, color: e.target.value } });
    render();
  }));
}

function catRow(c, isSub) {
  const can = canEditCat(c);
  return `<li class="cat-row ${isSub ? 'sub' : ''} ${c.active ? '' : 'off'}">
    ${can ? `<input type="color" value="${esc(c.color)}" data-color="${esc(c.id)}" aria-label="Цвет: ${esc(c.name)}">` : `<span class="swatch" style="--c:${esc(c.color)}"></span>`}
    <span class="cat-name">${esc(c.name)}</span>
    ${can ? `<span class="cat-actions">
      <button class="btn small" data-act="renameCat" data-v="${esc(c.id)}">Имя</button>
      <button class="btn small" data-act="toggleCat" data-v="${esc(c.id)}">${c.active ? 'Скрыть' : 'Показать'}</button>
    </span>` : ''}
  </li>`;
}

function addCat() {
  const name = $('#nc-name').value.trim();
  if (!name) { toast('Напиши название категории', 'error'); return; }
  const parent = $('#nc-parent').value;
  const exists = S.cats.some((c) => c.section === S.section && c.type === S.setType && c.parent === parent && c.name.toLowerCase() === name.toLowerCase());
  if (exists) { toast('Такая категория уже есть', 'error'); return; }
  enqueue('saveCat', { cat: { id: newId(), section: S.section, type: S.setType, name, color: $('#nc-color').value, parent, active: true, own: S.section === 'personal' } });
  toast(`Категория «${name}» добавлена`);
  render();
}

function renameCat(id) {
  const c = catById(id);
  openSheet(`
    <h3>Новое название</h3>
    <label class="field"><span>Было: ${esc(c.name)}</span><input id="rn-name" maxlength="40" value="${esc(c.name)}"></label>
    <div class="actions">
      <button class="btn primary big" data-act="renameSave" data-v="${esc(id)}">Сохранить название</button>
      <button class="btn big" data-act="closeSheet">Отменить</button>
    </div>`);
  setTimeout(() => $('#rn-name').focus(), 50);
}

function renameSave(id) {
  const name = $('#rn-name').value.trim();
  if (!name) { toast('Название не может быть пустым', 'error'); return; }
  enqueue('saveCat', { cat: { ...catById(id), name } });
  closeSheet(); render();
}

function toggleCat(id) {
  const c = catById(id);
  enqueue('saveCat', { cat: { ...c, active: !c.active } });
  toast(c.active ? `«${c.name}» скрыта. Старые записи остались.` : `«${c.name}» снова видна`);
  render();
}

function exportCsv() {
  const cell = (v) => {
    v = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // Excel не выполнит это как формулу
    return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const head = ['Дата', 'Тип', 'Сумма', 'Категория', 'Подкатегория', 'Заметка'].concat(S.section === 'club' ? ['Кто внёс'] : []);
  const rows = sectionOps().slice().sort((a, b) => a.date.localeCompare(b.date)).map((o) => {
    const c = catLabel(o);
    const r = [ruDate(o.date), o.type, String(o.amount).replace('.', ','), c.name, c.sub, o.note];
    if (S.section === 'club') r.push(personName(o.author));
    return r;
  });
  // BOM в начале и «;» как разделитель — так русский Excel откроет файл без кракозябр и по столбцам.
  const csv = '﻿' + [head].concat(rows).map((r) => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `kassa-${S.section === 'club' ? 'klub' : 'lichnoe'}-${today()}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Файл готов: ${rows.length} записей`);
}

function logout() {
  if (S.queue.length && !confirm(`На телефоне ${S.queue.length} неотправленных изменений. Если выйти сейчас, они пропадут. Выйти?`)) return;
  // На общем устройстве после выхода не должно остаться ни токена, ни данных.
  localStorage.removeItem(key('data'));
  localStorage.removeItem(key('queue'));
  localStorage.removeItem('cf_token');
  localStorage.removeItem('cf_uid');
  Object.assign(S, { token: null, user: null, people: [], cats: [], ops: [], queue: [], loaded: false, edit: null, form: null });
  showLogin();
}

// ---------- Нижняя панель и уведомления ----------
function openSheet(html) {
  const w = $('#sheet');
  $('.sheet', w).innerHTML = html;
  w.hidden = false;
  const first = $('.sheet button, .sheet input', w);
  if (first && first.tagName === 'BUTTON') first.focus({ preventScroll: true });
}
function closeSheet() { $('#sheet').hidden = true; }

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast ' + kind; }, kind === 'error' ? 4500 : 3000);
}

// ---------- Действия по нажатию ----------
const ACTIONS = {
  section: (v) => { S.section = v; localStorage.setItem('cf_section', v); S.edit = null; S.form = null; S.hist.cat = ''; S.hist.author = ''; render(); window.scrollTo(0, 0); },
  tab: (v) => { S.tab = v; render(); window.scrollTo(0, 0); },
  flush: () => { if (!S.queue.length && !navigator.onLine) toast('Нет связи с интернетом', 'warn'); flush(); },
  ftype: (v) => { S.form.type = v; S.form.cat = ''; S.form.sub = ''; renderAdd(); },
  fcat: (v) => { S.form.cat = v; S.form.sub = ''; renderAdd(); },
  fsub: (v) => { S.form.sub = S.form.sub === v ? '' : v; renderAdd(); },
  saveOp: () => saveOp(),
  cancelEdit: () => { S.edit = null; S.form = null; S.tab = 'history'; render(); },
  openOp: (v) => openOp(v),
  editOp: (v) => editOp(v),
  delOp: (v, el) => delOp(v, el),
  closeSheet: () => closeSheet(),
  cperiod: (v) => { S.charts.period = v; renderCharts(); },
  settype: (v) => { S.setType = v; renderSettings(); },
  addCat: () => addCat(),
  renameCat: (v) => renameCat(v),
  renameSave: (v) => renameSave(v),
  toggleCat: (v) => toggleCat(v),
  csv: () => exportCsv(),
  logout: () => logout(),
  resetDemo: () => resetDemo(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACTIONS[el.dataset.act]) return;
  if (el.tagName === 'BUTTON') e.preventDefault();
  ACTIONS[el.dataset.act](el.dataset.v, el);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ---------- Вход ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#l-name').value.trim();
  const pin = $('#l-pin').value.trim();
  const err = $('#l-error');
  if (!name) { err.textContent = 'Введи имя'; return; }
  if (!/^\d{6}$/.test(pin)) { err.textContent = 'PIN — это 6 цифр'; return; }
  const btn = $('#l-submit');
  btn.disabled = true; btn.textContent = 'Вхожу…'; err.textContent = '';
  try {
    const r = await api('login', { name, pin });
    S.token = r.token; S.user = r.user;
    localStorage.setItem('cf_token', r.token);
    localStorage.setItem('cf_uid', r.user.id);
    $('#l-pin').value = ''; // PIN на устройстве не храним
    loadLocal();
    showApp();
    flush();
  } catch (ex) {
    err.textContent = ex.offline ? 'Нет связи. Для входа нужен интернет.' : ex.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Войти';
  }
});

// ---------- Демо для портфолио ----------
// Кнопки быстрого входа за вымышленных людей и плашка «данные только в этом браузере».
function setupDemo() {
  if (!DEMO) return;
  document.body.classList.add('demo');
  const people = CFG.DEMO_PEOPLE || [];
  const box = document.createElement('div');
  box.className = 'demo-login';
  box.innerHTML = `<p>Это демо. Войди за одного из участников вымышленного клуба:</p>
    ${people.map((p, i) => `<button type="button" class="btn big ${i ? '' : 'primary'}" data-demo="${i}">${esc(p.name)}, ${esc(p.label)}</button>`).join('')}
    <p class="note">Попробуй войти за обоих: у каждого свои личные записи, чужие не видны.</p>`;
  $('#login-form').before(box);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-demo]');
    if (!b) return;
    const p = people[+b.dataset.demo];
    $('#l-name').value = p.name; $('#l-pin').value = p.pin;
    $('#login-form').requestSubmit();
  });
  const bar = document.createElement('p');
  bar.className = 'demo-bar';
  bar.textContent = 'Демо: записи хранятся только у тебя в браузере';
  $('.top').prepend(bar);
}

function resetDemo() {
  if (!confirm('Вернуть демо к исходным записям? Всё, что ты добавил, пропадёт.')) return;
  Object.keys(localStorage).filter((k) => k.startsWith('cf_')).forEach((k) => localStorage.removeItem(k));
  location.reload();
}

// ---------- Запуск ----------
function start() {
  setupDemo();
  if ('serviceWorker' in navigator && !USE_MOCK) navigator.serviceWorker.register('sw.js').catch(() => {});
  const token = localStorage.getItem('cf_token');
  const uid = localStorage.getItem('cf_uid');
  if (token && uid) {
    S.token = token;
    S.user = { id: uid, name: '', role: 'member' };
    loadLocal();
    try { const d = JSON.parse(localStorage.getItem(key('data')) || 'null'); if (d && d.user) S.user = d.user; } catch (e) {}
    showApp();
    flush();
  } else {
    showLogin();
  }
  window.addEventListener('online', () => flush());
  window.addEventListener('offline', () => { S.offline = true; renderStatus(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token) flush(); });
  setInterval(() => { if (S.queue.length && S.token) flush(); }, 30000);
}
start();
