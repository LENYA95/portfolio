/**
 * Имитация сервисов Google (таблица, кэш, свойства, блокировка, криптография) прямо в браузере.
 * Нужна только для проверки на компьютере: настоящий Code.gs запускается здесь без изменений.
 * На сайт (папка site) этот файл не попадает.
 */
(function (global) {
  'use strict';

  // ---------- SHA-256 и HMAC (синхронно, как в Apps Script) ----------
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

  function utf8(s) { return Array.from(new TextEncoder().encode(String(s))); }

  function sha256(bytes) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var m = bytes.slice(), bitLen = bytes.length * 8;
    m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    for (var i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    var w = new Array(64);
    for (var off = 0; off < m.length; off += 64) {
      for (var t = 0; t < 16; t++) w[t] = (m[off + t * 4] << 24) | (m[off + t * 4 + 1] << 16) | (m[off + t * 4 + 2] << 8) | m[off + t * 4 + 3];
      for (t = 16; t < 64; t++) {
        var s0 = ror(w[t - 15], 7) ^ ror(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = ror(w[t - 2], 17) ^ ror(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25), ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
        var S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22), mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = [h[0] + a, h[1] + b, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map(function (x) { return x | 0; });
    }
    var out = [];
    h.forEach(function (x) { out.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff); });
    return out;
  }
  function ror(x, n) { return (x >>> n) | (x << (32 - n)); }

  function hmac(keyBytes, msgBytes) {
    if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
    var k = keyBytes.slice(); while (k.length < 64) k.push(0);
    var ipad = k.map(function (b) { return b ^ 0x36; }), opad = k.map(function (b) { return b ^ 0x5c; });
    return sha256(opad.concat(sha256(ipad.concat(msgBytes))));
  }
  function signed(bytes) { return bytes.map(function (b) { return b > 127 ? b - 256 : b; }); } // Apps Script отдаёт байты со знаком

  // ---------- Хранилище ----------
  var db, persistKey = null;
  function fresh() { return { sheets: [], props: {}, cache: {} }; }
  function save() { if (persistKey) localStorage.setItem(persistKey, JSON.stringify(db)); }

  function Range(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.getValues = function () {
    var out = [];
    for (var i = 0; i < this.nr; i++) {
      var row = this.sh.rows[this.r - 1 + i] || [], line = [];
      for (var j = 0; j < this.nc; j++) line.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]);
      out.push(line);
    }
    return out;
  };
  Range.prototype.setValues = function (vals) {
    for (var i = 0; i < vals.length; i++) {
      var idx = this.r - 1 + i;
      while (this.sh.rows.length <= idx) this.sh.rows.push([]);
      for (var j = 0; j < vals[i].length; j++) {
        var v = vals[i][j];
        if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1); // как в Таблицах: апостроф скрыт
        this.sh.rows[idx][this.c - 1 + j] = v;
      }
    }
    save(); return this;
  };
  Range.prototype.setNumberFormat = function () { return this; };
  Range.prototype.setFontWeight = function () { return this; };

  function Sheet(data) { this.d = data; this.rows = data.rows; }
  Sheet.prototype.getName = function () { return this.d.name; };
  Sheet.prototype.setName = function (n) { this.d.name = n; save(); return this; };
  Sheet.prototype.getLastRow = function () { return this.rows.length; };
  Sheet.prototype.getMaxRows = function () { return Math.max(1000, this.rows.length); };
  Sheet.prototype.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); };
  Sheet.prototype.appendRow = function (row) { this.getRange(this.rows.length + 1, 1, 1, row.length).setValues([row]); return this; };
  Sheet.prototype.setFrozenRows = function () { return this; };

  var Spreadsheet = {
    getSheetByName: function (n) { var s = db.sheets.filter(function (x) { return x.name === n; })[0]; return s ? new Sheet(s) : null; },
    getSheets: function () { return db.sheets.map(function (s) { return new Sheet(s); }); },
    insertSheet: function (n) { var s = { name: n, rows: [] }; db.sheets.push(s); save(); return new Sheet(s); }
  };

  global.SpreadsheetApp = {
    getActive: function () { return Spreadsheet; },
    getActiveSpreadsheet: function () { return Spreadsheet; },
    flush: function () {},
    getUi: function () { throw new Error('Меню доступно только в настоящей таблице'); }
  };

  global.CacheService = {
    getScriptCache: function () {
      return {
        get: function (k) { var e = db.cache[k]; if (!e || e.exp < Date.now()) return null; return e.v; },
        put: function (k, v, sec) { db.cache[k] = { v: String(v), exp: Date.now() + (sec || 600) * 1000 }; save(); },
        remove: function (k) { delete db.cache[k]; save(); }
      };
    }
  };

  global.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return db.props[k] === undefined ? null : db.props[k]; },
        setProperty: function (k, v) { db.props[k] = String(v); save(); return this; }
      };
    }
  };

  global.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {} }; } };

  global.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: function (alg, s) { return signed(sha256(utf8(s))); },
    computeHmacSha256Signature: function (value, key) { return signed(hmac(utf8(key), utf8(value))); },
    getUuid: function () { return crypto.randomUUID(); },
    formatDate: function (d) { return d.toISOString().slice(0, 10); }
  };

  global.ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput: function (s) { return { getContent: function () { return s; }, setMimeType: function () { return this; } }; }
  };
  global.Session = { getScriptTimeZone: function () { return 'Europe/Moscow'; } };

  // ---------- Управление имитацией ----------
  global.GasMock = {
    sha256Hex: function (s) { return sha256(utf8(s)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); },
    hmacHex: function (key, s) { return hmac(utf8(key), utf8(s)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); },

    /** persist = ключ localStorage (данные переживут перезагрузку) или null (только в памяти). */
    init: function (persist) {
      persistKey = persist || null;
      var saved = persistKey && localStorage.getItem(persistKey);
      db = saved ? JSON.parse(saved) : fresh();
      if (!saved) db.sheets.push({ name: 'Лист1', rows: [] });
      return !saved; // true — база новая
    },

    /** Загружает настоящий Code.gs и выполняет его в глобальной области. */
    loadCode: function (url) {
      return fetch(url, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (code) { (0, eval)(code); });
    },

    /** То же, что fetch к веб-приложению: отдаём тело запроса в doPost и возвращаем JSON. */
    post: function (bodyText) {
      var out = global.doPost({ postData: { contents: bodyText } });
      return JSON.parse(out.getContent());
    },

    rawSheet: function (name) { var s = db.sheets.filter(function (x) { return x.name === name; })[0]; return s ? s.rows : null; }
  };
})(window);
