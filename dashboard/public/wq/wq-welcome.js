/* The child's first open of the home, "Jugnu says hello" (app_settings web_quiz_child_welcome; the hub answer's
 * `welcome: {v, attempt[, voice]}`; design/ftue_child/DESIGN.md, the lines from its URDU_READ.md). Loaded by wq-home.js
 * only when the answer says so, over the real home:
 *   1 Jugnu, silent (the tap unlocks sound) · 2 who I am · 3 the lands light up · 4 the Next stop is raised and the hand
 *   points at it: its own tap (the real Next path) is done. A phone that already played it (wq.welcome.dev): 1, 2, 4.
 *   Skip (its own row under the header) = skipped, at any step; a scrim tap does nothing; step 4 idle: the nudge at 8 s,
 *   20 s more = done (idle). Skip and idle end with one 2 s pulse on the Next stop. Never a hold, never the grown-ups pill.
 *   The voice: the recorded clips the answer names (`voice`: the one-voice set's path; welcome-<key>.mp3), only after the
 *   first tap and with the home's sound on; none named = captions only, silent. Never the phone's own voice.
 *   Per child: the server's flag (POST /api/wq/welcome {hub, kid, outcome}) and this phone's copy (wq.welcome.<kid>).
 *   WQW.start(root, B, ctx, opts) -> true when it shows · WQW.up() · WQW.COPY */
(function () {
  'use strict';
  var COPY = {
    en: { hi: 'Hi! I\'m Jugnu. I light the way!', hiShort: 'Hi! I\'m Jugnu.', lands: 'Stories, games and videos are all here!', stop: 'Your next stop is ready. Tap "Let\'s go!"', nudge: 'Ready? Tap "Let\'s go!"', skip: 'Skip' },
    ur: { hi: 'سلام! میں جگنو ہوں۔ میرا کام راستہ روشن کرنا ہے!', hiShort: 'سلام! میں جگنو ہوں۔', lands: 'کہانیاں، کھیل اور ویڈیوز، سب یہاں ہیں!', stop: 'آپ کی اگلی منزل تیار ہے۔ «آئیں چلیں!» دبائیں۔', nudge: 'تیار ہیں؟ «آئیں چلیں!» دبائیں۔', skip: 'چھوڑیں' },
  };
  var DEV = 'wq.welcome.dev';
  var HAND = '<svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true"><path fill="#FFE0B2" stroke="#5D4037" stroke-width="2.5" stroke-linejoin="round" d="M19 6a4 4 0 0 1 4 4v14l2-1a4 4 0 0 1 5 2l1 1a4 4 0 0 1 5 2v1a4 4 0 0 1 5 3v7c0 6-5 11-11 11h-4c-4 0-7-2-9-5l-7-11a4 4 0 0 1 6-5l2 2V10a4 4 0 0 1 1-4z"/></svg>';
  var SKIP = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M5 6l8 6-8 6zm9 0h3v12h-3z"/></svg>';
  var st = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* the server's flag still decides */ } }
  function seenOf(kid, v) { try { var x = JSON.parse(get('wq.welcome.' + kid) || 'null'); return x && x.v === v && (x.s === 'done' || x.s === 'skipped') ? x.s : null; } catch (e) { return null; } }
  function keep(kid, v, s) { put('wq.welcome.' + kid, JSON.stringify({ s: s, v: v })); }
  function post(ctx, kid, outcome) {
    try { fetch('/api/wq/welcome', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ hub: ctx.token, kid: kid, outcome: outcome }), keepalive: true, credentials: 'same-origin' }).catch(function () {}); } catch (e) {}
  }
  function now() { return Date.now(); }

  function start(root, B, ctx, opts) {
    var w = B && B.welcome;
    if (!w || !B.kid || B.practice || st || !root || typeof document === 'undefined' || !document.body) return false;
    if (w.replay) return false;
    var had = seenOf(B.kid, w.v);
    // this phone already holds it (a lost write, or a Let's go tap before this script arrived): tell the server again
    if (had) { post(ctx, B.kid, had); return false; }
    if (!layer(root, B, ctx, opts, false)) return false;
    var w2 = st.w, ev = st.ev, form = st.form, lang = st.lang;
    post(ctx, B.kid, 'shown');
    // the second show is the last: done as it shows, so a child who always leaves early is never caught in a loop
    if ((w2.attempt || 1) >= 2) keep(B.kid, w2.v, 'done');
    ev('welcome_shown', { form: form, v: w2.v, attempt: w2.attempt || 1, lang: lang });
    go(1);
    room();
    // ...and again once the look has dressed the card (its tag comes a moment after the home paints)
    [300, 1000, 2500].forEach(function (ms) { setTimeout(function () { if (st) room(); }, ms); });
    return true;
  }
  // The replay (DESIGN §5; the boot's `welcome.replay`): the greeting's Jugnu shows step 4 alone again, about 5 s; nothing
  // is written or counted, and its Let's go is the plain Next path.
  function replay(root, B, ctx, opts) {
    if (!B || !B.welcome || !B.welcome.replay || !B.kid || B.practice || st || !root || typeof document === 'undefined' || !document.body) return false;
    if (!layer(root, B, ctx, opts, true)) return false;
    go(4);
    room();
    return true;
  }
  // the layer over the home, its taps and the Next stop's own; st is set up
  function layer(root, B, ctx, opts, isReplay) {
    var w = B.welcome;
    var next = root.querySelector('.wq-next');
    if (!next) return false;
    var lang = ctx.lang === 'ur' ? 'ur' : 'en';
    var t = COPY[lang];
    var form = get(DEV) === '1' ? 'short' : 'full';
    var ev = ctx.ev || function () {};
    var muted = (opts && typeof opts.muted === 'function') ? opts.muted : function () { return false; };
    st = { root: root, B: B, ctx: ctx, w: w, t: t, lang: lang, form: form, ev: ev, muted: muted, next: next, at: now(), step: 0, timers: [], unlocked: isReplay, el: null, replay: isReplay };
    var o = document.createElement('div');
    o.setAttribute('class', 'wqw');
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-label', t.hiShort);
    o.setAttribute('dir', lang === 'ur' ? 'rtl' : 'ltr');
    o.setAttribute('lang', lang);
    st.el = o;
    o.addEventListener('click', function (e) {
      var a = e && e.target;
      if (a && !(a.getAttribute && a.getAttribute('data-ww')) && a.closest) a = a.closest('[data-ww]');
      var what = a && a.getAttribute ? a.getAttribute('data-ww') : null;
      if (what === 'skip') return end('skip');
      if (what === 'jugnu' && st && st.step === 1) return hello();
      // step 4: a tap in the Next stop's opening is the real Let's go (the home's own Next path)
      if (st && st.step === 4 && st.hole && e && inside(st.hole, e.clientX, e.clientY)) { var n = st.next; end('letsgo'); try { n.click(); } catch (x) {} return; }
      // the scrim, a land, anything else: nothing (the ways out are Jugnu, Let's go and Skip)
    });
    next.addEventListener('click', letsGo, true);
    document.body.appendChild(o);
    return true;
  }
  function later(fn, ms) { var id = setTimeout(function () { if (st) fn(); }, ms); st.timers.push(id); }
  function clear() { st.timers.forEach(function (id) { try { clearTimeout(id); } catch (e) {} }); st.timers = []; }
  function rectOf(el) { try { var r = el.getBoundingClientRect(); return r || null; } catch (e) { return null; } }
  function inside(r, x, y) { return typeof x === 'number' && typeof y === 'number' && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
  function px(n) { return Math.round(Number(n) || 0) + 'px'; }
  function vh() { return (typeof window !== 'undefined' && window.innerHeight) || 640; }
  function vw() { return (typeof window !== 'undefined' && window.innerWidth) || 360; }
  // A rect drawn on the scrim (a ring, the opening) kept inside the page's 16 px gutters (design-qa FT-2).
  function inset(r, pad) {
    var l = Math.max(16, r.left - pad), rt = Math.min(vw() - 16, r.right - 0 + pad);
    return { top: r.top - pad, left: l, width: Math.max(0, rt - l), height: r.height + 2 * pad };
  }
  // Skip's own row (design-qa C2 / FT-1): the Next stop and the look's tag over it move down while the welcome is up,
  // so they start ≥ 8 px under Skip; the card's own margin comes back at the end.
  var SKIP_H = 48;
  function room() {
    var r = rectOf(st.next);
    if (!r) return;
    var tag = st.next.querySelector ? st.next.querySelector('.wqa-bub') : null;
    var tr = tag ? rectOf(tag) : null;
    var top = Math.min(r.top, tr && tr.height > 0 ? tr.top : r.top);
    var need = Math.ceil(skipBottom() + 8 - top);
    if (!(need > 0)) return;
    var cur = 0;
    try { cur = parseFloat(window.getComputedStyle(st.next).marginTop) || 0; } catch (e) { cur = 0; }
    st.pushed = true;
    st.next.style.marginTop = (cur + need) + 'px';
  }
  // Skip's drawn bottom (its Urdu line can make it a little taller than 48), else where its row puts it
  function skipBottom() {
    var r = st.el && st.el.querySelector ? rectOf(st.el.querySelector('.wqw-skip')) : null;
    return r && r.height > 0 ? r.bottom : topRow() + SKIP_H;
  }
  // step 4 on a short screen: the page scrolls just enough for the whole card, never under Skip's row
  function reveal() {
    var r = rectOf(st.next);
    if (!r || !(r.bottom > vh() - 8)) return;
    var tag = st.next.querySelector ? st.next.querySelector('.wqa-bub') : null;
    var tr = tag ? rectOf(tag) : null;
    var top = Math.min(r.top, tr && tr.height > 0 ? tr.top : r.top);
    var by = Math.min(r.bottom - vh() + 16, top - (skipBottom() + 8));
    if (by > 0) { try { window.scrollBy(0, by); } catch (e) {} }
  }
  function topRow() {
    var h = rectOf(st.root.querySelector('.wq-hhead'));
    return Math.round((h && h.bottom ? h.bottom : 0) + 8);
  }
  function voice(key) {
    var base = st.w.voice;
    if (!st.unlocked || !base || typeof base !== 'string' || !/^\/wq\/[A-Za-z0-9/_.-]+\/$/.test(base) || st.muted() || typeof Audio !== 'function') return;
    try { var a = new Audio(base + 'welcome-' + key + '.mp3'); var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* the caption and the hand carry on */ }
  }
  // The scrim is a spotlight: the whole home dimmed, with an opening on the Next stop at step 4 (taps in it are
  // Let's go) and a ring on the land of the moment at step 3; Jugnu and the caption sit under the opening, or above it
  // when there is no room; the hand points at the card's own Let's go.
  function draw(cap, extra, ring) {
    var s = st.step;
    // the look's tag can arrive after the welcome (wq-adv.js dresses the card late): Skip's row is kept on every draw
    if (st.el && st.el.innerHTML) room();
    var hole = s >= 4 ? rectOf(st.next) : null;
    if (hole && !(hole.width > 0)) hole = null;
    st.hole = hole;
    var hb = hole ? inset(hole, 0) : null;
    var dim = hb ? '<div class="wqw-dim wqw-hole" style="top:' + px(hb.top) + ';left:' + px(hb.left) + ';width:' + px(hb.width) + ';height:' + px(hb.height) + '"></div>' : '<div class="wqw-dim"></div>';
    var rb = ring ? inset(ring, 4) : null;
    var stage = '';
    if (hole) stage = hole.bottom + 190 < vh() ? ' style="top:' + px(hole.bottom + 14) + '"' : ' style="top:auto;bottom:' + px(vh() - hole.top + 14) + '"';
    var hand = '';
    if (hole) {
      var g = rectOf(st.next.querySelector && st.next.querySelector('.wq-ngo')) || hole;
      if (!(g.width > 0)) g = hole;
      var x = st.lang === 'ur' ? g.left + g.width * 0.18 : g.left + g.width * 0.62;
      hand = ' style="top:' + px(g.top + g.height * 0.45) + ';left:' + px(x) + ';inset-inline-start:auto"';
    }
    st.el.setAttribute('data-step', String(s));
    st.el.innerHTML = dim + (rb ? '<span class="wqw-ring" style="top:' + px(rb.top) + ';left:' + px(rb.left) + ';width:' + px(rb.width) + ';height:' + px(rb.height) + '"></span>' : '') +
      '<div class="wqw-top" style="top:' + topRow() + 'px"><button type="button" class="wqw-skip" data-ww="skip" aria-label="' + esc(st.t.skip) + '">' + SKIP + '<span>' + esc(st.t.skip) + '</span></button></div>' +
      '<div class="wqw-stage' + (hole ? ' wqw-at-next' : '') + '"' + stage + '>' +
      '<button type="button" class="wqw-jug' + (s === 1 ? ' wqw-call' : '') + '" data-ww="jugnu" aria-label="' + esc(st.t.hiShort) + '"><img src="/wq/jugnu/hello.webp" alt="" width="72" height="72"></button>' +
      '<p class="wqw-cap" aria-live="polite">' + esc(cap || '') + '</p></div>' +
      '<span class="wqw-hand wqw-on-' + (hole ? 'next' : 'jug') + (extra || '') + '"' + hand + '>' + HAND + '</span>';
  }
  function go(n) {
    clear();
    st.step = n;
    if (!st.replay) st.ev('welcome_step', { step: n, ms_since_shown: Math.max(0, Math.round(now() - st.at)) });
    var t = st.t;
    if (n === 1) {
      draw('');
      // nothing happens for 6 s: the hand grows; step 1 never times out
      later(function () { draw('', ' wqw-big'); }, 6000);
      return;
    }
    if (n === 2) {
      var short = st.form === 'short';
      draw(short ? t.hiShort : t.hi);
      voice(short ? '2s' : '2');
      later(function () { go(short ? 4 : 3); }, 3000);
      return;
    }
    if (n === 3) {
      draw(t.lands);
      voice('3');
      var lands = st.root.querySelectorAll('.wqa-stop');
      if (!lands || !lands.length) lands = st.root.querySelectorAll('.wq-door');
      Array.prototype.forEach.call(lands || [], function (l, i) {
        later(function () { l.classList.add('wqw-lit'); draw(t.lands, '', rectOf(l)); }, i * 1000);
        later(function () { l.classList.remove('wqw-lit'); }, i * 1000 + 1000);
      });
      later(function () { go(4); }, 4000);
      return;
    }
    if (n === 4) {
      st.next.classList.add('wqw-up');
      reveal();
      draw(t.stop);
      voice('4');
      if (st.replay) { later(function () { end('idle'); }, 5000); return; }
      later(function () { draw(t.nudge, ' wqw-big'); voice('4n'); }, 8000);
      later(function () { end('idle'); }, 28000);
    }
  }
  // step 1's tap: the sound is unlocked (this tap is the first gesture), the kit's giggle, then who I am
  function hello() {
    st.unlocked = true;
    try { if (window.WQJ && !st.muted() && typeof window.WQJ.giggle === 'function') window.WQJ.giggle(); } catch (e) {}
    go(2);
  }
  function letsGo() { if (st) end('letsgo'); }
  function end(via) {
    if (!st) return;
    var s = st;
    clear();
    s.next.removeEventListener('click', letsGo, true);
    s.next.classList.remove('wqw-up');
    if (s.pushed) s.next.style.marginTop = '';
    if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
    st = null;
    if (s.replay) return;
    // step 5's hint: the page this Let's go opens is the child's first activity (w=1; wq-tel.js -> wq-cue.js there),
    // with the recorded voice's path when the welcome named one
    if (via === 'letsgo') hint(s);
    var outcome = via === 'skip' ? 'skipped' : 'done';
    keep(s.B.kid, s.w.v, outcome);
    if (s.form === 'full') put(DEV, '1');
    post(s.ctx, s.B.kid, outcome);
    var ms = Math.max(0, Math.round(now() - s.at));
    if (via === 'skip') s.ev('welcome_skip', { at_step: s.step });
    else s.ev('welcome_done', { via: via, ms_since_shown: ms });
    // Skip or idle: the Next stop pulses once (2 s), then the home is today's home
    if (via !== 'letsgo') {
      s.next.classList.add('wqw-pulse');
      setTimeout(function () { s.next.classList.remove('wqw-pulse'); }, 2000);
    }
  }

  function hint(s) {
    var href = s.next.getAttribute ? s.next.getAttribute('href') : null;
    if (typeof href === 'string' && href.charAt(0) === '/' && !/[?&]w=1(&|#|$)/.test(href)) {
      var i = href.indexOf('#');
      var path = i >= 0 ? href.slice(0, i) : href;
      s.next.setAttribute('href', path + (path.indexOf('?') >= 0 ? '&' : '?') + 'w=1' + (i >= 0 ? href.slice(i) : ''));
    }
    try { if (typeof s.w.voice === 'string' && s.w.voice) sessionStorage.setItem('wq.welcome.voice', s.w.voice); } catch (e) {}
  }

  window.WQW = { start: start, replay: replay, up: function () { return Boolean(st); }, COPY: COPY, _reset: function () { st = null; } };
})();
