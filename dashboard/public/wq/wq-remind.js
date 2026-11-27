/* Jugnu's reminder ask (switch app_settings web_quiz_push_remind, decided by the bot).
 *
 *   WQREMIND.mount(slot, ctx)    the results screen's secondary card, below the primary next step (wq.js lazy-loads this
 *                                file after the primary has painted). Never a test button here.
 *   WQREMIND.landing(root, ctx)  the /remind/:code page (edge-rendered; this file boots it from #wq-remind-boot). After
 *                                Done: the Play door to /q/<code>, and "Send one now" only when ctx.test (sandbox QA).
 *   ctx = {code, lang, chips, chip?, test?, host?, src?}   src: where it is mounted ('class_link' under the standing
 *                                link's chips; else the result screen), sent on every step as src (landing: 'landing')
 *
 * First GET /api/wqpush/key: a 404 means the switch is off, so any of our workers (/sw.js) is unregistered and nothing
 * is drawn. Never drawn beside an install card (#wqp-inst non-empty or [data-door="install"]), never on a class phone
 * (4+ chips). The browser's permission is asked only inside the Yes tap. Steps go to POST /api/wqpush/e.
 *
 * Each step, the subscribe and the context kept for the worker carry `ps`, this page load's telemetry session id, when
 * wq-tel.js has one (window.WQT.on; it keeps the id in sessionStorage as wq_ps), so a funnel read can drop QA walks by
 * page_start.ua. Telemetry off, no wq-tel on the page (the /remind landing) or no id: the bodies are as they were.
 *
 * How a sitting ended: the first answer after `shown` (yes / later / escape) carries dwell_ms, how long the ask was up;
 * the page going away (hidden, or pagehide) with the ask up and unanswered posts one `gone` step with dwell_ms (once
 * per sitting, through post()'s keepalive). No ask drawn, no `gone`. After Yes, `denied` carries `perm` ('denied' =
 * Block, 'default' = the prompt was closed), and the page going away with Chrome's prompt still unanswered posts one
 * `gone` with `after: 'yes'`. Nothing a child sees changes. */
(function () {
  'use strict';
  var T = {
    en: {
      remindTitle: 'Jugnu can remind you tomorrow evening.',
      remindTitleMon: 'Jugnu can remind you on Monday evening.',
      remindBody: 'One reminder on this phone, on school-day evenings. You can stop it any time.',
      remindYes: 'Yes',
      remindLater: 'Not now',
      // the ask's second wording (arm b, web_quiz_push_ask_v2): what it is, and when; no question, no names. "Weekdays",
      // not "school days": the sender skips Saturday and Sunday only, it reads no holiday calendar
      askBHead: 'Jugnu\'s evening reminder',
      askBWhen: 'Weekdays, by 6 pm',
      askBYes: 'Yes, remind us',
      // arm b, after Yes the permission prompt was closed (not Block): nothing is off, one more Yes asks again
      askBRetry: 'Tap Yes again and choose Allow',
      // the permission primer (web_quiz_push_primer): between our Yes and the browser's own prompt, so the child knows
      // the phone asks next; names no button in Urdu (the browser's dialog follows the phone's language)
      primerHead: 'One more step',
      primerBody: 'Your phone will ask about reminders next. Choose Allow.',
      primerGo: 'OK',
      // the install card (web_quiz_install_android): the finish screen's install card, after the reminder ask is settled
      instTitle: 'Put Jugnu on your phone',
      instAdd: 'Add',
      remindWait: 'Turning reminders on…',
      remindHint: 'Now tap Allow below',
      remindDone: 'Done. Jugnu will remind you tomorrow evening.',
      remindDoneMon: 'Done. Jugnu will remind you on Monday evening.',
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
      onTitle: 'Reminders are on!',
      offTitle: 'Reminders are off',
    },
    ur: {
      remindTitle: 'جگنو کل شام آپ کو یاد دلا سکتا ہے۔',
      remindTitleMon: 'جگنو پیر کی شام آپ کو یاد دلا سکتا ہے۔',
      remindBody: 'اس فون پر، اسکول کے دنوں کی شام، بس ایک یاد دہانی۔ آپ جب چاہیں بند کر سکتے ہیں۔',
      remindYes: 'ہاں',
      remindLater: 'ابھی نہیں',
      askBHead: 'جگنو کی شام کی یاد دہانی',
      askBWhen: 'پیر سے جمعہ، شام ۶ بجے تک',
      askBYes: 'ہاں، یاد دلائیں',
      askBRetry: 'دوبارہ ہاں دبائیں، پھر اجازت دیں',
      primerHead: 'بس ایک قدم اور',
      primerBody: 'اب آپ کا فون یاد دہانی کے بارے میں پوچھے گا۔ وہاں اجازت دیں۔',
      primerGo: 'ٹھیک ہے',
      instTitle: 'جگنو کو اپنے فون پر رکھیں',
      instAdd: 'شامل کریں',
      remindWait: 'یاد دہانی آن ہو رہی ہے…',
      // names no button: Chrome's permission dialog follows the phone's language, not the page's
      remindHint: 'اب نیچے والے بٹن سے اجازت دیں',
      remindDone: 'ہو گیا۔ جگنو کل شام یاد دلائے گا۔',
      remindDoneMon: 'ہو گیا۔ جگنو پیر کی شام یاد دلائے گا۔',
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
      onTitle: 'یاد دہانی آن ہے!',
      offTitle: 'یاد دہانی بند ہے',
    },
  };
  var IAB_RX = /\bWA4A\/|WhatsApp|FBAN|FBAV|Instagram|; wv\)/;
  var CODE_RX = /^[A-Za-z0-9]{4,12}$/;
  var PS_RX = /^[a-z0-9]{12}$/;
  // The reminder comes on the next school evening (Mon–Fri, PKT; the bot's nextAt): on a Friday or a Saturday that is
  // Monday, so the ask and the done line say Monday there, and tomorrow on every other day.
  function onMonday() { var d = new Date(Date.now() + 5 * 3600000).getUTCDay(); return d === 5 || d === 6; }
  var DAY = 864e5;
  var API = '/api/wqpush/';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  // set on this origin once the phone has Jugnu (installed here, or a page running as the app); the hub sets it too
  var APP_KEY = 'wq_app';
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (_) { /* private mode: no snooze */ } }
  function within(k, days) { var t = Number(lsGet(k)) || 0; return t > 0 && Date.now() - t < days * DAY; }
  function snoozed() { return within('wq_rm_asked', 30) || within('wq_rm_later', 7); }
  // This page load's telemetry session id, or '' (telemetry off: a wq_ps left by an earlier page in the tab is not this one)
  function pageSession() {
    if (!window.WQT || window.WQT.on !== true) return '';
    var v = '';
    try { v = String(window.sessionStorage.getItem('wq_ps') || ''); } catch (_) { v = ''; }
    return PS_RX.test(v) ? v : '';
  }

  function post(op, body) {
    try {
      return Promise.resolve(window.fetch(API + op, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin', keepalive: true }))
        .then(function (r) { return r; }, function () { return null; });
    } catch (_) { return Promise.resolve(null); }
  }
  // code: the quiz this ask is about; the bot answers ask:false outside the canary (web_quiz_push_canary)
  function getKey(code) {
    try {
      return Promise.resolve(window.fetch(API + 'key' + (code ? '?code=' + encodeURIComponent(code) : ''), { credentials: 'same-origin', headers: { accept: 'application/json' } }))
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
  /** Keep what the worker needs to re-subscribe on its own ({key, code, lang, ps?}). Best effort. */
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
    var src = landing ? 'landing' : ctx.src === 'class_link' ? 'class_link' : 'result';
    var key = null;
    var busy = false;
    var iab = false;
    var askedAt = 0; // when this sitting's ask was drawn; 0 = none up, or it was answered (or left)
    var permUp = false; // Yes was tapped and the browser's permission prompt has not answered yet
    var primer = false; // the permission primer (web_quiz_push_primer, from the key): our Yes shows it first
    var primerUp = false; // the primer is on screen: a second Yes tap (before it drew) counts nothing
    var primed = false; // the primer was answered OK once on this page: a later Yes (arm b's retry) asks the browser at once
    // the install card: the Android install on the finish screen (install_android from the key). It waits for the browser's offer
    // (beforeinstallprompt) AND for the reminder ask to be settled; never beside the ask, never in the installed app.
    var inst = { on: false, offer: null, settled: false, done: false, sent: {} };
    var arm = null; // the ask's arm from the key ('a' | 'b', web_quiz_push_ask_v2); null = no arm (today exactly)
    var watching = false;

    function ev(step, extra) {
      var b = { step: step, lang: lang, src: src };
      if (iab) b.iab = true;
      if (pageSession()) b.ps = pageSession();
      if (arm) b.ask_v = arm;
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) b[k] = extra[k];
      post('e', b);
    }
    // The ask's first answer takes how long it was up; every step after it carries nothing new.
    function dwell(extra) {
      var o = extra || {};
      if (!askedAt) return o;
      var ms = Math.round(Date.now() - askedAt);
      askedAt = 0;
      if (ms >= 0) o.dwell_ms = ms;
      return o;
    }
    function gone() {
      if (askedAt) { ev('gone', dwell()); return; }
      if (permUp) { permUp = false; ev('gone', { after: 'yes' }); }
    }
    function askShown() {
      ev('shown');
      askedAt = Date.now();
      if (watching) return;
      watching = true;
      var d = window.document;
      try { window.addEventListener('pagehide', gone); } catch (_) { /* no lifecycle events: no gone */ }
      try { d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') gone(); }); } catch (_) { /* as above */ }
    }
    function remindUrl() { return 'https://' + host + '/remind/' + code + '?from=iab&lang=' + lang; }
    function intentHref() {
      return 'intent://' + host + '/remind/' + code + '?from=iab&lang=' + lang
        + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(remindUrl()) + ';end';
    }
    // a ghost's underline sits under the word only (not across the full-width box)
    function lbl(cls, label) { return cls.indexOf('wq-ghost') >= 0 ? '<span style="text-decoration:underline;text-underline-offset:4px">' + esc(label) + '</span>' : esc(label); }
    function btn(cls, act, label) { return '<button type="button" class="wq-btn ' + cls + '" data-act="' + act + '"' + (cls.indexOf('wq-ghost') >= 0 ? ' style="text-decoration:none;border-bottom:0"' : '') + '>' + lbl(cls, label) + '</button>'; }
    function link(cls, act, href, label) { return '<a class="wq-btn ' + cls + '" data-act="' + act + '" href="' + esc(href) + '">' + esc(label) + '</a>'; }
    function section(inner) {
      return '<section class="wq-card wq-remind" lang="' + lang + '" dir="' + (lang === 'ur' ? 'rtl' : 'ltr') + '"'
        + ' style="margin:16px 0 0;padding:16px;display:grid;gap:10px">' + inner + '</section>';
    }
    // the card's own state (ask, primer, done, off...); the install card is a second section under it, so the
    // reminder's answer stays on screen
    var drawn = '';
    function draw(inner) { drawn = inner ? section(inner) : ''; slot.innerHTML = drawn; }
    // Nastaliq room; on the landing the status lines read at 18 px with a little more air
    var lh = lang === 'ur' ? (landing ? ';line-height:2.2' : ';line-height:2') : '';
    var fs = landing ? ';font-size:18px' : '';
    function title(t) { return '<h2 style="margin:0;font-size:18px' + lh + '">' + esc(t) + '</h2>'; }
    function line(t) { return '<p class="wq-sub" style="margin:0' + fs + lh + '">' + esc(t) + '</p>'; }
    // the landing's page title (its h1) is the one question; after Yes / Stop it says the state instead
    function pageTitle(t) {
      if (!landing) return;
      try { var h = window.document.querySelector('.wqr h1'); if (h) h.textContent = t; } catch (_) { /* no title to change */ }
    }

    var show = {
      // after Chrome's Allow: the worker and the push service take seconds, so the card says it is working at once
      wait: function () { draw('<p class="wq-sub" role="status" aria-busy="true" style="margin:0' + fs + lh + '">' + esc(c.remindWait) + '</p>'); },
      // while Chrome's permission sheet is up (it is in English): where to tap
      hint: function () { draw('<p class="wq-sub" role="status" style="margin:0' + fs + lh + '">' + esc(c.remindHint) + '</p>'); },
      // the result screen (take A): one line, then 🔔 Yes and Not now on one row, so the score and "See my card" stay the
      // heroes; the /remind landing keeps the consent line under its own question
      // arm b (take B's words): the head says what it is, one line says when; the same row, Yes reads "Yes, remind us"
      ask: function () {
        var b = arm === 'b';
        var yes = '<button type="button" class="wq-btn wq-soft" data-act="yes"><span aria-hidden="true">🔔</span> ' + esc(b ? c.askBYes : c.remindYes) + '</button>';
        var row = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + yes + btn('wq-ghost', 'later', c.remindLater) + '</div>';
        if (b) { draw(title(c.askBHead) + line(c.askBWhen) + row); return; }
        draw(landing ? line(c.remindBody) + row : title(onMonday() ? c.remindTitleMon : c.remindTitle) + row);
      },
      done: function () {
        pageTitle(c.onTitle);
        // the landing's one next step is Play (the primary); Stop is the small ghost; the test-send only for QA (?qa=1)
        draw(line(onMonday() ? c.remindDoneMon : c.remindDone)
          + (landing && code ? link('wq-go', 'play', '/q/' + code, c.play) : '')
          + (landing && ctx.test === true ? btn('wq-ghost', 'test', c.remindTest) : '')
          + btn('wq-ghost', 'stop', c.remindStop));
      },
      denied: function () { draw(line(c.remindDenied)); },
      // arm b, a CLOSED prompt ('default'): the browser blocked nothing, so the card says how to try again and keeps Yes
      // the primer: what comes next, then OK (the browser is asked inside that tap) and Not now
      primer: function () {
        var ok = '<button type="button" class="wq-btn wq-soft" data-act="primer_go">' + esc(c.primerGo) + '</button>';
        draw(title(c.primerHead) + line(c.primerBody) + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + ok + btn('wq-ghost', 'primer_back', c.remindLater) + '</div>');
        // the Urdu card can fall below a 740 px fold after Yes: bring its OK into view (no jump when it already fits)
        try { var card = slot.firstElementChild; if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' }); } catch (_) { /* no layout */ }
      },
      retry: function () {
        var yes = '<button type="button" class="wq-btn wq-soft" data-act="yes"><span aria-hidden="true">🔔</span> ' + esc(c.askBYes) + '</button>';
        draw(line(c.askBRetry) + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + yes + btn('wq-ghost', 'later', c.remindLater) + '</div>');
      },
      // on the landing the title already says it; the results card (no page title) keeps the line
      stopped: function () { pageTitle(c.offTitle); draw((landing ? '' : line(c.stopped)) + (landing && code ? link('wq-go', 'play', '/q/' + code, c.play) : '')); },
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
          var kept = { key: key, code: code, lang: lang };
          if (pageSession()) kept.ps = pageSession();
          return keep(kept).then(function () {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
          });
        })
        .then(function (sub) {
          var tz = '';
          try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { tz = ''; }
          var body = { sub: sub.toJSON(), code: code, lang: lang, chips: Number(ctx.chips) || 0, tz: tz };
          if (typeof ctx.chip === 'string' && ctx.chip) body.chip = ctx.chip;
          if (pageSession()) body.ps = pageSession();
          return post('subscribe', body).then(function (r) {
            if (r && r.status === 200) return 'ok';
            try { sub.unsubscribe(); } catch (_) { /* best effort */ }
            return r && r.status === 409 ? 'class' : 'fail';
          });
        });
    }

    // the install card's meter, on the page relay as install_prompt{step, at:'finish'} (the hub card's event); each step once per page.
    function istep(step) {
      if (inst.sent[step]) return;
      inst.sent[step] = true;
      try { if (window.WQT && window.WQT.on === true) window.WQT.push({ n: 'install_prompt', step: step, src: 'browser', at: 'finish' }); } catch (_) { /* no meter */ }
    }
    function instSnoozed() { var t = Number(lsGet('wqp_inst_later')); return isFinite(t) && t > 0 && Date.now() - t < 7 * 864e5; }
    function standaloneNow() {
      try { return Boolean((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (window.navigator && window.navigator.standalone === true)); } catch (_) { return false; }
    }
    // the reminder ask is settled (answered, or never shown): the card may come once the browser has offered
    function settle() { inst.settled = true; instShow(); }
    // the install card is for Android Chrome on the result screen: not the /remind landing, not WhatsApp's browser, iPhone or desktop
    function instOk(body) {
      return !landing && Boolean(code) && Boolean(body && body.install_android === true) && branch() === 'card'
        && /Android/i.test(String(window.navigator.userAgent || ''));
    }
    function instShow() {
      if (!inst.on || inst.done || !inst.settled || !inst.offer || instSnoozed()) return;
      inst.done = true;
      // the phone has Jugnu already (an old hub app keeps its own id, so Chrome may offer again): no card; unreadable = card
      if (lsGet(APP_KEY) === '1') { istep('had_app'); return; }
      istep('card_shown');
      slot.innerHTML = drawn + section(title(c.instTitle) + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
        + btn('wq-soft', 'inst_add', c.instAdd) + btn('wq-ghost', 'inst_later', c.remindLater) + '</div>');
    }
    function instWire(code) {
      if (standaloneNow()) return;
      inst.on = true;
      try {
        var l = window.document.createElement('link');
        l.rel = 'manifest'; l.href = '/q/' + encodeURIComponent(code) + '/manifest.webmanifest';
        window.document.head.appendChild(l);
      } catch (_) { inst.on = false; return; }
      window.addEventListener('beforeinstallprompt', function (e) {
        try { if (e && e.preventDefault) e.preventDefault(); } catch (_) { /* the browser's own banner then */ }
        inst.offer = e; istep('bip_fired'); instShow();
      });
      window.addEventListener('appinstalled', function () { inst.offer = null; lsSet(APP_KEY, '1'); istep('installed'); });
    }
    // a snoozed ask: read the key only where the install card could show (an Android Chrome tab, not the installed app,
    // not within the card's own snooze); anywhere else no network, as before
    function instOnly() {
      if (!code || branch() !== 'card' || !/Android/i.test(String(window.navigator.userAgent || '')) || standaloneNow() || instSnoozed()) return Promise.resolve();
      return getKey(code).then(function (r) {
        if (r.status === 200 && instOk(r.body)) { instWire(code); settle(); }
        return null;
      }).catch(function () { return null; });
    }
    function instAdd() {
      var e = inst.offer; inst.offer = null;
      slot.innerHTML = drawn;
      istep('add');
      try {
        e.prompt();
        if (e.userChoice && e.userChoice.then) e.userChoice.then(function (ch) { istep(ch && ch.outcome === 'accepted' ? 'accepted' : 'dismissed'); });
      } catch (_) { istep('prompt_failed'); }
    }

    // The Yes tap: the ONLY place the browser's permission is asked, first thing inside the gesture.
    function onYes() {
      if (busy || primerUp) return;
      ev('yes', dwell());
      // with the primer, Yes only draws it; the browser is asked from its OK, inside that tap
      if (primer && !primed) { primerUp = true; ev('primer_shown'); show.primer(); return; }
      askBrowser();
    }
    function askBrowser() {
      if (busy) return;
      busy = true;
      show.hint();
      permUp = true;
      var t0 = Date.now();
      var tookMs = function () { var ms = Date.now() - t0; return ms >= 0 ? Math.round(ms) : 0; };
      var asked = new Promise(function (resolve) {
        var r = window.Notification.requestPermission(resolve);
        if (r && typeof r.then === 'function') r.then(resolve, function () { resolve('default'); });
      });
      asked.then(function (perm) {
        permUp = false;
        if (perm !== 'granted') {
          lsSet('wq_rm_asked', Date.now());
          ev('denied', { perm: perm === 'denied' ? 'denied' : 'default', prompt_ms: tookMs() });
          if (arm === 'b' && perm !== 'denied') show.retry(); else { show.denied(); settle(); }
          return null;
        }
        ev('granted', { prompt_ms: tookMs() });
        show.wait();
        return subscribe().then(function (out) {
          if (out === 'ok') { ev('subscribed'); show.done(); settle(); } else if (out === 'class') { ev('failed', { ok: false }); draw(''); } else { ev('failed', { ok: false }); show.ask(); }
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
      else if (act === 'primer_go') { primerUp = false; primed = true; ev('primer_go'); askBrowser(); }
      // a Not now (to the ask or to the primer) gets no install card in that tap: it comes on the next finish page
      else if (act === 'primer_back') { primerUp = false; lsSet('wq_rm_later', Date.now()); ev('primer_back'); draw(''); }
      else if (act === 'later') { lsSet('wq_rm_later', Date.now()); ev('later', dwell()); draw(''); }
      else if (act === 'inst_add') { if (inst.offer) instAdd(); }
      else if (act === 'inst_later') { lsSet('wqp_inst_later', Date.now()); istep('later'); slot.innerHTML = drawn; }
      else if (act === 'stop') onStop();
      else if (act === 'test') onTest();
      else if (act === 'copy') { if (e.preventDefault) e.preventDefault(); onCopy(); }
      else if (act === 'escape') ev('escape', dwell({ how: 'intent' }));
      else if (act === 'how') { ev('escape', dwell({ how: 'menu' })); show.iab(true); }
    };

    return {
      start: function () {
        if ((Number(ctx.chips) || 0) >= 4) return Promise.resolve();
        if (installOnScreen()) return Promise.resolve();
        // the ask is snoozed (answered or Not now): no ask, but an Android Chrome tab may still get the install card
        if (!landing && snoozed()) return instOnly();
        return getKey(code).then(function (r) {
          // only a real off drops the worker; a 5xx, a route miss or no network leaves it (a failed read is not OFF)
          if (r.status === 404 && r.body && r.body.off === true) return dropWorkers();
          if (r.status !== 200) return null;
          // outside the canary: no card, no step, and any worker this phone already has stays
          if (r.body && r.body.ask === false) { if (instOk(r.body)) { instWire(code); settle(); } return null; }
          key = r.body && typeof r.body.key === 'string' ? r.body.key : null;
          // the landing keeps its own question: no arm there
          if (!landing && r.body && (r.body.ask_v === 'a' || r.body.ask_v === 'b')) arm = r.body.ask_v;
          primer = Boolean(r.body && r.body.primer === true);
          var b = branch();
          // the install card: only in a browser tab that can take it (not WhatsApp's browser, not iPhone, not a no-push browser)
          if (instOk(r.body)) instWire(code);
          if (b === 'iab') { iab = true; askShown(); show.iab(); return null; }
          if (b === 'ios') { ev('ios'); show.ios(); return null; }
          if (b === 'nopush') { ev('nopush'); show.nopush(); return null; }
          if (!key) return null;
          var perm = window.Notification.permission;
          if (perm === 'denied') { if (landing) show.denied(); settle(); return null; }
          return (perm === 'granted' ? currentSub() : Promise.resolve(null)).then(function (sub) {
            if (sub) { if (landing) show.done(); settle(); return; }
            askShown();
            show.ask();
          });
        }).catch(function () { return null; });
      },
    };
  }

  function run(slot, ctx, mode) {
    if (!slot) return Promise.resolve();
    if (standalone()) lsSet(APP_KEY, '1');
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
