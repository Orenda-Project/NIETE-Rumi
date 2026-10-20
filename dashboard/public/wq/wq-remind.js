/* Jugnu's reminder ask (switch app_settings web_quiz_push_remind, decided by the bot).
 *
 *   WQREMIND.mount(slot, ctx)    the results screen's secondary card, below the primary next step (wq.js lazy-loads this
 *                                file after the primary has painted). Never a test button here.
 *   WQREMIND.landing(root, ctx)  the /remind/:code page (edge-rendered; this file boots it from #wq-remind-boot). After
 *                                Done: the Play door to /q/<code>, and "Send one now" only when ctx.test (sandbox QA).
 *   ctx = {code, lang, chips, chip?, test?, host?}
 *
 * First GET /api/wqpush/key: a 404 means the switch is off, so any of our workers (/sw.js) is unregistered and nothing
 * is drawn. Never drawn beside an install card (#wqp-inst non-empty or [data-door="install"]), never on a class phone
 * (4+ chips). The browser's permission is asked only inside the Yes tap. Steps go to POST /api/wqpush/e. */
(function () {
  'use strict';
  var T = {
    en: {
      remindTitle: 'Want Jugnu to remind you tomorrow?',
      remindBody: 'One reminder on this phone, after school. You can stop it any time.',
      remindYes: 'Yes, remind me',
      remindLater: 'Not now',
      remindDone: 'Done. Jugnu will remind you tomorrow after school.',
      remindTest: 'Send one now',
      remindStop: 'Stop reminders',
      remindDenied: 'Reminders are off in this browser. You can turn them on in the browser settings.',
      iabBody: 'Reminders come only in Chrome.',
      iabChrome: 'Open in Chrome',
      iabHow: 'How?',
      iabHint: 'Or tap ⋮ at the top, then choose ‘Open in browser’.',
      iabCopy: 'Copy link',
      iosBody: 'On iPhone, open this page in Safari, tap Share, then ‘Add to Home Screen’. Reminders come from the Jugnu icon.',
      noPush: 'This browser cannot show reminders.',
      play: 'Play the quiz',
      stopped: 'Reminders are off.',
    },
    ur: {
      remindTitle: 'کیا جگنو کل آپ کو یاد دلائے؟',
      remindBody: 'اس فون پر، اسکول کے بعد، بس ایک یاد دہانی۔ آپ جب چاہیں بند کر سکتے ہیں۔',
      remindYes: 'جی ہاں، یاد دلائیں',
      remindLater: 'ابھی نہیں',
      remindDone: 'ہو گیا۔ جگنو کل اسکول کے بعد یاد دلائے گا۔',
      remindTest: 'ابھی ایک یاد دہانی بھیجیں',
      remindStop: 'یاد دہانی بند کریں',
      remindDenied: 'اس براؤزر میں یاد دہانی بند ہے۔ آپ براؤزر کی سیٹنگز سے اسے کھول سکتے ہیں۔',
      iabBody: 'یاد دہانی صرف کروم میں ملتی ہے۔',
      iabChrome: 'کروم میں کھولیں',
      iabHow: 'کیسے؟',
      iabHint: 'یا اوپر ⋮ دبائیں، پھر ’براؤزر میں کھولیں‘ چنیں۔',
      iabCopy: 'لنک کاپی کریں',
      iosBody: 'آئی فون پر یہ صفحہ سفاری میں کھولیں، بھیجنے کا نشان (⬆) دبائیں، پھر ’ہوم اسکرین پر شامل کریں‘۔ یاد دہانی جگنو کے آئیکن سے آئے گی۔',
      noPush: 'یہ براؤزر یاد دہانی نہیں دکھا سکتا۔',
      play: 'کوئز کھیلیں',
      stopped: 'یاد دہانی بند ہے۔',
    },
  };
  var IAB_RX = /\bWA4A\/|WhatsApp|FBAN|FBAV|Instagram|; wv\)/;
  var CODE_RX = /^[A-Za-z0-9]{4,12}$/;
  var DAY = 864e5;
  var API = '/api/wqpush/';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (_) { /* private mode: no snooze */ } }
  function within(k, days) { var t = Number(lsGet(k)) || 0; return t > 0 && Date.now() - t < days * DAY; }
  function snoozed() { return within('wq_rm_asked', 30) || within('wq_rm_later', 7); }

  function post(op, body) {
    try {
      return Promise.resolve(window.fetch(API + op, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin', keepalive: true }))
        .then(function (r) { return r; }, function () { return null; });
    } catch (_) { return Promise.resolve(null); }
  }
  function getKey() {
    try {
      return Promise.resolve(window.fetch(API + 'key', { credentials: 'same-origin', headers: { accept: 'application/json' } }))
        .then(function (r) {
          if (!r) return { status: 0 };
          return Promise.resolve(r.json()).then(function (b) { return { status: r.status, body: b || {} }; }, function () { return { status: r.status, body: {} }; });
        }, function () { return { status: 0 }; });
    } catch (_) { return Promise.resolve({ status: 0 }); }
  }

  function installOnScreen() {
    var d = window.document;
    var inst = d.getElementById && d.getElementById('wqp-inst');
    if (inst && String(inst.innerHTML || '').trim()) return true;
    return !!(d.querySelector && d.querySelector('[data-door="install"]'));
  }

  /** The switch is off: drop our worker (scriptURL ending in /sw.js), whatever state it is in. */
  function dropWorkers() {
    var sw = window.navigator.serviceWorker;
    if (!sw) return Promise.resolve();
    var all = sw.getRegistrations ? sw.getRegistrations() : sw.getRegistration('/').then(function (r) { return r ? [r] : []; });
    return Promise.resolve(all).then(function (regs) {
      (regs || []).forEach(function (reg) {
        var w = reg && (reg.active || reg.waiting || reg.installing);
        if (w && /\/sw\.js$/.test(String(w.scriptURL || '').split('?')[0])) { try { reg.unregister(); } catch (_) { /* gone */ } }
      });
    }, function () {});
  }

  function standalone() {
    try { if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true; } catch (_) { /* old browser */ }
    return window.navigator.standalone === true;
  }
  function hasPush() { return !!(window.navigator.serviceWorker && window.PushManager && window.Notification); }
  /** card | iab | ios | nopush */
  function branch() {
    var ua = String(window.navigator.userAgent || '');
    var android = /Android/i.test(ua);
    if (standalone() && hasPush()) return 'card';
    if (android && IAB_RX.test(ua)) return 'iab';
    if (hasPush()) return 'card';
    if (android) return 'iab';
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    return 'nopush';
  }

  function keyBytes(b64u) {
    var s = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var raw = window.atob(s);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }
  /** Keep what the worker needs to re-subscribe on its own ({key, code, lang}). Best effort. */
  function keep(ctxVal) {
    return new Promise(function (resolve) {
      try {
        if (!window.indexedDB) return resolve();
        var open = window.indexedDB.open('wq-push', 1);
        open.onupgradeneeded = function () { open.result.createObjectStore('kv'); };
        open.onerror = function () { resolve(); };
        open.onsuccess = function () {
          try {
            var tx = open.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(ctxVal, 'ctx');
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { resolve(); };
          } catch (_) { resolve(); }
        };
      } catch (_) { resolve(); }
    });
  }
  function currentSub() {
    var sw = window.navigator.serviceWorker;
    if (!sw || !sw.getRegistration) return Promise.resolve(null);
    return Promise.resolve(sw.getRegistration('/')).then(function (reg) {
      return reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
    }).then(function (s) { return s || null; }, function () { return null; });
  }

  function Card(slot, ctx, mode) {
    var lang = ctx.lang === 'en' ? 'en' : 'ur';
    var c = T[lang];
    var code = CODE_RX.test(String(ctx.code || '')) ? String(ctx.code) : '';
    var host = String(ctx.host || window.location.host || '').replace(/[^A-Za-z0-9.:-]/g, '');
    var landing = mode === 'landing';
    var key = null;
    var busy = false;
    var iab = false;

    function ev(step, extra) {
      var b = { step: step, lang: lang };
      if (iab) b.iab = true;
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) b[k] = extra[k];
      post('e', b);
    }
    function remindUrl() { return 'https://' + host + '/remind/' + code + '?from=iab&lang=' + lang; }
    function intentHref() {
      return 'intent://' + host + '/remind/' + code + '?from=iab&lang=' + lang
        + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(remindUrl()) + ';end';
    }
    // a ghost's underline sits under the word only (not across the full-width box)
    function lbl(cls, label) { return cls.indexOf('wq-ghost') >= 0 ? '<span style="text-decoration:underline;text-underline-offset:4px">' + esc(label) + '</span>' : esc(label); }
    function btn(cls, act, label) { return '<button type="button" class="wq-btn ' + cls + '" data-act="' + act + '"' + (cls.indexOf('wq-ghost') >= 0 ? ' style="text-decoration:none"' : '') + '>' + lbl(cls, label) + '</button>'; }
    function link(cls, act, href, label) { return '<a class="wq-btn ' + cls + '" data-act="' + act + '" href="' + esc(href) + '">' + esc(label) + '</a>'; }
    function draw(inner) {
      if (!inner) { slot.innerHTML = ''; return; }
      slot.innerHTML = '<section class="wq-card wq-remind" lang="' + lang + '" dir="' + (lang === 'ur' ? 'rtl' : 'ltr') + '"'
        + ' style="margin:16px 0 0;padding:16px;display:grid;gap:10px">' + inner + '</section>';
    }
    var lh = lang === 'ur' ? ';line-height:2' : '';
    function title(t) { return '<h2 style="margin:0;font-size:18px' + lh + '">' + esc(t) + '</h2>'; }
    function line(t) { return '<p class="wq-sub" style="margin:0' + lh + '">' + esc(t) + '</p>'; }

    var show = {
      ask: function () { draw(title(c.remindTitle) + line(c.remindBody) + btn('wq-soft', 'yes', c.remindYes) + btn('wq-ghost', 'later', c.remindLater)); },
      done: function () {
        // the landing's one next step is Play (the primary); Stop is the small ghost; the test-send only for QA (?qa=1)
        draw(line(c.remindDone)
          + (landing && code ? link('wq-go', 'play', '/q/' + code, c.play) : '')
          + (landing && ctx.test === true ? btn('wq-ghost', 'test', c.remindTest) : '')
          + btn('wq-ghost', 'stop', c.remindStop));
      },
      denied: function () { draw(line(c.remindDenied)); },
      stopped: function () { draw(line(c.stopped) + (landing && code ? link('wq-go', 'play', '/q/' + code, c.play) : '')); },
      // WhatsApp's browser: one line and ONE door to Chrome; the ⋮ hint and Copy link only after "How?" (a child's screen)
      iab: function (more) {
        draw(line(c.iabBody) + (code && host ? link('wq-soft', 'escape', intentHref(), c.iabChrome) : '')
          + (more ? line(c.iabHint) + (code && host ? btn('wq-ghost', 'copy', c.iabCopy) : '') : btn('wq-ghost', 'how', c.iabHow)));
      },
      ios: function () { draw(line(c.iosBody)); },
      nopush: function () { draw(line(c.noPush)); },
    };

    function subscribe() {
      var sw = window.navigator.serviceWorker;
      return Promise.resolve(sw.register('/sw.js', { scope: '/' }))
        .then(function () { return sw.ready; })
        .then(function (reg) {
          return keep({ key: key, code: code, lang: lang }).then(function () {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
          });
        })
        .then(function (sub) {
          var tz = '';
          try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { tz = ''; }
          var body = { sub: sub.toJSON(), code: code, lang: lang, chips: Number(ctx.chips) || 0, tz: tz };
          if (typeof ctx.chip === 'string' && ctx.chip) body.chip = ctx.chip;
          return post('subscribe', body).then(function (r) {
            if (r && r.status === 200) return 'ok';
            try { sub.unsubscribe(); } catch (_) { /* best effort */ }
            return r && r.status === 409 ? 'class' : 'fail';
          });
        });
    }

    // The Yes tap: the ONLY place the browser's permission is asked, first thing inside the gesture.
    function onYes() {
      if (busy) return;
      busy = true;
      ev('yes');
      var asked = new Promise(function (resolve) {
        var r = window.Notification.requestPermission(resolve);
        if (r && typeof r.then === 'function') r.then(resolve, function () { resolve('default'); });
      });
      asked.then(function (perm) {
        if (perm !== 'granted') {
          lsSet('wq_rm_asked', Date.now());
          ev('denied');
          show.denied();
          return null;
        }
        ev('granted');
        return subscribe().then(function (out) {
          if (out === 'ok') { ev('subscribed'); show.done(); } else if (out === 'class') { ev('failed', { ok: false }); draw(''); } else { ev('failed', { ok: false }); show.ask(); }
        });
      }).catch(function () { ev('failed', { ok: false }); show.ask(); }).then(function () { busy = false; });
    }
    function onStop() {
      if (busy) return;
      busy = true;
      currentSub().then(function (sub) {
        if (!sub) return null;
        return post('unsubscribe', { endpoint: sub.endpoint, by: 'page' }).then(function () { return sub.unsubscribe(); });
      }).catch(function () { return null; }).then(function () { ev('stop'); show.stopped(); busy = false; });
    }
    function onTest() {
      if (!landing || ctx.test !== true || busy) return;
      busy = true;
      currentSub().then(function (sub) { return sub ? post('test', { endpoint: sub.endpoint }) : null; })
        .then(function () { ev('test'); busy = false; }, function () { busy = false; });
    }
    function onCopy() {
      var u = remindUrl();
      ev('copy', { how: 'copy' });
      try {
        var cb = window.navigator.clipboard;
        if (cb && cb.writeText) { cb.writeText(u).catch(function () {}); return; }
      } catch (_) { /* fall back below */ }
      try { window.prompt(c.iabCopy, u); } catch (_) { /* nothing more to try */ }
    }

    slot.onclick = function (e) {
      var el = e && e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      var act = el && el.getAttribute('data-act');
      if (!act) return;
      if (act === 'yes') onYes();
      else if (act === 'later') { lsSet('wq_rm_later', Date.now()); ev('later'); draw(''); }
      else if (act === 'stop') onStop();
      else if (act === 'test') onTest();
      else if (act === 'copy') { if (e.preventDefault) e.preventDefault(); onCopy(); }
      else if (act === 'escape') ev('escape', { how: 'intent' });
      else if (act === 'how') { ev('escape', { how: 'menu' }); show.iab(true); }
    };

    return {
      start: function () {
        if ((Number(ctx.chips) || 0) >= 4) return Promise.resolve();
        if (installOnScreen()) return Promise.resolve();
        if (!landing && snoozed()) return Promise.resolve();
        return getKey().then(function (r) {
          if (r.status === 404) return dropWorkers();
          if (r.status !== 200) return null;
          key = r.body && typeof r.body.key === 'string' ? r.body.key : null;
          var b = branch();
          if (b === 'iab') { iab = true; ev('shown'); show.iab(); return null; }
          if (b === 'ios') { ev('ios'); show.ios(); return null; }
          if (b === 'nopush') { ev('nopush'); show.nopush(); return null; }
          if (!key) return null;
          var perm = window.Notification.permission;
          if (perm === 'denied') { if (landing) show.denied(); return null; }
          return (perm === 'granted' ? currentSub() : Promise.resolve(null)).then(function (sub) {
            if (sub) { if (landing) show.done(); return; }
            ev('shown');
            show.ask();
          });
        }).catch(function () { return null; });
      },
    };
  }

  function run(slot, ctx, mode) {
    if (!slot) return Promise.resolve();
    return Card(slot, ctx || {}, mode).start();
  }

  window.WQREMIND = {
    T: T,
    mount: function (slot, ctx) { return run(slot, ctx, 'mount'); },
    landing: function (root, ctx) { return run(root, ctx, 'landing'); },
  };

  // The /remind/:code page boots itself (no inline script on the page).
  try {
    var d = window.document;
    var bootEl = d && d.getElementById && d.getElementById('wq-remind-boot');
    var rootEl = d && d.getElementById && d.getElementById('wq-remind-root');
    if (bootEl && rootEl) window.WQREMIND.landing(rootEl, JSON.parse(bootEl.textContent || '{}'));
  } catch (_) { /* a broken boot draws nothing */ }
}());
