/**
 * The storybook's "Slower" (switch `web_quiz_stories_slow_gaps`, the book says `slow_gaps: true`): the voice always plays
 * at its own speed and the reader waits BETWEEN phrases instead — ~700 ms after a sentence's last word, ~400 ms after a
 * comma or a printed line's end, nothing elsewhere — with the highlight resting on the last word. The wait is
 * max(least, target − (next word's start − this word's end)): 700 / 500 ms after a sentence, 400 / 250 ms after a comma or
 * a line end, for every clip alike (an old take with no pause gets the full target, a take that already pauses still gets
 * the least, so Slower is always heard; timings that overlap get none). A tap, Pause, a page
 * turn, Back, Home or another book drops a waiting gap. Off, Slower is exactly what it was (the 0.85 stretch).
 *
 * The real player (wq-readalong.js) runs in a vm with a fake audio element whose clock moves only while it plays, a
 * frame queue and a wall clock the test holds; the real reader (wq-stories.js) drives it in a second vm with a small
 * fake DOM. Invented books only ("Testwala").
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RA_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-readalong.js'), 'utf8');
const ST_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-stories.js');
const ST_Q = path.join(__dirname, '..', 'public', 'wq', 'wq-stories-q.js');
const KID = 'kidchipabcdefghi';

// ---- the player's world: DOM nodes, audio with a moving clock, frames, a wall clock -------------------------------
function node(tag) {
  const n = {
    tag, children: [], attrs: {}, style: {}, l: {}, className: '', parent: null, _text: '', clientWidth: tag === 'img' ? 540 : 0,
    appendChild(c) { c.parent = n; n.children.push(c); return c; },
    setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute(k) { return n.attrs[k]; }, removeAttribute(k) { delete n.attrs[k]; },
    addEventListener(e, fn) { (n.l[e] = n.l[e] || []).push(fn); }, removeEventListener(e, fn) { n.l[e] = (n.l[e] || []).filter((f) => f !== fn); },
    fire(e) { (n.l[e] || []).slice().forEach((fn) => fn({ preventDefault() {} })); }, click() { n.fire('click'); },
  };
  Object.defineProperty(n, 'textContent', { get: () => n._text + n.children.map((c) => c.textContent).join(''), set: (v) => { n._text = String(v); n.children = []; } });
  Object.defineProperty(n, 'innerHTML', { get: () => '', set: () => { n.children = []; n._text = ''; } });
  return n;
}
const all = (n, pred, out = []) => { if (pred(n)) out.push(n); n.children.forEach((c) => all(c, pred, out)); return out; };

function world() {
  let wall = 0;
  const frames = [];
  const timers = [];
  const audios = [];
  const rates = [];   // every playbackRate any audio element was given
  class Audio {
    constructor() { this.l = {}; this.t = 0; this.paused = true; this.attrs = {}; this._r = 1; audios.push(this); }
    get currentTime() { return this.t / 1000; }
    set currentTime(v) { this.t = v * 1000; }
    get playbackRate() { return this._r; }
    set playbackRate(v) { rates.push(v); this._r = v; }
    set src(v) { this.attrs.src = v; } get src() { return this.attrs.src; }
    removeAttribute(k) { delete this.attrs[k]; } load() {}
    addEventListener(n, fn) { (this.l[n] = this.l[n] || []).push(fn); } removeEventListener(n, fn) { this.l[n] = (this.l[n] || []).filter((f) => f !== fn); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const head = node('head');
  const document = {
    head, body: node('body'), visibilityState: 'visible',
    createElement: (t) => node(t), createTextNode: (t) => { const n = node('#text'); n.textContent = t; return n; },
    getElementById: (id) => all(head, (x) => x.id === id)[0] || null,
    addEventListener() {}, removeEventListener() {},
  };
  const window = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame: (h) => { frames[h - 1] = null; },
  };
  const setTimeout = (f, ms) => { const t = { f, at: wall + (ms || 0), id: timers.length + 1 }; timers.push(t); return t.id; };
  const clearTimeout = (id) => { const t = timers.find((x) => x.id === id); if (t) t.dead = true; };
  function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  const ctx = { window, document, Audio, CustomEvent, console, setTimeout, clearTimeout, Promise, fetch: () => Promise.reject(new Error('no net')) };
  vm.createContext(ctx);
  vm.runInContext(RA_SRC, ctx);
  const audio = () => audios[audios.length - 1];
  // the wall clock moves in 10 ms steps: a playing clip's clock moves with it, a paused one does not; due timers run, then one frame
  function run(ms, each) {
    for (let k = 0; k < ms; k += 10) {
      wall += 10;
      audios.forEach((a) => { if (!a.paused) a.t += 10; });
      timers.filter((t) => !t.dead && !t.done && t.at <= wall).forEach((t) => { t.done = true; t.f(); });
      frames.splice(0).forEach((f) => f && f());
      if (each) each();
    }
  }
  const live = () => timers.filter((t) => !t.dead && !t.done).length;
  // made: every timer the player ever asked for (a wait scheduled where none is due shows here, even if it already ran)
  return { RA: window.WQReadAlong, document, audio, audios, rates, run, live, made: () => timers.length, get wall() { return wall; } };
}

const W = (i, t, s, e) => ({ i, t, s_ms: s, e_ms: e });
// "Mina has a kite. It goes up, up and away." — a sentence ends INSIDE the first printed line; line 1 is words 0–5
const EN = {
  v: 1, id: 'b-1/p1', lang: 'en', dir: 'ltr', audio: { url: '/a/p1.ogg', ms: 3600 },
  words: [W(0, 'Mina', 100, 400), W(1, 'has', 420, 600), W(2, 'a', 620, 700), W(3, 'kite.', 720, 1100), W(4, 'It', 1120, 1300), W(5, 'goes', 1320, 1600),
    W(6, 'up,', 1620, 1900), W(7, 'up', 1920, 2200), W(8, 'and', 2220, 2400), W(9, 'away.', 2420, 3000)],
};
const EN_LINES = [[0, 5], [6, 9]];
// «مینا کی پتنگ اونچی ہے۔ وہ اڑتی ہے، اوپر اور اوپر۔» — ۔ ends a sentence inside line 1, ، is a comma; line 1 is words 0–6
const UR = {
  v: 1, id: 'b-2/p1', lang: 'ur', dir: 'rtl', audio: { url: '/a/u1.ogg', ms: 3800 },
  words: [W(0, 'مینا', 100, 400), W(1, 'کی', 420, 600), W(2, 'پتنگ', 620, 900), W(3, 'اونچی', 920, 1200), W(4, 'ہے۔', 1220, 1500), W(5, 'وہ', 1520, 1700),
    W(6, 'اڑتی', 1720, 2000), W(7, 'ہے،', 2020, 2300), W(8, 'اوپر', 2320, 2600), W(9, 'اور', 2620, 2800), W(10, 'اوپر۔', 2820, 3300)],
};
const UR_LINES = [[0, 6], [7, 10]];

// Play a page to its end and write down every stretch of wall time the clip's clock stood still while the player said
// "playing": [the word the clip stopped after, how long, the word lit throughout].
function gapsOf(w, p) {
  const out = [];
  let still = null;
  p.play();
  w.run(9000, () => {
    const a = w.audio();
    if (p.state === 'playing' && a.paused) {
      if (!still) still = { at: a.t, ms: 0, lit: new Set() };
      still.ms += 10; still.lit.add(p.current);
    } else if (still) { out.push(still); still = null; }
  });
  return out.map((s) => [s.at, s.ms, [...s.lit]]);
}

describe('the player: gaps between phrases (opts.gaps, opt-in)', () => {
  test('EN: 700 ms after a sentence end (one that ends inside a line), 400 ms after a comma and after a printed line end, nothing elsewhere, none after the last word, each less the clip\'s own pause; the highlight rests on the last word', () => {
    const w = world();
    const p = w.RA.mount(w.document.createElement('div'), EN, { lines: EN_LINES, leadMs: 50, gaps: { sentence: [700, 500], comma: [400, 250] } });
    // kite. (ends 1100, mid-line; stops mid-silence at 1110) → 700 − its own 20; goes (line 1's end) → 400 − 20; up, → 400 − 20; away. is the last word → none
    expect(gapsOf(w, p)).toEqual([[1110, 680, [3]], [1610, 380, [5]], [1910, 380, [6]]]);
    expect(w.audio()._r).toBe(1);
    expect(p.state).toBe('ended');
  });
  test('UR: ۔ is a sentence end (also inside a line), ، a comma, the line end a short gap', () => {
    const w = world();
    const p = w.RA.mount(w.document.createElement('div'), UR, { lines: UR_LINES, leadMs: 50, gaps: { sentence: [700, 500], comma: [400, 250] } });
    // (2.01 s × 1000 is 2009.999… in floating point, so that stop lands on the next 10 ms frame, as in a browser)
    expect(gapsOf(w, p)).toEqual([[1510, 680, [4]], [2020, 380, [6]], [2310, 380, [7]]]);
  });
  test('gaps: true is the storybook spec (700 / 400, never under 500 / 250)', () => {
    const w = world();
    const p = w.RA.mount(w.document.createElement('div'), EN, { lines: EN_LINES, gaps: true });
    expect(gapsOf(w, p).map((g) => g[1])).toEqual([680, 380, 380]);
  });
  test('a sentence end that is also a line end is one sentence gap, not two', () => {
    const w = world();
    const p = w.RA.mount(w.document.createElement('div'), EN, { lines: [[0, 3], [4, 9]], gaps: true });
    expect(gapsOf(w, p).slice(0, 1)).toEqual([[1110, 680, [3]]]);
  });
  test('the clip stops in the middle of the natural pause, never at the word\'s end time (an early end time cannot clip the word)', () => {
    const w = world();
    const words = EN.words.map((x) => ({ ...x }));
    words[3] = { ...words[3], e_ms: 800 };    // "kite." ends (by its timings) at 800; the next word starts at 1120
    const p = w.RA.mount(w.document.createElement('div'), { ...EN, words }, { lines: EN_LINES, gaps: true });
    expect(gapsOf(w, p)[0]).toEqual([960, 500, [3]]);   // its own pause is 320 ms: 700 − 320 = 380, under the least 500
  });
  test('the highlight never runs ahead of the voice: the next word starts 20 ms after the gap word ends (inside the 50 ms lead), and the pill still waits on the gap word', () => {
    const w = world();
    const lit = [];
    const p = w.RA.mount(w.document.createElement('div'), EN, { lines: EN_LINES, leadMs: 50, gaps: true, onWord: (i) => lit.push([w.audio().t, i]) });
    p.play();
    w.run(1090);
    expect(p.current).toBe(3);
    w.run(20);     // the clip passes 1100: it stops on "kite."
    expect(w.audio().paused).toBe(true);
    expect(p.current).toBe(3);
    w.run(660);
    expect(p.current).toBe(3);
    expect(lit.filter(([, i]) => i === 4)).toEqual([]);
    w.run(20);     // resumed: "It" lights only now, with its lead
    expect(w.audio().paused).toBe(false);
    expect(p.current).toBe(4);
    expect(p.state).toBe('playing');
  });
  test('a one-letter word with a 20 ms box («a», «I») stays lit until the next word starts, gaps on or off', () => {
    for (const gaps of [undefined, true]) {
      const w = world();
      const words = EN.words.map((x) => ({ ...x }));
      words[2] = { ...words[2], s_ms: 620, e_ms: 640 };
      const p = w.RA.mount(w.document.createElement('div'), { ...EN, words }, { lines: EN_LINES, leadMs: 50, gaps });
      p.play();
      w.run(580); expect(p.current).toBe(2);   // 570 + 50 lead ≥ 620
      w.run(80); expect(p.current).toBe(2);    // 660: past its 640 end, "kite." starts at 720
      w.run(20); expect(p.current).toBe(3);    // 680 + 50 ≥ 720
    }
  });
  test('no gaps asked (Jugnu\'s passages): the clip never stops between phrases', () => {
    const w = world();
    const p = w.RA.mount(w.document.createElement('div'), EN, { lines: EN_LINES });
    expect(gapsOf(w, p)).toEqual([]);
    expect(w.made()).toBe(0);
  });

  // The wait is max(least, target − (next.s_ms − prev.e_ms)), the same sum for every clip (no take is named).
  describe('the wait is the target less the clip\'s own pause, never under the least (every clip, one formula)', () => {
    const take = (gaps, over = {}) => ({ ...EN, ...over, words: EN.words.map((x, k) => ({ ...x, ...(gaps[k] || {}) })) });
    test('an old take (no pause of its own: each word starts where the last one ends) gets the full wait, at rate 1', () => {
      const w = world();
      // every word ends exactly where the next one starts
      const words = EN.words.map((x, k) => ({ ...x, e_ms: k < 9 ? EN.words[k + 1].s_ms : x.e_ms }));
      const p = w.RA.mount(w.document.createElement('div'), { ...EN, words }, { lines: EN_LINES, gaps: true });
      expect(gapsOf(w, p).map((g) => g[1])).toEqual([700, 400, 400]);
      expect(w.audio()._r).toBe(1);
      expect(w.rates.every((r) => r === 1)).toBe(true);
    });
    test('a take that already pauses (a storyteller take) still gets the least: 500 after a sentence, 250 after a comma or a line end, so Slower is always heard', () => {
      // kite. → It: 900 ms of its own (700 − 900 < 500: 500); goes → up,: 500 (250); up, → up: 250 (400 − 250 = 150 < 250: 250)
      const words = [W(0, 'Mina', 100, 400), W(1, 'has', 420, 600), W(2, 'a', 620, 700), W(3, 'kite.', 720, 1100), W(4, 'It', 2000, 2200), W(5, 'goes', 2220, 2500),
        W(6, 'up,', 3000, 3300), W(7, 'up', 3550, 3800), W(8, 'and', 3820, 4000), W(9, 'away.', 4020, 4600)];
      const w2 = world();
      const p2 = w2.RA.mount(w2.document.createElement('div'), { ...EN, audio: { url: '/a/p1.ogg', ms: 5000 }, words }, { lines: EN_LINES, gaps: true });
      const got = gapsOf(w2, p2);
      expect(got.map((g) => g[1])).toEqual([500, 250, 250]);
      expect(got.map((g) => g[2])).toEqual([[3], [5], [6]]);
      expect(w2.made()).toBe(3);   // a wait at every phrase end: never 0 added
      expect(w2.rates.every((r) => r === 1)).toBe(true);
    });
    // the ruled rows: the clip's own pause n after a sentence end (kite.) and after a comma (up,)
    test.each([
      [0, 700, 400], [300, 500, 250], [1200, 500, 250], [150, 550, 250],
    ])('its own pause n = %i ms: %i ms after a sentence, %i ms after a comma', (n, sent, comma) => {
      const w = world();
      // kite. ends at 1100 and up, at 3300 + n's shift; every later word moves by the added pause
      const sh = (k) => (k >= 4 ? n - 20 : 0) + (k >= 7 ? n - 20 : 0);
      const words = EN.words.map((x, k) => ({ ...x, s_ms: x.s_ms + sh(k), e_ms: x.e_ms + sh(k) }));
      const p = w.RA.mount(w.document.createElement('div'), { ...EN, audio: { url: '/a/p1.ogg', ms: 3600 + 2 * n }, words }, { gaps: true });
      const got = gapsOf(w, p);
      expect(got.map((g) => [g[2][0], g[1]])).toEqual([[3, sent], [6, comma]]);
    });
    test('timings that overlap (the next word starts before this one ends): no wait there, the clip never stops inside a word', () => {
      const w = world();
      // "It" starts at 1050, before "kite." ends at 1100; the others keep their 20 ms
      const p = w.RA.mount(w.document.createElement('div'), take({ 4: { s_ms: 1050 } }), { lines: EN_LINES, gaps: true });
      const got = gapsOf(w, p);
      expect(got.map((g) => g[2][0])).toEqual([5, 6]);
      expect(got.map((g) => g[1])).toEqual([380, 380]);
      expect(w.rates.every((r) => r === 1)).toBe(true);
    });
    test('no take is named: a page marked as a storyteller take and the same page unmarked wait the same', () => {
      const runs = [{}, { pipeline: 'vr2-storyteller' }, { pipeline: 'v1' }].map((over) => {
        const w = world();
        const p = w.RA.mount(w.document.createElement('div'), { ...EN, ...over }, { lines: EN_LINES, gaps: true });
        return gapsOf(w, p);
      });
      expect(runs[1]).toEqual(runs[0]);
      expect(runs[2]).toEqual(runs[0]);
      expect(fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-readalong.js'), 'utf8')).not.toMatch(/pipeline|storyteller/);
    });
  });

  describe('a waiting gap is dropped (no timer outlives it)', () => {
    function inGap() {
      const w = world();
      const taps = [];
      const p = w.RA.mount(w.document.createElement('div'), EN, { lines: EN_LINES, tap: 'sentence', gaps: true, onWordTap: (i) => taps.push(i) });
      p.play();
      w.run(1150);   // stopped on "kite." at 1100, 50 ms into its 700 ms gap
      expect(w.audio().paused).toBe(true);
      expect(p.state).toBe('playing');
      expect(w.live()).toBe(1);
      return { w, p, taps };
    }
    test('Pause: paused, the gap timer is gone, and the clip stays put past the gap', () => {
      const { w, p } = inGap();
      p.pause();
      expect(p.state).toBe('paused');
      expect(w.live()).toBe(0);
      w.run(2000);
      expect(w.audio().paused).toBe(true);
      expect(w.audio().t).toBe(1110);
    });
    test('the play button (toggle) is a Pause during a gap', () => {
      const { w, p } = inGap();
      p.toggle();
      expect(p.state).toBe('paused');
      expect(w.live()).toBe(0);
    });
    test('a word tap (its sentence) plays from that word; the old gap never resumes the clip from the old place', () => {
      const { w, p } = inGap();
      p.seekToWord(6);
      expect(w.live()).toBe(0);
      expect(w.audio().t).toBeGreaterThanOrEqual(1500);
      w.run(700);
      expect(w.audio().t).toBeGreaterThan(1600);   // reading on from the tapped place, never back at 1100
    });
    test('a tap back to the first word: the gaps it passes again are kept (counted from the new place)', () => {
      const { w, p } = inGap();
      w.run(1200);   // the rest of the gap, then on to "goes" (1600): stopped there now
      expect(w.audio().t).toBe(1610);
      p.seekToWord(0);
      w.run(1100);   // from 50: stops again on "kite." at 1110
      expect(w.audio().t).toBe(1110);
      expect(w.audio().paused).toBe(true);
    });
    test('a one-word play (a tapped word) drops the gap', () => {
      const { w, p } = inGap();
      p.playWord(1);
      expect(w.live()).toBe(0);
    });
    test('destroy (page turn, Back, Home, another book) drops the gap', () => {
      const { w, p } = inGap();
      p.destroy();
      expect(w.live()).toBe(0);
      w.run(2000);
      expect(w.audio().paused).toBe(true);
    });
  });

  describe('slow(on, gaps): the storybook\'s Slower button', () => {
    test('gaps on: the voice stays at rate 1 and the page gets the gaps; off again: no gaps, rate 1', () => {
      const w = world();
      const p = w.RA.mount(w.document.createElement('div'), EN, { lines: EN_LINES });
      p.slow(true, true);
      expect(w.audio()._r).toBe(1);
      expect(w.audio().preservesPitch).toBe(true);
      expect(gapsOf(w, p).map((g) => g[1])).toEqual([680, 380, 380]);
      p.slow(false, true);
      expect(w.audio()._r).toBe(1);
      expect(gapsOf(w, p)).toEqual([]);
      expect(w.rates.every((r) => r === 1)).toBe(true);
    });
    test('turned on mid-page: gaps start from where the clip is (never a jump back to a passed word)', () => {
      const w = world();
      const p = w.RA.mount(w.document.createElement('div'), EN, { lines: EN_LINES });
      p.play(); w.run(1200);
      expect(p.current).toBe(4);
      p.slow(true, true);
      w.run(20);
      expect(p.current).toBe(4);
      expect(w.audio().paused).toBe(false);
    });
    test('gaps not switched on: Slower is the old stretch, exactly (0.85 with the pitch kept), and no gaps', () => {
      const w = world();
      const p = w.RA.mount(w.document.createElement('div'), EN, { lines: EN_LINES });
      p.slow(true, false);
      expect(w.audio()._r).toBe(0.85);
      expect(w.audio().preservesPitch).toBe(true);
      expect(gapsOf(w, p)).toEqual([]);
      p.slow(false, false);
      expect(w.audio()._r).toBe(1);
    });
  });
});

// ---- the reader driving the real player ---------------------------------------------------------------------------
function key(sel) { return sel.replace(/^[.[]/, '').replace(/[\]=].*$/, '').split(' ')[0]; }
function fakeEl(name) {
  const els = {};
  const L = {};
  return {
    name, _h: '', attrs: {}, style: {}, hidden: false, textContent: '', className: '', clientWidth: 360, clientHeight: 500, L, els, children: [],
    set innerHTML(h) { this._h = String(h); this.children = []; Object.keys(els).forEach((k) => delete els[k]); }, get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(n, f) { (L[n] = L[n] || []).push(f); }, removeEventListener() {},
    querySelector(sel) { if (!this._h.includes(key(sel))) return null; els[sel] = els[sel] || fakeEl(sel); return els[sel]; },
    querySelectorAll() { return []; }, appendChild(c) { this.children.push(c); return c; },
  };
}
function fire(root, tap, arg) {
  const target = { getAttribute: (k) => (k === 'data-tap' ? tap : k === 'data-arg' ? (arg == null ? null : String(arg)) : null), parentNode: null };
  root.L.click.forEach((f) => f({ target, preventDefault() {} }));
}
const flush = () => new Promise((r) => setImmediate(r));
const page = (data, lines, n) => ({ n, image: { url: `/s/b/p0${n}.webp`, w: 720, h: 1080 }, text_band: null, text: data.words.map((x) => x.t).join(' '), words: data.words, audio: data.audio,
  boxes_ok: false, is_picture: false, lines: lines.map(([i0, i1]) => ({ i0, i1 })) });
function storyBook(lang, over = {}) {
  const d = lang === 'ur' ? UR : EN;
  const L = lang === 'ur' ? UR_LINES : EN_LINES;
  return { id: 'b-1', title: lang === 'ur' ? 'مینا ٹیسٹ والا' : 'Mina Testwala', lang, dir: lang === 'ur' ? 'rtl' : 'ltr', grade: 1, pace_wpm: 90, lr3: false,
    pages: [page(d, L, 1), page(d, L, 2)], questions: [], ...over };
}

function reader({ lang = 'en', gapsKey, slowStored } = {}) {
  const w = world();
  const bk = storyBook(lang, gapsKey === undefined ? {} : { slow_gaps: gapsKey });
  const store = { m: {}, getItem(k) { return k in this.m ? this.m[k] : null; }, setItem(k, v) { this.m[k] = String(v); } };
  if (slowStored) store.setItem('wq_st_slow:' + KID, slowStored);
  const posts = [];
  const bodies = [];
  const fetch = (url, init) => {
    init = init || {};
    if ((init.method || 'GET') === 'POST') { posts.push(url); bodies.push(init.body); }
    const r = /\/stories\/book\//.test(url) ? { status: 200, body: bk } : { status: 200, body: { ok: true } };
    return Promise.resolve({ status: r.status, ok: true, json: () => Promise.resolve(r.body) });
  };
  const win = {
    location: { hash: '', pathname: '/h/tok', search: '?x=1' }, localStorage: store, fetch, WQReadAlong: w.RA,
    addEventListener() {}, removeEventListener() {}, setTimeout() { return 0; }, clearTimeout() {},
    history: { replaceState() {}, back() {} }, HashChangeEvent: function (n) { this.type = n; }, dispatchEvent() {},
    Image: function () { Object.defineProperty(this, 'src', { set() {}, get() { return ''; } }); },
  };
  let sb = null;
  const doc = {
    getElementById: () => null, querySelector: (sel) => (/wq-stories\.js/.test(sel) ? { getAttribute: () => '/wq/wq-stories.js?v=abc123' } : null),
    createElement: (tag) => ({ tag }), addEventListener() {},
    head: { appendChild(x) { if (x.tag === 'script' && /wq-stories-q\.js/.test(x.src)) { vm.runInContext(fs.readFileSync(ST_Q, 'utf8'), sb); x.onload(); } } },
  };
  sb = vm.createContext({ window: win, document: doc, JSON, Math, String, Number, Array, Object, Promise, encodeURIComponent, Date });
  vm.runInContext(fs.readFileSync(ST_SRC, 'utf8'), sb);
  let now = 0;
  const clock = { now: () => now, set: () => 0, clear() {} };
  const root = fakeEl('root');
  const open = async () => { win.WQSTORIES.open('b-1', { token: 'tok', kid: KID, lang, clock, root }); await flush(); await flush(); return root; };
  return { w, win, root, open, store, posts, bodies };
}
// the clip of the page on screen (the player listens to it; the next page's warm-up copy has no listeners)
const pl = (r) => r.w.audios.filter((a) => (a.l.ended || []).length).pop();

describe('the reader\'s Slower with the switch ON (the book says slow_gaps)', () => {
  test.each(['en', 'ur'])('%s: a remembered Slower means gaps: rate 1, the clip stops after the sentence end for 700 ms less the page\'s own pause with the highlight on its last word, then reads on', async (lang) => {
    const r = reader({ lang, gapsKey: true, slowStored: '1' });
    const root = await r.open();
    expect(root.innerHTML).toContain('data-tap="slow" aria-pressed="true"');
    fire(root, 'main');
    const end = lang === 'ur' ? 1500 : 1100;
    r.w.run(end + 20);
    expect(pl(r).paused).toBe(true);
    expect(pl(r)._r).toBe(1);
    expect(root.querySelector('[data-main]').textContent).toBe(lang === 'ur' ? 'رکیں' : 'Pause');
    r.w.run(650);
    expect(pl(r).paused).toBe(true);
    expect(pl(r).t).toBe(end + 10);
    r.w.run(30);   // 700 less the page's own 20 ms: back on air 680 ms after the stop
    expect(pl(r).paused).toBe(false);
    expect(r.w.rates.every((x) => x === 1)).toBe(true);
  });
  test('the Slower button toggles gaps, never the speed: rate stays 1 through every tap and page', async () => {
    const r = reader({ gapsKey: true });
    const root = await r.open();
    fire(root, 'slow'); fire(root, 'slow'); fire(root, 'slow');
    expect(r.store.getItem('wq_st_slow:' + KID)).toBe('1');
    fire(root, 'main'); r.w.run(1200);
    expect(pl(r).paused).toBe(true);   // gaps are on
    fire(root, 'next'); await flush();
    fire(root, 'main'); r.w.run(1200);
    expect(pl(r).paused).toBe(true);
    expect(r.w.rates.length).toBeGreaterThan(0);
    expect(r.w.rates.filter((x) => x < 1)).toEqual([]);
  });
  test('the reader itself never sets playbackRate below 1 (no stretch left in the storybook files)', () => {
    const code = ['wq-stories.js', 'wq-stories-q.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', f), 'utf8')).join('\n');
    expect(code).not.toMatch(/playbackRate\s*=\s*[^=]/);
    expect(code).not.toMatch(/0\.85/);
  });

  describe('every way off the page drops a waiting gap (the clip never starts again by itself)', () => {
    async function inGap() {
      const r = reader({ gapsKey: true, slowStored: '1' });
      const root = await r.open();
      fire(root, 'main'); r.w.run(1150);
      expect(pl(r).paused).toBe(true);
      expect(r.w.live()).toBe(1);
      return { r, root, a: pl(r) };
    }
    test('Pause', async () => {
      const { r, root, a } = await inGap();
      fire(root, 'main');
      expect(root.querySelector('[data-main]').textContent).toBe('Listen');
      expect(r.w.live()).toBe(0);
      r.w.run(2000); expect(a.paused).toBe(true);
    });
    test('a page turn', async () => {
      const { r, root, a } = await inGap();
      fire(root, 'next'); await flush();
      expect(r.w.live()).toBe(0);
      r.w.run(2000); expect(a.paused).toBe(true);
    });
    test('Back', async () => {
      const { r, root, a } = await inGap();
      fire(root, 'back');
      expect(r.w.live()).toBe(0);
      r.w.run(2000); expect(a.paused).toBe(true);
    });
    test('Home', async () => {
      const { r, root, a } = await inGap();
      fire(root, 'home');
      expect(r.w.live()).toBe(0);
      r.w.run(2000); expect(a.paused).toBe(true);
    });
    test('another book', async () => {
      const { r, a } = await inGap();
      r.win.WQSTORIES.open('b-2', { token: 'tok', kid: KID, lang: 'en', clock: { now: () => 0, set: () => 0, clear() {} }, root: fakeEl('root2') });
      expect(r.w.live()).toBe(0);
      r.w.run(2000); expect(a.paused).toBe(true);
    });
    test('a tapped word (Your turn\'s practise word)', async () => {
      const { r, root } = await inGap();
      fire(root, 'word', 1);
      expect(r.w.live()).toBe(0);
    });
  });
});

describe('the switch OFF: Slower is exactly today\'s (golden)', () => {
  test.each(['en', 'ur'])('%s: remembered Slower → the 0.85 stretch with the pitch kept, no gaps; the page is byte-identical with the key off, absent or on', async (lang) => {
    const pages = {};
    for (const k of ['absent', false, true]) {
      const r = reader({ lang, gapsKey: k === 'absent' ? undefined : k, slowStored: '1' });
      const root = await r.open();
      pages[String(k)] = root.innerHTML;
      if (k !== true) {
        expect(pl(r)._r).toBe(0.85);
        expect(pl(r).preservesPitch).toBe(true);
        fire(root, 'main');
        r.w.run(4000, () => { if (pl(r).t > 0 && pl(r).t < 2900) expect(pl(r).paused).toBe(false); });
        fire(root, 'slow');
        expect(pl(r)._r).toBe(1);
      }
    }
    expect(pages.false).toBe(pages.absent);
    expect(pages.true).toBe(pages.absent);
  });
  test('Slower off, key off: rate 1 (today)', async () => {
    const r = reader({ gapsKey: false });
    await r.open();
    expect(pl(r)._r).toBe(1);
    expect(pl(r).preservesPitch).toBe(true);
  });
});

// Slower in the page-listened event (`slow: 1`), only with the switch on; off, the posted body is today's, byte for byte.
describe('story_page_listened says slow: 1 when the child listened with Slower on (switch on only)', () => {
  async function listenedBodies(o) {
    const r = reader(o);
    const root = await r.open();
    fire(root, 'main');
    r.w.run(9000);
    await flush();
    return r.bodies.filter((b) => /story_page_listened/.test(String(b)));
  }
  test.each(['en', 'ur'])('%s: on + Slower on → slow: 1 with the page\'s numbers', async (lang) => {
    const got = await listenedBodies({ lang, gapsKey: true, slowStored: '1' });
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]).data).toEqual({ ms: 0, completed: true, slow: 1 });
  });
  test('on + Slower off → no slow', async () => {
    const got = await listenedBodies({ gapsKey: true });
    expect(JSON.parse(got[0]).data).toEqual({ ms: 0, completed: true });
  });
  test('off (absent or false), Slower on or off → the body is byte-identical to today\'s', async () => {
    const base = await listenedBodies({});
    expect(base).toHaveLength(1);
    expect(base[0]).not.toContain('slow');
    for (const o of [{ slowStored: '1' }, { gapsKey: false, slowStored: '1' }, { gapsKey: false }]) expect(await listenedBodies(o)).toEqual(base);
  });
});

// The numbers from settings: the book's slow_gaps may be {sentence: [target, least], comma: [target, least]}, and the
// reader hands it to the player as it is (no client code reads the numbers).
describe('the book carries the Slower numbers', () => {
  test.each(['en', 'ur'])('%s: slow_gaps {sentence: [900, 600], comma: [500, 300]} → 880 ms after the sentence end (900 less its own 20), rate 1', async (lang) => {
    const r = reader({ lang, gapsKey: { sentence: [900, 600], comma: [500, 300] }, slowStored: '1' });
    const root = await r.open();
    fire(root, 'main');
    const end = lang === 'ur' ? 1500 : 1100;
    r.w.run(end + 20);
    expect(pl(r).paused).toBe(true);
    r.w.run(860);
    expect(pl(r).paused).toBe(true);
    r.w.run(30);
    expect(pl(r).paused).toBe(false);
    expect(r.w.rates.every((x) => x === 1)).toBe(true);
  });
});

// The first tap on Slower is heard (switch on only): turned ON while the page waits (before the first Listen, paused,
// or heard to its end), the reader says the current (or last) sentence again from its first word with the pauses;
// before the first Listen the tap IS that Listen. After Your turn and on the questions: the toggle only. Turned OFF: nothing starts. While playing: no jump, the next phrase end already waits.
// The switch off: the tap is today's, exactly. One stored toggle per tap, always (wq-stories.js keeps it).
describe('the first tap on Slower is heard (switch on)', () => {
  const mainText = (root) => root.querySelector('[data-main]').textContent;
  const PAUSE = { en: 'Pause', ur: 'رکیں' };
  const LISTEN = { en: 'Listen', ur: 'سنیں' };
  // EN "It goes up, up and away." starts at word 4 (1120); UR «وہ اڑتی ہے، اوپر اور اوپر۔» at word 5 (1520), after the ۔
  const MID = { en: { at: 1450, from: 1120, stop: 1610 }, ur: { at: 1800, from: 1520, stop: 2020 } };   // (2.01 s × 1000 lands on the next 10 ms frame)
  function counted(r) {
    const n = { slow: 0 };
    const set = r.store.setItem;
    r.store.setItem = function (k, v) { if (/^wq_st_slow:/.test(k)) n.slow += 1; return set.call(this, k, v); };
    return n;
  }

  test.each(['en', 'ur'])('%s (1): paused mid-page, Slower ON says the current sentence again from its first word, with the pauses; one stored toggle', async (lang) => {
    const r = reader({ lang, gapsKey: true });
    const root = await r.open();
    fire(root, 'main'); r.w.run(MID[lang].at);
    fire(root, 'main');
    expect(mainText(root)).toBe(LISTEN[lang]);
    expect(pl(r).paused).toBe(true);
    const n = counted(r);
    fire(root, 'slow');
    expect(n.slow).toBe(1);
    expect(r.store.getItem('wq_st_slow:' + KID)).toBe('1');
    expect(root.querySelector('.wqs-slow').getAttribute('aria-pressed')).toBe('true');
    expect(pl(r).paused).toBe(false);                 // played inside the tap
    expect(pl(r).t).toBe(MID[lang].from);             // from the sentence's first word, at its own start (no lead into the sentence before)
    expect(mainText(root)).toBe(PAUSE[lang]);
    r.w.run(MID[lang].stop - MID[lang].from);         // the first phrase end of that sentence: it waits (gaps are on)
    expect(pl(r).paused).toBe(true);
    expect(pl(r).t).toBe(MID[lang].stop);
    expect(mainText(root)).toBe(PAUSE[lang]);
    expect(r.w.rates.filter((x) => x < 1)).toEqual([]);
  });

  test.each(['en', 'ur'])('%s (2): before the first Listen, Slower ON is that Listen (the main button says Pause, from word 0, the same listened event)', async (lang) => {
    const r = reader({ lang, gapsKey: true });
    const root = await r.open();
    expect(pl(r).paused).toBe(true);                  // no voice before the child's tap
    expect(mainText(root) || LISTEN[lang]).toBe(LISTEN[lang]);
    const n = counted(r);
    fire(root, 'slow');
    expect(n.slow).toBe(1);
    expect(pl(r).paused).toBe(false);
    expect(pl(r).t).toBe(0);
    expect(mainText(root)).toBe(PAUSE[lang]);
    r.w.run(lang === 'ur' ? 1520 : 1120);             // the first sentence end waits
    expect(pl(r).paused).toBe(true);
    expect(mainText(root)).toBe(PAUSE[lang]);
    r.w.run(9000); await flush();
    const viaSlow = r.bodies.filter((b) => /story_page_listened/.test(String(b)));
    // the same page heard through Listen with Slower already on
    const r2 = reader({ lang, gapsKey: true, slowStored: '1' });
    const root2 = await r2.open();
    fire(root2, 'main'); r2.w.run(9000); await flush();
    expect(viaSlow).toHaveLength(1);
    expect(viaSlow).toEqual(r2.bodies.filter((b) => /story_page_listened/.test(String(b))));
    expect(mainText(root)).toBe(mainText(root2));
  });

  test.each(['en', 'ur'])('%s (1b): the page heard to its end, Slower ON says its last sentence again, with the pauses', async (lang) => {
    const r = reader({ lang, gapsKey: true });
    const root = await r.open();
    fire(root, 'main'); r.w.run(9000); await flush();
    expect(pl(r).paused).toBe(true);
    const n = counted(r);
    fire(root, 'slow');
    expect(n.slow).toBe(1);
    expect(pl(r).paused).toBe(false);
    expect(pl(r).t).toBe(MID[lang].from);
    expect(mainText(root)).toBe(PAUSE[lang]);
    r.w.run(MID[lang].stop - MID[lang].from);
    expect(pl(r).paused).toBe(true);
    expect(pl(r).t).toBe(MID[lang].stop);
  });

  test.each(['en', 'ur'])('%s (3): playing, Slower ON is only the toggle: no jump, no restart, and the next phrase end waits', async (lang) => {
    const r = reader({ lang, gapsKey: true });
    const root = await r.open();
    fire(root, 'main'); r.w.run(MID[lang].at);
    expect(pl(r).paused).toBe(false);
    const n = counted(r);
    fire(root, 'slow');
    expect(n.slow).toBe(1);
    expect(pl(r).t).toBe(MID[lang].at);
    expect(pl(r).paused).toBe(false);
    expect(mainText(root)).toBe(PAUSE[lang]);
    r.w.run(MID[lang].stop - MID[lang].at);
    expect(pl(r).paused).toBe(true);                  // gaps on from here
    expect(pl(r).t).toBe(MID[lang].stop);
  });

  test.each(['en', 'ur'])('%s (4): Slower OFF while waiting starts nothing (before the first Listen, and paused)', async (lang) => {
    const r = reader({ lang, gapsKey: true, slowStored: '1' });
    const root = await r.open();
    let n = counted(r);
    fire(root, 'slow');
    expect(n.slow).toBe(1);
    expect(r.store.getItem('wq_st_slow:' + KID)).toBe('0');
    expect(pl(r).paused).toBe(true);
    expect(pl(r).t).toBe(0);
    const r2 = reader({ lang, gapsKey: true, slowStored: '1' });
    const root2 = await r2.open();
    fire(root2, 'main'); r2.w.run(1050); fire(root2, 'main');
    n = counted(r2);
    fire(root2, 'slow');
    expect(n.slow).toBe(1);
    expect(pl(r2).paused).toBe(true);
    expect(pl(r2).t).toBe(1050);
    expect(mainText(root2)).toBe(LISTEN[lang]);
    r2.w.run(2000);
    expect(pl(r2).paused).toBe(true);
  });

  test.each(['en', 'ur'])('%s (5): the switch off (absent or false): a Slower tap is today\'s, exactly: no sound, the 0.85 stretch, the same page', async (lang) => {
    const seen = {};
    for (const k of ['absent', false]) {
      const r = reader({ lang, gapsKey: k === 'absent' ? undefined : k });
      const root = await r.open();
      const n = counted(r);
      fire(root, 'slow');
      expect(n.slow).toBe(1);
      expect(pl(r).paused).toBe(true);
      expect(pl(r).t).toBe(0);
      expect(pl(r)._r).toBe(0.85);
      // paused mid-page, Slower off then on again: still no sound, no jump
      fire(root, 'main'); r.w.run(MID[lang].at); fire(root, 'main');
      fire(root, 'slow'); fire(root, 'slow');
      expect(n.slow).toBe(3);
      expect(pl(r).paused).toBe(true);
      expect(pl(r).t).toBe(MID[lang].at);
      expect(r.w.audios.filter((a) => !a.paused)).toEqual([]);
      seen[String(k)] = [root.innerHTML, mainText(root), root.querySelector('.wqs-slow').getAttribute('aria-pressed'), r.bodies.join('|')];
    }
    expect(seen.false).toEqual(seen.absent);
  });

  test('(7) one stored toggle per tap, every state, the switch on: 6 taps, 6 writes, alternating', async () => {
    const r = reader({ gapsKey: true });
    const root = await r.open();
    const n = counted(r);
    const got = [];
    const tap = () => { fire(root, 'slow'); got.push(r.store.getItem('wq_st_slow:' + KID) + (pl(r).paused ? '' : ' playing')); };
    tap();                                    // idle → ON (plays)
    r.w.run(500); tap();                      // playing → OFF
    tap();                                    // playing → ON
    fire(root, 'main'); tap();                // paused → OFF
    tap();                                    // paused → ON (plays)
    r.w.run(100); tap();                      // playing → OFF
    expect(n.slow).toBe(6);
    expect(got).toEqual(['1 playing', '0 playing', '1 playing', '0', '1 playing', '0 playing']);
  });
});
