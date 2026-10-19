/*
 * The live reading meter (window.WQPace). Loaded by a page only when the bot says so (the read payload's / menu's
 * `pace`, app_settings web_quiz_live_meter). Without it the reader keeps Jugnu's glow, unchanged.
 *
 *   full(grade)              the pace (words read right a minute) that fills the meter: G1–2 35, G3 50, G4–5 60; an
 *                            unknown grade is G3's (the middle, never the easiest). The bands' 4th light.
 *   step(s, now, words, o)   the meter's state after `words` newly read words at `now` (ms); step(null, t0, 0) starts a
 *                            read. The level is a SUSTAINED pace against the grade's: the words read right in the last
 *                            20 s (each lit phrase spread over the time it took to say) over what a reader at the
 *                            grade's pace reads in that time (never under 12 s, so the first phrase cannot fill it).
 *                            Between two lit phrases it holds (4.5 s: the recogniser lights a phrase at its end); a
 *                            longer pause lets it fall. It rises at most 0.12 a second (8 s from empty to full) and
 *                            falls at most 0.2 a second.
 *                            → { t0, ev, lv, at, level 0–1 }. Pure: no DOM, no clock.
 *   mount(el, o)             draws the meter into el: o.variant 'sky' (a bar along the top, Jugnu riding its tip past
 *                            5 stars) or 'vine' (a glowing vine up the side, Jugnu climbing it past 5 leaves); o.grade,
 *                            o.keep (an object that holds the state across redraws, and across the pages of one book:
 *                            the clock stops while the meter is stopped or gone). The read starts at the first mount.
 *                            → { word(n), stop(), destroy(), level() }. word(n) is called with the words newly lit.
 *   variant / grade          the page's meter, from its own script tag (data-meter, data-grade; the edge writes them)
 * Never a number on screen and never "slower": the speed stays a picture. Only words read right move it (a skipped
 * word never does), so racing past words cannot fill it.
 */
(function () {
  'use strict';
  var WIN = 20000;      // the window the pace is read over
  var SPAN_MIN = 12000; // the shortest time a pace is judged on
  var HOLD = 4500;      // the wait for the next lit phrase before a pause counts
  var SAY_MS = 3000;    // a lit phrase is spread back over the time since the last one, at most this a word
  var RISE = 0.12, FALL = 0.2;   // the most it moves a second
  var FULL = { lo: 35, mid: 50, hi: 60 };
  var MARKS = [0.2, 0.4, 0.6, 0.8, 1];

  function full(grade) {
    var g = Number(String(grade == null ? '' : grade).replace(/\D/g, ''));
    return !(g >= 1) ? FULL.mid : g <= 2 ? FULL.lo : g === 3 ? FULL.mid : FULL.hi;
  }
  // the words said inside (now - WIN, now]: a phrase [from, to, n] counts by the share of its time inside
  function said(ev, now) {
    var n = 0, lo = now - WIN;
    ev.forEach(function (e) { var d = e[1] - e[0]; n += d > 0 ? e[2] * Math.max(0, Math.min(e[1], now) - Math.max(e[0], lo)) / d : e[1] > lo ? e[2] : 0; });
    return n;
  }
  function step(s, now, words, o) {
    s = s && s.ev ? s : { t0: now, ev: [], lv: 0, at: now };
    var ev = s.ev.filter(function (e) { return e[1] > now - WIN - HOLD; });
    var w = Math.max(0, words || 0);
    if (w) {
      var last = ev.length ? ev[ev.length - 1][1] : s.t0;
      ev.push([Math.max(last, now - w * SAY_MS, s.t0), now, w]);
    }
    // judged up to the last lit phrase while the next may still be on its way; 5 % short of the grade's pace still fills it
    var end = Math.min(now, Math.max(ev.length ? ev[ev.length - 1][1] : s.t0, now - HOLD));
    var cap = full(o && o.grade) / 60000 * Math.min(WIN, Math.max(SPAN_MIN, end - s.t0)) * 0.95;
    var raw = Math.min(1, said(ev, end) / cap), dt = Math.max(0, now - s.at) / 1000;
    var lv = raw > s.lv ? Math.min(raw, s.lv + RISE * dt) : Math.max(raw, s.lv - FALL * dt);
    return { t0: s.t0, ev: ev, lv: lv, at: now, level: lv };
  }

  // the read's clock moved on by d ms while no one was reading (between pages): every time in it moves with it
  function shift(s, d) {
    return d > 0 ? { t0: s.t0 + d, ev: s.ev.map(function (e) { return [e[0] + d, e[1] + d, e[2]]; }), lv: s.lv, at: s.at + d, level: s.lv } : s;
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
    var now = o.now || function () { return Date.now(); };
    var s = keep.s ? shift(keep.s, keep.off != null ? now() - keep.off : 0) : step(null, now(), 0, o), shown = keep.shown || 0, raf = 0, stopped = false, top = 0;
    keep.s = s; keep.off = null;
    function target() { s = keep.s = step(s, now(), 0, o); return s.level; }
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
    kick();
    return {
      word: function (n) {
        if (stopped || !(n > 0)) return;
        s = keep.s = step(s, now(), n, o);
        rider.classList.remove('hop'); void rider.offsetWidth; rider.classList.add('hop');
        kick();
      },
      level: function () { return shown; },
      stop: function () { if (!stopped) keep.off = now(); stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; box.classList.add('wqp-done'); },
      destroy: function () { if (!stopped) keep.off = now(); stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; if (box.parentNode) box.parentNode.removeChild(box); }
    };
  }

  var me = typeof document !== 'undefined' && document.currentScript;
  var mv = me && me.getAttribute ? me.getAttribute('data-meter') : null;
  window.WQPace = { full: full, step: step, mount: mount, WIN: WIN,
    variant: mv === 'sky' || mv === 'vine' ? mv : null, grade: me && me.getAttribute ? me.getAttribute('data-grade') : null };
})();
