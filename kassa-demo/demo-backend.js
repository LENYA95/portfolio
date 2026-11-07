/**
 * «Сервер» демо-версии: настоящий Code.gs + имитация Google (gas-mock.js).
 * Данные лежат в localStorage посетителя (ключ cf_demo_db) и никуда не уходят.
 * Клуб, люди и суммы вымышленные.
 */
window.DevBackend = (function () {
  'use strict';
  var DB_KEY = 'cf_demo_db';

  function call(obj) { return GasMock.post(JSON.stringify(obj)); }

  function seed() {
    setup();
    addPersonCore('Ирина', 'admin', '111111');
    addPersonCore('Максим', 'member', '222222');
    addPersonCore('Аня', 'member', '333333');
    addPersonCore('Олег', 'member', '444444');

    function as(name, pin) {
      var t = call({ action: 'login', name: name, pin: pin }).token;
      return { t: t, d: call({ action: 'sync', token: t }) };
    }
    function cat(d, section, type, name, parentName) {
      var parent = parentName && d.cats.filter(function (c) { return c.section === section && c.type === type && c.name === parentName && !c.parent; })[0];
      return d.cats.filter(function (c) {
        return c.section === section && c.type === type && c.name === name && (parent ? c.parent === parent.id : !c.parent);
      })[0];
    }
    function day(monthsAgo, d) {
      var x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - monthsAgo); x.setDate(Math.min(d, 28));
      if (x > new Date()) x = new Date();
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    }
    function add(u, section, type, amount, catName, subName, date, note) {
      var c = cat(u.d, section, type, catName);
      var s = subName ? cat(u.d, section, type, subName, catName) : null;
      call({ action: 'saveOp', token: u.t, op: {
        id: crypto.randomUUID(), section: section, type: type, amount: amount,
        cat: c.id, sub: s ? s.id : '', date: date, note: note || '' } });
    }

    var I = as('Ирина', '111111'), M = as('Максим', '222222'), A = as('Аня', '333333'), O = as('Олег', '444444');
    for (var m = 5; m >= 0; m--) {
      add(I, 'club', 'расход', 22000, 'Аренда зала', null, day(m, 2), 'Зал на месяц');
      add(I, 'club', 'расход', 38000, 'Зарплата тренеров', null, day(m, 25), 'Две группы');
      add(M, 'club', 'доход', 2800 * (12 + m % 3), 'Абонементы и взносы', null, day(m, 5), 'Старшая группа');
      add(A, 'club', 'доход', 2400 * (8 + m % 2), 'Абонементы и взносы', null, day(m, 7), 'Младшая группа');
      if (m % 2 === 0) add(O, 'club', 'расход', 3900 + m * 200, 'Инвентарь', null, day(m, 12), 'Мячи и фишки');
      if (m % 3 === 1) add(I, 'club', 'расход', 4500, 'Реклама', null, day(m, 9), 'Листовки у школ');
      add(I, 'personal', 'расход', 7200 + m * 350, 'Еда', null, day(m, 10), '');
      add(I, 'personal', 'расход', 1900, 'Транспорт', null, day(m, 3), 'Проездной');
      add(I, 'personal', 'доход', 18000 + m * 1500, 'Подработка', null, day(m, 15), '');
      add(M, 'personal', 'расход', 4100 + m * 200, 'Еда', null, day(m, 11), '');
      add(M, 'personal', 'расход', 790, 'Подписки', null, day(m, 1), 'Музыка');
      add(M, 'personal', 'доход', 4500, 'Стипендия', null, day(m, 20), '');
    }
    add(M, 'club', 'расход', 14000, 'Соревнования', 'Взносы', day(0, 3), 'Турнир, 10 человек');
    add(O, 'club', 'расход', 6200, 'Соревнования', 'Проезд', day(0, 4), 'Автобус туда и обратно');
    add(A, 'club', 'доход', 11000, 'Сданные деньги за соревнования', null, day(0, 4), 'Родители сдали на турнир');
    add(I, 'club', 'расход', 9800, 'Экипировка', null, day(1, 14), 'Форма для новичков');
    add(A, 'club', 'доход', 9800, 'Сданные деньги за экипировку', null, day(1, 16), '');
    add(M, 'club', 'расход', 6400, 'Развлечения', 'Боулинг', day(1, 22), 'Боулинг после сезона');
    add(I, 'club', 'доход', 15000, 'Спонсоры', null, day(2, 8), 'Спортмагазин на районе');
    add(M, 'personal', 'расход', 2300, 'Одежда', null, day(0, 2), 'Кроссовки');
  }

  var ready = (async function () {
    var isNew = GasMock.init(DB_KEY);
    await GasMock.loadCode('Code.gs');
    if (isNew) seed();
  })();

  return {
    ready: ready,
    post: async function (body) {
      await ready;
      await new Promise(function (r) { setTimeout(r, 120); });
      return GasMock.post(body);
    }
  };
})();
