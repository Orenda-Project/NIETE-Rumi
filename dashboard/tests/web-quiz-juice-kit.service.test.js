/**
 * The sound + motion kit (public/wq/wq-juice.js, window.WQJ).
 *
 * Runs the shipped file in a vm with the browser's boundaries faked: AudioContext (every oscillator, buffer
 * source and its start/stop times recorded), performance.now (a clock the test moves), localStorage, matchMedia,
 * Element.animate and navigator.vibrate. Each recipe is checked against what it is meant to be: its notes in order,
 * its length, nothing for a wrong answer louder or longer than for a right one, no sound when muted or hidden.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_PATH = path.join(__dirname, '..', 'public', 'wq', 'wq-juice.js');
const CSS_PATH = path.join(__dirname, '..', 'public', 'wq', 'wq-juice.css');
const SRC = fs.existsSync(SRC_PATH) ? fs.readFileSync(SRC_PATH, 'utf8') : '';

function fakeEl(tag) {
  const el = {
    tag, attrs: {}, style: {}, children: [], parentNode: null, listeners: {}, animations: [], className: '', textContent: '',
    classes: new Set(),
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    fire(n) { (this.listeners[n] || []).forEach((fn) => fn({})); },
    querySelectorAll() { return this.stars || []; },
    animate(frames, opts) { const a = { frames, opts, cancelled: false, cancel() { this.cancelled = true; if (this.oncancel) this.oncancel(); } }; this.animations.push(a); return a; },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
  };
  el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c) };
  return el;
}

function kit({ store = {}, reduced = false, lang = 'en', audio = true, noStore = false } = {}) {
  let clock = 1000;
  const nodes = []; // every oscillator / buffer source the kit made
  const contexts = [];
  const vib = [];
  const timers = [];
  const fetches = [];
  class FakeAudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.resumes = 0; this.suspends = 0; contexts.push(this); }
    resume() { this.resumes += 1; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.suspends += 1; this.state = 'suspended'; return Promise.resolve(); }
    createOscillator() {
      const o = { kind: 'osc', type: 'sine', f: [], connect() {}, start(t) { this.t0 = t; }, stop(t) { if (this.t1 == null) this.t1 = t; else this.stoppedAt = t; } };
      o.frequency = { setValueAtTime: (v, t) => o.f.push({ v, t }), linearRampToValueAtTime: (v, t) => o.f.push({ v, t, ramp: 1 }) };
      nodes.push(o); return o;
    }
    createGain() {
      const g = { peak: 0, connect() {} };
      g.gain = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime(v) { if (v > g.peak) g.peak = v; } };
      const last = nodes[nodes.length - 1]; if (last) last.gain = g;
      return g;
    }
    createBufferSource() { const s = { kind: 'buf', connect() {}, start(t, off, dur) { this.t0 = t; this.off = off; this.dur = dur; }, stop(t) { this.stoppedAt = t; } }; nodes.push(s); return s; }
    decodeAudioData(b, ok) { const buf = { duration: 4.8 }; if (ok) ok(buf); return Promise.resolve(buf); }
  }
  const ls = new Map(Object.entries(store));
  const docL = {}; const winL = {};
  const html = fakeEl('html'); html.lang = lang;
  const body = fakeEl('body');
  const doc = {
    visibilityState: 'visible', documentElement: html, body,
    createElement: (t) => fakeEl(t),
    getElementById: () => null,
    querySelectorAll: (sel) => (sel === '.wqj-cf' ? body.children.filter((c) => c.className === 'wqj-cf') : []),
    addEventListener: (n, fn) => { (docL[n] = docL[n] || []).push(fn); },
  };
  const ctx = {
    console, Promise,
    document: doc,
    performance: { now: () => clock },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    matchMedia: (q) => ({ matches: reduced && /reduce/.test(q) }),
    navigator: { vibrate: (p) => { vib.push(p); return true; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    fetch: (url, init) => { fetches.push({ url, init }); return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); },
    AbortController: function AbortController() { this.aborted = 0; const self = this; this.signal = {}; this.abort = () => { self.aborted += 1; }; },
    addEventListener: (n, fn) => { (winL[n] = winL[n] || []).push(fn); },
  };
  if (audio) ctx.AudioContext = FakeAudioContext;
  // a phone that blocks site storage: reading localStorage throws
  if (noStore) Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('SecurityError'); } });
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const tapDoc = () => (docL.pointerdown || []).forEach((fn) => fn({}));
  const fireDoc = (n) => (docL[n] || []).forEach((fn) => fn({}));
  const fireWin = (n) => (winL[n] || []).forEach((fn) => fn({}));
  const oscs = () => nodes.filter((n) => n.kind === 'osc');
  const tick = (ms) => { clock += ms; };
  const runTimers = () => timers.filter((t) => t.live).forEach((t) => { t.live = false; t.fn(); });
  return { J: ctx.WQJ, ctx, nodes, oscs, contexts, vib, timers, fetches, tapDoc, fireDoc, fireWin, tick, runTimers, ls, html, body, fakeEl };
}
const flush = () => new Promise((r) => setImmediate(r));

// One recipe's sound as [first Hz of each note in start order], its length in ms, its loudest gain.
function shape(oscs) {
  const t0 = Math.min(...oscs.map((o) => o.t0));
  const t1 = Math.max(...oscs.map((o) => o.t1));
  const seq = [...oscs].sort((a, b) => a.t0 - b.t0).map((o) => Math.round(o.f[0].v));
  return { seq, ms: Math.round((t1 - t0) * 1000), peak: Math.max(...oscs.map((o) => (o.gain ? o.gain.peak : 0))), types: oscs.map((o) => o.type) };
}
const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
// the stop time carries a 20 ms tail for the release past the last ramp; the recipe's own length is without it
const len = (s) => s.ms - 20;

describe('the kit loads and is one API', () => {
  test('window.WQJ carries every call the screens use', () => {
    const { J } = kit();
    expect(J).toBeTruthy();
    ['tap', 'correct', 'wrong', 'word', 'sentence', 'streak', 'finish', 'badge', 'dayDot', 'mic', 'after', 'muted', 'mute', 'toggle', 'stopAll', 'pop', 'wobble', 'fly', 'confetti', 'autoNext', 'skin', 'chunk']
      .forEach((k) => expect(typeof J[k]).toBe('function'));
  });

  test('no AudioContext before the first tap; the first tap makes and resumes it', () => {
    const k = kit();
    expect(k.contexts.length).toBe(0);
    k.tapDoc();
    expect(k.contexts.length).toBe(1);
    expect(k.contexts[0].resumes).toBe(1);
    expect(k.contexts[0].state).toBe('running');
  });

  test('the page root gets the one class the press style hangs on', () => {
    const k = kit();
    expect(k.html.classes.has('wq-juice')).toBe(true);
  });
});

describe('each recipe is the sound it is meant to be', () => {
  test('a right answer: rising C6 → G6, 220 ms, sine + triangle, gain 0.6', () => {
    const k = kit(); k.tapDoc();
    k.J.correct({});
    const s = shape(k.oscs());
    expect(uniq(s.seq)).toEqual([1047, 1568]);
    expect(len(s)).toBe(220);
    expect(s.peak).toBeCloseTo(0.6, 5);
    expect(uniq(s.types).sort()).toEqual(['sine', 'triangle']);
  });

  test('a wrong answer: one soft triangle "bup" E5 gliding to D5, 120 ms, gain 0.35, never louder or longer than right', () => {
    const k = kit(); k.tapDoc();
    k.J.wrong({});
    const o = k.oscs();
    expect(o.length).toBe(1);
    expect(o[0].type).toBe('triangle');
    expect(Math.round(o[0].f[0].v)).toBe(659);
    expect(Math.round(o[o.length - 1].f[1].v)).toBe(587);
    const s = shape(o);
    expect(len(s)).toBe(120);
    expect(s.peak).toBeCloseTo(0.35, 5);
    const r = kit(); r.tapDoc(); r.J.correct({});
    expect(s.peak).toBeLessThan(shape(r.oscs()).peak);
    expect(len(s)).toBeLessThan(len(shape(r.oscs())));
    expect(k.vib).toEqual([]); // no buzz on a wrong answer
  });

  test('a word read: a tink E6 → G6 in 90 ms', () => {
    const k = kit(); k.tapDoc();
    expect(k.J.word({ i: 0, ok: true })).toBe(true);
    const s = shape(k.oscs());
    expect(s.seq).toEqual([1319, 1568]);
    expect(len(s)).toBe(90);
  });

  test('a sentence (and the day-dot): the arpeggio C6 E6 G6 in 220 ms', () => {
    const k = kit(); k.tapDoc();
    k.J.sentence();
    const s = shape(k.oscs());
    expect(s.seq).toEqual([1047, 1319, 1568]);
    expect(len(s)).toBe(220);
  });

  test('the finish fanfare (before the sprite is in) lasts 1.8 s and is in a major key', () => {
    const k = kit(); k.tapDoc();
    k.J.finish({});
    const s = shape(k.oscs());
    expect(len(s)).toBe(1800);
    expect(s.seq.slice(0, 3)).toEqual([523, 659, 784]); // C E G
  });

  test('the sticker jingle (before the sprite is in) lasts 2.0 s', () => {
    const k = kit(); k.tapDoc();
    k.J.badge(null);
    expect(len(shape(k.oscs()))).toBe(2000);
  });

  test('a run of right answers: 3 adds an octave layer, 5 the triad\'s third (320 ms), 10 a 600 ms chord + sparkle', () => {
    const k = kit(); k.tapDoc();
    for (let i = 0; i < 2; i++) k.J.correct({});
    let n = k.oscs().length;
    k.J.correct({});
    const third = k.oscs().slice(n);
    expect(third.some((o) => Math.round(o.f[0].v) === 2093)).toBe(true); // C7, the octave
    for (let i = 0; i < 1; i++) k.J.correct({});
    n = k.oscs().length;
    k.J.correct({});
    const fifth = shape(k.oscs().slice(n));
    expect(len(fifth)).toBe(320);
    for (let i = 0; i < 4; i++) k.J.correct({});
    n = k.oscs().length;
    k.J.correct({});
    const tenth = k.oscs().slice(n).filter((o) => o.f[0].v < 2000 && o.t1 - o.t0 > 0.5);
    expect(tenth.length).toBe(3);
    expect(k.vib).toContainEqual([20, 40, 20]);
  });

  test('a wrong answer starts the run again: the third right answer after it is a plain chime', () => {
    const k = kit(); k.tapDoc();
    k.J.correct({}); k.J.correct({}); k.J.wrong({});
    expect(k.J.correct({})).toBe(1);
  });
});

describe('never too much', () => {
  test('a word tink at most once per 150 ms', () => {
    const k = kit(); k.tapDoc();
    expect(k.J.word({ i: 0 })).toBe(true);
    k.tick(100);
    expect(k.J.word({ i: 1 })).toBe(false);
    k.tick(49);
    expect(k.J.word({ i: 2 })).toBe(false);
    k.tick(1);
    expect(k.J.word({ i: 3 })).toBe(true);
    expect(k.oscs().length).toBe(4); // two tinks of two notes
  });

  test('a word marked not read makes no sound', () => {
    const k = kit(); k.tapDoc();
    expect(k.J.word({ i: 0, ok: false })).toBe(false);
    expect(k.oscs().length).toBe(0);
  });

  test('no more than 30 sounds a minute (word tinks aside)', () => {
    const k = kit(); k.tapDoc();
    for (let i = 0; i < 40; i++) { k.J.sentence(); k.tick(100); }
    expect(k.oscs().length).toBe(30 * 3);
    k.tick(60000);
    k.J.sentence();
    expect(k.oscs().length).toBe(31 * 3);
  });

  test('the microphone window: every sound but the word tink and the sentence beat is held back; the tink at 0.5', () => {
    const k = kit(); k.tapDoc();
    k.J.mic(true);
    k.J.correct({}); k.J.finish({}); k.J.streak(3);
    expect(k.oscs().length).toBe(0);
    expect(k.vib).toEqual([]); // no buzz when its sound is held back
    k.J.word({ i: 0 });
    expect(shape(k.oscs()).peak).toBeCloseTo(0.5, 5); // JUICE §0.3: the per-word tink at 0.5 gain
    k.J.mic(false);
    k.J.sentence();
    expect(k.oscs().length).toBe(5);
  });

  test('a sentence read under the microphone: its arpeggio at half gain AND its buzz; muted: neither', () => {
    const k = kit(); k.tapDoc();
    k.J.mic(true);
    k.J.sentence();
    const s = shape(k.oscs());
    expect(s.seq).toEqual([1047, 1319, 1568]);
    expect(s.peak).toBeCloseTo(0.3, 5);
    expect(k.vib).toEqual([15]);
    const m = kit({ store: { wq_sound: 'false' } }); m.tapDoc();
    m.J.mic(true); m.J.sentence(); m.J.mic(false); m.J.sentence();
    expect(m.nodes.length).toBe(0);
    expect(m.vib).toEqual([]);
  });

  test('a mic chunk boundary: no sound for 150 ms after it, then the tink again', () => {
    const k = kit(); k.tapDoc();
    k.J.mic(true);
    k.J.chunk();
    k.J.word({ i: 0 }); k.J.sentence();
    expect(k.oscs().length).toBe(0);
    expect(k.vib).toEqual([]);
    k.tick(150);
    k.J.word({ i: 1 });
    expect(k.oscs().length).toBe(2);
    k.J.mic(false); k.J.chunk(); k.J.sentence(); // outside the mic window a chunk holds nothing
    expect(k.oscs().length).toBe(5);
  });

  test('the finish stars take one of the 3 animation slots (never past the cap)', () => {
    const k = kit(); k.tapDoc();
    const card = k.fakeEl('div');
    card.stars = [1, 2, 3, 4, 5].map(() => k.fakeEl('i'));
    k.J.finish({ el: card });
    expect(card.stars.every((x) => x.animations.length === 1)).toBe(true);
    const a = k.fakeEl('b'); const b = k.fakeEl('b');
    k.J.pop(a); k.J.pop(b);
    expect([a.animations.length, b.animations.length]).toEqual([1, 0]); // card + stars + a = 3
    k.J.stopAll();
    expect(card.stars.every((x) => x.animations[0].cancelled)).toBe(true);
  });

  test('no more than 3 animations at once', () => {
    const k = kit();
    const els = [1, 2, 3, 4].map(() => k.fakeEl('b'));
    els.forEach((e) => k.J.pop(e));
    expect(els.map((e) => e.animations.length)).toEqual([1, 1, 1, 0]);
  });
});

describe('mute', () => {
  test('muted (the page\'s own switch, wq_sound false): no AudioContext and no audio node, ever', () => {
    const k = kit({ store: { wq_sound: 'false' } });
    k.tapDoc();
    k.J.correct({}); k.J.wrong({}); k.J.word({ i: 0 }); k.J.sentence(); k.J.finish({}); k.J.badge(null); k.J.streak(3);
    expect(k.contexts.length).toBe(0);
    expect(k.nodes.length).toBe(0);
    expect(k.J.muted()).toBe(true);
    expect(k.fetches.length).toBe(0); // and the sprite is never fetched
  });

  test('muted: no vibration either (never a buzz when its sound is refused)', () => {
    const k = kit({ store: { wq_sound: 'false' } }); k.tapDoc();
    k.J.correct({}); k.J.sentence(); k.J.finish({}); k.J.badge(null);
    for (let i = 0; i < 9; i++) k.J.correct({});
    expect(k.vib).toEqual([]);
  });

  test('no Web Audio on the phone: no sound, so no vibration either', () => {
    const k = kit({ audio: false }); k.tapDoc();
    k.J.correct({}); k.J.sentence(); k.J.finish({}); k.J.badge(null);
    expect(k.vib).toEqual([]);
  });

  test('a finish before any tap (a finished quiz reopened): no sound context, no notes queued, no buzz — nothing sounds at the next tap', () => {
    const k = kit();
    k.J.finish({}); k.J.correct({});
    expect(k.contexts.length).toBe(0);
    expect(k.nodes.length).toBe(0);
    expect(k.vib).toEqual([]);
    k.tapDoc();
    expect(k.nodes.length).toBe(0);
  });

  test('a phone that blocks storage: mute still holds for the page (kept in memory)', () => {
    const k = kit({ noStore: true }); k.tapDoc();
    k.J.mute(true);
    expect(k.J.muted()).toBe(true);
    const before = k.nodes.length;
    k.J.correct({}); k.J.finish({});
    expect(k.nodes.length).toBe(before);
    expect(k.vib).toEqual([]);
    k.J.mute(false);
    expect(k.J.muted()).toBe(false);
  });

  test('the home\'s key (wq_snd "0") is the same switch: muted', () => {
    const k = kit({ store: { wq_snd: '0' } });
    k.tapDoc(); k.J.correct({});
    expect(k.nodes.length).toBe(0);
    expect(k.J.muted()).toBe(true);
    expect(kit({ store: { wq_snd: '1' } }).J.muted()).toBe(false);
  });

  test('the toggle flips the same switch, persisted, and says its state', () => {
    const k = kit();
    const b = k.fakeEl('button');
    k.J.toggle(b);
    expect(b.attrs['aria-pressed']).toBe('true');
    b.fire('click');
    expect(k.ls.get('wq_sound')).toBe('false');
    expect(k.ls.get('wq_snd')).toBe('0');
    expect(b.attrs['aria-pressed']).toBe('false');
    expect(k.J.muted()).toBe(true);
    b.fire('click');
    expect(k.ls.get('wq_sound')).toBe('true');
  });

  test('the toggle draws inline SVG, never an emoji (old Android phones draw new emoji as empty boxes)', () => {
    const k = kit();
    const b = k.fakeEl('button');
    k.J.toggle(b);
    expect(b.innerHTML).toMatch(/^<svg [^>]*aria-hidden="true"/);
    expect(b.innerHTML).not.toMatch(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u);
    const on = b.innerHTML;
    b.fire('click');
    expect(b.innerHTML).toMatch(/^<svg /);
    expect(b.innerHTML).not.toBe(on);
  });

  test('the toggle\'s size: the kit css gives its button at least 48 × 48 px', () => {
    const css = fs.existsSync(CSS_PATH) ? fs.readFileSync(CSS_PATH, 'utf8') : '';
    expect(css).toMatch(/\.wqj-snd\{[^}]*min-width:48px[^}]*min-height:48px/);
  });
});

describe('leaving the page stops everything', () => {
  test.each([['win', 'pagehide', false], ['doc', 'visibilitychange', true], ['doc', 'freeze', false], ['doc', 'wq-silence', false]])('%s %s', (where, name, hide) => {
    const k = kit(); k.tapDoc();
    const el = k.fakeEl('div');
    k.J.finish({ el });
    const fired = jest.fn();
    k.J.after(900, fired);
    const before = k.nodes.length;
    expect(before).toBeGreaterThan(0);
    if (hide) k.ctx.document.visibilityState = 'hidden';
    (where === 'win' ? k.fireWin : k.fireDoc)(name);
    expect(k.nodes.every((n) => n.stoppedAt === 0)).toBe(true);
    expect(k.contexts[0].suspends).toBe(1);
    expect(el.animations.every((a) => a.cancelled)).toBe(true);
    expect(k.body.children.filter((c) => c.className === 'wqj-cf').length).toBe(0); // the confetti is gone
    k.runTimers();
    expect(fired).not.toHaveBeenCalled(); // the auto-advance does not happen behind the child's back
  });

  test('while the page is hidden nothing sounds', () => {
    const k = kit(); k.tapDoc();
    k.ctx.document.visibilityState = 'hidden';
    k.J.correct({}); k.J.word({ i: 0 }); k.J.finish({});
    expect(k.nodes.length).toBe(0);
    expect(k.body.children.filter((c) => c.className === 'wqj-cf').length).toBe(0); // no confetti behind the child's back
  });

  test('back in view, the context is resumed but nothing replays', () => {
    const k = kit(); k.tapDoc();
    k.ctx.document.visibilityState = 'hidden'; k.fireDoc('visibilitychange');
    k.ctx.document.visibilityState = 'visible'; k.fireDoc('visibilitychange');
    expect(k.contexts[0].state).toBe('running');
    expect(k.nodes.length).toBe(0);
  });
});

describe('the sprite', () => {
  test('is fetched once, on the first right answer, never on load', async () => {
    const k = kit(); k.tapDoc();
    expect(k.fetches.length).toBe(0);
    k.J.correct({}); k.J.correct({});
    expect(k.fetches.map((f) => f.url)).toEqual(['/wq/snd/juice-1.opus']);
  });

  test('once decoded, the finish plays its fanfare from the sprite: 0 – 1.8 s', async () => {
    const k = kit(); k.tapDoc();
    k.J.correct({});
    await flush(); await flush(); await flush();
    k.J.finish({});
    const b = k.nodes.filter((n) => n.kind === 'buf');
    expect(b.length).toBe(1);
    expect(b[0].off).toBe(0);
    expect(b[0].dur).toBe(1.8);
  });

  test('the sprite file is on disk, an Ogg Opus, ≤ 14 KB', () => {
    const p = path.join(__dirname, '..', 'public', 'wq', 'snd', 'juice-1.opus');
    expect(fs.existsSync(p)).toBe(true);
    const b = fs.readFileSync(p);
    expect(b.slice(0, 4).toString('latin1')).toBe('OggS');
    expect(b.indexOf('OpusHead')).toBeGreaterThan(0);
    expect(b.length).toBeLessThanOrEqual(14 * 1024);
  });
});

describe('the right answer moves on by itself (WQJ.autoNext)', () => {
  function root(k) {
    const r = k.fakeEl('main'); r.next = k.fakeEl('button'); r.attrs['data-m'] = 'M7';
    r.querySelector = (sel) => (sel === '#wq-next' ? r.next : null);
    return r;
  }
  test('900 ms after the voice ends, once, while the same Next is on screen', () => {
    const k = kit(); const r = root(k); let went = 0;
    const done = k.J.autoNext(r, () => { went += 1; });
    expect(typeof done).toBe('function');
    expect(k.timers.length).toBe(0); // nothing until the voice has ended
    done();
    expect(k.timers.filter((t) => t.live).map((t) => t.ms)).toEqual([900]);
    k.runTimers();
    expect(went).toBe(1);
  });
  test('not when the child tapped Next already, the screen moved on, or everything stopped', () => {
    const k = kit(); let went = 0; const go = () => { went += 1; };
    const a = root(k); const d1 = k.J.autoNext(a, go); d1(); a.next = k.fakeEl('button'); k.runTimers();
    const b = root(k); const d2 = k.J.autoNext(b, go); d2(); b.attrs['data-m'] = 'M6'; k.runTimers();
    const c = root(k); const d3 = k.J.autoNext(c, go); d3(); k.J.stopAll(); k.runTimers();
    expect(went).toBe(0);
  });
});

describe('the page\'s own sound button, drawn by the kit (WQJ.skin)', () => {
  // the page's own click handler is registered first and flips aria-pressed; the kit only redraws and keeps both keys
  function pageButton(k, on) {
    const b = k.fakeEl('button'); b.attrs['aria-pressed'] = String(on); b.textContent = on ? '\u{1F514}' : '\u{1F515}';
    b.addEventListener('click', function () { const now = b.attrs['aria-pressed'] !== 'true'; b.setAttribute('aria-pressed', now); b.textContent = now ? '\u{1F514}' : '\u{1F515}'; k.ls.set('wq_sound', String(now)); });
    return b;
  }
  test('inline SVG in place of the emoji, its state from the page, one flip per tap', () => {
    const k = kit(); const b = pageButton(k, true);
    k.J.skin(b);
    expect(b.innerHTML).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(b.innerHTML).toContain('M16 9a4 4 0 0 1 0 6'); // the waves: on
    b.fire('click');
    expect(b.attrs['aria-pressed']).toBe('false');
    expect(b.innerHTML).toContain('M16 9l5 6'); // the cross: off
    expect(b.innerHTML).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(k.ls.get('wq_snd')).toBe('0'); // the home's key follows the page's button
    expect(k.J.muted()).toBe(true);
    b.fire('click');
    expect(b.attrs['aria-pressed']).toBe('true');
    expect(k.ls.get('wq_snd')).toBe('1');
    expect(k.J.muted()).toBe(false);
  });
  test('no button: nothing happens', () => {
    const k = kit();
    expect(() => k.J.skin(null)).not.toThrow();
  });
});

describe('the panel\'s two fixes (the kit css)', () => {
  const css = () => fs.readFileSync(CSS_PATH, 'utf8');
  test('the streak word is drawn over the page, so nothing below it moves', () => {
    expect(css()).toMatch(/\.wqj-strip\{[^}]*position:fixed/);
    expect(css()).toMatch(/\.wqj-strip\{[^}]*pointer-events:none/);
  });
  test('the confetti stays in the top band, clear of the card\'s buttons', () => {
    expect(css()).toMatch(/100%\{transform:translateY\(40vh\)/);
  });
});

describe('the not-yet answer on the real quiz page (the kit css)', () => {
  const css = () => fs.readFileSync(CSS_PATH, 'utf8');
  test('the picked option: amber outline #E65100 and an underline, no fill (JUICE §1 row 2)', () => {
    const m = css().match(/\.wq-juice \.wq-opt\.wq-picked\{([^}]*)\}/);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/border-color:#E65100!important/i);
    expect(m[1]).toMatch(/background:#fff!important/i);
    expect(m[1]).toMatch(/text-decoration:underline/);
  });
  test('the picture and order answers get the same amber edge', () => {
    expect(css()).toMatch(/\.wq-juice \.wq-hot\.wq-picked\{[^}]*#E65100/i);
    expect(css()).toMatch(/\.wq-juice \.wq-seq\.wq-picked,\.wq-juice \.wq-mgrid\.wq-picked\{[^}]*#E65100/i);
  });
  test('never red', () => {
    expect(css()).not.toMatch(/#(f00|ff0000|dc2626|ef4444|b91c1c)\b/i);
  });
});

describe('motion', () => {
  test('a wrong answer wobbles ±3 px over 240 ms; a right answer pops', () => {
    const k = kit(); k.tapDoc();
    const bad = k.fakeEl('b'); const good = k.fakeEl('b');
    k.J.wrong({ el: bad });
    expect(bad.animations[0].opts.duration).toBe(240);
    expect(JSON.stringify(bad.animations[0].frames)).toMatch(/translateX\(-3px\).*translateX\(3px\)/);
    k.J.correct({ el: good });
    expect(JSON.stringify(good.animations[0].frames)).toMatch(/scale\(1\.08\)/);
  });

  test('the finish: the card rises at +300 ms for 400 ms, its stars light 150 ms apart within 900 ms, 24 confetti for 1.6 s', () => {
    const k = kit(); k.tapDoc();
    const card = k.fakeEl('div');
    card.stars = [1, 2, 3, 4, 5].map(() => k.fakeEl('i'));
    k.J.finish({ el: card });
    expect(card.animations[0].opts.delay).toBe(300);
    expect(card.animations[0].opts.duration).toBe(400);
    const delays = card.stars.map((s) => s.animations[0].opts.delay);
    expect(delays[1] - delays[0]).toBe(150);
    expect(delays[4] + 150 - delays[0]).toBeLessThanOrEqual(900);
    const cf = k.body.children.find((c) => c.className === 'wqj-cf');
    expect(cf.children.length).toBe(24);
    expect(cf.children[0].style.animationDuration).toBe('1600ms');
    expect(k.vib).toContainEqual([30, 50, 30, 50, 60]);
  });

  test('reduced motion: every move becomes a 150 ms fade, no confetti, the sound stays', () => {
    const k = kit({ reduced: true }); k.tapDoc();
    const el = k.fakeEl('b'); const card = k.fakeEl('div');
    k.J.wrong({ el });
    k.J.finish({ el: card });
    [el, card].forEach((e) => {
      expect(e.animations[0].opts.duration).toBe(150);
      expect(JSON.stringify(e.animations[0].frames)).not.toMatch(/translate|scale/);
    });
    expect(k.body.children.filter((c) => c.className === 'wqj-cf').length).toBe(0);
    expect(k.oscs().length).toBeGreaterThan(0);
  });

  test('the streak strip says the word, never a count, in the page\'s language', () => {
    const words = { en: ['Great!', 'Super!', 'Wow!'], ur: ['بہت خوب!', 'زبردست!', 'شاندار!'] };
    for (const lang of ['en', 'ur']) {
      const k = kit({ lang });
      const holder = k.fakeEl('div'); const at = k.fakeEl('div'); holder.appendChild(at);
      [3, 5, 10].forEach((n, i) => {
        expect(k.J.streak(n, at)).toBe(true);
        const s = holder.children[holder.children.length - 1];
        expect(s.textContent).toBe(words[lang][i]);
        expect(s.textContent).not.toMatch(/[0-9۰-۹]/);
      });
      expect(k.J.streak(4, at)).toBe(false);
    }
  });
});

describe('the weight', () => {
  test('the script ≤ 6 KB and the css ≤ 1 KB gzipped; the whole kit with the sprite ≤ 30 KB', () => {
    const zlib = require('zlib');
    const js = zlib.gzipSync(fs.readFileSync(SRC_PATH), { level: 9 }).length;
    const css = zlib.gzipSync(fs.readFileSync(CSS_PATH), { level: 9 }).length;
    const opus = fs.statSync(path.join(__dirname, '..', 'public', 'wq', 'snd', 'juice-1.opus')).size;
    expect(js).toBeLessThanOrEqual(6 * 1024);
    expect(css).toBeLessThanOrEqual(1024);
    expect(js + css + opus).toBeLessThanOrEqual(30 * 1024);
    // the cap is on the source; the served gz (web_quiz_wq_strip on: whole-line comments stripped) is printed beside it
    const served = zlib.gzipSync(require('../lib/wq-strip').stripLineComments(fs.readFileSync(SRC_PATH)), { level: 9 }).length;
    console.log(`${path.basename(SRC_PATH)} gz: source ${js}, served ${served} (cap ${6 * 1024} on the source)`);
  });
});
