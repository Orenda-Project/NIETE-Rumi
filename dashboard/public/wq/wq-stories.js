/* Stories core (web_quiz_stories): WQSTORIES.shelf(el, ctx) fills [data-stories-shelf]; open(id, ctx, q) is the reader (one
 * WQReadAlong per page, the print zoomed to the line); route(ctx): '#story/<id>', '/p<n>', '/q'. wq-stories-q.js (Your turn,
 * questions, done) loads at our ?v=. Teacher preview ctx: {role:'teacher', bookUrl, root, lang, onBack?}. Contracts:
 * STORIES, READALONG §4, LIVEREAD §11, JUICE §0, CONVERGENCE, RULINGS #S4-#S8. No rate or score is shown. */
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
      listen: 'Listen', pause: 'Pause', yourTurn: 'Your turn', next: 'Next', again: 'Listen again', whole: 'Whole page', slow: 'Slower',
      denied: 'That\'s OK, let\'s listen with Jugnu', wellRead: 'Well read!', together: 'Let\'s read it together', practise: 'Let\'s practise this word',
    },
    ur: {
      shelf: 'کہانیوں کی کتابیں', gl: function (g, l) { return 'جماعت ' + g + '، ' + (l === 'ur' ? 'اردو' : 'انگریزی'); },
      readWith: function (h) { return '▶ جگنو کے ساتھ <bdi>' + h + '</bdi> پڑھیں'; }, teacher: 'ٹیچر کی طرف سے', by: function (n) { return n + ' کی لکھی ہوئی'; },
      read: 'پڑھ لی', empty: 'یہاں ابھی کوئی کہانی نہیں۔ کوئی اور جماعت چنیں۔', oops: 'جگنو یہ کھول نہیں سکا۔', retry: 'دوبارہ کوشش کریں',
      off: 'آج کہانیاں آرام کر رہی ہیں۔', home: 'ہوم', back: 'واپس', close: 'بند کریں', sound: 'آواز', prevP: 'پچھلا صفحہ', nextP: 'اگلا صفحہ',
      listen: 'سنیں', pause: 'رکیں', yourTurn: 'اب آپ پڑھیں', next: 'آگے', again: 'دوبارہ سنیں', whole: 'پورا صفحہ', slow: 'آہستہ',
      denied: 'کوئی بات نہیں، جگنو کے ساتھ سنیں', wellRead: 'بہت اچھا پڑھا!', together: 'آئیں مل کر پڑھیں', practise: 'آئیں، یہ لفظ پھر سے پڑھیں',
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
  // ltr bar: the one mute sits top-right
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
    if (!q) { q = {}; var gl = String(ls('wq_st_gl') || '').split(','); if (gl[0]) q.g = gl[0]; if (gl[1]) q.l = gl[1]; }
    var l = lg(q.l || ctx.lang), ids = tids(ctx.kid).join(',');
    try { el.setAttribute('data-filled', '1'); } catch (e) {}
    wire(el, function (tap, arg) {
      var d = el._d || {}, b = (d.books || [])[+arg];
      if (tap === 'book' && b) {
        opened[b.id] = 1;
        post(ctx, b.id, 'story_opened', { shelf_position: b.shelf_position == null ? +arg : b.shelf_position, from_teacher: !!b.from_teacher, grade: b.grade, lang: b.lang });
        W.location.hash = '#story/' + b.id;
      } else if (tap === 'gl') { el._open = !el._open; el.innerHTML = shelfHtml(d, el._open); }
      else if (tap === 'g' || tap === 'l') { q[tap] = arg; ls('wq_st_gl', (q.g || '') + ',' + (q.l || '')); shelf(el, ctx, q); }
      else if (tap === 'retry') shelf(el, ctx, q);
    });
    el.innerHTML = '<div class="wqs wqs-shelf" aria-busy="true"><div class="wqs-grid">' + new Array(5).join('<i class="wqs-skel"></i>') + '</div></div>';
    function fail() { el.innerHTML = retryHtml(l, '<a class="wqs-ic" href="#" data-home data-tap="home" aria-label="' + esc(T[l].home) + '">🏠</a>'); }
    req('GET', '/api/wq/stories/shelf/h/' + enc(ctx.token) + '?kid=' + enc(ctx.kid) + (q.g ? '&g=' + enc(q.g) : '') + '&l=' + l + (ids ? '&t=' + enc(ids) : '')).then(function (r) {
      if (r.status === 404) { el.innerHTML = ''; el.hidden = true; return; }
      if (!r.ok) return fail();
      el._d = r.body; el._open = false;
      el.innerHTML = shelfHtml(r.body, false);
      evt(ctx, 'story_shelf_shown', { n: (r.body.books || []).length, grade: r.body.grade, lang: r.body.lang });
    }, fail);
  }

  /* ---- one text, zoom to the line (reading-expert verdict): pure camera math in page px ---- */
  // printed lines: the server's lines[] ({i0, i1, box}), else words grouped by box y-overlap, in reading order
  function lines(p) {
    var l = [], of = [], c = null;
    if (p.lines && p.lines.length) {
      p.lines.forEach(function (x, k) { var a = []; for (var i = x.i0; i <= x.i1; i++) { a.push(i); of[i] = k; } l.push({ i: a, bs: x.box ? [x.box] : [] }); });
      return { l: l, of: of };
    }
    (p.words || []).forEach(function (w, i) {
      var x = w.box;
      if (!x) return;
      if (!c || Math.min(c.y1, x[1] + x[3]) - Math.max(c.y0, x[1]) <= Math.min(c.h, x[3]) / 2) l.push(c = { i: [], bs: [], y0: x[1], y1: x[1] + x[3], h: x[3] });
      c.i.push(i); c.bs.push(x); c.y0 = Math.min(c.y0, x[1]); c.y1 = Math.max(c.y1, x[1] + x[3]); c.h = Math.min(c.h, x[3]);
      of[i] = l.length - 1;
    });
    return { l: l, of: of };
  }
  // boxes + viewport -> translate/scale: line fills the width, words >= 26 px, <= cap x whole, at 70 % height; too wide:
  // its reading start in view; no boxes: the whole page
  function cam(bs, vw, vh, pw, ph, rtl, cap) {
    var w0 = Math.min(vw / pw, vh / ph), r = function (v) { return Math.round(v * 10) / 10; };
    if (!bs || !bs.length) return { s: Math.round(w0 * 1000) / 1000, tx: r((vw - pw * w0) / 2), ty: r((vh - ph * w0) / 2), ok: false };
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, mh = 1e9;
    bs.forEach(function (b) { x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[0] + b[2]); y0 = Math.min(y0, b[1]); y1 = Math.max(y1, b[1] + b[3]); mh = Math.min(mh, b[3]); });
    var s = Math.max(w0, Math.min(Math.max(vw / ((x1 - x0) * 1.16), 26 / mh), w0 * (cap || 3)));
    var tx = (x1 - x0) * s <= vw * 0.92 ? vw / 2 - (x0 + x1) / 2 * s : rtl ? vw * 0.96 - x1 * s : vw * 0.04 - x0 * s;
    tx = Math.min(0, Math.max(vw - pw * s, tx));
    var ty = Math.min(0, Math.max(vh - ph * s, vh * 0.7 - (y0 + y1) / 2 * s));
    return { s: Math.round(s * 1000) / 1000, tx: r(tx), ty: r(ty), px: mh * s, ok: mh * s >= 25.5 };
  }
  // the sweep mark (page px): the word's box, else an underline across its server line, else its neighbours' row, else a bar
  function mark(p, i, a, rtl) {
    var ws = p.words || [], w = ws[i], k, x;
    if (!w) return null;
    if (w.box) return w.box.slice(0, 4);
    x = (p.lines || []).filter(function (y) { return y.i0 <= i && i <= y.i1; })[0];
    if (x && x.box) { var b = x.box, g = (i - x.i0 + 1) / (x.i1 - x.i0 + 1); return [b[0] + (rtl ? b[2] * (1 - g) : 0), b[1] + b[3] - 6, b[2] * g, 6, 1]; }
    x = 0;
    a = a || [0, p.image.h - 40, p.image.w, 40];
    for (k = 1; !x && k < ws.length; k++) x = (ws[i - k] || {}).box || (ws[i + k] || {}).box;
    if (x) return [a[0], x[1], a[2], x[3], 1];
    var f = (i + 1) / ws.length;
    return [a[0] + (rtl ? a[2] * (1 - f) : 0), a[1], a[2] * f, a[3], 1];
  }

  // Your turn on a long page (> 40 words): consecutive lines, <= 25 words a chunk; no full line map -> 25-word slices
  function chunks(p, ln) {
    var n = (p.words || []).length, out = [], a = -1, z = -1, g = [], i;
    if (n <= 40) return [[0, n - 1]];
    ln.l.forEach(function (x) { g.push([x.i[0], x.i[x.i.length - 1]]); });
    if (ln.of.filter(function (x) { return x != null; }).length !== n) for (g = [], i = 0; i < n; i += 25) g.push([i, Math.min(n, i + 25) - 1]);
    g.forEach(function (x) {
      if (a >= 0 && x[1] - a + 1 > 25) { out.push([a, z]); a = -1; }
      if (a < 0) a = x[0];
      z = x[1];
    });
    out.push([a, z]);
    return out;
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


  /* ---- the lazy part (wq-stories-q.js: Your turn, questions, done) and m-scorecard's card, at our own ?v= ---- */
  function load(path, css, cb) {
    var done = 0, fin = function () { if (!done) { done = 1; cb(); } };
    try {
      var s = document.querySelector('script[src*="wq-stories.js"]'), v = s && /[?&]v=([\w-]+)/.exec(s.getAttribute('src') || ''), q = v ? '?v=' + v[1] : '';
      var h = document.head, sc = document.createElement('script'), c;
      if (css) { c = document.createElement('link'); c.rel = 'stylesheet'; c.href = '/wq/' + css + q; h.appendChild(c); }
      sc.src = '/wq/' + path + q; sc.onload = sc.onerror = fin; h.appendChild(sc);
      W.setTimeout(fin, 8000);
    } catch (e) { fin(); }
  }
  var qw = null;
  function withQ(cb) {
    if (W.WQSTORIES._q) return cb(1);
    if (qw) return qw.push(cb);
    qw = [cb];
    load('wq-stories-q.js', 0, function () { var w = qw; qw = null; w.forEach(function (f) { f(!!W.WQSTORIES._q); }); });
  }

  /* ---- the reader ---- */
  function reader(id, ctx, root) {
    var C = clockOf(ctx), tch = ctx.role === 'teacher', R = { id: id, root: root, ctx: ctx, C: C, tch: tch, pl: null, lr: null, poll: null, au: null };
    var b, L = lg(ctx.lang), t = T[L], P, m, Q, view = '', pg = -1, t0 = -1, acc = 0, sent = {}, ask = {};
    var sp, sm = '', bp, LN = { l: [], of: [] }, zl = -1, li = -1, wu = 0;   // the stage's page, mode (z zoom, l lens, s sweep), lines, line, word, "whole page"
    var paint = R.paint = function (h) { root.innerHTML = h; };
    R.live = function () { return cur === R; };
    function back() { kill(); if (!tch) W.location.hash = '#stories'; else if (ctx.onBack) ctx.onBack(); else if (W.history) W.history.back(); }
    R.back = back;
    function home() {
      kill();
      try { W.history.replaceState(null, '', W.location.pathname + W.location.search); W.dispatchEvent(new W.HashChangeEvent('hashchange')); } catch (e) { W.location.hash = '#'; }
    }
    R.home = home;
    function bookUrl() { return tch ? ctx.bookUrl : '/api/wq/stories/book/' + enc(id) + '/h/' + enc(ctx.token) + '?kid=' + enc(ctx.kid); }
    function wait() { paint(scr('story-wait', L, '<i class="wqs-skel wqs-big"></i>')); }
    R.wait = wait;
    function oops() { paint(retryHtml(L, ic(t, 'back', t.back, '‹'))); }
    function load(q) {
      wait();
      (cache[id] && !tch ? Promise.resolve({ ok: true, body: cache[id] }) : req('GET', bookUrl())).then(function (r) {
        if (cur !== R) return;
        if (r.status === 404) return paint(kind('stories-off', L, t.off, '<button class="wqs-main" data-primary data-home data-tap="home">' + esc(t.home) + '</button>'));
        if (!r.ok) return oops();
        start(r.body, q);
      }, function () { if (cur === R) oops(); });
    }
    function start(bk, q) {
      R.b = b = bk; if (!tch) cache[id] = b;
      R.L = L = lg(b.lang); R.t = t = T[L]; R.P = P = b.pages || [];
      if (!W.WQReadAlong) P.forEach(function (p) { p.audio = null; });
      var o = { lr: !tch && !!(W.WQLiveRead && W.WQLiveRead.mount), fx: fx, start: q && q.p ? q.p - 1 : 0 };
      R.m = m = machine(b, o);
      if (!opened[id] && !tch) {
        opened[id] = 1;
        var d = { shelf_position: ctx.shelf_position == null ? null : ctx.shelf_position, from_teacher: !!ctx.from_teacher || tids(ctx.kid).indexOf(id) >= 0, grade: b.grade, lang: b.lang };
        if (codes[id]) d.code = codes[id];
        post(ctx, id, 'story_opened', d);
      }
      if (q && q.q) m.st = 'questions';
      o.on = show;
      show();
      withQ(function () {});   // warm the lazy part while the child looks at the page
    }
    R.go = function (q) {
      if (!m) return;
      if (q.q && view !== 'q') m.set('questions');
      else if (q.p && P[q.p - 1]) m.go(q.p - 1);
    };
    function show() {
      if (cur !== R) return;
      var s = m.st, v = s === 'mic' ? 'mic' : s === 'reading' ? 'read' : s === 'questions' ? 'q' : s === 'done' ? 'd' : 'page';
      if (v === view && (v !== 'page' || m.i === pg)) { if (v === 'page') sync(); return; }
      if (pg >= 0 && (m.i !== pg || v === 'q' || v === 'd')) flush();
      drop();
      view = v; pg = m.i;
      if (v === 'page') return pageScreen();
      wait();
      withQ(function (ok) {
        if (cur !== R || view !== v) return;
        if (!ok) return oops();
        Q = Q || W.WQSTORIES._q(R);
        Q[v]();
      });
    }
    function drop() {
      if (R.pl) { try { R.pl.destroy(); } catch (e) {} R.pl = null; }
      if (R.lr) { try { R.lr.destroy(); } catch (e) {} R.lr = null; }
      if (R.poll) { C.clear(R.poll); R.poll = null; }
    }
    R.drop = drop;
    function flush() {
      if (t0 >= 0) { acc += C.now() - t0; t0 = -1; }
      if (acc > 0 && !sent[pg] && P[pg]) { sent[pg] = 1; post(ctx, id, 'story_page_listened', { ms: acc, completed: false }, P[pg].n); }
      acc = 0;
    }
    function kill() {
      if (cur === R) { flush(); cur = null; }
      drop(); if (R.au) R.au.pause();
    }
    R.kill = kill;
    // the page hidden: the listen pauses (and its clock), a reading stops, a question clip stops
    R.hush = function () {
      if (R.au) R.au.pause();
      if (m && m.st === 'listening') m.primary();
      if (R.lr && m.st === 'reading') R.lr.stop('hidden');
    };
    function fx(n) {
      var p = R.pl;
      if (n === 'play' && p) { t0 = C.now(); p.play(); zl = -1; camLine(li >= 0 ? li : 0); }
      else if (n === 'pause' && p) { p.pause(); if (t0 >= 0) { acc += C.now() - t0; t0 = -1; } }
      else if (n === 'stop' && R.lr) R.lr.stop('done_tap');
    }
    function pageScreen() {
      var p = P[m.i], im = p.image, i = m.i;
      paint(scr('story-page', L, top(L, ic(t, 'back', t.back, '‹'), b.title, !!p.audio) + stage(p, (p.audio && p.boxes_ok ? '' : img(im.url, im.w, im.h)) + (p.audio ? '<div data-ra></div>' : '')) +
        '<div class="wqs-extra" data-extra>' + extra() + '</div><div class="wqs-ctl">' +
        '<button class="wqs-arr" data-tap="prev"' + (i ? '' : ' disabled') + ' aria-label="' + esc(t.prevP) + '"><span dir="ltr">' + (L === 'ur' ? '›' : '‹') + '</span></button>' +
        '<button class="wqs-main" data-main data-primary data-tap="main"' + (p.audio ? ' data-sound data-trigger="tap"' : '') + '>' + esc(t[m.label()]) + '</button>' +
        (p.audio ? '<button class="wqs-slow" data-tap="slow" aria-pressed="' + slow() + '">🐢 ' + esc(t.slow) + '</button>' : '') +
        '<button class="wqs-arr" data-tap="next" aria-label="' + esc(t.nextP) + '"><span dir="ltr">' + (L === 'ur' ? '‹' : '›') + '</span></button></div>'));
      camTo(null);
      if (p.audio) {
        mount(p, {
          onEnd: ended,
          onState: function (s) { if (s === 'error' && R.pl) m.err(); },
          onWordTap: function () { if (/^(idle|paused|listened|together|denied)$/.test(m.st)) { t0 = C.now(); m.set('listening'); } },
        });
      } else if (!p.is_picture && !ask[i]) {
        // #S4: a page may be voiced on demand; look once, 3 s in
        ask[i] = 1;
        C.set(function () {
          req('GET', bookUrl()).then(function (r) {
            var np = r.ok && r.body.pages && r.body.pages[i];
            if (!np || !np.audio || !W.WQReadAlong || cur !== R) return;
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
    function dims() {
      var s = root.querySelector('[data-stage]'), vw = (s && s.clientWidth) || (W.innerWidth || 384) - 24;
      return [vw, (s && s.clientHeight) || (W.innerHeight ? W.innerHeight * 0.62 : vw * sp.image.h / sp.image.w)];
    }
    function rtl() { return b.dir === 'rtl'; }
    // ONE text: the print zoomed to the line (z); else the 2x band as a lens OVER the print region (l); else a sweep (s)
    function stage(p, inner) {
      var ws = p.words || [], tb = p.text_band, im = p.image, d;
      sp = p; LN = lines(p); zl = -1; li = -1; wu = 0; sm = '';
      if (ws.length && !p.is_picture) {
        d = dims();
        // a line without a box is never zoomed (the whole page, a sweep); every boxed line must reach 26 px
        sm = (p.lines || p.boxes_ok) && LN.l.some(function (x) { return x.bs.length; }) && LN.l.every(function (x) { return !x.bs.length || cam(x.bs, d[0], d[1], im.w, im.h, rtl(), 3).ok; }) ? 'z' : tb && tb.box ? 'l' : 's';
      }
      bp = sm === 'l' && p.audio && p.boxes_ok;   // the player draws the crop and its pill (#S8); we lay it over the print
      var bx = sm === 'l' && !bp && tb.box;
      return '<div class="wqs-stage" data-stage><div class="wqs-cam" data-cam style="width:' + im.w + 'px;height:' + im.h + 'px">' + inner +
        (bx ? img(tb.url, tb.w, tb.h, 'wqs-lens', ' style="left:' + bx[0] + 'px;top:' + bx[1] + 'px;width:' + bx[2] + 'px;height:' + bx[3] + 'px"') : '') +
        (own() ? '<i class="wqs-mk" data-mk></i>' : '') + '</div>' +
        (sm === 'z' || sm === 'l' ? '<button class="wqs-whole" data-whole data-tap="cam" aria-pressed="false">🖼 ' + esc(t.whole) + '</button>' : '') + '</div>';
    }
    function own() { return sm && !bp && (sm !== 'z' || !sp.boxes_ok); }   // our mark (the player's pill is hidden or absent)
    R.stage = stage;
    R.mode = function () { return sm; };
    R.lines = function () { return LN; };
    function camTo(bs) {
      var c = root.querySelector('[data-cam]'), d, k;
      if (!c || !sp) return;
      d = dims();
      k = cam(wu ? null : bs, d[0], d[1], sp.image.w, sp.image.h, rtl(), sm === 'l' ? 6 : 3);
      c.style.transform = 'translate(' + k.tx + 'px,' + k.ty + 'px) scale(' + k.s + ')';
    }
    function camLine(i) {
      li = i;
      var n = sm === 'z' ? LN.of[i] || 0 : 0;
      if (sm && sm !== 's' && n !== zl) { zl = n; camTo(sm === 'z' ? LN.l[n].bs : [sp.text_band.box]); }
    }
    R.camTo = camTo; R.camLine = camLine;
    function word(i) {
      if (i >= 0) camLine(i);
      var e = root.querySelector('[data-mk]'), r = i >= 0 && own() && mark(sp, i, sm === 'l' && sp.text_band.box, rtl());
      if (!e) return;
      if (!r) { e.style.opacity = '0'; return; }
      e.style.left = r[0] + 'px'; e.style.top = r[1] + 'px'; e.style.width = r[2] + 'px'; e.style.height = r[3] + 'px'; e.style.opacity = '1';
      e.className = 'wqs-mk' + (r[4] ? ' wqs-sw' : '');
    }
    R.word = word;
    function mount(p, op) {
      var ra = root.querySelector('[data-ra]'), tb = p.text_band, k, e;
      op.mode = p.boxes_ok ? 'overlay' : 'strip'; op.leadMs = 50; op.labels = { play: t.listen, pause: t.pause, replay: t.again }; op.onWord = word;
      if (bp) op.band = { url: tb.url, x: tb.box[0], y: tb.box[1], w: tb.box[2], h: tb.box[3] };
      try { R.pl = W.WQReadAlong.mount(ra, { v: 1, id: b.id + '/p' + p.n, lang: b.lang, dir: b.dir, audio: p.audio, words: p.words, image: p.image }, op); } catch (x) { R.pl = null; }
      e = bp && ra && ra.querySelector('.wqra-band');
      if (e) for (k = 0; k < 4; k++) e.style[['left', 'top', 'width', 'height'][k]] = tb.box[k] + 'px';
      if (R.pl && R.pl.audio) R.pl.audio.muted = muted();
      rate();
    }
    R.mount = mount;
    // 🐢 a slower voice (pitch kept), remembered per child; no number on screen
    function slow() { return ls('wq_st_slow:' + (ctx.kid || '')) === '1'; }
    function rate() { var a = R.pl && R.pl.audio; if (a) { a.playbackRate = slow() ? 0.85 : 1; a.preservesPitch = true; } }
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
      li = -1; zl = -1; camTo(null); word(-1);   // after the last word: back out to the whole picture
      m.end();
    }

    wire(root, function (tap, arg) {
      if (cur !== R) return;
      if (!m) { if (tap === 'retry') load(R.q); else if (tap === 'back') back(); else if (tap === 'home') home(); return; }
      if (Q && Q.act(tap, arg)) return;
      if (tap === 'main') m.primary();
      else if (tap === 'next') m.next();
      else if (tap === 'prev') m.prev();
      else if (tap === 'back') back();
      else if (tap === 'home') home();
      else if (tap === 'retry') { view = ''; show(); }
      else if (tap === 'close' || tap === 'notnow') m.notNow();
      else if (tap === 'snd') {
        var v = !muted(), s = root.querySelector('[data-snd]');
        if (W.WQJ && W.WQJ.mute) juice('mute', v);
        ls('wq_snd', v ? '0' : '1');
        if (R.pl && R.pl.audio) R.pl.audio.muted = v;
        if (R.au) R.au.muted = v;
        if (s) { s.textContent = v ? '🔇' : '🔊'; s.setAttribute('aria-pressed', String(v)); }
      } else if (tap === 'again') { if (R.pl) { if (t0 < 0) t0 = C.now(); R.pl.replay(); if (/^(listened|paused)$/.test(m.st)) m.set('listening'); } }
      else if (tap === 'word') { if (R.pl) R.pl.playWord(+arg); }
      else if (tap === 'slow') { ls('wq_st_slow:' + (ctx.kid || ''), slow() ? '0' : '1'); rate(); var sb = root.querySelector('.wqs-slow'); if (sb) sb.setAttribute('aria-pressed', String(slow())); }
      else if (tap === 'cam') { wu = !wu; zl = -1; if (wu) camTo(null); else if (li >= 0) camLine(li); var wb = root.querySelector('[data-whole]'); if (wb) wb.setAttribute('aria-pressed', String(!!wu)); }
    });
    R.load = function (q) { R.q = q; load(q); };
    return R;
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

  W.WQSTORIES = { shelf: shelf, open: open, route: route, _machine: machine, _bad: bad, _cam: cam, _lines: lines, _mark: mark, _chunks: chunks,
    _k: { T: T, JG: JG, esc: esc, enc: enc, dg: dg, scr: scr, img: img, ic: ic, top: top, post: post, req: req, juice: juice, muted: muted, evt: evt, load: load } };

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
    var sl = document.querySelector('[data-stories-shelf]');
    if (sl && c0 && !sl.getAttribute('data-filled')) shelf(sl, c0);
    W.addEventListener('hashchange', function () { route(found()); });
    if (document.addEventListener) document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && cur) cur.hush(); });
    if (c0) route(c0);
  } catch (e) {}
}());
