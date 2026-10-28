/* Stories: the storybook shelf and the reader (the page's own pictures, read along with Jugnu, zoomed to the line).
 * WQSTORIES.shelf(el, ctx), open(id, ctx, q), route(ctx). Your turn, questions and the done screen: wq-stories-q.js. */
(function () {
  'use strict';
  var W = window;
  // Copy rules: see wq-stories-q.js.
  var T = {
    en: {
      shelf: 'Storybooks', gl: function (g, l) { return (g ? 'Grade ' + g : 'All grades') + ', ' + (l === 'ur' ? 'Urdu' : 'English'); }, all: 'All grades',
      readWith: function (h) { return 'Read ' + h + ' with Jugnu'; }, teacher: 'From your teacher', by: function (n) { return 'by ' + n; },
      read: 'Read', empty: 'No storybooks here yet. Try another grade.', oops: 'Jugnu could not open this.', retry: 'Try again',
      off: 'Stories are resting today.', home: 'Home', back: 'Back', close: 'Close', sound: 'Sound', prevP: 'Page before', nextP: 'Next page',
      listen: 'Listen', pause: 'Pause', yourTurn: 'Your turn', next: 'Next', again: 'Listen again', whole: 'Whole page', slow: 'Slower', hearFirst: 'Hear it first',
      opening: 'Opening…',
    },
    ur: {
      shelf: 'کہانیوں کی کتابیں', gl: function (g, l) { return (g ? 'جماعت ' + g : 'سب جماعتیں') + '، ' + (l === 'ur' ? 'اردو' : 'انگریزی'); }, all: 'سب جماعتیں',
      readWith: function (h) { return 'جگنو کے ساتھ ' + h + ' پڑھیں'; }, teacher: 'ٹیچر کی طرف سے', by: function (n) { return n + ' کی لکھی ہوئی'; },
      read: 'پڑھ لی', empty: 'یہاں ابھی کوئی کہانی نہیں۔ کوئی اور جماعت چنیں۔', oops: 'یہ کتاب ابھی نہیں کھل سکی۔', retry: 'دوبارہ کوشش کریں',
      off: 'آج کہانیاں آرام کر رہی ہیں۔', home: 'ہوم', back: 'واپس', close: 'بند کریں', sound: 'آواز', prevP: 'پچھلا صفحہ', nextP: 'اگلا صفحہ',
      listen: 'سنیں', pause: 'رکیں', yourTurn: 'اب آپ پڑھیں', next: 'آگے', again: 'دوبارہ سنیں', whole: 'پورا صفحہ', slow: 'آہستہ', hearFirst: 'پہلے سنیں',
      opening: 'صفحہ کھل رہا ہے…',
    },
  };
  var JG = '/wq/jugnu/';
  function sv(d) { return '<svg class="wqs-g" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }
  var IC = {
    tick: sv('M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'), play: sv('M8 5v14l11-7z'), home: sv('M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'),
    spk: sv('M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z'),
    mute: sv('M3 9v6h4l5 5V4L7 9zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z'),
    slow: sv('M3 16a9 7 0 0 1 18 0zm17-3a2 2 0 1 0 2.5-2.5zM6 16v3h3v-3zm9 0v3h3v-3z'),
    prev: sv('M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z'), next: sv('M8.6 7.4 10 6l6 6-6 6-1.4-1.4 4.6-4.6z'),
  };
  // the look (wq.css .wqs-re)
  function adv() { try { return document.documentElement.classList.contains('wq-adv'); } catch (e) { return false; } }
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
  function req(method, url, body, k) {
    var init = { method: method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (k) init.keepalive = k;
    if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return W.fetch(url, init).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, ok: r.ok, body: j || {} }; }, function () { return { status: r.status, ok: r.ok, body: {} }; });
    });
  }
  function post(ctx, id, ev, data, n, k) {
    if (ctx.role === 'teacher') return Promise.resolve({});
    var b = { kid: ctx.kid, book_id: id, event: ev, data: data || {} };
    if (n) b.page_n = n;
    return req('POST', '/api/wq/stories/event/h/' + enc(ctx.token), b, k).then(function (r) { return r.body; }, function () { return {}; });
  }
  function tids(kid) { return String(ls('wq_st_t:' + (kid || '')) || '').split(',').filter(Boolean); }

  function hm(l) { return '<a class="wqs-ic" href="#" data-home data-tap="home" aria-label="' + esc(T[l].home) + '">' + IC.home + '</a>'; }
  function scr(name, l, inner, cls) { return '<section class="wqs ' + (cls || '') + '" data-screen="' + name + '" lang="' + l + '" dir="' + dirOf(l) + '">' + inner + '</section>'; }
  function img(src, w, h, cls, ex) { return '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="' + esc(W.wqjv ? W.wqjv(src) : src) + '" width="' + w + '" height="' + h + '" alt=""' + (ex || '') + ' onerror="WQSTORIES._bad(this)">'; }
  function ic(t, tap, label, glyph, ex) { return '<button class="wqs-ic" ' + (ex || 'data-back') + ' data-tap="' + tap + '" aria-label="' + esc(label) + '">' + (glyph === '‹' ? IC.prev : glyph) + '</button>'; }
  function top(l, left, title, snd) {
    var t = T[l], m = muted();
    return '<div class="wqs-top" dir="' + dirOf(l) + '">' + (left || '<span class="wqs-ic0"></span>') + '<h2 lang="' + l + '" dir="' + dirOf(l) + '">' + esc(title || '') + '</h2>' +
      (snd ? '<button class="wqs-ic wqs-snd" data-snd data-tap="snd" aria-pressed="' + m + '" aria-label="' + esc(t.sound) + '">' + (m ? IC.mute : IC.spk) + '</button>' : '') + '</div>';
  }
  function kind(name, l, say, btn, left) {
    return scr(name, l, top(l, left) + img(JG + 'thinking.webp', 96, 96, 'wqs-jg') + '<p class="wqs-say">' + esc(say) + '</p>' + btn, 'wqs-sheet');
  }
  function retryHtml(l, left) { return kind('stories-retry', l, T[l].oops, '<button class="wqs-main" data-primary data-tap="retry">' + esc(T[l].retry) + '</button>', left); }
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

  function shelfHtml(d, open, host) {
    var l = lg(d.lang), t = T[l], bk = d.books || [], tk = -1, k, cards = '', pk = -1;
    for (k = 0; k < bk.length && tk < 0; k++) if (bk[k].from_teacher) tk = k;
    // the primary: the first unfinished book
    if (tk >= 0 && !bk[tk].done) pk = tk;
    for (k = 0; k < bk.length && pk < 0; k++) if (k !== tk && !bk[k].done) pk = k;
    if (pk < 0) pk = tk >= 0 ? tk : 0;
    var cov = function (b) { return img(b.cover, 160, 240, '', ' loading="lazy"'); };
    bk.forEach(function (b, k) {
      if (k === tk) return;
      var bl = lg(b.lang);
      cards += '<li><button class="wqs-book" data-tap="book" data-arg="' + k + '" data-id="' + esc(b.id) + '"' + (k === pk ? ' data-primary' : '') + (b.done ? ' data-done' : '') + '><span class="wqs-cov">' + cov(b) +
        (b.from_teacher ? '<i class="wqs-rib">' + esc(t.teacher) + '</i>' : '') + (b.done ? '<i class="wqs-tick" aria-label="' + esc(t.read) + '">' + IC.tick + '</i>' : '') +
        '</span><b lang="' + bl + '" dir="' + dirOf(bl) + '">' + esc(b.title) + '</b>' + (b.by ? '<small>' + esc(t.by(b.by)) + '</small>' : '') + '</button></li>';
    });
    var sel = d.sel || [d.grade], all = sel === 'all';
    var chips = '';
    if (open) {
      chips += '<button class="wqs-chip" data-tap="g" data-arg="all" aria-pressed="' + all + '">' + t.all + '</button>';
      (d.grades || [1, 2, 3, 4, 5]).forEach(function (g) { chips += '<button class="wqs-chip" data-tap="g" data-arg="' + g + '" aria-pressed="' + (!all && sel.indexOf(+g) >= 0) + '">' + dg(g, l) + '</button>'; });
      ['en', 'ur'].forEach(function (x) { chips += '<button class="wqs-chip" data-tap="l" data-arg="' + x + '" aria-pressed="' + (x === l) + '" lang="' + x + '" dir="' + dirOf(x) + '">' + (x === 'ur' ? 'اردو' : 'EN') + '</button>'; });
    }
    var tb = bk[tk];
    if (host && !bk.length) return scr('stories-shelf', l, '<p class="wqs-say">' + esc(t.empty) + '</p>', 'wqs-shelf');
    return scr('stories-shelf', l,
      '<div class="wqs-top">' + hm(l) + '<h2>' + esc(t.shelf) + '</h2></div>' +
      '<button class="wqs-gl" data-tap="gl"' + (bk.length ? '' : ' data-primary') + ' aria-expanded="' + !!open + '">' + esc(t.gl(all ? '' : dg(sel.join(l === 'ur' ? '، ' : ', '), l), l)) + '<i class="wq-caret" aria-hidden="true"></i></button>' + (open ? '<div class="wqs-pick">' + chips + '</div>' : '') +
      (tb ? '<button class="wqs-tcard" data-tap="book" data-arg="' + tk + '" data-id="' + esc(tb.id) + '"' + (tk === pk ? ' data-primary' : '') + '>' + cov(tb) + '<span><i class="wqs-rib">' + esc(t.teacher) + '</i><b>' + IC.play + ' ' + t.readWith('<bdi lang="' + lg(tb.lang) + '" dir="' + dirOf(lg(tb.lang)) + '">' + esc(tb.title) + '</bdi>') + '</b>' + (tb.by ? '<small>' + esc(t.by(tb.by)) + '</small>' : '') + '</span></button>' : '') +
      (bk.length ? '<ul class="wqs-grid">' + cards + '</ul>' : '<p class="wqs-say">' + esc(t.empty) + '</p>'), 'wqs-shelf');
  }
  function shelf(el, ctx, q) {
    if (!el) return;
    ctx = ctx || {};
    if (q && q.token || !ctx.token && ctx.kid) { var x = q || {}; ctx = { token: x.token, kid: ctx.kid, lang: x.lang || ctx.lang, ev: x.ev, primary: x.primary, host: 1 }; q = 0; }
    if (!q) { q = {}; var gl = String(ls('wq_st_gl') || '').split(','); if (gl[0]) q.g = gl[0]; if (gl[1]) q.l = gl[1]; }
    var l = lg(q.l || ctx.lang), ids = tids(ctx.kid).join(',');
    var gen = el._gen = (el._gen || 0) + 1, np = function (h) {
      if (ctx.host) h = h.replace(/<div class="wqs-top"[^>]*>[\s\S]*?<\/div>/, '');
      return ctx.primary === false ? h.replace(/ data-primary/g, '') : h;
    };
    try { el.setAttribute('data-filled', '1'); } catch (e) {}
    wire(el, function (tap, arg) {
      var d = el._d || {}, b = (d.books || [])[+arg];
      if (tap === 'book' && b) {
        opened[b.id] = 1;
        post(ctx, b.id, 'story_opened', { shelf_position: b.shelf_position == null ? +arg + 1 : b.shelf_position, from_teacher: !!b.from_teacher, grade: b.grade, lang: b.lang });
        W.location.hash = '#story/' + b.id;
      } else if (tap === 'gl') { el._open = !el._open; el.innerHTML = np(shelfHtml(d, el._open, ctx.host)); }
      else if (tap === 'g' || tap === 'l') { q[tap] = arg; ls('wq_st_gl', (q.g || '') + ',' + (q.l || '')); shelf(el, ctx, q); }
      else if (tap === 'retry') shelf(el, ctx, q);
    });
    el.innerHTML = np(scr('stories-wait', l, '<div class="wqs-top">' + hm(l) + '</div><div class="wqs-grid" aria-busy="true">' + new Array(5).join('<i class="wqs-skel"></i>') + '</div>', 'wqs-shelf'));
    function fail() { if (el._gen === gen) el.innerHTML = np(retryHtml(l, hm(l))); }
    req('GET', '/api/wq/stories/shelf/h/' + enc(ctx.token) + '?kid=' + enc(ctx.kid) + (q.g ? '&g=' + enc(q.g) : '') + '&l=' + l + (ids ? '&t=' + enc(ids) : '')).then(function (r) {
      if (el._gen !== gen) return;
      if (r.status === 404) { el.innerHTML = ''; el.hidden = true; return; }
      if (!r.ok) return fail();
      el._d = shelf.d = r.body; el._open = false;
      el.innerHTML = np(shelfHtml(r.body, false, ctx.host));
      if (r.body.warm) load('wq-stories-w.js', 0, Date);
      evt(ctx, 'story_shelf_shown', { n: (r.body.books || []).length, grade: +r.body.grade, lang: r.body.lang });
    }, fail);
  }

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
  function cam(bs, vw, vh, pw, ph, rtl, cap, fit) {
    var w0 = Math.min(vw / pw, vh / ph), r = function (v) { return Math.round(v * 10) / 10; };
    if (!bs || !bs.length) return { s: Math.round(w0 * 1000) / 1000, tx: r((vw - pw * w0) / 2), ty: r((vh - ph * w0) / 2), ok: false };
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, mh = 1e9;
    bs.forEach(function (b) { x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[0] + b[2]); y0 = Math.min(y0, b[1]); y1 = Math.max(y1, b[1] + b[3]); mh = Math.min(mh, b[3]); });
    var s = Math.max(w0, Math.min(fit ? Math.min(vw / ((x1 - x0) * 1.16), vh / ((y1 - y0) * 1.16)) : Math.max(vw / ((x1 - x0) * 1.16), 26 / mh), w0 * (cap || 3)));
    var tx = (x1 - x0) * s <= vw * 0.92 ? vw / 2 - (x0 + x1) / 2 * s : rtl ? vw * 0.96 - x1 * s : vw * 0.04 - x0 * s;
    tx = Math.min(0, Math.max(vw - pw * s, tx));
    var ty = vh * 0.7 - (y0 + y1) / 2 * s;
    if (fit) ty = Math.max(-y0 * s, Math.min(ty, vh - y1 * s));
    ty = Math.min(0, Math.max(vh - ph * s, ty));
    return { s: Math.round(s * 1000) / 1000, tx: r(tx), ty: r(ty), px: mh * s, ok: mh * s >= 25.5 };
  }
  function mark(p, i, a, rtl) {
    var ws = p.words || [], w = ws[i], k, x;
    if (!w) return null;
    if (p.quality === 'low') {
      var N = lines(p), q = N.l[N.of[i]], bs = q ? (q.bs.length ? q.bs : q.i.map(function (j) { return ws[j].box; }).filter(Boolean)) : [];
      if (!bs.length) { a = a || [0, p.image.h - 40, p.image.w, 40]; return a.slice(0, 4); }
      x = [1e9, 1e9, -1e9, -1e9];
      bs.forEach(function (b) { x = [Math.min(x[0], b[0]), Math.min(x[1], b[1]), Math.max(x[2], b[0] + b[2]), Math.max(x[3], b[1] + b[3])]; });
      return [x[0], x[1], x[2] - x[0], x[3] - x[1]];
    }
    if (w.box) return w.box.slice(0, 4);
    x = (p.lines || []).filter(function (y) { return y.i0 <= i && i <= y.i1; })[0];
    var b = x && (x.box || a && [a[0], a[1] + a[3] / p.lines.length * p.lines.indexOf(x), a[2], a[3] / p.lines.length]);
    if (b) { var g = (i - x.i0 + 1) / (x.i1 - x.i0 + 1); return [b[0] + (rtl ? b[2] * (1 - g) : 0), b[1] + b[3] - 6, b[2] * g, 6, 1]; }
    x = 0;
    a = a || [0, p.image.h - 40, p.image.w, 40];
    for (k = 1; !x && k < ws.length; k++) x = (ws[i - k] || {}).box || (ws[i + k] || {}).box;
    if (x) return [a[0], x[1], a[2], x[3], 1];
    var f = (i + 1) / ws.length;
    return [a[0] + (rtl ? a[2] * (1 - f) : 0), a[1], a[2] * f, a[3], 1];
  }

  function machine(b, o) {
    var P = b.pages || [];
    var m = { i: 0, st: '', lr: !!o.lr, skip: -1, no: {}, l: {}, r: {}, first: {}, ratio: 1, pref: b.grade >= 3 ? 'read' : 'listen' };
    function chg() { if (o.on) o.on(m); }
    function fx(n) { if (o.fx) o.fx(n); }
    function can() { var p = P[m.i]; return m.lr && !m.no[m.i] && !!(p.words && p.words.length); }
    function au() { return !!P[m.i].audio; }
    m.set = function (s) {
      var f = s === 'mic' ? 'read' : s === 'listening' ? 'listen' : 0;
      if (f && m.st === 'idle') m.pref = f;
      if (f && !m.first[m.i]) m.first[m.i] = f;
      m.st = s; chg();
    };
    m.go = function (i) { m.i = i; m.skip = -1; m.st = P[i].is_picture ? 'picture' : 'idle'; chg(); };
    m.label = function () {
      var s = m.st;
      if (s === 'listening') return 'pause';
      if (s === 'paused') return 'listen';
      if (s === 'reading') return 'done';
      if (s === 'idle') return m.pref === 'read' && can() ? 'yourTurn' : au() ? 'listen' : can() ? 'yourTurn' : 'next';
      if (s === 'listened') return can() ? 'yourTurn' : 'next';
      if (s === 'together' || s === 'denied') return au() ? 'listen' : 'next';
      return s === 'practise' || s === 'read' || s === 'picture' ? 'next' : null;
    };
    m.alt = function () {
      var s = m.st, l = m.label();
      if (/^(idle|listening|paused)$/.test(s) && l !== 'yourTurn' && can()) return 'yourTurn';
      return s === 'idle' && l === 'yourTurn' && au() ? 'hearFirst' : null;
    };
    m.altTap = function () {
      var a = m.alt();
      if (a === 'yourTurn') { if (m.st === 'listening') fx('pause'); m.pref = 'read'; m.set('mic'); }
      else if (a) { fx('play'); m.set('listening'); }
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
    m.denied = function () { if (b.steady) m.no[m.i] = m.dn = 1; else m.lr = false; m.set('denied'); };
    m.voice = function () { m.lr = false; m.set('listening'); fx('play'); };
    m.notNow = function () { m.no[m.i] = 1; m.set('idle'); };
    m.result = function (r) {
      var ok = !!(r && r.words_read > 0 && r.words_read >= 0.1 * (r.words_total || 0));
      m.ratio = ok ? r.words_read / (r.words_total || 1) : 0;
      m.skip = ok && P[m.i].quality !== 'low' ? (r.marks || []).indexOf('skipped') : -1;
      if (ok) m.r[m.i] = 1;
      m.set(ok ? (m.skip >= 0 ? 'practise' : 'read') : 'together');
    };
    m.next = function () { if (m.i < P.length - 1) m.go(m.i + 1); else m.set(b.questions && b.questions.length ? 'questions' : 'done'); };
    m.prev = function () { if (m.i > 0) m.go(m.i - 1); };
    m.counts = function () { return { pages_listened: Object.keys(m.l).length, pages_read: Object.keys(m.r).length }; };
    if (P.length) m.go(Math.max(0, Math.min(P.length - 1, o.start || 0))); else m.st = b.questions && b.questions.length ? 'questions' : 'done';
    return m;
  }


  function load(path, css, cb) {
    var done = 0, fin = function () { if (!done) { done = 1; cb(); } };
    try {
      var s = document.querySelector('script[src*="wq-stories.js"]'), v = s && /[?&]v=([\w-]+)/.exec(s.getAttribute('src') || ''), q = v ? '?v=' + v[1] : '';
      var h = document.head, sc = document.createElement('script'), c;
      if (css) { c = document.createElement('link'); c.rel = 'stylesheet'; c.href = '/wq/' + css + q; h.appendChild(c); }
      sc.src = '/wq/' + path + (/\?/.test(path) ? '' : q); sc.onload = sc.onerror = fin; h.appendChild(sc);
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
  // the player (and lr3's live reader) come with the book
  var got = {}, RA_V = '64569caa64';   // the player's content hash (a test pins it)
  function need(f, g, css, cb) {
    if (W[g] || got[f] === 1) return cb();
    if (got[f]) return got[f].push(cb);
    got[f] = [cb];
    load(f, css, function () { var w = got[f]; got[f] = W[g] ? 1 : 0; w.forEach(function (x) { x(); }); });
  }

  function reader(id, ctx, root) {
    var C = clockOf(ctx), tch = ctx.role === 'teacher', R = { id: id, root: root, ctx: ctx, C: C, tch: tch, pl: null, lr: null, poll: null, au: null };
    var b, L = lg(ctx.lang), t = T[L], P, m, Q, view = '', pg = -1, t0 = -1, acc = 0, sent = {}, ask = {};
    var sp, sm = '', LN = { l: [], of: [] }, zl = -1, li = -1, wu = 0, lc, ro, ros;
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
    function wait() { paint(scr('story-wait', L, top(L, ic(t, 'back', t.back, '‹', 'data-back data-primary')) + '<i class="wqs-skel wqs-big"></i>')); }
    R.wait = wait;
    function oops() { paint(retryHtml(L, ic(t, 'back', t.back, '‹'))); }
    function load(q) {
      wait();
      (cache[id] && !tch ? Promise.resolve({ ok: true, body: cache[id] }) : req('GET', bookUrl())).then(function (r) {
        if (cur !== R) return;
        if (r.status === 404) return r.body.error === 'gone' ? withQ(function (k) { if (cur === R) k ? W.WQSTORIES._gone(R) : oops(); }) : paint(kind('stories-off', L, t.off, '<button class="wqs-main" data-primary data-home data-tap="home">' + esc(t.home) + '</button>'));
        if (!r.ok) return oops();
        var go = function () { if (cur === R) start(r.body, q); };
        need('wq-readalong.js?v=' + RA_V, 'WQReadAlong', 0, r.body.lr3 && !tch && !W.WQLiveRead ? function () { need('wq-read-live.js', 'WQLive', 0, function () { need('wq-liveread.js', 'WQLiveRead', 'wq-liveread.css', go); }); } : go);
      }, function () { if (cur === R) oops(); });
    }
    function start(bk, q) {
      if (bk && bk.mp3 === 1) (bk.pages || []).forEach(function (p) { if (p.audio) p.audio.url = mp3(p.audio.url); });
      R.b = b = bk; if (!tch) cache[id] = b;
      R.L = L = lg(b.lang); R.t = t = T[L]; R.P = P = b.pages || [];
      if (!W.WQReadAlong) P.forEach(function (p) { p.audio = null; });
      var LR = W.WQLiveRead, o = { lr: !tch && !!(LR && LR.mount && LR.askMic), fx: fx, start: q && q.p ? q.p - 1 : 0 };
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
      withQ(function (k) { if (k && cur === R) Q = Q || W.WQSTORIES._q(R); });
    }
    R.re = function () { view = ''; show(); };
    R.go = function (q) {
      if (!m) return;
      if (q.q && view !== 'q') m.set('questions');
      else if (q.p && P[q.p - 1]) m.go(q.p - 1);
    };
    function show() {
      if (cur !== R) return;
      var s = m.st, v = s === 'mic' ? 'mic' : s === 'reading' ? 'read' : s === 'questions' ? 'q' : s === 'done' ? 'd' : s === 'echo' ? 'e' : 'page';
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
    // the listening clock: stopped (billed) or restarted (g)
    var ac = R.ac = function (g) { if (t0 >= 0) { acc += C.now() - t0; t0 = -1; } if (g) t0 = C.now(); };
    function flush(k) {
      ac();
      if (acc > 0 && !sent[pg] && P[pg]) { sent[pg] = 1; pp('story_page_listened', { ms: acc, completed: false }, pg, k); }
      acc = 0;
    }
    R.fl = flush;
    var pp = R.pp = function (ev, d, k, ka) { var n = P[k] && P[k].n; if (b.slow_gaps && R.pl && R.pl.slowed) d.slow = 1; if (n >= 1 && n <= P.length) post(ctx, id, ev, d, n, ka); };
    function kill() {
      if (cur === R) { flush(); cur = null; }
      drop(); if (R.au) R.au.pause(); if (R.un) R.un();
    }
    R.kill = kill;
    R.hush = function () {   // the echo and Your turn's reading: wq-stories-q.js
      if (R.au) R.au.pause();
      if (m && m.st === 'listening') m.primary(); else if (R.pl) R.pl.pause();
    };
    function fx(n) {
      var p = R.pl;
      if (n === 'play' && p) {
        ac(1); zl = -1; camLine(li >= 0 ? li : 0);
        p.play();
      }
      else if (n === 'pause' && p) { p.pause(); ac(); }
      else if (n === 'stop' && R.lr) R.lr.stop('done_tap');
    }
    function pageScreen() {
      var p = P[m.i], im = p.image, i = m.i, ve = function () { m.err(); if (view === 'page' && m.i === i) { drop(); pageScreen(); } };
      paint(scr('story-page', L, top(L, ic(t, 'back', t.back, '‹'), b.title, !!p.audio) + stage(p, (p.audio && p.boxes_ok ? '' : img(im.url, im.w, im.h)) + (p.audio ? '<div data-ra></div>' : ''), rtl()) +
        '<div class="wqs-extra" data-extra>' + extra() + '</div><div class="wqs-lrl" data-lrl></div><div class="wqs-ctl">' +
        '<button class="wqs-arr" data-tap="prev"' + (i ? '' : ' disabled') + ' aria-label="' + esc(t.prevP) + '">' + IC.prev + '</button>' +
        '<button class="wqs-main" data-main data-primary data-tap="main"' + (p.audio ? ' data-sound data-trigger="tap"' : '') + '>' + esc(t[m.label()]) + '</button>' +
        (p.audio ? '<button class="wqs-slow" data-tap="slow" aria-pressed="' + slow() + '">' + IC.slow + ' ' + esc(t.slow) + '</button>' : '') +
        '<button class="wqs-arr" data-tap="next" aria-label="' + esc(t.nextP) + '">' + IC.next + '</button></div>'));
      rest();
      if (p.audio) {
        R.mount(p, {
          onEnd: ended,
          onState: function (s) { if (b.steady && R.os) R.os(s, i); else if (s === 'error' && R.pl) b.steady ? withQ(function (k) { if (cur === R) k ? R.os(s, i) : m.i === i && ve(); }) : ve(); if (s === 'blocked' && m.st === 'listening') { t0 = -1; m.set('paused'); } else if (s === 'paused' && m.st === 'listening') { ac(); m.set(m.l[m.i] ? 'listened' : 'paused'); } },
          onWordTap: function () { if (/^(idle|paused|listened|together|denied)$/.test(m.st)) { ac(1); m.set('listening'); } },
        });
      }
      // without the setting (wq-stories-q.js may not be here yet)
      if (!b.steady) {
        if (!p.audio && !p.is_picture && !ask[i]) {
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
      }
      sync();
    }
    function dims() {
      var s = root.querySelector('[data-stage]'), vw = (s && s.clientWidth) || (W.innerWidth || 384) - 24;
      return [vw, (s && s.clientHeight) || (W.innerHeight ? W.innerHeight * 0.62 : vw * sp.image.h / sp.image.w)];
    }
    function rtl() { return b.dir === 'rtl'; }
    function stage(p, inner, art) {
      var ws = p.words || [], tb = p.text_band, im = p.image, d;
      sp = p; LN = lines(p); zl = -1; li = -1; wu = 0; sm = ''; lc = 0;
      if (ws.length && !p.is_picture) {
        d = dims();
        sm = (p.boxes_ok || p.lines && !(tb && tb.box)) && LN.l.some(function (x) { return x.bs.length; }) && LN.l.every(function (x) { return !x.bs.length || cam(x.bs, d[0], d[1], im.w, im.h, rtl(), 3).ok && (!b.tx || x.bs.every(function (y) { return y[2] * 5 > y[3]; })); }) ? 'z' : tb && tb.box ? 'l' : 's';
      }
      var bx = sm === 'l' && tb.box, wh = sm === 'z' || sm === 'l';
      return '<div class="wqs-stage' + (wh ? ' wqs-st2' : '') + '" data-stage>' + (b.steady ? '<div class="wqs-ph" data-ph><p>' + esc(p.text) + '</p><i>' + esc(t.opening) + '</i></div>' : '') + '<div class="wqs-cam" data-cam style="width:' + im.w + 'px;height:' + im.h + 'px">' + inner +
        (bx ? img(tb.url, tb.w, tb.h, 'wqs-lens', ' style="left:' + bx[0] + 'px;top:' + bx[1] + 'px;width:' + bx[2] + 'px;height:' + bx[3] + 'px"') : '') +
        (own() ? '<i class="wqs-mk" data-mk></i>' : '') + '</div>' + (art !== !1 && sm === 'z' && b.read_fb ? '<div class="wqs-art" data-art hidden><i>' + img(im.url, im.w, im.h) + '</i></div>' : '') + (wh && b.tx ? '<div class="wqs-tx" data-tx>' + img(im.url, im.w, im.h) + '</div>' : '') + '</div>' +
        (wh ? '<button class="wqs-whole" data-whole data-tap="cam" aria-pressed="false">' + esc(t.whole) + '</button>' : '');
    }
    function own() { return sm && (sm !== 'z' || !sp.boxes_ok); }
    R.stage = stage;
    R.mode = function () { return sm; };
    R.lines = function () { return LN; };
    function al() { return [].concat.apply([], LN.l.map(function (l) { return l.bs; })); }
    // the reading moment's picture box (stage(.., art); wq-moment.js art): framed words never leave a sliver of the picture
    function camTo(bs, fit, rs) {
      var c = root.querySelector('[data-cam]'), x = root.querySelector('[data-tx]'), a = root.querySelector('[data-art]'), M = W.WQMoment, d, k, f, ph;
      if (!c || !sp) return;
      if (x && bs) x.className = 'wqs-tx';
      d = dims(); lc = [bs, fit, rs];
      f = a && bs && !wu && M && M.art && M.art(a, cam, sp.image, al(), bs, d, rtl(), rs, b.read_sheet, R.af);
      k = f || cam(wu ? null : bs, d[0], d[1], sp.image.w, sp.image.h, rtl(), sm === 'l' ? 6 : 3, fit);
      c.style.transform = 'translate(' + k.tx + 'px,' + k.ty + 'px) scale(' + k.s + ')';
      if (a) { c.style.clipPath = f ? f.clip : ''; a.hidden = !f; }
      // clipped: the opening words under the sheet go once its picture is in (they never show past its lines); the stage
      // resized (the meter came in): framed again
      if (f && (ph = root.querySelector('[data-ph]'))) { k = a.querySelector('img'); if (!k || k.complete && k.naturalWidth) ph.style.display = 'none'; else k.addEventListener('load', function () { ph.style.display = 'none'; }); }
      if (a && W.ResizeObserver && (x = root.querySelector('[data-stage]')) !== ros) { if (ro) ro.disconnect(); ros = x; ro = new W.ResizeObserver(function () { R.af(); }); ro.observe(x); }
      return f;
    }
    // at rest the whole sheet (its art) and, when the print is small, a lens of the words at a readable size on their side
    function rest() {
      var x = root.querySelector('[data-tx]'), d, y = 0, bs, k;
      // an Urdu page with that box: the words at rest at Your turn's size
      if (sm === 'z' && !wu && root.querySelector('[data-art]') && camTo(al(), 1, 1)) { lc = 0; if (x) x.className = 'wqs-tx'; return; }
      camTo(null); lc = 0;
      d = dims();
      if (!x) return;
      bs = sm === 'z' ? al() : [sp.text_band.box];
      k = cam(bs, d[0], d[1] * .4, sp.image.w, sp.image.h, rtl(), 6, 1);
      bs.forEach(function (b) { y += (b[1] + b[3] / 2) / bs.length; });
      x.className = 'wqs-tx' + (wu || k.s < cam(0, d[0], d[1], sp.image.w, sp.image.h).s * 1.3 ? '' : ' on') + (y > sp.image.h / 2 ? ' lo' : '');
      if (x.firstChild) x.firstChild.style.transform = 'translate(' + k.tx + 'px,' + k.ty + 'px) scale(' + k.s + ')';
    }
    // steady: the voice's line framed across the page's widest line, so no line's ends are cut
    function lineFrame(n) {
      var bs = LN.l[n].bs, a = 1e9, z = -1e9;
      if (!b.steady || !bs.length) return bs;
      LN.l.forEach(function (l) { l.bs.forEach(function (x) { a = Math.min(a, x[0]); z = Math.max(z, x[0] + x[2]); }); });
      return bs.concat([[a, bs[0][1], z - a, bs[0][3]]]);
    }
    function camLine(i) {
      li = i;
      var n = sm === 'z' ? LN.of[i] || 0 : 0;
      if (sm && sm !== 's' && n !== zl) { zl = n; camTo(sm === 'z' ? lineFrame(n) : [sp.text_band.box], 1); }
    }
    R.camTo = camTo; R.camLine = camLine;
    // the moment's file came late: this view framed again
    R.af = function () { if (cur === R) lc ? camTo.apply(null, lc) : rest(); };
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
      var ra = root.querySelector('[data-ra]');
      op.mode = p.boxes_ok ? 'overlay' : 'strip'; op.leadMs = 50; op.tap = 'sentence'; if (p.lines && p.lines.length) op.lines = p.lines.map(function (x) { return [x.i0, x.i1]; }); op.labels = { play: t.listen, pause: t.pause, replay: t.again }; op.onWord = word;
      try { R.pl = W.WQReadAlong.mount(ra, { v: 1, id: b.id + '/p' + p.n, lang: b.lang, dir: b.dir, audio: p.audio, words: p.words, image: p.image, quality: p.quality }, op); } catch (x) { R.pl = null; }
      // no voice before the first Listen
      if (R.pl && R.pl.audio) { R.pl.audio.muted = muted(); if (b.steady) R.pl.audio.preload = 'none'; }
      rate();
    }
    R.mount = mount;
    function slow() { return ls('wq_st_slow:' + (ctx.kid || '')) === '1'; }
    function rate() { if (R.pl && R.pl.slow) R.pl.slow(slow(), b.slow_gaps); }
    function extra() {
      var s = m.st, p = P[m.i], a = m.alt(), h = R.ex ? R.ex(s, p) : '';
      if (a) h = '<button class="wqs-sec" data-tap="alt"' + (a === 'hearFirst' ? ' data-sound data-trigger="tap"' : '') + '>' + esc(t[a]) + '</button>' + h;
      if (p.audio && /^(listened|paused|read|practise)$/.test(s)) h += '<button class="wqs-again" data-tap="again" data-sound data-trigger="tap">' + (adv() ? '<i class="wqs-re"></i>' : '↻') + ' ' + esc(t.again) + '</button>';
      return h;
    }
    function sync() {
      var mb = root.querySelector('[data-main]'), ex = root.querySelector('[data-extra]'), lab = m.label();
      if (mb) { mb.textContent = lab ? t[lab] : ''; mb.className = 'wqs-main wqs-' + lab; if (R.sy) R.sy(mb, lab); }
      if (ex) ex.innerHTML = extra();
    }
    function ended() {
      ac();
      if (!sent[m.i]) { sent[m.i] = 1; pp('story_page_listened', { ms: acc, completed: true }, m.i); }
      acc = 0;
      li = -1; zl = -1; rest(); word(-1);
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
      else if (tap === 'retry') R.re();
      else if (tap === 'snd') {
        var v = !muted(), s = root.querySelector('[data-snd]');
        if (W.WQJ && W.WQJ.mute) juice('mute', v);
        ls('wq_snd', v ? '0' : '1');
        if (R.pl && R.pl.audio) R.pl.audio.muted = v;
        if (R.au) R.au.muted = v;
        if (s) { s.innerHTML = v ? IC.mute : IC.spk; s.setAttribute('aria-pressed', String(v)); }
      } else if (tap === 'again') { if (R.pl) { if (t0 < 0) ac(1); R.pl.replay(); if (/^(listened|paused)$/.test(m.st)) m.set('listening'); } }
      else if (tap === 'alt') m.altTap();
      else if (tap === 'slow') { ls('wq_st_slow:' + (ctx.kid || ''), slow() ? '0' : '1'); rate(); var sb = root.querySelector('.wqs-slow'); if (sb) sb.setAttribute('aria-pressed', String(slow())); }
      else if (tap === 'cam') { wu = !wu; zl = -1; if (wu || li < 0) rest(); else camLine(li); var wb = root.querySelector('[data-whole]'); if (wb) wb.setAttribute('aria-pressed', String(!!wu)); }
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
  // iOS < 18.4 plays no Ogg Opus: with the book's mp3 (web_quiz_story_mp3) our voices come as the edge's .mp3 (W.WQMP3)
  var mp3 = W.WQMP3 = function (u) { var a = document.createElement('audio'); return /^\/s\/[^?#]+\.ogg$/.test(u) && a.canPlayType && !a.canPlayType('audio/ogg; codecs="opus"') ? u.slice(0, -3) + 'mp3' : u; };
  function found() { var B = W.WQSTORIES_CTX ? null : boot(); return W.WQSTORIES_CTX || (B.token ? { token: B.token, kid: B.kid, lang: B.lang } : null); }

  W.WQSTORIES = { _af: function () { if (cur && cur.af) cur.af(); }, shelf: shelf, open: open, route: route, _machine: machine, _bad: bad, _cam: cam, _lines: lines, _mark: mark,
    _k: { T: T, JG: JG, IC: IC, esc: esc, enc: enc, dg: dg, scr: scr, img: img, ic: ic, top: top, post: post, req: req, juice: juice, muted: muted, evt: evt, load: load } };

  try {
    var B0 = boot(), s0 = B0.story, c0 = found(), h0 = /^#story\/([A-Za-z0-9_-]+)/.exec(W.location.hash || '');
    if (!s0 && h0 && /[?&]from=link(&|$)/.test(W.location.search || '')) s0 = { id: h0[1] };
    if (s0 && s0.id && c0) {
      var sid = String(s0.id), ids = tids(c0.kid).filter(function (x) { return x !== sid; });
      ids.unshift(sid);
      ls('wq_st_t:' + (c0.kid || ''), ids.slice(0, 5).join(','));
      if (s0.code) codes[sid] = String(s0.code);
      if (!/^#story\//.test(W.location.hash || '')) W.location.hash = '#story/' + sid;
    }
    var sl = document.querySelector('[data-stories-shelf], .wq-shelf[data-shelf]');
    if (sl && c0 && !sl.getAttribute('data-filled') && sl.getAttribute('data-host') == null) shelf(sl, c0);
    W.addEventListener('hashchange', function () { route(found()); });
    if (document.addEventListener) document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && cur) cur.hush(); });
    if (c0) route(c0);
  } catch (e) {}
}());
