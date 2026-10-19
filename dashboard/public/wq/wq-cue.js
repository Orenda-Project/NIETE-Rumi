/* The child welcome's last cue (app_settings web_quiz_child_welcome; design/ftue_child/DESIGN.md step 5): the page the
 * welcome's Let's go opened carries ?w=1 (wq-welcome.js), and wq-tel.js loads this file there. ONCE, it points the hand
 * at that page's own first control (the lesson's play button; on a question its listen button, never an answer, else
 * nothing at all; else the page's primary) with "Your turn. Tap
 * here!" (the native read's final), for 6 s or until the first tap anywhere. The address forgets w=1 at once, so a
 * reload or a later visit never shows it again. The voice: the welcome's recorded clip welcome-5 (at its folder's ?v=) under the path the
 * welcome named (sessionStorage), with the sound on; else none. Never the phone's own voice. Nothing to point at in
 * 10 s: nothing shows. Only a label: it never takes a tap. */
(function () {
  'use strict';
  var COPY = { en: 'Your turn. Tap here!', ur: 'اب آپ کی باری! یہاں دبائیں۔' };
  window.WQCUE = { COPY: COPY };
  var search = String((typeof location !== 'undefined' && location.search) || '');
  if (!/[?&]w=1(&|$)/.test(search)) return;
  var HAND = '<svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true"><path fill="#FFE0B2" stroke="#5D4037" stroke-width="2.5" stroke-linejoin="round" d="M19 6a4 4 0 0 1 4 4v14l2-1a4 4 0 0 1 5 2l1 1a4 4 0 0 1 5 2v1a4 4 0 0 1 5 3v7c0 6-5 11-11 11h-4c-4 0-7-2-9-5l-7-11a4 4 0 0 1 6-5l2 2V10a4 4 0 0 1 1-4z"/></svg>';
  var CSS = '.wqc{position:fixed;inset:0;z-index:1002;pointer-events:none;overflow:hidden}' +
    '.wqc-hand{position:absolute;animation:wqc-tap 1.1s ease-in-out infinite}.wqc[dir=rtl] .wqc-hand{transform:scaleX(-1)}' +
    '.wqc-cap{position:absolute;inset-inline:16px;margin:0 auto;max-width:calc(100vw - 32px);padding:10px 16px;border-radius:18px;background:#fff;color:#1E2A4A;font-weight:800;font-size:18px;line-height:1.4;text-align:center;text-wrap:balance;box-shadow:0 4px 18px rgba(10,18,40,.25)}' +
    '.wqc[dir=rtl] .wqc-cap{font-family:var(--fu,inherit);font-weight:400;font-size:20px;line-height:2}' +
    '@keyframes wqc-tap{0%,100%{translate:0 0}50%{translate:0 10px}}@keyframes wqc-fade{0%,100%{opacity:1}50%{opacity:.45}}' +
    '@media (prefers-reduced-motion:reduce){.wqc-hand{animation:wqc-fade 1.4s ease-in-out infinite}}';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function px(n) { return Math.round(Number(n) || 0) + 'px'; }
  // the address without w=1 (the rest, and the #fragment, as they were)
  try {
    var keep = search.replace(/^\?/, '').split('&').filter(function (p) { return p && p !== 'w=1'; });
    history.replaceState(history.state, '', location.pathname + (keep.length ? '?' + keep.join('&') : '') + (location.hash || ''));
  } catch (e) {}
  var t0 = Date.now(), el = null, done = false;
  function vis(sel) {
    var e = null;
    try { e = document.querySelector(sel); } catch (x) { e = null; }
    var r = e && e.getBoundingClientRect ? e.getBoundingClientRect() : null;
    return r && r.width > 0 && r.height > 0 ? r : null;
  }
  // What the hand may point at (design-qa S5-2, S5-3; the live walk). Never an answer: on any question (a quiz item, a
  // game's item, the "is someone helping you today?" self-report) only the question's own listen button, else step 5 is
  // skipped (no hand, no bubble). The lesson video: its play button, never the scrubber. Any other first screen: its
  // primary. -> {r, kind} | {skip: true} | null (nothing drawn yet)
  function target() {
    var play = vis('.wq-vplay');
    if (play) return { r: play, kind: 'play' };
    var asks = vis('.wq-opt') || vis('[data-screen="help-ask"]') || vis('[data-screen$="-play"]') || vis('.wqc-opts');
    if (asks) {
      var spk = vis('#wq-spk') || vis('.wq-qcard .wq-spk') || vis('#wqc-hear');
      return spk ? { r: spk, kind: 'listen' } : { skip: true };
    }
    var p = vis('[data-primary]') || vis('.wq-btn.wq-go');
    return p ? { r: p, kind: 'primary' } : null;
  }
  // Where the bubble goes (design-qa S5-1 to S5-4): right next to its own target, directly above or below it within
  // 8–24 px, so "Tap here" reads as that control and never as another: it is never nearer to another button than to its
  // target. It covers no other answer or button, never the question's text; the lesson's rows only when nothing else is
  // free. What holds the target (the question card, the video's frame and cover) it overlaps only as much as being next
  // to the target takes, the least of all the places it could go.
  var TAP = ['button', 'a[href]', '[data-primary]', '.wq-opt', 'input', 'select', 'textarea', '[role="button"]', '[data-tap]'];
  var TEXT = ['.wq-qtext'];
  var HOLD = ['.wq-vbox', 'video', '.wq-qcard'];
  var ROWS = ['.wq-how li'];
  function rects(sels, vh) {
    var out = [];
    sels.forEach(function (sel) {
      var list = [];
      try { list = document.querySelectorAll(sel) || []; } catch (x) { list = []; }
      Array.prototype.forEach.call(list, function (e) {
        if (e.closest && e.closest('.wqc')) return;
        var b = e.getBoundingClientRect ? e.getBoundingClientRect() : null;
        if (b && b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < vh) out.push(b);
      });
    });
    return out;
  }
  function holds(o, t) { return o.top <= t.top && o.bottom >= t.bottom && o.left <= t.left && o.right >= t.right; }
  function same(o, t) { return Math.abs(o.top - t.top) < 1 && Math.abs(o.bottom - t.bottom) < 1 && Math.abs(o.left - t.left) < 1 && Math.abs(o.right - t.right) < 1; }
  function over(a, b) { return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) * (a.left < b.right && b.left < a.right ? 1 : 0); }
  function dist(a, b) { return Math.max(0, b.top - a.bottom, a.top - b.bottom, b.left - a.right, a.left - b.right); }
  function capTop(t, h, vh) {
    var r = t.r, vw = window.innerWidth || 360;
    var taps = rects(TAP, vh), text = rects(TEXT, vh), hold = rects(HOLD, vh), rows = rects(ROWS, vh);
    var own = taps.filter(function (o) { return holds(o, r); });       // the target's own control (the video's cover)
    var others = taps.filter(function (o) { return !holds(o, r) && !same(o, r); });
    hold = hold.concat(own);
    var best = null;
    [8, 12, 16, 20, 24].forEach(function (g) {
      [r.top - g - h, r.bottom + g].forEach(function (top) {
        if (top < 8 || top + h > vh - 8) return;
        var b = { top: top, bottom: top + h, left: 16, right: vw - 16 };
        var d = dist(b, r);
        // never nearer to another button than to its target, never over another button or answer, never the question text
        if (others.some(function (o) { return over(b, o) > 0 || dist(b, o) <= d; }) || text.some(function (o) { return over(b, o) > 0; })) return;
        var cost = hold.reduce(function (n, o) { return n + over(b, o); }, 0) + rows.reduce(function (n, o) { return n + 1000 * (over(b, o) > 0 ? 1 : 0); }, 0) + g / 100;
        if (!best || cost < best.cost) best = { cost: cost, top: top };
      });
    });
    return best ? best.top : null;
  }
  function hide() {
    if (!el) return;
    try { document.removeEventListener('pointerdown', hide, true); } catch (e) {}
    if (el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }
  function voice() {
    var base = null, v = null;
    try { base = sessionStorage.getItem('wq.welcome.voice'); v = sessionStorage.getItem('wq.welcome.voice_v'); sessionStorage.removeItem('wq.welcome.voice'); sessionStorage.removeItem('wq.welcome.voice_v'); } catch (e) { base = null; }
    var off = false;
    try { off = localStorage.getItem('wq_snd') === '0' || localStorage.getItem('wq_sound') === 'false'; } catch (e) { off = false; }
    if (!base || off || !/^\/wq\/[A-Za-z0-9/_.-]+\/$/.test(base) || typeof Audio !== 'function') return;
    try { var a = new Audio(base + 'welcome-5.mp3' + (v && /^[0-9a-f]{6,16}$/.test(v) ? '?v=' + v : '')); var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* the line carries it */ }
  }
  function show(t) {
    done = true;
    var r = t.r;
    var ur = document.documentElement && document.documentElement.lang === 'ur';
    var vh = window.innerHeight || 640, vw = window.innerWidth || 360;
    var hx = ur ? r.left + r.width * 0.2 : r.left + r.width * 0.6;
    var hand = 'top:' + px(r.top + r.height * 0.5) + ';left:' + px(Math.min(Math.max(16, hx), vw - 72));
    try { var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); } catch (e) {}
    el = document.createElement('div');
    el.setAttribute('class', 'wqc');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('dir', ur ? 'rtl' : 'ltr');
    el.setAttribute('lang', ur ? 'ur' : 'en');
    el.innerHTML = '<span class="wqc-hand" style="' + hand + '">' + HAND + '</span><p class="wqc-cap" style="top:0;visibility:hidden">' + esc(COPY[ur ? 'ur' : 'en']) + '</p>';
    document.body.appendChild(el);
    // the bubble's own height once drawn (one Urdu line is taller than an English one), else the tallest it gets
    var p = el.querySelector ? el.querySelector('.wqc-cap') : null;
    var ph = p && p.getBoundingClientRect ? p.getBoundingClientRect().height : 0;
    var top = capTop(t, ph > 0 ? ph : 60, vh);
    // nowhere next to its target without standing nearer to another control: the hand alone
    if (top == null) { el.innerHTML = '<span class="wqc-hand" style="' + hand + '">' + HAND + '</span>'; }
    var hs = '<span class="wqc-hand" style="' + hand + '">' + HAND + '</span>';
    if (top != null) el.innerHTML = hs + '<p class="wqc-cap" style="top:' + px(top) + '">' + esc(COPY[ur ? 'ur' : 'en']) + '</p>';
    try { document.addEventListener('pointerdown', hide, true); } catch (e) {}
    setTimeout(hide, 6000);
    voice();
    try { if (window.WQT && typeof window.WQT.push === 'function') window.WQT.push({ n: 'welcome_step', step: 5, ms_since_shown: 0 }); } catch (e) {}
  }
  // the page draws its first screen after its own answer comes back: look every 300 ms, for 10 s at most
  (function look() {
    if (done) return;
    var t = target();
    if (t && t.skip) { done = true; return; } // a question with no listen button: step 5 is skipped, never an answer
    if (t) return show(t);
    if (Date.now() - t0 < 10000) setTimeout(look, 300);
  })();
})();
