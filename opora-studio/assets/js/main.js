/* «Опора»: общий скрипт для всех страниц.
   1. Бургер-меню на телефоне
   2. Выпрямление позвонков на главной (одно движение на сайте)
   3. Окно записи на пробное занятие
   4. Демо-формы: проверка полей, «Отправляем…», сообщение «это демо»
   5. Расписание: фильтр по дню и направлению (schedule.html)
   6. Ближайшие занятия (index.html)
   Данные расписания совпадают с legend.md. */

(function () {
  'use strict';

  /* ---------- данные ---------- */
  var DIRS = {
    reformer: { name: 'Пилатес на реформере', dur: 55, level: 'начальный и средний' },
    mat:      { name: 'Мат-пилатес',          dur: 55, level: 'любой' },
    hatha:    { name: 'Хатха-йога',           dur: 75, level: 'начальный' },
    stretch:  { name: 'Растяжка и спина',     dur: 55, level: 'любой' }
  };
  var DAYS = [
    { key: 'mon', short: 'Пн', full: 'Понедельник' },
    { key: 'tue', short: 'Вт', full: 'Вторник' },
    { key: 'wed', short: 'Ср', full: 'Среда' },
    { key: 'thu', short: 'Чт', full: 'Четверг' },
    { key: 'fri', short: 'Пт', full: 'Пятница' },
    { key: 'sat', short: 'Сб', full: 'Суббота' },
    { key: 'sun', short: 'Вс', full: 'Воскресенье' }
  ];
  var SCHEDULE = [
    ['mon', '08:00', 'reformer', 'Анна'], ['mon', '12:00', 'mat', 'Вера'], ['mon', '19:00', 'hatha', 'Ксения'], ['mon', '20:30', 'stretch', 'Вера'],
    ['tue', '07:45', 'hatha', 'Ксения'], ['tue', '10:00', 'reformer', 'Илья'], ['tue', '18:30', 'reformer', 'Илья'], ['tue', '20:00', 'mat', 'Вера'],
    ['wed', '08:00', 'reformer', 'Анна'], ['wed', '12:00', 'stretch', 'Вера'], ['wed', '19:00', 'hatha', 'Ксения'], ['wed', '20:30', 'reformer', 'Анна'],
    ['thu', '07:45', 'mat', 'Вера'], ['thu', '10:00', 'reformer', 'Илья'], ['thu', '18:30', 'stretch', 'Вера'], ['thu', '20:00', 'reformer', 'Илья'],
    ['fri', '08:00', 'reformer', 'Анна'], ['fri', '12:00', 'hatha', 'Ксения'], ['fri', '19:00', 'mat', 'Вера'],
    ['sat', '10:00', 'reformer', 'Илья'], ['sat', '11:30', 'hatha', 'Ксения'], ['sat', '13:00', 'stretch', 'Вера'],
    ['sun', '10:00', 'mat', 'Вера'], ['sun', '11:30', 'reformer', 'Анна'], ['sun', '16:00', 'hatha', 'Ксения']
  ].map(function (r) { return { day: r[0], time: r[1], dir: r[2], trainer: r[3] }; });

  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  function dayOf(key) { return DAYS.filter(function (d) { return d.key === key; })[0]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- 1. бургер ---------- */
  var burger = $('.burger'), nav = $('#site-nav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') !== 'true';
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      nav.classList.toggle('is-open', open);
      var use = burger.querySelector('use');
      if (use) use.setAttribute('href', open ? '#i-x' : '#i-menu');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { burger.click(); burger.focus(); }
    });
  }

  /* ---------- 2. позвонки выпрямляются ---------- */
  var spine = $('.spine-anim');
  if (spine) {
    var curve = [0, 7, 14, 19, 20, 16, 9, 1, -6, -10, -9, -5];   // лёгкий изгиб, как у сутулой спины
    curve.forEach(function (dx, i) {
      var s = document.createElement('span');
      s.style.setProperty('--i', i);
      s.style.setProperty('--dx', dx + 'px');
      s.style.setProperty('--rot', (dx / 2.2).toFixed(1) + 'deg');
      spine.appendChild(s);
    });
    if (calm) spine.classList.add('is-straight');
    else setTimeout(function () { spine.classList.add('is-straight'); }, 450);
  }

  /* ---------- 4. демо-формы ---------- */
  var RULES = {
    name: function (v) { return v.trim().length >= 2 ? '' : 'Напишите имя, хотя бы две буквы'; },
    phone: function (v) { var d = v.replace(/\D/g, ''); return (d.length === 10 || d.length === 11) ? '' : 'Нужен номер из 10–11 цифр, например +7 900 000-00-00'; }
  };
  function initForm(form) {
    var btn = $('button[type="submit"]', form);
    var label = btn.textContent;
    var done = $('.form-done', form);
    function check(el) {
      var rule = RULES[el.name];
      if (!rule) return true;
      var msg = rule(el.value);
      el.setAttribute('aria-invalid', msg ? 'true' : 'false');
      var err = document.getElementById(el.getAttribute('aria-describedby'));
      if (err) err.textContent = msg;
      return !msg;
    }
    $$('input', form).forEach(function (el) {
      el.addEventListener('blur', function () { if (el.value) check(el); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var bad = null;
      $$('input', form).forEach(function (el) { if (!check(el) && !bad) bad = el; });
      if (bad) { bad.focus(); return; }
      btn.disabled = true;
      btn.textContent = 'Отправляем…';
      setTimeout(function () {
        var name = $('[name="name"]', form).value.trim();
        done.innerHTML = '<p><b>Спасибо, ' + esc(name) + '!</b></p><p>Это демо-сайт, заявка никуда не уходит. ' +
          'В настоящей студии администратор перезвонил бы в течение часа и подтвердил пробное занятие.</p>';
        form.classList.add('is-done');
        done.focus();
      }, 1200);
    });
    form.resetDemo = function () {
      form.classList.remove('is-done');
      form.reset();
      btn.disabled = false;
      btn.textContent = label;
      $$('.field-error', form).forEach(function (e) { e.textContent = ''; });
      $$('[aria-invalid]', form).forEach(function (e) { e.removeAttribute('aria-invalid'); });
    };
  }

  /* ---------- 3. окно записи ---------- */
  var dialog = null;
  function dirOptions() {
    return '<option value="">Пока не знаю, посоветуйте</option>' + Object.keys(DIRS).map(function (k) {
      return '<option value="' + k + '">' + DIRS[k].name + '</option>';
    }).join('');
  }
  function buildDialog() {
    if (!window.HTMLDialogElement) return null;
    var d = document.createElement('dialog');
    d.className = 'dialog';
    d.setAttribute('aria-labelledby', 'dlg-title');
    d.innerHTML =
      '<form class="form" novalidate data-demo-form>' +
        '<div class="dialog-head"><h2 id="dlg-title">Записаться на пробное</h2>' +
        '<button type="button" class="dialog-close" aria-label="Закрыть окно"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button></div>' +
        '<p class="dlg-class muted" hidden></p>' +
        '<p class="muted">Пробное занятие стоит 500 ₽. Перед ним тренер 10 минут спросит про травмы и посмотрит осанку.</p>' +
        '<div class="field"><label for="d-name">Имя</label><input id="d-name" name="name" autocomplete="given-name" required aria-describedby="d-name-e"><span class="field-error" id="d-name-e"></span></div>' +
        '<div class="field"><label for="d-phone">Телефон</label><input id="d-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__" required aria-describedby="d-phone-e"><span class="field-error" id="d-phone-e"></span></div>' +
        '<div class="field"><label for="d-dir">Направление</label><select id="d-dir" name="dir">' + dirOptions() + '</select></div>' +
        '<input type="hidden" name="slot">' +
        '<button class="btn" type="submit">Записаться на пробное</button>' +
        '<p class="form-note">Это демо-сайт: заявка никуда не отправляется.</p>' +
        '<div class="form-done" role="status" tabindex="-1"></div>' +
      '</form>';
    document.body.appendChild(d);
    var form = $('form', d);
    initForm(form);
    $('.dialog-close', d).addEventListener('click', function () { d.close(); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });   // клик по затемнению
    d.addEventListener('close', function () { if (form.classList.contains('is-done')) form.resetDemo(); });
    return d;
  }
  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-book]');
    if (!opener) return;
    dialog = dialog || buildDialog();
    if (!dialog) return;                       // старый браузер: работает обычная ссылка на контакты
    e.preventDefault();
    var form = $('form', dialog);
    if (form.classList.contains('is-done')) form.resetDemo();
    var info = $('.dlg-class', dialog);
    var slot = opener.getAttribute('data-slot') || '';
    $('[name="slot"]', form).value = slot;
    info.hidden = !slot;
    info.textContent = slot ? 'Занятие: ' + slot : '';
    $('#d-dir', form).value = opener.getAttribute('data-dir') || '';
    if (nav && nav.classList.contains('is-open')) burger.click();
    dialog.showModal();
    $('#d-name', form).focus();                // сразу в первое поле, а не на крестик
  });
  $$('[data-demo-form]').forEach(initForm);

  /* ---------- 5. расписание с фильтром ---------- */
  var sched = $('#schedule');
  if (sched) {
    /* Фильтр сохраняется в адресе по-русски: schedule.html?день=пн&направление=хатха
       Старые латинские ссылки (?day=mon&dir=hatha) тоже понимаются.
       Если нужны короткие ссылки для мессенджеров, поставь RU_URL = false. */
    var RU_URL = true;
    var DAY_RU = { mon: 'пн', tue: 'вт', wed: 'ср', thu: 'чт', fri: 'пт', sat: 'сб', sun: 'вс' };
    var DIR_RU = { reformer: 'реформер', mat: 'мат', hatha: 'хатха', stretch: 'растяжка' };
    function fromRu(map, v) {
      if (!v) return null;
      v = v.toLowerCase();
      if (map[v]) return v;                                   // латинское значение
      for (var k in map) if (map[k] === v) return k;          // русское значение
      return null;
    }
    var params = new URLSearchParams(location.search);
    var state = {
      day: fromRu(DAY_RU, params.get('день') || params.get('day')) || 'all',
      dir: fromRu(DIR_RU, params.get('направление') || params.get('dir')) || 'all'
    };
    var dayChips = $('#f-day'), dirChips = $('#f-dir'), status = $('#sched-status');

    dayChips.innerHTML = '<button type="button" class="chip" data-v="all">Вся неделя</button>' +
      DAYS.map(function (d) { return '<button type="button" class="chip" data-v="' + d.key + '"><span aria-hidden="true">' + d.short + '</span><span class="sr-only">' + d.full + '</span></button>'; }).join('');
    dirChips.innerHTML = '<button type="button" class="chip" data-v="all">Все направления</button>' +
      Object.keys(DIRS).map(function (k) { return '<button type="button" class="chip d-' + k + '" data-v="' + k + '"><span class="dot" aria-hidden="true"></span>' + DIRS[k].name + '</button>'; }).join('');

    function word(n) {
      var m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return 'занятие';
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'занятия';
      return 'занятий';
    }
    function render() {
      [[dayChips, state.day], [dirChips, state.dir]].forEach(function (pair) {
        $$('.chip', pair[0]).forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-v') === pair[1])); });
      });
      var list = SCHEDULE.filter(function (s) {
        return (state.day === 'all' || s.day === state.day) && (state.dir === 'all' || s.dir === state.dir);
      });
      if (!list.length) {
        sched.innerHTML = '<div class="empty"><p>В этот день такого занятия нет. Посмотрите всю неделю: направление есть в другие дни.</p>' +
          '<button type="button" class="btn btn--ghost" id="reset-day">Показать всю неделю</button></div>';
        $('#reset-day').addEventListener('click', function () { state.day = 'all'; update(); });
        status.textContent = 'Ничего не найдено';
        return;
      }
      status.textContent = 'Показано ' + list.length + ' ' + word(list.length) + ' в неделю';
      sched.innerHTML = DAYS.filter(function (d) { return list.some(function (s) { return s.day === d.key; }); }).map(function (d) {
        return '<section class="day-block" aria-label="' + d.full + '"><h2>' + d.full + '</h2><ul class="slots">' +
          list.filter(function (s) { return s.day === d.key; }).map(function (s) {
            var dir = DIRS[s.dir];
            var slot = d.short + ' ' + s.time + ', ' + dir.name + ', тренер ' + s.trainer;
            return '<li class="slot d-' + s.dir + '"><time>' + s.time + '</time><b>' + dir.name + '</b>' +
              '<span>' + s.trainer + ', ' + dir.dur + ' минут, уровень ' + dir.level + '</span>' +
              '<a class="btn btn--sm" href="contacts.html#trial" data-book data-dir="' + s.dir + '" data-slot="' + esc(slot) + '">Записаться<span class="sr-only">: ' + esc(slot) + '</span></a></li>';
          }).join('') + '</ul></section>';
      }).join('');
    }
    function update() {
      var q = new URLSearchParams();
      if (state.day !== 'all') q.set(RU_URL ? 'день' : 'day', RU_URL ? DAY_RU[state.day] : state.day);
      if (state.dir !== 'all') q.set(RU_URL ? 'направление' : 'dir', RU_URL ? DIR_RU[state.dir] : state.dir);
      var url = location.pathname + (q.toString() ? '?' + q : '');
      try { history.replaceState(null, '', url); } catch (e) { /* при открытии с диска может не сработать, фильтр всё равно работает */ }
      render();
    }
    dayChips.addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { state.day = c.getAttribute('data-v'); update(); } });
    dirChips.addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { state.dir = c.getAttribute('data-v'); update(); } });
    render();
  }

  /* ---------- 6. ближайшие занятия ---------- */
  var up = $('#upcoming');
  if (up) {
    var now = new Date();
    var todayIdx = (now.getDay() + 6) % 7;                  // 0 = понедельник
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var items = [];
    for (var off = 0; off < 7 && items.length < 4; off++) {
      var di = (todayIdx + off) % 7, d = DAYS[di];
      SCHEDULE.filter(function (s) { return s.day === d.key; }).forEach(function (s) {
        var t = s.time.split(':'), m = +t[0] * 60 + +t[1];
        if (off === 0 && m <= nowMin) return;
        if (items.length < 4) items.push({ s: s, when: off === 0 ? 'Сегодня' : off === 1 ? 'Завтра' : d.full });
      });
    }
    up.innerHTML = items.map(function (it) {
      var dir = DIRS[it.s.dir];
      var d = DAYS.filter(function (x) { return x.key === it.s.day; })[0];
      var slot = d.short + ' ' + it.s.time + ', ' + dir.name + ', тренер ' + it.s.trainer;
      return '<li class="up-card d-' + it.s.dir + '"><time>' + it.s.time + '</time><span class="up-day">' + it.when + '</span>' +
        '<b>' + dir.name + '</b><span class="muted">' + it.s.trainer + ', ' + dir.dur + ' минут</span><span class="up-gap"></span>' +
        '<a class="btn btn--sm" href="contacts.html#trial" data-book data-dir="' + it.s.dir + '" data-slot="' + esc(slot) + '">Записаться<span class="sr-only">: ' + esc(slot) + '</span></a></li>';
    }).join('');
  }
  /* ---------- 7. главная: «пролёт камеры» и въезд блоков (как у «Лака») ----------
     Первый экран стоит на месте: фото приближается, текст растворяется,
     светлая вспышка, и проявляется вторая сцена с видео.
     Остальные блоки въезжают снизу. Только transform и opacity. */
  var intro = $('.intro');
  if (intro) {
    var heroEl = $('.hero', intro), bg = $('.hero-bg', intro), heroIn = $('.hero-in', intro),
        word = $('.hero-word', intro), side = $('.hero-side', intro), flash = $('.stage-flash', intro),
        chapter = $('.chapter', intro), chIn = $('.chapter-in', intro), ghost = $('.chapter-ghost', intro),
        cvid = $('.chapter-video', intro), vtoggle = $('.video-toggle', intro);
    var scenes = $$('.scene');
    var wideQ = window.matchMedia('(min-width: 900px)');
    var userPaused = calm;
    var ticking = false;
    var clamp = function (v) { return Math.min(Math.max(v, 0), 1); };
    var seg = function (p, a, b) { return clamp((p - a) / (b - a)); };
    var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
    function setPaused(pz) {
      if (pz) cvid.pause(); else cvid.play().catch(function () {});
      vtoggle.setAttribute('aria-label', pz ? 'Включить видео' : 'Остановить видео');
      $('use', vtoggle).setAttribute('href', pz ? '#i-play' : '#i-pause');
    }
    vtoggle.addEventListener('click', function () { userPaused = !cvid.paused; setPaused(userPaused); });
    if (calm) setPaused(true);
    function resetAll() {
      [bg, heroIn, word, side, flash, chapter, chIn, ghost, cvid].forEach(function (el) { if (el) { el.style.transform = ''; el.style.opacity = ''; } });
      chapter.classList.remove('is-on');
      scenes.forEach(function (el) { var x = $('.scene-inner', el); if (x) { x.style.transform = ''; x.style.opacity = ''; } });
    }
    function update() {
      ticking = false;
      if (calm || !wideQ.matches) {
        resetAll();
        // на телефоне видео играет, когда вторая сцена на экране
        var r0 = chapter.getBoundingClientRect();
        var seen = r0.top < window.innerHeight && r0.bottom > 0;
        if (!userPaused) { if (seen && cvid.paused) setPaused(false); else if (!seen && !cvid.paused) cvid.pause(); }
        return;
      }
      var vh = window.innerHeight;
      var r = intro.getBoundingClientRect();
      var p = clamp(-r.top / (r.height - heroEl.offsetHeight));
      var zoom = ease(seg(p, 0, 0.55));
      bg.style.transform = 'scale(' + (1 + 0.45 * zoom).toFixed(4) + ')';
      var out = ease(seg(p, 0, 0.3));
      heroIn.style.opacity = (1 - out).toFixed(3);
      heroIn.style.transform = 'translateY(' + (-9 * out).toFixed(2) + 'vh)';
      word.style.opacity = (1 - out).toFixed(3);
      word.style.transform = 'scale(' + (1 + 0.25 * out).toFixed(4) + ')';
      side.style.opacity = (1 - out).toFixed(3);
      side.style.transform = 'translateX(' + (8 * out).toFixed(2) + 'vw)';
      flash.style.opacity = (0.9 * Math.sin(Math.PI * seg(p, 0.26, 0.6))).toFixed(3);
      var inn = ease(seg(p, 0.36, 0.75));
      chapter.style.opacity = inn.toFixed(3);
      chapter.classList.toggle('is-on', inn > 0.5);
      chIn.style.transform = 'translateY(' + ((1 - inn) * 7).toFixed(2) + 'vh)';
      cvid.style.transform = 'scale(' + (1.18 - 0.18 * inn).toFixed(4) + ')';
      ghost.style.transform = 'translateX(' + ((1 - inn) * 10 - 3 * seg(p, 0.75, 1)).toFixed(2) + 'vw)';
      if (!userPaused) { if (inn > 0.05 && cvid.paused) setPaused(false); else if (inn <= 0.05 && !cvid.paused) cvid.pause(); }
      scenes.forEach(function (el) {
        var x = $('.scene-inner', el);
        var e = clamp((vh - el.getBoundingClientRect().top) / (vh * 0.45));
        x.style.transform = 'translateY(' + ((1 - e) * 7).toFixed(2) + 'vh) scale(' + (0.965 + 0.035 * e).toFixed(4) + ')';
        x.style.opacity = (0.3 + 0.7 * e).toFixed(3);
      });
    }
    var req = function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', req);
    update();
  }

  /* ---------- 8. нижняя панель на телефоне: появляется после первого экрана, прячется у формы ---------- */
  var mbar = $('.mbar');
  if (mbar) {
    var formSeen = false;
    var forms = $$('main [data-demo-form]');
    if (forms.length && 'IntersectionObserver' in window) {
      var io8 = new IntersectionObserver(function (en) {
        en.forEach(function (e) { e.target._seen = e.isIntersecting; });
        formSeen = forms.some(function (f) { return f._seen; });
        toggleBar();
      }, { threshold: 0.1 });
      forms.forEach(function (f) { io8.observe(f); });
    }
    var toggleBar = function () { mbar.classList.toggle('is-on', window.scrollY > window.innerHeight * 0.6 && !formSeen); };
    window.addEventListener('scroll', toggleBar, { passive: true });
    toggleBar();
  }
})();
