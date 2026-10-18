/*
 * The live reading meter (window.WQPace). Loaded by a page only when the bot says so (the read payload's / menu's
 * `pace`, app_settings web_quiz_live_meter). Without it the reader keeps Jugnu's glow, unchanged.
 *
 *   full(grade)              the pace (words read right a minute) that fills the meter: G1–2 35, G3 50, G4–5 60; an
 *                            unknown grade is G1–2's (the kinder scale). The bands' 4th light, so most children fill it.
 *   step(s, now, words, o)   the meter's state after `words` newly read words at `now` (ms): a leaky count of the words
 *                            read right, each one decaying over o.tau (6 s). A word lifts it at once, a pause lets it
 *                            fall gently. → { e, at, level 0–1 }. Pure: no DOM, no clock.
 *   mount(el, o)             draws the meter into el: o.variant 'sky' (a bar along the top, Jugnu riding its tip past
 *                            5 stars) or 'vine' (a glowing vine up the side, Jugnu climbing it past 5 leaves); o.grade,
 *                            o.keep (an object that holds the state across redraws).
 *                            → { word(n), stop(), destroy(), level() }. word(n) is called with the words newly lit.
 *   variant / grade          the page's meter, from its own script tag (data-meter, data-grade; the edge writes them)
 * Never a number on screen and never "slower": the speed stays a picture. Only words read right move it (a skipped
 * word never does), so racing past words cannot fill it.
 */
(function () {
  'use strict';
  var TAU = 6000;
  var FULL = { lo: 35, mid: 50, hi: 60 };
  var MARKS = [0.2, 0.4, 0.6, 0.8, 1];

  function full(grade) {
    var g = Number(String(grade == null ? '' : grade).replace(/\D/g, ''));
    return !(g >= 3) ? FULL.lo : g === 3 ? FULL.mid : FULL.hi;
  }
  function step(s, now, words, o) {
    var tau = (o && o.tau) || TAU;
    var cap = full(o && o.grade) / 60000 * tau;   // the leaky count at a steady full pace
    var e = s && s.at != null ? s.e * Math.exp(-Math.max(0, now - s.at) / tau) : 0;
    e += Math.max(0, words || 0);
    return { e: e, at: now, level: Math.min(1, e / cap) };
  }

  function el(tag, cls, html) { var x = document.createElement(tag); x.className = cls; if (html) x.innerHTML = html; return x; }
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5-4.9-4.6 6.6-.8z"/></svg>';
  var LEAF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21C3 11 9 4 21 3c0 11-7 18-18 18z"/></svg>';

  function mount(root, o) {
    o = o || {};
    var variant = o.variant === 'vine' ? 'vine' : 'sky';
    var box = el('div', 'wqp wqp-' + variant);
    box.setAttribute('aria-hidden', 'true');
    box.setAttribute('data-level', '0');
    var track = el('div', 'wqp-track');
    var fill = el('i', 'wqp-fill');
    var rider = el('b', 'wqp-rider', '<img src="/wq/jugnu/idle.webp" alt="" width="40" height="40" decoding="async">');
    var marks = MARKS.map(function (m, i) {
      var k = el('em', 'wqp-mark', variant === 'vine' ? LEAF : STAR);
      k.style.setProperty('--at', (m * 100) + '%');
      k.setAttribute('data-i', String(i));
      track.appendChild(k);
      return k;
    });
    track.appendChild(fill); track.appendChild(rider); box.appendChild(track);
    root.appendChild(box);

    var keep = o.keep || {};   // the state lives here, so a redrawn screen mounts the same meter where it was
    var s = keep.s || null, shown = keep.shown || 0, raf = 0, stopped = false, top = 0;
    var now = o.now || function () { return Date.now(); };
    function target() { return s ? step(s, now(), 0, o).level : 0; }
    function paint() {
      raf = 0;
      var t = stopped ? shown : target();
      shown += (t - shown) * (t > shown ? 0.45 : 0.12);   // rises quickly with a word, falls gently in a pause
      if (Math.abs(t - shown) < 0.002) shown = t;
      keep.shown = shown;
      var pct = Math.round(shown * 1000) / 10;
      box.style.setProperty('--lv', String(shown));
      fill.style[variant === 'vine' ? 'height' : 'width'] = pct + '%';
      var lit = 0;
      marks.forEach(function (k, i) { var on = shown >= MARKS[i] - 0.001; if (on) lit = i + 1; k.classList.toggle('on', on); });
      if (lit > top) { top = lit; marks[lit - 1].classList.remove('pop'); void marks[lit - 1].offsetWidth; marks[lit - 1].classList.add('pop'); }
      if (lit < top) top = lit;
      box.setAttribute('data-level', String(lit));
      box.classList.toggle('wqp-full', shown >= 0.999);
      if (!stopped && (shown > 0.001 || t > 0)) raf = requestAnimationFrame(paint);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(paint); }
    if (s || shown) kick();
    return {
      word: function (n) {
        if (stopped || !(n > 0)) return;
        s = keep.s = step(s, now(), n, o);
        rider.classList.remove('hop'); void rider.offsetWidth; rider.classList.add('hop');
        kick();
      },
      level: function () { return shown; },
      stop: function () { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; box.classList.add('wqp-done'); },
      destroy: function () { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; if (box.parentNode) box.parentNode.removeChild(box); }
    };
  }

  var me = typeof document !== 'undefined' && document.currentScript;
  var mv = me && me.getAttribute ? me.getAttribute('data-meter') : null;
  window.WQPace = { full: full, step: step, mount: mount, TAU: TAU,
    variant: mv === 'sky' || mv === 'vine' ? mv : null, grade: me && me.getAttribute ? me.getAttribute('data-grade') : null };
})();
