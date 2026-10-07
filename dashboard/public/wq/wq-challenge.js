/*
 * The kid's Challenge page (/c/<hub token>): a menu of short exercises, each played alone.
 *   bigger  "Which is bigger?"  2 practice pairs, then 10 pairs, a tap each (10 s); 4 misses in a row stop it.
 *   read    "Read aloud"        the story large, 60 s on the microphone with a countdown and a Done button;
 *                               the recording goes straight to storage (presigned PUT), the server scores it
 *                               and the page polls until the words-per-minute come back.
 * The mascot says each step (a recorded clip when there is one; the line is always shown in the bubble).
 * No microphone (refused, or WhatsApp's browser cannot give one): say so, offer Chrome, or skip.
 * Copy lives in T (en + ur), gender-neutral; Urdu prose uses Urdu digits, the maths cards Western digits.
 */
(function () {
  'use strict';
  var root = document.getElementById('wq');
  var boot = {};
  try { boot = JSON.parse(document.getElementById('boot').textContent || '{}'); } catch (e) { boot = {}; }
  var menuData = boot.menu || { exercises: [], lang: 'en' };
  var L = menuData.lang === 'ur' ? 'ur' : 'en';
  var MASCOT = boot.mascot || (L === 'ur' ? 'جگنو' : 'Jugnu');
  var JUG = '/wq/jugnu/';

  var T = {
    en: {
      title: function (m) { return m + "'s Challenge"; },
      pick: 'Pick one. Each one takes about 2 minutes.',
      mins: function (n) { return n + ' min'; },
      done: 'Done',
      lastBigger: function (c, n) { return c + ' / ' + n; },
      lastRead: function (w) { return w + ' words a minute'; },
      start: 'Start',
      ready: "I'm ready",
      hear: 'Tap to hear',
      practice: "Let's practise first",
      own: 'Now on your own!',
      tapBigger: 'Tap the bigger number',
      yes: function (n) { return 'Yes! ' + n + ' is bigger.'; },
      notQuite: function (n) { return n + ' is bigger. Let us try another.'; },
      of: function (i, n) { return i + ' of ' + n; },
      gotBigger: function (c, n) { return 'You got ' + c + ' out of ' + n + '!'; },
      stoppedBigger: 'Good try! Numbers get easier with practice.',
      readNow: 'Read now!',
      finished: 'Done',
      micAsk: 'Allow the microphone when your phone asks.',
      sending: 'Sending your reading…',
      listening: 'Listening to your reading…',
      wcpm: function (w) { return 'You read ' + w + ' words in a minute!'; },
      readStopped: 'Good try! Reading gets easier every day you practise.',
      unheard: "We couldn't hear that clearly. Try again?",
      later: 'Your result is on its way.',
      wrong: 'Something went wrong. Try again.',
      empty: 'Nothing was recorded. Try again.',
      more_words: function (n) { return n + ' more words than last time!'; },
      same_words: 'As many words as last time. Keep going!',
      noMic: "Your WhatsApp browser can't use the microphone.",
      chrome: 'Open in Chrome',
      skip: 'Skip this one',
      more: 'More challenges',
      again: 'Try again',
      tooMany: 'That is enough reading for today. Come back tomorrow!',
      offline: 'No internet. Check the connection and try again.',
    },
    ur: {
      title: function (m) { return m + ' کا چیلنج'; },
      pick: 'ایک چنیں۔ ہر ایک تقریباً ۲ منٹ کا ہے۔',
      mins: function (n) { return ud(n) + ' منٹ'; },
      done: 'ہو گیا',
      lastBigger: function (c, n) { return ud(n) + ' میں سے ' + ud(c); },
      lastRead: function (w) { return 'ایک منٹ میں ' + ud(w) + ' لفظ'; },
      start: 'شروع کریں',
      ready: 'تیار ہوں',
      hear: 'سننے کے لیے چھوئیں',
      practice: 'پہلے مشق کریں',
      own: 'اب خود کریں!',
      tapBigger: 'بڑے نمبر کو چھوئیں',
      yes: function (n) { return 'جی ہاں! ' + iso(n) + ' بڑا ہے۔'; },
      notQuite: function (n) { return iso(n) + ' بڑا ہے۔ ایک اور کریں۔'; },
      of: function (i, n) { return ud(n) + ' میں سے ' + ud(i); },
      gotBigger: function (c, n) { return ud(n) + ' میں سے ' + ud(c) + ' صحیح!'; },
      stoppedBigger: 'اچھی کوشش! مشق سے نمبر آسان ہو جاتے ہیں۔',
      readNow: 'اب پڑھیں!',
      finished: 'ختم',
      micAsk: 'فون پوچھے تو مائیک کی اجازت دیں۔',
      sending: 'آپ کی آواز بھیجی جا رہی ہے…',
      listening: 'آپ کی پڑھائی سنی جا رہی ہے…',
      wcpm: function (w) { return 'آپ نے ایک منٹ میں ' + ud(w) + ' لفظ پڑھے!'; },
      readStopped: 'اچھی کوشش! روز مشق سے پڑھنا آسان ہو جاتا ہے۔',
      unheard: 'آواز صاف سنائی نہیں دی۔ دوبارہ کوشش کریں؟',
      later: 'آپ کا نتیجہ آ رہا ہے۔',
      wrong: 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔',
      empty: 'کچھ ریکارڈ نہیں ہوا۔ دوبارہ کوشش کریں۔',
      more_words: function (n) { return 'پچھلی بار سے ' + ud(n) + ' لفظ زیادہ!'; },
      same_words: 'پچھلی بار جتنے لفظ۔ پڑھتے رہیں!',
      noMic: 'آپ کا واٹس ایپ براؤزر مائیک استعمال نہیں کر سکتا۔',
      chrome: 'کروم میں کھولیں',
      skip: 'اسے چھوڑ دیں',
      more: 'مزید چیلنج',
      again: 'دوبارہ کریں',
      tooMany: 'آج کے لیے اتنا پڑھنا کافی ہے۔ کل پھر آئیں!',
      offline: 'انٹرنیٹ نہیں ہے۔ کنکشن دیکھ کر دوبارہ کوشش کریں۔',
    },
  };
  var t = T[L];
  var ICON = { bigger: '🔢', read: '📖' };

  // Urdu digits in Urdu prose; a number on a maths card stays Western and is isolated LTR.
  function ud(n) { return L === 'ur' ? String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.charAt(+d); }) : String(n); }
  function iso(n) { return '⁦' + n + '⁩'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function q(id) { return root.querySelector('#' + id); }
  function on(id, fn) { var el = q(id); if (el) el.addEventListener('click', fn); }

  // ── styles (own module, so the quiz's stylesheet is untouched) ──────────────────────────────────────
  (function css() {
    try {
      var s = document.createElement('style');
      s.id = 'wqc-css';
      s.textContent = [
        '.wqc-tiles{display:grid;gap:12px}',
        '.wqc-tile{display:flex;align-items:center;gap:14px;min-height:84px;border-radius:20px;border:0;background:var(--card);box-shadow:0 4px 0 var(--line);padding:10px 14px;width:100%;text-align:start;cursor:pointer;color:var(--navy)}',
        '.wqc-ico{font-size:34px;width:56px;height:56px;border-radius:16px;background:var(--paper-2);display:grid;place-items:center;flex:0 0 auto;line-height:1}',
        '.wqc-tile b{display:block;font-size:20px;font-weight:900}',
        'html[lang=ur] .wqc-tile b{font-weight:700;line-height:1.9}',
        '.wqc-tile small{display:block;color:var(--muted);font-weight:700;font-size:14px}',
        '.wqc-badge{display:inline-block;margin-top:4px;border-radius:999px;padding:2px 10px;font-weight:800;font-size:13px;background:var(--right-bg);color:var(--right)}',
        '.wqc-pair{display:grid;grid-template-columns:1fr 1fr;gap:14px;direction:ltr}',
        '.wqc-num{min-height:150px;border-radius:24px;border:3px solid transparent;background:var(--card);box-shadow:0 5px 0 var(--line);font-size:56px;font-weight:900;color:var(--navy);cursor:pointer;font-family:var(--f)}',
        '.wqc-num.wqc-ok{border-color:var(--right);background:var(--right-bg)}',
        '.wqc-num.wqc-no{border-color:var(--notyet);background:var(--notyet-bg)}',
        '.wqc-num.wqc-tap{border-color:var(--navy)}',
        '.wqc-timer{height:10px;border-radius:999px;background:var(--paper-2);overflow:hidden}',
        '.wqc-timer>i{display:block;height:100%;background:var(--brand);width:100%;transition:width .25s linear}',
        '.wqc-story{background:var(--card);border-radius:20px;padding:14px 16px;box-shadow:0 3px 0 var(--line);font-size:24px;line-height:1.7;font-weight:700;color:var(--ink)}',
        'html[lang=ur] .wqc-story{font-size:21px;line-height:2.25;font-weight:400}',
        '.wqc-clock{display:flex;align-items:center;justify-content:center;gap:10px;font-size:44px;font-weight:900;color:var(--navy);font-family:var(--f)}',
        '.wqc-dot{width:16px;height:16px;border-radius:50%;background:#D93A3A;animation:wqc-pulse 1s ease-in-out infinite}',
        '@keyframes wqc-pulse{50%{opacity:.3}}',
        '.wqc-hear{border:0;background:transparent;color:var(--navy);font-weight:800;font-size:15px;text-decoration:underline;cursor:pointer;padding:4px 0}',
        '.wqc-hear.wqc-pulse{animation:wqc-pulse 1.2s ease-in-out infinite}',
        '.wqc-score{font-size:30px;font-weight:900;color:var(--navy);text-align:center;margin:0}',
        'html[lang=ur] .wqc-score{font-weight:700;line-height:2}',
        // the action stays on screen however long the story is (Urdu runs past the fold at 360x740)
        '.wqc-sticky{position:fixed;left:0;right:0;bottom:0;z-index:5;padding:14px 16px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(rgba(255,255,255,0),var(--paper) 30%)}',
      ].join('\n');
      document.head.appendChild(s);
    } catch (e) { /* the page still works unstyled */ }
  })();

  // ── network ─────────────────────────────────────────────────────────────────────────────────────────
  function api(path, body, method) {
    var init = { method: method || (body ? 'POST' : 'GET'), headers: { accept: 'application/json' } };
    if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch('/api/wq/' + path, init).then(function (r) {
      return r.text().then(function (txt) {
        var j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
        if (!r.ok) { var err = new Error((j && j.error) || ('http_' + r.status)); err.status = r.status; throw err; }
        return j || {};
      });
    });
  }
  function ev(n, props) {
    try {
      var e = { n: n, lang: L };
      for (var k in (props || {})) e[k] = props[k];
      var body = JSON.stringify({ events: [e] });
      fetch('/api/wq/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (e) { /* events never break the page */ }
  }
  function kidQs() { return '?lang=' + L + (boot.kid ? '&kid=' + encodeURIComponent(boot.kid) : ''); }

  // ── the mascot: a bubble and, when there is one, its recorded clip ────────────────────────────────
  var player = null;
  function jug(pose, line, big) {
    return '<div class="wq-jug' + (big ? ' wq-big' : '') + '"><span class="wq-jimg"><img src="' + JUG + pose + '.webp" alt="" width="92" height="92"></span>'
      + '<div class="wq-say" id="wqc-say">' + esc(line) + '</div></div>';
  }
  function say(clip, cb) {
    if (player) { try { player.pause(); } catch (e) {} player = null; }
    if (!clip || !clip.url) { if (cb) cb(); return; }
    var done = false;
    var fin = function () { if (!done) { done = true; if (cb) cb(); } };
    try {
      var a = new Audio(clip.url);
      player = a;
      a.addEventListener('ended', fin);
      a.addEventListener('error', fin);
      var p = a.play();
      if (p && p.catch) {
        p.catch(function () {
          // Autoplay refused: the kid taps to hear it (never another voice), and the step goes on.
          var h = q('wqc-hear');
          if (h) h.className += ' wqc-pulse';
          fin();
        });
      }
      setTimeout(fin, 12000);
    } catch (e) { fin(); }
  }
  function hearBtn(clip) {
    return clip && clip.url ? '<button class="wqc-hear" id="wqc-hear" type="button">🔊 ' + esc(t.hear) + '</button>' : '';
  }
  function bindHear(clip) { on('wqc-hear', function () { say(clip); }); }

  var S = { screen: null, ex: null, data: null };
  function show(name, html) {
    S.screen = name;
    root.innerHTML = '<section class="wq-screen wqc" data-screen="' + name + '">' + html + '</section>';
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  // ── menu ────────────────────────────────────────────────────────────────────────────────────────────
  function lastLine(x) {
    if (!x.last) return '';
    // A read is ticked only for a real result: words per minute above 0 (a stopped or empty reading is not praise).
    if (x.id === 'read') return x.last.wcpm > 0 && !x.last.stopped ? t.lastRead(x.last.wcpm) : '';
    return x.last.n ? t.lastBigger(x.last.correct, x.last.n) : t.done;
  }
  function menu() {
    var tiles = (menuData.exercises || []).map(function (x) {
      return '<button class="wqc-tile" type="button" id="wqc-ex-' + esc(x.id) + '"><span class="wqc-ico" aria-hidden="true">' + (ICON[x.id] || '⭐') + '</span>'
        + '<span><b>' + esc(x.name) + '</b><small>' + esc(t.mins(x.mins)) + '</small>'
        + (x.done && (x.id !== 'read' || lastLine(x)) ? '<span class="wqc-badge">✓ ' + esc(lastLine(x)) + '</span>' : '') + '</span></button>';
    }).join('');
    show('menu', jug('hello', t.title(MASCOT), true) + '<p class="wq-sub">' + esc(t.pick) + '</p><div class="wqc-tiles">' + tiles + '</div>');
    (menuData.exercises || []).forEach(function (x) { on('wqc-ex-' + x.id, function () { open(x.id); }); });
  }

  function refreshMenu() {
    return api('ch/' + encodeURIComponent(boot.token) + kidQs()).then(function (m) { menuData = m; }).catch(function () {}).then(menu);
  }

  function errorScreen(err, retry) {
    // Each state says what happened (never one message for all): offline, today's limit, or a plain "went wrong".
    var line = err && err.status === 429 ? t.tooMany : (err && err.status ? t.wrong : t.offline);
    show('error', jug('notyet', line, true) + '<div class="wq-stack">'
      + (retry ? '<button class="wq-btn wq-go" id="wqc-retry" type="button">' + esc(t.again) + '</button>' : '')
      + '<button class="wq-btn wq-soft" id="wqc-menu" type="button">' + esc(t.more) + '</button></div>');
    if (retry) on('wqc-retry', retry);
    on('wqc-menu', refreshMenu);
  }

  function open(ex) {
    S.ex = ex;
    api('ch/' + encodeURIComponent(boot.token) + '/' + ex + kidQs()).then(function (d) {
      S.data = d;
      ev('ch_start', { step: ex });
      intro();
    }).catch(function (e) { errorScreen(e, function () { open(ex); }); });
  }

  function intro() {
    var d = S.data;
    show('intro', jug('hello', d.clips.intro.text, true) + hearBtn(d.clips.intro)
      + '<div class="wqc-sticky"><button class="wq-btn wq-go" id="wqc-go" type="button">' + esc(d.ex === 'read' ? t.ready : t.start) + '</button></div>');
    bindHear(d.clips.intro);
    say(d.clips.intro);
    on('wqc-go', function () { if (d.ex === 'read') micStart(); else bigger.practice(0); });
  }

  // ── Which is bigger? ────────────────────────────────────────────────────────────────────────────────
  var bigger = {
    taps: [], i: 0, miss: 0, timer: null, t0: 0, started: 0,
    pairHtml: function (p, line, k, n) {
      return jug('thinking', line) + (n ? '<p class="wq-small">' + esc(t.of(k, n)) + '</p><div class="wqc-timer"><i id="wqc-bar"></i></div>' : '')
        + '<div class="wqc-pair"><button class="wqc-num" type="button" id="wqc-a">' + esc(p.a) + '</button><button class="wqc-num" type="button" id="wqc-b">' + esc(p.b) + '</button></div>';
    },
    practice: function (k) {
      var d = S.data;
      var p = d.practice[k];
      if (!p) { bigger.ownTurn(); return; }
      show('bigger-practice', '<p class="wq-sub">' + esc(t.practice) + '</p>' + bigger.pairHtml(p, t.tapBigger));
      var picked = false;
      var pick = function (v, id) {
        if (picked) return;
        picked = true;
        var right = v === p.answer;
        var el = q(id);
        if (el) el.className += right ? ' wqc-ok' : ' wqc-no';
        var s = q('wqc-say');
        if (s) s.textContent = right ? t.yes(p.answer) : t.notQuite(p.answer);
        setTimeout(function () { bigger.practice(k + 1); }, 1600);
      };
      on('wqc-a', function () { pick(p.a, 'wqc-a'); });
      on('wqc-b', function () { pick(p.b, 'wqc-b'); });
    },
    ownTurn: function () {
      bigger.taps = []; bigger.i = 0; bigger.miss = 0; bigger.started = Date.now();
      show('bigger-go', jug('hello', t.own, true));
      say(S.data.clips.start, function () { setTimeout(function () { bigger.item(0); }, 300); });
    },
    item: function (i) {
      var d = S.data;
      if (i >= d.items.length || bigger.miss >= (d.stop_after || 4)) { bigger.finish(); return; }
      bigger.i = i;
      var p = d.items[i];
      show('bigger-play', bigger.pairHtml(p, t.tapBigger, i + 1, d.items.length));
      bigger.t0 = Date.now();
      var limit = (d.per_item_s || 10) * 1000;
      var answered = false;
      var next = function (pick) {
        if (answered) return;
        answered = true;
        clearInterval(bigger.timer);
        var ms = Date.now() - bigger.t0;
        if (pick != null) bigger.taps.push({ i: i, pick: pick, ms: ms });
        // the phone keeps its own count of misses so a stopped kid is not shown more pairs
        var right = pick != null && pick === Math.max(p.a, p.b) && ms <= limit;
        bigger.miss = right ? 0 : bigger.miss + 1;
        var id = pick === p.a ? 'wqc-a' : (pick === p.b ? 'wqc-b' : null);
        if (id && q(id)) q(id).className += ' wqc-tap';
        setTimeout(function () { bigger.item(i + 1); }, 350);
      };
      on('wqc-a', function () { next(p.a); });
      on('wqc-b', function () { next(p.b); });
      bigger.timer = setInterval(function () {
        var left = Math.max(0, limit - (Date.now() - bigger.t0));
        var bar = q('wqc-bar');
        if (bar) bar.style.width = (100 * left / limit) + '%';
        if (left <= 0) next(null);
      }, 250);
    },
    finish: function () {
      clearInterval(bigger.timer);
      var d = S.data;
      show('bigger-wait', jug('thinking', d.clips.stop.text, true));
      say(d.clips.stop);
      api('ch/result', { ct: d.ct, taps: bigger.taps, ms: Date.now() - bigger.started })
        .then(function (r) { bigger.result(r.score); })
        .catch(function (e) { errorScreen(e, bigger.finish); });
    },
    result: function (s) {
      var d = S.data;
      var good = !s.stopped;
      show('bigger-result', jug(good ? 'celebrate' : 'notyet', good ? d.clips.done.text : t.stoppedBigger, true)
        + '<p class="wqc-score" id="wqc-score">' + esc(t.gotBigger(s.correct, s.n)) + '</p>'
        + '<div class="wq-stack"><button class="wq-btn wq-go" id="wqc-menu" type="button">' + esc(t.more) + '</button>'
        + '<button class="wq-btn wq-soft" id="wqc-again" type="button">' + esc(t.again) + '</button></div>');
      if (good) say(d.clips.done);
      on('wqc-menu', refreshMenu);
      on('wqc-again', function () { open('bigger'); });
    },
  };

  // ── Read aloud ──────────────────────────────────────────────────────────────────────────────────────
  var rec = { stream: null, mr: null, chunks: [], type: '', left: 60, timer: null, started: 0, sent: false };
  var MIC_WAIT_MS = 12000;
  var MIN_BYTES = 1000;

  function stopTracks(stream) {
    try { stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) { /* already gone */ }
  }
  // The microphone is handed back on every way out: done, a recorder error, Skip, leaving the page.
  function releaseMic() {
    clearInterval(rec.timer);
    if (rec.stream) { stopTracks(rec.stream); rec.stream = null; }
  }
  window.addEventListener('pagehide', function () {
    if (rec.mr && rec.mr.state === 'recording') { try { rec.mr.stop(); } catch (e) {} }
    releaseMic();
  });
  // The child left WhatsApp's browser mid-read: stop there and send what was read (the mic is released).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && rec.mr && rec.mr.state === 'recording') stopRec();
  });

  function pickType() {
    var MR = window.MediaRecorder;
    if (!MR) return null;
    var want = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    if (typeof MR.isTypeSupported !== 'function') return '';
    for (var i = 0; i < want.length; i++) if (MR.isTypeSupported(want[i])) return want[i];
    return '';
  }

  function micStart() {
    var md = navigator.mediaDevices;
    var type = pickType();
    if (!md || typeof md.getUserMedia !== 'function' || type === null) {
      ev('ch_mic', { ok: false, err: 'unsupported' });
      noMic();
      return;
    }
    show('mic-ask', jug('hello', t.micAsk, true) + '<button class="wq-btn wq-soft" id="wqc-skip" type="button">' + esc(t.skip) + '</button>');
    var settled = false;
    on('wqc-skip', function () { settled = true; releaseMic(); refreshMenu(); });
    // A WebView whose app never answers the permission request leaves getUserMedia pending for ever.
    setTimeout(function () {
      if (settled) return;
      settled = true;
      ev('ch_mic', { ok: false, err: 'timeout' });
      noMic();
    }, MIC_WAIT_MS);
    md.getUserMedia({ audio: true }).then(function (stream) {
      if (settled) { stopTracks(stream); return; }
      settled = true;
      ev('ch_mic', { ok: true });
      rec.stream = stream;
      rec.type = type;
      readStart();
    }).catch(function (e) {
      if (settled) return;
      settled = true;
      var name = String((e && e.name) || 'error').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'error';
      ev('ch_mic', { ok: false, err: name });
      noMic();
    });
  }

  function chromeHref() {
    return 'intent://' + location.host + location.pathname + (location.search || '') + '#Intent;scheme=https;package=com.android.chrome;end';
  }
  function noMic() {
    var android = /Android/i.test(navigator.userAgent || '');
    show('no-mic', jug('notyet', t.noMic, true) + '<div class="wq-stack">'
      + (android ? '<a class="wq-btn wq-go" id="wqc-chrome" href="' + esc(chromeHref()) + '">' + esc(t.chrome) + '</a>' : '')
      + '<button class="wq-btn wq-soft" id="wqc-skip" type="button">' + esc(t.skip) + '</button></div>');
    on('wqc-skip', function () { releaseMic(); refreshMenu(); });
  }

  function storyHtml(st) {
    return '<div class="wqc-story" dir="' + (st.dir === 'rtl' ? 'rtl' : 'ltr') + '" lang="' + L + '">' + esc(st.text) + '</div>';
  }
  function clock(s) { return L === 'ur' ? ud(s) : String(s); }

  function readStart() {
    var d = S.data;
    show('read-ready', jug('hello', d.clips.start.text) + storyHtml(d.story));
    say(d.clips.start, function () { record(); });
  }

  function record() {
    var d = S.data;
    rec.chunks = [];
    rec.left = d.secs || 60;
    rec.sent = false;
    try {
      rec.mr = rec.type ? new MediaRecorder(rec.stream, { mimeType: rec.type }) : new MediaRecorder(rec.stream);
    } catch (e) {
      releaseMic();
      ev('ch_mic', { ok: false, err: 'recorder' });
      noMic();
      return;
    }
    rec.mr.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
    rec.mr.onstop = function () { finishRec(); };
    rec.mr.onerror = function () {
      ev('ch_mic', { ok: false, err: 'recorder_died' });
      finishRec();
    };
    rec.mr.start(1000);
    rec.started = Date.now();
    show('read-rec', '<div class="wqc-clock"><span class="wqc-dot" aria-hidden="true"></span><span id="wqc-left">' + clock(rec.left) + '</span></div>'
      + '<p class="wq-sub">' + esc(t.readNow) + '</p>' + storyHtml(d.story)
      + '<div class="wqc-sticky"><button class="wq-btn wq-navy" id="wqc-stop" type="button">⏹ ' + esc(t.finished) + '</button></div>');
    on('wqc-stop', function () { stopRec(); });
    rec.timer = setInterval(function () {
      rec.left = Math.max(0, (d.secs || 60) - Math.floor((Date.now() - rec.started) / 1000));
      var el = q('wqc-left');
      if (el) el.textContent = clock(rec.left);
      if (rec.left <= 0) stopRec();
    }, 250);
  }

  function stopRec() {
    clearInterval(rec.timer);
    rec.ms = rec.ms || (Date.now() - rec.started);
    if (rec.mr && rec.mr.state !== 'inactive') {
      try { rec.mr.stop(); say(S.data.clips.stop); return; } catch (e) { /* finish below */ }
    }
    finishRec();
  }

  // Once per recording: give the mic back, then send what was read (or say nothing was recorded).
  function finishRec() {
    if (rec.sent) return;
    rec.sent = true;
    rec.ms = rec.ms || (Date.now() - rec.started);
    releaseMic();
    var size = rec.chunks.reduce(function (a, c) { return a + (c.size || 0); }, 0);
    if (size < MIN_BYTES) {
      show('read-empty', jug('notyet', t.empty, true) + '<div class="wq-stack"><button class="wq-btn wq-go" id="wqc-again" type="button">' + esc(t.again) + '</button>'
        + '<button class="wq-btn wq-soft" id="wqc-menu" type="button">' + esc(t.more) + '</button></div>');
      on('wqc-again', function () { open('read'); });
      on('wqc-menu', refreshMenu);
      return;
    }
    upload();
  }

  function upload() {
    var d = S.data;
    var type = (rec.mr && rec.mr.mimeType) || rec.type || 'audio/webm';
    var blob = new Blob(rec.chunks, { type: type });
    rec.blob = blob;
    show('read-send', jug('thinking', t.sending, true));
    api('ch/upload', { ct: d.ct, type: type, size: blob.size }).then(function (u) {
      return fetch(u.put_url, { method: 'PUT', headers: { 'content-type': u.content_type }, body: blob }).then(function (r) {
        if (!r.ok) { var e = new Error('put_' + r.status); e.status = r.status; throw e; }
        return u.key;
      });
    }).then(function (key) {
      show('read-wait', jug('thinking', t.listening, true));
      return api('ch/result', { ct: d.ct, key: key, ms: rec.ms || 0, lang: L });
    }).then(function (r) {
      if (r && r.pending) return pollResult(0);
      readResult(r);
    }).catch(function (e) { errorScreen(e, function () { open('read'); }); });
  }

  var POLL_MS = 3000;
  var POLL_MAX = 20;   // 60 s
  function pollResult(n) {
    if (n >= POLL_MAX) { readResult({ later: true }); return; }
    setTimeout(function () {
      api('ch/result/' + encodeURIComponent(S.data.ct)).then(function (r) {
        if (r && r.pending) pollResult(n + 1);
        else readResult(r);
      }).catch(function (e) {
        if (e && e.status >= 400 && e.status < 500) { errorScreen(e, function () { open('read'); }); return; }
        pollResult(n + 1);
      });
    }, POLL_MS);
  }

  function readResult(r) {
    var d = S.data;
    var line; var pose = 'celebrate'; var score = ''; var growth = '';
    if (r.later) { line = t.later; pose = 'hello'; }
    // Nothing heard (attempted 0) is "try again", whatever the server called it; heard but nothing right is
    // encouragement. Only a reading with words per minute above 0 is praised.
    else if (r.failed || (r.score && !r.score.stopped && r.score.attempted === 0)) { r = { failed: true }; line = t.unheard; pose = 'notyet'; }
    else if ((r.score && r.score.stopped) || !(r.wcpm > 0)) { line = t.readStopped; pose = 'notyet'; }
    else {
      line = d.clips.done.text; score = t.wcpm(r.wcpm);
      var prev = r.previous && r.previous.wcpm;
      if (prev != null && r.wcpm > prev) growth = t.more_words(r.wcpm - prev);
      else if (prev != null && r.wcpm === prev) growth = t.same_words;
    }
    show('read-result', jug(pose, line, true) + (score ? '<p class="wqc-score" id="wqc-score">' + esc(score) + '</p>' : '')
      + (growth ? '<p class="wq-sub" id="wqc-growth">' + esc(growth) + '</p>' : '')
      // Not heard: steer the child to read again — "Try again" is the primary button, "More challenges" the second.
      + '<div class="wq-stack">' + (r.failed
        ? '<button class="wq-btn wq-go" id="wqc-again" type="button">' + esc(t.again) + '</button><button class="wq-btn wq-soft" id="wqc-menu" type="button">' + esc(t.more) + '</button>'
        : '<button class="wq-btn wq-go" id="wqc-menu" type="button">' + esc(t.more) + '</button>') + '</div>');
    if (score) say(d.clips.done);
    on('wqc-menu', refreshMenu);
    on('wqc-again', function () { open('read'); });
  }

  // The test harness reaches the screens through this handle; nothing on the page uses it.
  window.__wqc = { S: S, menu: menu, open: open, intro: intro, bigger: bigger, micStart: micStart, noMic: noMic, record: record, stopRec: stopRec, readResult: readResult, upload: upload, pollResult: pollResult, rec: rec, T: T };
  ev('ch_open', {});
  menu();
})();
