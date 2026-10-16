/* Stories (web_quiz_stories): WQSTORIES.shelf(el, ctx) fills the home's [data-shelf]; open(id, ctx, q) is the reader
 * (ONE WQReadAlong player per page, Your turn via WQLiveRead, questions, the done card); route(ctx) handles '#story/<id>',
 * '#story/<id>/p<n>', '#story/<id>/q'; _machine is the pure page state machine. ctx = {token, kid, lang, ev, root?, clock?};
 * a teacher preview is {role:'teacher', bookUrl, root, lang, onBack?}. Contracts: STORIES.md, READALONG.md §4,
 * LIVEREAD.md §11, JUICE.md §0, CONVERGENCE.md, RULINGS #S4 #S5 #S7. The server checks answers; no rate or score is shown. */
(function () {
  'use strict';
  var W = window;
  /* Copy rules (URDU_REVIEW.md): no test words (test, exam, assessment, امتحان, ٹیسٹ); gender-neutral آپ; ergative past
   agreeing with the story («آپ نے … پڑھ لی»); «ٹیچر» not «استاد»; «دبائیں» not «ٹیپ کریں»; «کھویا ہوا» not «گم شدہ»;
   Urdu digits in Urdu prose; no U+00B7; every Urdu run in dir="rtl"; short lines. */
  var T = {
    en: {
      shelf: 'Storybooks', gl: function (g, l) { return 'Grade ' + g + ', ' + (l === 'ur' ? 'Urdu' : 'English'); },
      readWith: function (h) { return '▶ Read <bdi>' + h + '</bdi> with Jugnu'; }, teacher: 'From your teacher', by: function (n) { return 'by ' + n; },
      read: 'Read', empty: 'No storybooks here yet. Try another grade.', oops: 'Jugnu could not open this.', retry: 'Try again',
      off: 'Stories are resting today.', home: 'Home', back: 'Back', close: 'Close', sound: 'Sound', prevP: 'Page before', nextP: 'Next page',
      listen: 'Listen', pause: 'Pause', yourTurn: 'Your turn', next: 'Next', again: 'Listen again', done: 'I\'m done ✓',
      micSay: 'Tap to let Jugnu hear you', ok: 'OK', notNow: 'Not now, just listen', denied: 'That\'s OK, let\'s listen with Jugnu',
      readNow: 'Read it aloud!', keepGoing: 'Keep going!', checking: 'Jugnu is listening…', wellRead: 'Well read!',
      lookBack: 'Let\'s look back!', backQ: 'Back to the question', together: 'Let\'s read it together', practise: 'Let\'s practise this word', hear: 'Hear it',
      wholeRead: 'You read the whole story!', readSome: 'You read with Jugnu!', wholeHeard: 'You listened to the whole story!', tried: 'You tried a new story!',
      pagesRead: function (s, n) { return s + (n === 1 ? ' page read' : ' pages read'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' page listened to' : ' pages listened to'); },
      sticker: 'A new sticker for your Book!', more: 'More stories',
    },
    ur: {
      shelf: 'کہانیوں کی کتابیں', gl: function (g, l) { return 'جماعت ' + g + '، ' + (l === 'ur' ? 'اردو' : 'انگریزی'); },
      readWith: function (h) { return '▶ جگنو کے ساتھ <bdi>' + h + '</bdi> پڑھیں'; }, teacher: 'ٹیچر کی طرف سے', by: function (n) { return n + ' کی لکھی ہوئی'; },
      read: 'پڑھ لی', empty: 'یہاں ابھی کوئی کہانی نہیں۔ کوئی اور جماعت چنیں۔', oops: 'جگنو یہ کھول نہیں سکا۔', retry: 'دوبارہ کوشش کریں',
      off: 'آج کہانیاں آرام کر رہی ہیں۔', home: 'ہوم', back: 'واپس', close: 'بند کریں', sound: 'آواز', prevP: 'پچھلا صفحہ', nextP: 'اگلا صفحہ',
      listen: 'سنیں', pause: 'رکیں', yourTurn: 'اب آپ پڑھیں', next: 'آگے', again: 'دوبارہ سنیں', done: 'میں نے پڑھ لیا ✓',
      micSay: 'جگنو کو اپنی آواز سنانے کے لیے دبائیں', ok: 'ٹھیک ہے', notNow: 'ابھی نہیں، صرف سنیں', denied: 'کوئی بات نہیں، جگنو کے ساتھ سنیں',
      readNow: 'اونچی آواز میں پڑھیں!', keepGoing: 'پڑھتے رہیں!', checking: 'جگنو سن رہا ہے…', wellRead: 'بہت خوب پڑھا!',
      lookBack: 'آئیں، پیچھے دیکھیں!', backQ: 'سوال پر واپس', together: 'آؤ مل کر پڑھیں', practise: 'آئیں یہ لفظ مشق کریں', hear: 'سنیں',
      wholeRead: 'آپ نے پوری کہانی پڑھ لی!', readSome: 'آپ نے جگنو کے ساتھ پڑھا!', wholeHeard: 'آپ نے پوری کہانی سن لی!', tried: 'آپ نے ایک نئی کہانی آزمائی!',
      pagesRead: function (s, n) { return s + (n === 1 ? ' صفحہ پڑھا' : ' صفحے پڑھے'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' صفحہ سنا' : ' صفحے سنے'); },
      sticker: 'آپ کی کتاب کے لیے ایک نیا اسٹیکر!', more: 'اور کہانیاں',
    },
  };
  var JG = '/wq/jugnu/';
  var cache = {}, opened = {}, codes = {}, cur = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
  function lg(l) { return l === 'ur' ? 'ur' : 'en'; }
  function dirOf(l) { return l === 'ur' ? 'rtl' : 'ltr'; }
  function dg(n, l) { var s = String(n); return l === 'ur' ? s.replace(/[0-9]/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); }) : s; }
  function ls(k, v) { try { if (v === undefined) return W.localStorage.getItem(k); W.localStorage.setItem(k, v); } catch (e) {} return null; }
  function juice(f, a) { try { if (W.WQJ && typeof W.WQJ[f] === 'function') return W.WQJ[f](a); } catch (e) {} }
  function muted() { if (W.WQJ && W.WQJ.muted) return !!juice('muted'); return ls('wq_snd') === '0'; }
  function evt(ctx, n, p) { try { if (ctx.ev) ctx.ev(n, p); } catch (e) {} }
  function clockOf(ctx) {
    return ctx.clock || { now: function () { return Date.now(); }, set: function (f, ms) { return W.setTimeout(f, ms); }, clear: function (h) { W.clearTimeout(h); } };
  }
  function req(method, url, body) {
    var init = { method: method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return W.fetch(url, init).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, ok: r.ok, body: j || {} }; }, function () { return { status: r.status, ok: r.ok, body: {} }; });
    });
  }
  function post(ctx, id, ev, data, n) {
    if (ctx.role === 'teacher') return Promise.resolve({});
    var b = { kid: ctx.kid, book_id: id, event: ev, data: data || {} };
    if (n) b.page_n = n;
    return req('POST', '/api/wq/stories/event/h/' + enc(ctx.token), b).then(function (r) { return r.body; }, function () { return {}; });
  }
  function tids(kid) { return String(ls('wq_st_t:' + (kid || '')) || '').split(',').filter(Boolean); }

  function scr(name, l, inner, cls) { return '<section class="wqs ' + (cls || '') + '" data-screen="' + name + '" lang="' + l + '" dir="' + dirOf(l) + '">' + inner + '</section>'; }
  function img(src, w, h, cls, ex) { return '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="' + esc(src) + '" width="' + w + '" height="' + h + '" alt=""' + (ex || '') + ' onerror="WQSTORIES._bad(this)">'; }
  function ic(t, tap, label, glyph, ex) { return '<button class="wqs-ic" ' + (ex || 'data-back') + ' data-tap="' + tap + '" aria-label="' + esc(label) + '">' + glyph + '</button>'; }
  // left-to-right in both languages: the one mute sits top-right (JUICE §0.1)
  function top(l, left, title, snd) {
    var t = T[l], m = muted();
    return '<div class="wqs-top" dir="ltr">' + (left || '<span class="wqs-ic0"></span>') + '<h2 lang="' + l + '" dir="' + dirOf(l) + '">' + esc(title || '') + '</h2>' +
      (snd ? '<button class="wqs-ic wqs-snd" data-snd data-tap="snd" aria-pressed="' + m + '" aria-label="' + esc(t.sound) + '">' + (m ? '🔇' : '🔊') + '</button>' : '') + '</div>';
  }
  function kind(name, l, say, btn, left) {
    return scr(name, l, top(l, left) + img(JG + 'thinking.webp', 96, 96, 'wqs-jg') + '<p class="wqs-say">' + esc(say) + '</p>' + btn, 'wqs-sheet');
  }
  function retryHtml(l, left) { return kind('stories-retry', l, T[l].oops, '<button class="wqs-main" data-primary data-tap="retry">' + esc(T[l].retry) + '</button>', left); }
  // a broken picture: a tap tries again
  function bad(im) {
    if (!im || / wqs-bad/.test(im.className || '')) return;
    im.className = (im.className || '') + ' wqs-bad';
    im.alt = '↻';
    im.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); im.className = im.className.replace(' wqs-bad', ''); var s = im.src; im.src = ''; im.src = s; };
  }
  function wire(el, fn) {
    el._wqs = fn;
    if (el._wqw) return;
    el._wqw = 1;
    el.addEventListener('click', function (e) {
      for (var n = e.target; n && n !== el; n = n.parentNode) {
        var a = n.getAttribute && n.getAttribute('data-tap');
        if (a) { el._wqs(a, n.getAttribute('data-arg'), e); return; }
      }
    });
  }

  /* ---- the shelf: the server orders it, the page never reorders ---- */
  function shelfHtml(d, open) {
    var l = lg(d.lang), t = T[l], bk = d.books || [], tk = -1, k, cards = '', first;
    for (k = 0; k < bk.length && tk < 0; k++) if (bk[k].from_teacher) tk = k;
    first = tk < 0;
    var cov = function (b) { return img(b.cover, 160, 240, '', ' loading="lazy"'); };
    bk.forEach(function (b, k) {
      if (k === tk) return;
      var bl = lg(b.lang);
      cards += '<li><button class="wqs-book" data-tap="book" data-arg="' + k + '"' + (first ? ' data-primary' : '') + (b.done ? ' data-done' : '') + '><span class="wqs-cov">' + cov(b) +
        (b.from_teacher ? '<i class="wqs-rib">' + esc(t.teacher) + '</i>' : '') + (b.done ? '<i class="wqs-tick" aria-label="' + esc(t.read) + '">✓</i>' : '') +
        '</span><b lang="' + bl + '" dir="' + dirOf(bl) + '">' + esc(b.title) + '</b>' + (b.by ? '<small>' + esc(t.by(b.by)) + '</small>' : '') + '</button></li>';
      first = false;
    });
    var chips = '';
    if (open) {
      (d.grades || [1, 2, 3, 4, 5]).forEach(function (g) { chips += '<button class="wqs-chip" data-tap="g" data-arg="' + g + '" aria-pressed="' + (+g === +d.grade) + '">' + dg(g, l) + '</button>'; });
      ['en', 'ur'].forEach(function (x) { chips += '<button class="wqs-chip" data-tap="l" data-arg="' + x + '" aria-pressed="' + (x === l) + '" lang="' + x + '" dir="' + dirOf(x) + '">' + (x === 'ur' ? 'اردو' : 'EN') + '</button>'; });
    }
    var tb = bk[tk];
    return scr('stories-shelf', l,
      '<div class="wqs-top"><a class="wqs-ic" href="#" data-home data-tap="home"' + (bk.length ? '' : ' data-primary') + ' aria-label="' + esc(t.home) + '">🏠</a><h2>' + esc(t.shelf) + '</h2></div>' +
      '<button class="wqs-gl" data-tap="gl" aria-expanded="' + !!open + '">' + esc(t.gl(dg(d.grade, l), l)) + ' ▾</button>' + (open ? '<div class="wqs-pick">' + chips + '</div>' : '') +
      (tb ? '<button class="wqs-tcard" data-tap="book" data-arg="' + tk + '" data-primary>' + cov(tb) + '<span><i class="wqs-rib">' + esc(t.teacher) + '</i><b>' + t.readWith(esc(tb.title)) + '</b>' + (tb.by ? '<small>' + esc(t.by(tb.by)) + '</small>' : '') + '</span></button>' : '') +
      (bk.length ? '<ul class="wqs-grid">' + cards + '</ul>' : '<p class="wqs-say">' + esc(t.empty) + '</p>'), 'wqs-shelf');
  }
  function shelf(el, ctx, q) {
    if (!el) return;
    ctx = ctx || {};
    if (!q) { q = {}; var gl = String(ls('wq_st_gl') || '').split(','); if (gl[1]) q.l = gl[1]; }
    var l = lg(q.l || ctx.lang), ids = tids(ctx.kid).join(',');
    try { el.setAttribute('data-filled', '1'); } catch (e) {}
    wire(el, function (tap, arg) {
      var d = el._d || {}, b = (d.books || [])[+arg];
      if (tap === 'book' && b) {
        opened[b.id] = 1;
        post(ctx, b.id, 'story_opened', { shelf_position: b.shelf_position == null ? +arg : b.shelf_position, from_teacher: !!b.from_teacher, grade: b.grade, lang: b.lang });
        W.location.hash = '#story/' + b.id;
      } else if (tap === 'gl') { el._open = !el._open; el.innerHTML = shelfHtml(d, el._open); }
      else if (tap === 'g' || tap === 'l') { q.g = q.g || d.grade; q.l = q.l || d.lang; q[tap] = arg; ls('wq_st_gl', q.g + ',' + q.l); shelf(el, ctx, q); }
      else if (tap === 'retry') shelf(el, ctx, q);
    });
    el.innerHTML = '<div class="wqs wqs-shelf" aria-busy="true"><div class="wqs-grid">' + new Array(5).join('<i class="wqs-skel"></i>') + '</div></div>';
    function fail() { el.innerHTML = retryHtml(l); }
    req('GET', '/api/wq/stories/shelf/h/' + enc(ctx.token) + '?kid=' + enc(ctx.kid) + (q.g ? '&g=' + enc(q.g) : '') + (q.l ? '&l=' + enc(q.l) : '') + (ids ? '&t=' + enc(ids) : '')).then(function (r) {
      if (r.status === 404) { el.innerHTML = ''; el.hidden = true; return; }
      if (!r.ok) return fail();
      el._d = r.body; el._open = false;
      el.innerHTML = shelfHtml(r.body, false);
      evt(ctx, 'story_shelf_shown', { n: (r.body.books || []).length, grade: r.body.grade, lang: r.body.lang });
    }, fail);
  }

  /* ---- the page state machine (pure; effects go out through o.fx) ---- */
  function machine(b, o) {
    var P = b.pages || [];
    var m = { i: 0, st: '', lr: !!o.lr, skip: -1, no: {}, l: {}, r: {} };
    function chg() { if (o.on) o.on(m); }
    function fx(n) { if (o.fx) o.fx(n); }
    function can() { var p = P[m.i]; return m.lr && !m.no[m.i] && !!(p.words && p.words.length); }
    function au() { return !!P[m.i].audio; }
    m.set = function (s) { m.st = s; chg(); };
    // a picture page waits for a tap on Next (no timer)
    m.go = function (i) { m.i = i; m.skip = -1; m.st = P[i].is_picture ? 'picture' : 'idle'; chg(); };
    m.label = function () {
      var s = m.st;
      if (s === 'listening') return 'pause';
      if (s === 'paused') return 'listen';
      if (s === 'reading') return 'done';
      if (s === 'idle') return au() ? 'listen' : can() ? 'yourTurn' : 'next';
      if (s === 'listened') return can() ? 'yourTurn' : 'next';
      if (s === 'together' || s === 'denied') return au() ? 'listen' : 'next';
      return s === 'practise' || s === 'read' || s === 'picture' ? 'next' : null;
    };
    m.primary = function () {
      var lab = m.label();
      if (lab === 'pause') { fx('pause'); m.set('paused'); }
      else if (lab === 'listen') { fx('play'); m.set('listening'); }
      else if (lab === 'yourTurn') m.set('mic');
      else if (lab === 'done') fx('stop');
      else if (lab === 'next') m.next();
    };
    m.end = function () { if (m.st === 'listening' || m.st === 'paused') { m.l[m.i] = 1; m.set('listened'); } };
    m.err = function () { P[m.i].audio = null; m.set('idle'); };
    m.granted = function () { m.set('reading'); };
    m.denied = function () { m.lr = false; m.set('denied'); };
    m.notNow = function () { m.no[m.i] = 1; m.set('idle'); };
    // #S5: praise only when words were heard; else "let's read it together" + Listen
    m.result = function (r) {
      var ok = !!(r && r.words_read > 0);
      m.skip = ok ? (r.marks || []).indexOf('skipped') : -1;
      if (ok) m.r[m.i] = 1;
      m.set(ok ? (m.skip >= 0 ? 'practise' : 'read') : 'together');
    };
    m.next = function () { if (m.i < P.length - 1) m.go(m.i + 1); else m.set(b.questions && b.questions.length ? 'questions' : 'done'); };
    m.prev = function () { if (m.i > 0) m.go(m.i - 1); };
    m.counts = function () { return { pages_listened: Object.keys(m.l).length, pages_read: Object.keys(m.r).length }; };
    if (P.length) m.go(Math.max(0, Math.min(P.length - 1, o.start || 0))); else m.st = b.questions && b.questions.length ? 'questions' : 'done';
    return m;
  }

  /* ---- the reader ---- */
  function reader(id, ctx, root) {
    var C = clockOf(ctx), tch = ctx.role === 'teacher', me = { id: id, root: root };
    var b, L = lg(ctx.lang), t = T[L], P, m, pl = null, lr = null, view = '', pg = -1, t0 = -1, acc = 0, sent = {}, poll = null, ask = {}, stream = null;
    var qi = 0, ans = [], tries = [], chosen = -1, qlock = 0, qs = null, au = null;
    function paint(h) { root.innerHTML = h; }
    function back() { kill(); if (!tch) W.location.hash = '#stories'; else if (ctx.onBack) ctx.onBack(); else if (W.history) W.history.back(); }
    function bookUrl() { return tch ? ctx.bookUrl : '/api/wq/stories/book/' + enc(id) + '/h/' + enc(ctx.token) + '?kid=' + enc(ctx.kid); }
    function load(q) {
      paint(scr('story-wait', L, '<i class="wqs-skel wqs-big"></i>'));
      (cache[id] && !tch ? Promise.resolve({ ok: true, body: cache[id] }) : req('GET', bookUrl())).then(function (r) {
        if (cur !== me) return;
        if (r.status === 404) return paint(kind('stories-off', L, t.off, '<button class="wqs-main" data-primary data-home data-tap="home">' + esc(t.home) + '</button>'));
        if (!r.ok) return paint(retryHtml(L, ic(t, 'back', t.back, '‹')));
        start(r.body, q);
      }, function () { if (cur === me) paint(retryHtml(L, ic(t, 'back', t.back, '‹'))); });
    }
    function start(bk, q) {
      b = bk; if (!tch) cache[id] = b;
      L = lg(b.lang); t = T[L]; P = b.pages || [];
      if (!W.WQReadAlong) P.forEach(function (p) { p.audio = null; });
      var o = { lr: !tch && !!(W.WQLiveRead && W.WQLiveRead.mount), clock: C, fx: fx, start: q && q.p ? q.p - 1 : 0 };
      m = machine(b, o);
      if (!opened[id] && !tch) {
        opened[id] = 1;
        var d = { shelf_position: ctx.shelf_position == null ? null : ctx.shelf_position, from_teacher: !!ctx.from_teacher || tids(ctx.kid).indexOf(id) >= 0, grade: b.grade, lang: b.lang };
        if (codes[id]) d.code = codes[id];
        post(ctx, id, 'story_opened', d);
      }
      if (q && q.q) m.st = 'questions';
      o.on = show;
      show();
    }
    me.go = function (q) {
      if (!m) return;
      if (q.q && view !== 'q') m.set('questions');
      else if (q.p && P[q.p - 1]) m.go(q.p - 1);
    };
    function show() {
      if (cur !== me) return;
      var s = m.st, v = s === 'mic' ? 'mic' : s === 'reading' ? 'read' : s === 'questions' ? 'q' : s === 'done' ? 'd' : 'page';
      if (v === view && (v !== 'page' || m.i === pg)) { if (v === 'page') sync(); return; }
      if (pg >= 0 && (m.i !== pg || v === 'q' || v === 'd')) flushListen();
      drop();
      view = v; pg = m.i;
      if (tch && (v === 'q' || v === 'd')) return paint(preview());
      if (v === 'page') pageScreen();
      else if (v === 'mic') paint(scr('story-mic', L, top(L, ic(t, 'close', t.close, '✕')) + img(JG + 'hello.webp', 96, 96, 'wqs-jg') + '<h2 class="wqs-say">' + esc(t.micSay) +
        '</h2><div class="wqs-micslot" data-mic></div><button class="wqs-main" data-primary data-tap="mic">🎤 ' + esc(t.ok) + '</button><button class="wqs-sec" data-tap="notnow">' + esc(t.notNow) + '</button>', 'wqs-sheet'));
      else if (v === 'read') readScreen();
      else if (v === 'q') qStart();
      else finish();
    }
    function drop() {
      if (pl) { try { pl.destroy(); } catch (e) {} pl = null; }
      if (lr) { try { lr.destroy(); } catch (e) {} lr = null; }
      if (poll) { C.clear(poll); poll = null; }
    }
    function flushListen() {
      if (t0 >= 0) { acc += C.now() - t0; t0 = -1; }
      if (acc > 0 && !sent[pg] && P[pg]) { sent[pg] = 1; post(ctx, id, 'story_page_listened', { ms: acc, completed: false }, P[pg].n); }
      acc = 0;
    }
    function kill() {
      if (cur === me) { flushListen(); cur = null; }
      drop(); if (au) au.pause();
    }
    me.kill = kill;
    me.hush = function () { if (au) au.pause(); };

    function fx(n) {
      if (n === 'play' && pl) { t0 = C.now(); pl.play(); }
      else if (n === 'pause' && pl) { pl.pause(); if (t0 >= 0) { acc += C.now() - t0; t0 = -1; } }
      else if (n === 'stop' && lr) lr.stop('done_tap');
    }
    function pageScreen() {
      var p = P[m.i], im = p.image, ov = !!(p.boxes_ok && p.audio), i = m.i;
      paint(scr('story-page', L, top(L, ic(t, 'back', t.back, '‹'), b.title, !!p.audio) + print(p) +
        '<div class="wqs-extra" data-extra>' + extra() + '</div><div class="wqs-ctl">' +
        '<button class="wqs-arr" data-tap="prev"' + (i ? '' : ' disabled') + ' aria-label="' + esc(t.prevP) + '">‹</button>' +
        '<button class="wqs-main" data-main data-primary data-tap="main"' + (p.audio ? ' data-sound data-trigger="tap"' : '') + '>' + esc(t[m.label()]) + '</button>' +
        '<button class="wqs-arr" data-tap="next" aria-label="' + esc(t.nextP) + '">›</button></div>'));
      if (p.audio) {
        mount(p, {
          onEnd: ended,
          onState: function (s) { if (s === 'error' && pl) m.err(); },
          onWordTap: function () { if (/^(idle|paused|listened|together|denied)$/.test(m.st)) { t0 = C.now(); m.set('listening'); } },
        });
      } else if (!p.is_picture && !ask[i]) {
        // #S4: a page may be voiced on demand; look once, 3 s in
        ask[i] = 1;
        C.set(function () {
          req('GET', bookUrl()).then(function (r) {
            var np = r.ok && r.body.pages && r.body.pages[i];
            if (!np || !np.audio || !W.WQReadAlong || cur !== me) return;
            P[i].audio = np.audio; P[i].words = np.words || P[i].words;
            if (view === 'page' && m.i === i && m.st === 'idle') { drop(); pageScreen(); }
          }, function () {});
        }, 3000);
      }
      var nx = P[i + 1];
      if (nx) {
        try { new W.Image().src = nx.image.url; } catch (e) {}
        try { if (nx.audio && W.WQReadAlong.preload) W.WQReadAlong.preload({ id: b.id + '/p' + nx.n, audio: nx.audio, words: nx.words }); } catch (e) {}
      }
      sync();
    }
    // the page's own picture; the player draws on it (overlay) or only plays (strip text hidden)
    function print(p) {
      var im = p.image, ov = !!(p.boxes_ok && p.audio);
      return '<div class="wqs-print" style="max-width:calc(62vh*' + (im.w / im.h).toFixed(4) + ')">' + (ov ? '' : img(im.url, im.w, im.h)) + (p.audio ? '<div data-ra></div>' : '') + '</div>';
    }
    function mount(p, op) {
      var tb = p.text_band;
      op.mode = p.boxes_ok ? 'overlay' : 'strip'; op.leadMs = 50; op.labels = { play: t.listen, pause: t.pause, replay: t.again };
      // the ONE player paints the band pill too (COS 17:34Z); no band DOM of ours
      if (tb && tb.box) op.band = { url: tb.url, x: tb.box[0], y: tb.box[1], w: tb.box[2], h: tb.box[3] };
      try { pl = W.WQReadAlong.mount(root.querySelector('[data-ra]'), { v: 1, id: b.id + '/p' + p.n, lang: b.lang, dir: b.dir, audio: p.audio, words: p.words, image: p.image }, op); } catch (e) { pl = null; }
      if (pl && pl.audio) pl.audio.muted = muted();
    }
    function extra() {
      var s = m.st, p = P[m.i], w = p.words && p.words[m.skip], h = '';
      if (s === 'practise' && w) h = '<p>' + esc(t.practise) + '</p><button class="wqs-word" data-tap="word" data-arg="' + m.skip + '"' + (p.audio ? ' data-sound data-trigger="tap"' : '') + ' lang="' + L + '" dir="' + dirOf(L) + '">' + (p.audio ? '🔊 ' : '') + esc(w.t) + '</button>';
      else if (s === 'read' || s === 'practise') h = '<p class="wqs-well">' + esc(t.wellRead) + '</p>';
      else if (s === 'together' || s === 'denied') h = '<p>' + esc(t[s]) + '</p>';
      if (p.audio && /^(listened|paused|read|practise)$/.test(s)) h += '<button class="wqs-again" data-tap="again" data-sound data-trigger="tap">↻ ' + esc(t.again) + '</button>';
      return h;
    }
    function sync() {
      var mb = root.querySelector('[data-main]'), ex = root.querySelector('[data-extra]'), lab = m.label();
      if (mb) { mb.textContent = lab ? t[lab] : ''; mb.className = 'wqs-main wqs-' + lab; }
      if (ex) ex.innerHTML = extra();
    }
    function ended() {
      if (t0 >= 0) { acc += C.now() - t0; t0 = -1; }
      if (!sent[m.i]) { sent[m.i] = 1; post(ctx, id, 'story_page_listened', { ms: acc, completed: true }, P[m.i].n); }
      acc = 0;
      m.end();
    }
    function declined(how) { evt(ctx, 'mic_declined', { src: 'story', how: how }); }
    // the mic is asked inside the tap (WhatsApp in-app browser)
    function mic() {
      var LR = W.WQLiveRead, slot = root.querySelector('[data-mic]'), md = W.navigator && W.navigator.mediaDevices;
      var o = {
        lang: L,
        onStream: function (s) { if (m.st === 'mic') { stream = s; m.granted(); } },
        onDenied: function () { if (m.st === 'mic') { declined('denied'); m.denied(); } },
      };
      if (LR.askMic && slot) { LR.askMic(slot, o); var g = slot.querySelector('.lr-go'); if (g && g.click) g.click(); }
      else if (md && md.getUserMedia) md.getUserMedia({ audio: true }).then(o.onStream, o.onDenied);
      else o.onDenied();
    }
    function readScreen() {
      var p = P[m.i], LR = W.WQLiveRead;
      paint(scr('story-read', L, top(L, ic(t, 'close', t.close, '✕')) + img(JG + 'hello.webp', 72, 72, 'wqs-jg wqs-g0', ' data-jg') +
        '<div class="wqs-lr" data-lr></div><button class="wqs-main wqs-done" data-primary data-tap="main">' + esc(t.done) + '</button>'));
      try {
        lr = LR.mount(root.querySelector('[data-lr]'), {
          words: p.words, image: p.image, lang: L, dir: b.dir, id: b.id + ':' + p.n, stream: stream, meter: 'none', record: false, counted: false,
          finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: true },
          copy: { done: t.done, readNow: t.readNow, keepGoing: t.keepGoing, checking: t.checking, wellRead: t.wellRead },
          getKey: function () { return req('POST', '/api/wq/lr/key', { st: ctx.token, kid: ctx.kid, book: b.id, page: p.n, lang: L }).then(function (r) { return r.body; }); },
          onResult: result,
        });
      } catch (e) { m.denied(); return; }
      // Jugnu glows by the share of words lit, never by time
      poll = C.set(function tick() {
        var v = lr && lr.view && lr.view(), g = root.querySelector('[data-jg]');
        if (v && g && LR.glowLevel) g.className = 'wqs-jg wqs-g' + LR.glowLevel(v);
        if (lr) poll = C.set(tick, 500);
      }, 500);
    }
    function result(r) {
      if (m.st !== 'reading') return;
      r = r || {};
      post(ctx, id, 'story_page_read', { words_total: r.words_total, words_read: r.words_read, skipped: r.skipped, ms: r.ms, ended: r.ended }, P[m.i].n);
      m.result(r);
    }

    function qStart() {
      if (W.location.hash !== '#story/' + id + '/q') W.location.hash = '#story/' + id + '/q';
      qi = 0; ans = []; tries = []; chosen = -1; qlock = 0;
      if (!(b.questions || []).length) return m.set('done');
      qPaint();
    }
    function say(k, pr) { return '<button class="wqs-ic wqs-say" data-tap="say" data-arg="' + k + '"' + (pr ? ' data-primary' : '') + ' data-sound data-trigger="tap" aria-label="' + esc(t.hear) + '">🔊</button>'; }
    function optOf(op) { return typeof op === 'string' ? { t: op } : op || {}; }
    function qPaint() {
      var q = b.questions[qi], a = q.audio || {}, o = a.o || [];
      paint(scr('story-questions', L, top(L, ic(t, 'back', t.back, '‹'), '', 1) +
        '<p class="wqs-dots" aria-hidden="true">' + b.questions.map(function (x, k) { return '<i class="' + (k < qi ? 'wqs-was' : k === qi ? 'wqs-now' : '') + '"></i>'; }).join('') + '</p>' +
        '<div class="wqs-qc">' + (a.q ? say('q', 1) : '') + '<h2>' + esc(q.q) + '</h2></div><div class="wqs-opts">' +
        (q.options || []).map(function (op, k) {
          op = optOf(op);
          return '<div class="wqs-orow"><button class="wqs-opt' + (chosen === k ? ' wqs-chosen' : '') + '" data-tap="ans" data-arg="' + k + '"' + (!a.q && !k ? ' data-primary' : '') + '>' +
            (op.img ? img(/\//.test(op.img) ? op.img : '/s/' + b.id + '/' + op.img, 64, 64) : '') + '<span>' + esc(op.t) + '</span></button>' + (o[k] ? say(k) : '') + '</div>';
        }).join('') + '</div>'));
    }
    function sayIt(k) {
      var a = b.questions[qi].audio || {}, u = k === 'q' ? a.q : (a.o || [])[+k];
      if (!u || muted() || !W.Audio) return;
      if (au) au.pause();
      au = new W.Audio(u);
      var pr = au.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
    // #S7 look back: a first miss shows the page that answers it; the 2nd try is taken; a failed call moves on
    function answer(k) {
      if (qlock) return;
      var q = b.questions[qi], again = tries[qi];
      qlock = 1; chosen = +k; ans[qi] = +k; tries[qi] = 1;
      juice('tap'); qPaint();
      var r0 = post(ctx, id, 'story_answer', { n: q.n, pick: +k });
      if (again) return on();
      r0.then(function (r) {
        if (cur !== me) return;
        if (!r || r.right == null || r.right) { if (r && r.right) juice('correct'); return on(); }
        juice('wrong');
        var o = root.querySelector('.wqs-chosen');
        if (o) o.className += ' wqs-wob';
        var lp = P.filter(function (x) { return x.n === q.page_ref; })[0];
        C.set(function () { if (cur !== me) return; if (lp) look(lp); else { qlock = 0; chosen = -1; qPaint(); } }, 600);
      });
    }
    function on() {
      C.set(function () {
        if (cur !== me) return;
        qlock = 0; chosen = -1;
        if (++qi < b.questions.length) return qPaint();
        paint(scr('story-wait', L, '<i class="wqs-skel wqs-big"></i>'));
        post(ctx, id, 'story_questions_done', { answers: ans }).then(function (r) { qs = r && r.stars != null ? r.stars : null; if (cur === me) m.set('done'); });
      }, 900);
    }
    function look(p) {
      drop();
      paint(scr('story-look', L, top(L, '', '', !!p.audio) + img(JG + 'thinking.webp', 72, 72, 'wqs-jg') + '<h2 class="wqs-say">' + esc(t.lookBack) + '</h2>' + print(p) +
        (p.audio ? '<button class="wqs-again" data-tap="lplay" data-sound data-trigger="tap">🔊 ' + esc(t.listen) + '</button>' : '') +
        '<button class="wqs-main" data-primary data-tap="lret">' + esc(t.backQ) + '</button>', 'wqs-sheet'));
      if (p.audio) mount(p, {});
    }
    function preview() {
      return scr('story-questions', L, top(L, ic(t, 'back', t.back, '‹')) + '<ol class="wqs-pv">' + (b.questions || []).map(function (q) {
        return '<li><h2>' + esc(q.q) + '</h2><ul>' + (q.options || []).map(function (op) { return '<li>' + esc(optOf(op).t) + '</li>'; }).join('') + '</ul></li>';
      }).join('') + '</ol><button class="wqs-main" data-primary data-tap="back">' + esc(t.back) + '</button>');
    }

    // the done card (#S5, W6): read -> listened to every text page -> tried; one sticker at most, no score
    function finish() {
      var c = m.counts(), tp = [], k;
      for (k = 0; k < P.length; k++) if (!P[k].is_picture && P[k].words && P[k].words.length) tp.push(k);
      var all = function (o) { return tp.length > 0 && tp.every(function (i) { return o[i]; }); };
      var rd = c.pages_read > 0, heard = !rd && all(m.l), n = rd ? c.pages_read : heard ? c.pages_listened : 0;
      var head = rd ? (all(m.r) ? t.wholeRead : t.readSome) : heard ? t.wholeHeard : t.tried;
      paint(scr('story-wait', L, '<i class="wqs-skel wqs-big"></i>'));
      post(ctx, id, 'story_done', { pages_listened: c.pages_listened, pages_read: c.pages_read, stars: qs }).then(function (r) {
        if (cur !== me) return;
        var stk = !!(r && r.sticker === true), deed = function (k) { return t[rd ? 'pagesRead' : 'pagesHeard'](dg(k, L), k); };
        if (n) juice('finish', { stars: 3, kind: 'story' });
        if (W.WQFC && W.WQFC.mount) {
          try { return W.WQFC.mount(root, { kind: 'story', deed: 'story', lang: L, title: b.title, hub: ctx.token, kid: ctx.kid, sticker: stk, ev: ctx.ev, pages_read: c.pages_read, pages_listened: c.pages_listened }); } catch (e) {}
        }
        paint(scr('story-done', L, top(L, '', '', 1) + img('/wq/jugnu_celebrate.webp', 120, 120, 'wqs-jg') + '<h2>' + esc(head) + '</h2>' +
          (n ? '<p class="wqs-deed" data-n>' + esc(deed(n)) + '</p>' : '') + (stk ? '<p class="wqs-stk"><span aria-hidden="true">🌟</span> ' + esc(t.sticker) + '</p>' : '') +
          '<div class="wqs-col"><button class="wqs-main" data-primary data-tap="more">' + esc(t.more) + '</button><button class="wqs-sec" data-home data-tap="home">' + esc(t.home) + '</button></div>', 'wqs-sheet'));
        var el = root.querySelector('[data-n]'), k = 0;
        var still = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (el && n > 1 && !still) (function up() { el.textContent = deed(++k); if (k < n) C.set(up, 150); })();
      });
    }

    wire(root, function (tap, arg) {
      if (cur !== me) return;
      if (!m) { if (tap === 'retry') load(me.q); else if (tap === 'back') back(); else if (tap === 'home') { kill(); W.location.hash = '#'; } return; }
      if (tap === 'main') m.primary();
      else if (tap === 'next') m.next();
      else if (tap === 'prev') m.prev();
      else if (tap === 'back') back();
      else if (tap === 'close' || tap === 'notnow') { if (m.st === 'mic') declined('not_now'); m.notNow(); }
      else if (tap === 'mic') mic();
      else if (tap === 'snd') {
        var v = !muted(), s = root.querySelector('[data-snd]');
        if (W.WQJ && W.WQJ.mute) juice('mute', v);
        ls('wq_snd', v ? '0' : '1');
        if (pl && pl.audio) pl.audio.muted = v;
        if (au) au.muted = v;
        if (s) { s.textContent = v ? '🔇' : '🔊'; s.setAttribute('aria-pressed', String(v)); }
      } else if (tap === 'again') { if (pl) { if (t0 < 0) t0 = C.now(); pl.replay(); if (/^(listened|paused)$/.test(m.st)) m.set('listening'); } }
      else if (tap === 'word') { if (pl) pl.playWord(+arg); }
      else if (tap === 'say') sayIt(arg);
      else if (tap === 'ans') answer(arg);
      else if (tap === 'lplay') { if (pl) pl.play(); }
      else if (tap === 'lret') { drop(); qlock = 0; chosen = -1; qPaint(); }
      else if (tap === 'more') { kill(); W.location.hash = '#stories'; }
      else if (tap === 'home') { kill(); W.location.hash = '#'; }
    });
    me.load = function (q) { me.q = q; load(q); };
    return me;
  }

  function open(id, ctx, q) {
    ctx = ctx || {};
    q = q || {};
    var root = ctx.root || document.getElementById('wq');
    if (!root || !id) return null;
    if (cur && cur.id === id && cur.root === root) { cur.go(q); return cur; }
    if (cur) cur.kill();
    cur = reader(String(id), ctx, root);
    cur.load(q);
    return cur;
  }
  function route(ctx) {
    var h = /^#story\/([A-Za-z0-9_-]+)(?:\/(q|p(\d+)))?$/.exec(String(W.location.hash || ''));
    if (!h) { if (cur) cur.kill(); return false; }
    open(h[1], ctx || {}, { q: h[2] === 'q', p: h[3] ? +h[3] : 0 });
    return true;
  }
  function boot() { try { return JSON.parse(document.getElementById('boot').textContent) || {}; } catch (e) { return {}; } }
  function found() { var B = W.WQSTORIES_CTX ? null : boot(); return W.WQSTORIES_CTX || (B.token ? { token: B.token, kid: B.kid, lang: B.lang } : null); }

  W.WQSTORIES = { shelf: shelf, open: open, route: route, _machine: machine, _bad: bad };

  // on load: a teacher link's book, the home's [data-shelf], the #story routes
  try {
    var B0 = boot(), s0 = B0.story, c0 = found();
    if (s0 && s0.id && c0) {
      var sid = String(s0.id), ids = tids(c0.kid).filter(function (x) { return x !== sid; });
      ids.unshift(sid);
      ls('wq_st_t:' + (c0.kid || ''), ids.slice(0, 5).join(','));
      if (s0.code) codes[sid] = String(s0.code);
      if (!/^#story\//.test(W.location.hash || '')) W.location.hash = '#story/' + sid;
    }
    var sl = document.querySelector('[data-shelf]');
    if (sl && c0 && !sl.getAttribute('data-filled')) shelf(sl, c0);
    W.addEventListener('hashchange', function () { route(found()); });
    if (document.addEventListener) document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && cur) cur.hush(); });
    if (c0) route(c0);
  } catch (e) {}
}());
