/* The child welcome's last cue (app_settings web_quiz_child_welcome; design/ftue_child/DESIGN.md step 5): the page the
 * welcome's Let's go opened carries ?w=1 (wq-welcome.js), and wq-tel.js loads this file there. ONCE, it points the hand
 * at that page's own first control (the lesson's play, else its primary, else the first answer) with "Your turn. Tap
 * here!" (the native read's final), for 6 s or until the first tap anywhere. The address forgets w=1 at once, so a
 * reload or a later visit never shows it again. The voice: the welcome's recorded clip welcome-5 under the path the
 * welcome named (sessionStorage), with the sound on; else none. Never the phone's own voice. Nothing to point at in
 * 10 s: nothing shows. Only a label: it never takes a tap. */
(function () {
  'use strict';
  var COPY = { en: 'Your turn. Tap here!', ur: 'اب آپ کی باری! یہاں دبائیں۔' };
  window.WQCUE = { COPY: COPY };
  var search = String((typeof location !== 'undefined' && location.search) || '');
  if (!/[?&]w=1(&|$)/.test(search)) return;
  var PICK = ['.wq-vcover', '[data-primary]', '.wq-opt', '.wq-btn.wq-go'];
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
  function target() {
    for (var i = 0; i < PICK.length; i++) {
      var e = null;
      try { e = document.querySelector(PICK[i]); } catch (x) { e = null; }
      var r = e && e.getBoundingClientRect ? e.getBoundingClientRect() : null;
      if (r && r.width > 0 && r.height > 0) return r;
    }
    return null;
  }
  // Where the bubble goes (design-qa S5-1): in the free band nearest the pointed control, over nothing a child could tap
  // (an answer, a button, a link, the lesson's rows), never over the control itself; no free band: over the pointed
  // control's top only.
  var OBS = 'button, a[href], [data-primary], .wq-opt, input, select, textarea, video, [role="button"], [data-tap], .wq-how li';
  function capTop(r, h, vh) {
    var iv = [[0, 8], [vh - 8, vh], [r.top, r.bottom]];
    try {
      Array.prototype.forEach.call(document.querySelectorAll(OBS), function (e) {
        if (e.closest && e.closest('.wqc')) return;
        var b = e.getBoundingClientRect();
        if (b && b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < vh) iv.push([b.top, b.bottom]);
      });
    } catch (x) { /* only the edges and the control */ }
    iv.sort(function (a, b) { return a[0] - b[0]; });
    var best = null, end = iv[0][1];
    for (var i = 1; i < iv.length; i++) {
      var g0 = end, g1 = iv[i][0];
      if (g1 - g0 >= h + 16) {
        var above = g1 <= r.top;
        var d = above ? r.top - g1 : g0 - r.bottom;
        if (d >= 0 && (!best || d < best.d)) best = { d: d, top: above ? g1 - 8 - h : g0 + 8 };
      }
      end = Math.max(end, iv[i][1]);
    }
    return best ? best.top : r.top + 8;
  }
  function hide() {
    if (!el) return;
    try { document.removeEventListener('pointerdown', hide, true); } catch (e) {}
    if (el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }
  function voice() {
    var base = null;
    try { base = sessionStorage.getItem('wq.welcome.voice'); sessionStorage.removeItem('wq.welcome.voice'); } catch (e) { base = null; }
    var off = false;
    try { off = localStorage.getItem('wq_snd') === '0' || localStorage.getItem('wq_sound') === 'false'; } catch (e) { off = false; }
    if (!base || off || !/^\/wq\/[A-Za-z0-9/_.-]+\/$/.test(base) || typeof Audio !== 'function') return;
    try { var a = new Audio(base + 'welcome-5.mp3'); var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* the line carries it */ }
  }
  function show(r) {
    done = true;
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
    var top = capTop(r, ph > 0 ? ph : 60, vh);
    var hs = '<span class="wqc-hand" style="' + hand + '">' + HAND + '</span>';
    el.innerHTML = hs + '<p class="wqc-cap" style="top:' + px(top) + '">' + esc(COPY[ur ? 'ur' : 'en']) + '</p>';
    try { document.addEventListener('pointerdown', hide, true); } catch (e) {}
    setTimeout(hide, 6000);
    voice();
    try { if (window.WQT && typeof window.WQT.push === 'function') window.WQT.push({ n: 'welcome_step', step: 5, ms_since_shown: 0 }); } catch (e) {}
  }
  // the page draws its first screen after its own answer comes back: look every 300 ms, for 10 s at most
  (function look() {
    if (done) return;
    var r = target();
    if (r) return show(r);
    if (Date.now() - t0 < 10000) setTimeout(look, 300);
  })();
})();
