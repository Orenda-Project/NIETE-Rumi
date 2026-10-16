/*
 * WQJ: the sound + motion kit every child screen calls (wq-juice.js + wq-juice.css; sprite /wq/snd/juice-1.opus).
 * The edge loads it only when the page payload carries `juice: true` (app_settings web_quiz_juice, default off).
 * With it absent nothing changes, so every caller writes `if (window.WQJ) WQJ.x(...)` and keeps today's path otherwise.
 *
 *   WQJ.tap()                     unlocks the sound (also done by itself on the first tap anywhere on the page)
 *   WQJ.correct({el})             chime C6→G6 220 ms; el pops; counts the run of right answers (strip at 3 / 5 / 10)
 *   WQJ.wrong({el})               soft bup E5→D5 120 ms; el wobbles ±3 px 240 ms; the run starts again; no buzz
 *   WQJ.word({i, ok})             live reading: a tink E6→G6 90 ms per word read, never more than one per 150 ms
 *   WQJ.sentence()                arpeggio C6-E6-G6 220 ms (also the day-dot's sound)
 *   WQJ.streak(n, at)             the strip at n = 3 / 5 / 10 after the element `at` (other n: nothing)
 *   WQJ.finish({el, kind})        card up at +300 ms (400 ms), its stars one by one over 900 ms, confetti 24 × 1.6 s,
 *                                 fanfare ≤ 1.8 s from the sprite (a synthesised one until the sprite is in)
 *   WQJ.badge(el) / WQJ.dayDot(el) sticker jingle 2.0 s + 0.6→1.15→1.0 spring; the day-dot fills 300 ms + ring 200 ms
 *   WQJ.mic(on)                   the microphone window: every sound but the word tink is held back; the tink at half
 *   WQJ.after(ms, fn)             a timer that stopAll() cancels (the right-answer auto-advance)
 *   WQJ.muted() / WQJ.mute(b)     the page's ONE sound switch (localStorage wq_sound, the quiz page's; wq_snd, the home's)
 *   WQJ.toggle(btn)               wires a ≥ 48 px sound button to that switch
 *   WQJ.stopAll()                 every sound, timer and animation stops; runs by itself on pagehide, hidden, freeze
 *   WQJ.pop / wobble / fly / confetti   the motion helpers
 * prefers-reduced-motion: every move is a 150 ms fade; colour and sound stay. Muted: no audio node is ever made.
 */
(function (W) {
  'use strict';
  if (!W || W.WQJ) return;
  var D = W.document;
  var C6 = 1046.5, D5 = 587.33, E5 = 659.25, E6 = 1318.51, G6 = 1567.98, C7 = 2093, G7 = 3135.96;
  // [start s, length s, Hz, Hz at the end (glide), wave, gain]
  var R = {
    correct: [[0, 0.11, C6, C6, 'sine', 0.6], [0, 0.11, C6, C6, 'triangle', 0.2], [0.09, 0.13, G6, G6, 'sine', 0.6], [0.09, 0.13, G6, G6, 'triangle', 0.2]],
    wrong: [[0, 0.12, E5, D5, 'triangle', 0.35]],
    word: [[0, 0.045, E6, E6, 'sine', 0.5], [0.04, 0.05, G6, G6, 'sine', 0.5]],
    sentence: [[0, 0.08, C6, C6, 'sine', 0.6], [0.07, 0.08, E6, E6, 'sine', 0.6], [0.14, 0.08, G6, G6, 'sine', 0.6]],
    s3: [[0, 0.11, C7, C7, 'sine', 0.12], [0.09, 0.13, G7, G7, 'sine', 0.12]],
    s5: [[0.2, 0.12, 1318.51 * 2, 1318.51 * 2, 'sine', 0.3]],
    s10: [[0, 0.6, C6, C6, 'sine', 0.25], [0, 0.6, E6, E6, 'sine', 0.25], [0, 0.6, G6, G6, 'sine', 0.25],
      [0.05, 0.08, C7 * 2, C7 * 2, 'sine', 0.12], [0.2, 0.08, G7, G7, 'sine', 0.12], [0.35, 0.08, C7 * 2, C7 * 2, 'sine', 0.12], [0.5, 0.1, G7, G7, 'sine', 0.12]],
    // fallbacks until the sprite has decoded: a short major fanfare (1.8 s) and the sticker jingle (2.0 s)
    fanfare: [[0, 0.15, 523.25, 523.25, 'triangle', 0.5], [0.15, 0.15, 659.25, 659.25, 'triangle', 0.5], [0.3, 0.15, 783.99, 783.99, 'triangle', 0.5],
      [0.45, 1.35, C6, C6, 'triangle', 0.5], [0.45, 1.35, E6, E6, 'sine', 0.25], [0.45, 1.35, G6, G6, 'sine', 0.25]],
    badge: [[0, 0.25, G6, G6, 'sine', 0.4], [0.25, 0.25, E6, E6, 'sine', 0.4], [0.5, 0.25, G6, G6, 'sine', 0.4], [0.75, 1.25, C7, C7, 'sine', 0.4]]
  };
  // the sprite: [offset s, length s]
  var SPRITE = '/wq/snd/juice-1.opus', SP = { fanfare: [0, 1.8], badge: [2, 2], giggle: [4.2, 0.6] };
  var KEY = 'wq_sound', KEY2 = 'wq_snd', WORD_MS = 150, PER_MIN = 30, MAX_ANIM = 3;

  var ac = null, live = [], timers = [], anims = [], sent = [], lastWord = -1e9, duck = false, run = 0;
  var sprite = null, spriteAsk = null, abort = null;
  function now() { return W.performance && W.performance.now ? W.performance.now() : Date.now(); }
  function store() { try { return W.localStorage; } catch (e) { return null; } }
  // one switch for the child, two keys on the phone: the quiz page's own (wq_sound, JSON) and the home's (wq_snd, '1'/'0')
  function get(k) { var s = store(); try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function muted() { return get(KEY) === 'false' || get(KEY2) === '0'; }
  function mute(b) {
    var s = store();
    try { if (s) { s.setItem(KEY, b ? 'false' : 'true'); s.setItem(KEY2, b ? '0' : '1'); } } catch (e) {}
    if (b) stopAll();
  }
  function hidden() { return D && D.visibilityState === 'hidden'; }
  function calm() { try { return !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function buzz(p) { try { if (W.navigator && W.navigator.vibrate) W.navigator.vibrate(p); } catch (e) {} }

  /* ---------- sound ---------- */
  function ctx() {
    if (ac) return ac;
    var A = W.AudioContext || W.webkitAudioContext;
    if (!A) return null;
    try { ac = new A(); } catch (e) { ac = null; }
    return ac;
  }
  function unlock() {
    if (muted()) return;
    var c = ctx();
    try { if (c && c.state === 'suspended' && c.resume) c.resume(); } catch (e) {}
  }
  // one sound may play: not muted, the page in view, under 30 a minute (word tinks have their own limit)
  function may(kind) {
    if (muted() || hidden()) return false;
    if (kind === 'word') return true;
    if (duck) return false;
    var t = now();
    sent = sent.filter(function (x) { return t - x < 60000; });
    if (sent.length >= PER_MIN) return false;
    sent.push(t);
    return true;
  }
  function notes(list, scale) {
    var c = ctx();
    if (!c) return;
    var t0 = c.currentTime + 0.01;
    list.forEach(function (n) {
      try {
        var o = c.createOscillator(), g = c.createGain(), a = t0 + n[0], z = a + n[1];
        o.type = n[4];
        o.frequency.setValueAtTime(n[2], a);
        if (n[3] !== n[2]) o.frequency.linearRampToValueAtTime(n[3], z);
        g.gain.setValueAtTime(0.0001, a);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, n[5] * (scale || 1)), a + Math.min(0.012, n[1] / 4));
        g.gain.exponentialRampToValueAtTime(0.0001, z);
        o.connect(g); g.connect(c.destination);
        o.start(a); o.stop(z + 0.02);
        live.push(o);
        o.onended = function () { var i = live.indexOf(o); if (i >= 0) live.splice(i, 1); };
      } catch (e) {}
    });
  }
  function play(kind, scale) { if (may(kind)) notes(R[kind], scale); }
  // the sprite is asked for once, on the first right answer, never on page load
  function loadSprite() {
    if (spriteAsk || muted() || !W.fetch) return;
    var c = ctx();
    if (!c || !c.decodeAudioData) return;
    try { abort = W.AbortController ? new W.AbortController() : null; } catch (e) { abort = null; }
    spriteAsk = W.fetch(SPRITE, abort ? { signal: abort.signal } : {}).then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { return new Promise(function (ok, no) { var p = c.decodeAudioData(b, ok, no); if (p && p.then) p.then(ok, no); }); })
      .then(function (buf) { sprite = buf; }, function () { /* the synthesised fallbacks stay */ });
  }
  function clip(name, fallback) {
    if (!may(name)) return;
    var c = ctx();
    if (sprite && c) {
      try {
        var s = c.createBufferSource(), g = c.createGain();
        s.buffer = sprite; g.gain.value = 0.8;
        s.connect(g); g.connect(c.destination);
        s.start(c.currentTime + 0.01, SP[name][0], SP[name][1]);
        live.push(s);
        return;
      } catch (e) {}
    }
    if (fallback) notes(R[fallback]);
  }

  /* ---------- motion ---------- */
  function anim(el, frames, ms, ease, delay) {
    if (!el || !el.animate || anims.length >= MAX_ANIM) return null;
    if (calm()) { frames = [{ opacity: 0.4 }, { opacity: 1 }]; ms = 150; }
    try {
      var a = el.animate(frames, { duration: ms, easing: ease || 'ease-out', delay: delay || 0, fill: 'backwards' });
      anims.push(a);
      a.onfinish = a.oncancel = function () { var i = anims.indexOf(a); if (i >= 0) anims.splice(i, 1); };
      return a;
    } catch (e) { return null; }
  }
  function pop(el) { return anim(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], 200); }
  function wobble(el) {
    return anim(el, [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' },
      { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], 240, 'linear');
  }
  function fly(el, to) {
    if (!el || !to || !el.getBoundingClientRect) return null;
    var a = el.getBoundingClientRect(), b = to.getBoundingClientRect();
    return anim(el, [{ transform: 'translate(0,0) scale(1)' }, { transform: 'translate(' + (b.left - a.left) + 'px,' + (b.top - a.top) + 'px) scale(.4)', opacity: 0.2 }], 500);
  }
  var COLS = ['#58cc02', '#ffc800', '#1cb0f6', '#ff86d0', '#ce82ff'];
  function confetti(n, ms) {
    if (!D || !D.body || !D.createElement || calm() || hidden()) return null;
    var box = D.createElement('div');
    box.className = 'wqj-cf';
    box.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < n; i++) {
      var p = D.createElement('i');
      p.style.left = Math.round((i + 0.5) * 100 / n) + '%';
      p.style.background = COLS[i % COLS.length];
      p.style.animationDuration = ms + 'ms';
      p.style.animationDelay = (i % 6) * 40 + 'ms';
      box.appendChild(p);
    }
    D.body.appendChild(box);
    after(ms + 300, function () { gone(box); });
    return box;
  }
  function gone(el) { try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {} }

  /* ---------- timers ---------- */
  function after(ms, fn) {
    var id = W.setTimeout(function () { var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); fn(); }, ms);
    timers.push(id);
    return id;
  }

  /* ---------- the events ---------- */
  var STRIP = { en: { 3: 'Great!', 5: 'Super!', 10: 'Wow!' }, ur: { 3: 'بہت خوب!', 5: 'زبردست!', 10: 'شاندار!' } };
  function lang() { return D && D.documentElement && D.documentElement.lang === 'ur' ? 'ur' : 'en'; }
  function streak(n, at) {
    var line = STRIP[lang()][n];
    if (!line) return false;
    if (n === 3) play('s3');
    if (n === 5) play('s5');
    if (n === 10) { play('s10'); buzz([20, 40, 20]); }
    if (at && D && D.createElement && at.parentNode) {
      var old = D.getElementById && D.getElementById('wqj-strip');
      gone(old);
      var s = D.createElement('p');
      s.id = 'wqj-strip'; s.className = 'wqj-strip'; s.setAttribute('role', 'status');
      s.textContent = line;
      at.parentNode.insertBefore(s, at.nextSibling);
      anim(s, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], 400);
    }
    return true;
  }
  function correct(o) {
    o = o || {};
    play('correct');
    loadSprite();
    buzz(15);
    pop(o.el);
    if (o.panel) anim(o.panel, [{ transform: 'translateY(24px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], 200);
    run += 1;
    streak(run, o.at);
    return run;
  }
  function wrong(o) {
    o = o || {};
    play('wrong');
    wobble(o.el);
    run = 0;
  }
  function word(o) {
    if (o && o.ok === false) return false;
    var t = now();
    if (t - lastWord < WORD_MS) return false;
    lastWord = t;
    if (!may('word')) return false;
    notes(R.word, duck ? 0.5 : 1);
    return true;
  }
  function sentence() { play('sentence'); buzz(15); }
  function finish(o) {
    o = o || {};
    clip('fanfare', 'fanfare');
    buzz([30, 50, 30, 50, 60]);
    var el = o.el;
    if (el) {
      if (calm()) anim(el, [{ opacity: 0 }, { opacity: 1 }], 150, 'linear', 300);
      else anim(el, [{ transform: 'translateY(48px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], 400, 'ease-out', 300);
      // the stars light one by one after the card is up: 150 ms apart, the whole count within 900 ms
      var st = !calm() && el.querySelectorAll ? el.querySelectorAll('.wq-star.wq-on') : [];
      Array.prototype.forEach.call(st, function (s, i) {
        try { s.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 150, delay: 700 + i * Math.min(150, 750 / st.length), fill: 'backwards' }); } catch (e) {}
      });
    }
    confetti(24, 1600);
    run = 0;
  }
  function badge(el) {
    clip('badge', 'badge');
    buzz(40);
    anim(el, [{ transform: 'scale(.6)' }, { transform: 'scale(1.15)', offset: 0.6 }, { transform: 'scale(1)' }], 600, 'cubic-bezier(.34,1.56,.64,1)');
  }
  function dayDot(el) {
    play('sentence');
    anim(el, [{ transform: 'scale(.5)', opacity: 0.3 }, { transform: 'scale(1)', opacity: 1 }], 300);
    if (el && el.classList) { el.classList.add('wqj-ring'); after(500, function () { el.classList.remove('wqj-ring'); }); }
  }
  function tap() { unlock(); }

  function stopAll() {
    live.splice(0).forEach(function (n) { try { n.stop(0); } catch (e) {} });
    timers.splice(0).forEach(function (id) { try { W.clearTimeout(id); } catch (e) {} });
    anims.splice(0).forEach(function (a) { try { a.cancel(); } catch (e) {} });
    try { if (abort) abort.abort(); } catch (e) {}
    if (!sprite) { spriteAsk = null; abort = null; }
    try { if (ac && ac.state === 'running' && ac.suspend) ac.suspend(); } catch (e) {}
    var cf = D && D.querySelectorAll ? D.querySelectorAll('.wqj-cf') : [];
    Array.prototype.forEach.call(cf, gone);
  }
  // a speaker, with waves (on) or a cross (off): inline SVG, never an emoji (old Android draws new emoji as boxes)
  var SVG_HEAD = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>';
  var SVG_ON = SVG_HEAD + '<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
  var SVG_OFF = SVG_HEAD + '<path d="M16 9l5 6M21 9l-5 6"/></svg>';
  function toggle(btn) {
    if (!btn) return;
    var draw = function () { var m = muted(); btn.setAttribute('aria-pressed', String(!m)); btn.innerHTML = m ? SVG_OFF : SVG_ON; };
    draw();
    btn.addEventListener('click', function () { mute(!muted()); draw(); if (!muted()) unlock(); });
  }

  // the first tap anywhere unlocks the sound (Android and iOS refuse it before a tap)
  if (D && D.addEventListener) {
    D.addEventListener('pointerdown', unlock, true);
    D.addEventListener('touchstart', unlock, true);
    D.addEventListener('keydown', unlock, true);
    D.addEventListener('visibilitychange', function () { if (hidden()) stopAll(); else if (ac) unlock(); });
    D.addEventListener('freeze', stopAll);
    D.addEventListener('wq-silence', stopAll);
    if (D.documentElement && D.documentElement.classList) D.documentElement.classList.add('wq-juice');
  }
  if (W.addEventListener) W.addEventListener('pagehide', stopAll);

  W.WQJ = {
    tap: tap, correct: correct, wrong: wrong, word: word, sentence: sentence, streak: streak, finish: finish, badge: badge,
    dayDot: dayDot, giggle: function () { clip('giggle'); }, mic: function (on) { duck = !!on; }, after: after,
    muted: muted, mute: mute, toggle: toggle, stopAll: stopAll, pop: pop, wobble: wobble, fly: fly, confetti: confetti,
    R: R, SP: SP
  };
})(typeof window !== 'undefined' ? window : null);
