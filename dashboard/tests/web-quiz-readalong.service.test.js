/**
 * The read-along player (public/wq/wq-readalong.js) run in a vm with a small fake DOM, a fake audio element whose
 * clock the test holds, and a frame queue the test flushes: the timing parser, the highlight scheduler (which word is
 * lit at which time, with the lead), play/pause/replay, tap-a-word, one-word play, image mode, the audio unlock,
 * pagehide, destroy, and the size budget.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const FILE = path.join(__dirname, '..', 'public', 'wq', 'wq-readalong.js');
const SRC = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';

function node(tag) {
  const n = {
    tag, children: [], attrs: {}, style: {}, l: {}, className: '', parent: null, _text: '',
    appendChild(c) { c.parent = n; n.children.push(c); return c; },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return n.attrs[k]; },
    removeAttribute(k) { delete n.attrs[k]; },
    addEventListener(e, fn) { (n.l[e] = n.l[e] || []).push(fn); },
    removeEventListener(e, fn) { n.l[e] = (n.l[e] || []).filter((f) => f !== fn); },
    fire(e) { (n.l[e] || []).slice().forEach((fn) => fn({ preventDefault() {} })); },
    click() { n.fire('click'); },
  };
  Object.defineProperty(n, 'textContent', { get: () => n._text + n.children.map((c) => c.textContent).join(''), set: (v) => { n._text = String(v); n.children = []; } });
  Object.defineProperty(n, 'innerHTML', { get: () => '', set: () => { n.children = []; n._text = ''; } });
  return n;
}
const all = (n, pred, out = []) => { if (pred(n)) out.push(n); n.children.forEach((c) => all(c, pred, out)); return out; };
const byClass = (n, c) => all(n, (x) => String(x.className).split(' ').includes(c));

function load({ playRejects = false, imgWidth = 540, raf = true } = {}) {
  const frames = [];
  const events = [];
  const audios = [];
  const wl = {};
  const dl = {};
  class Audio {
    constructor() { this.l = {}; this.currentTime = 0; this.duration = NaN; this.paused = true; this.plays = 0; this.attrs = {}; audios.push(this); }
    set src(v) { this.attrs.src = v; }
    get src() { return this.attrs.src; }
    removeAttribute(k) { delete this.attrs[k]; }
    load() {}
    addEventListener(n, fn) { (this.l[n] = this.l[n] || []).push(fn); }
    removeEventListener(n, fn) { this.l[n] = (this.l[n] || []).filter((f) => f !== fn); }
    fire(n) { (this.l[n] || []).slice().forEach((fn) => fn({})); }
    // as the HTML spec (and Chrome) do: play() on an element that has ended starts again from 0, whatever was just set
    play() { this.plays += 1; if (playRejects) return Promise.reject(new Error('NotAllowedError')); if (this.ended) { this.ended = false; this.currentTime = 0; } this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const head = node('head');
  const document = {
    head, body: node('body'), visibilityState: 'visible',
    createElement: (t) => { const n = node(t); if (t === 'img') n.clientWidth = imgWidth; return n; },
    createTextNode: (t) => { const n = node('#text'); n.textContent = t; return n; },
    getElementById: (id) => all(head, (x) => x.id === id)[0] || null,
    addEventListener(n, fn) { (dl[n] = dl[n] || []).push(fn); },
    removeEventListener(n, fn) { dl[n] = (dl[n] || []).filter((f) => f !== fn); },
  };
  function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  const window = {
    addEventListener(n, fn) { (wl[n] = wl[n] || []).push(fn); },
    removeEventListener(n, fn) { wl[n] = (wl[n] || []).filter((f) => f !== fn); },
    dispatchEvent(e) { events.push(e.detail); },
    ...(raf ? { requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame: (h) => { frames[h - 1] = null; } } : {}),
  };
  const ctx = { window, document, Audio, CustomEvent, console, setTimeout, clearTimeout, Promise, fetch: () => Promise.reject(new Error('no net')) };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const audio = () => audios[audios.length - 1];
  // one frame at audio time t ms: the pending frame callbacks run once
  const at = (ms) => { audio().currentTime = ms / 1000; const due = frames.splice(0); due.forEach((f) => f && f()); };
  return { RA: window.WQReadAlong, document, window, frames, events, audio, at, wl, dl, flush: () => new Promise((r) => setImmediate(r)) };
}

const DATA = {
  v: 1, id: 'en.read.2.story01', lang: 'en', dir: 'ltr',
  audio: { url: 'https://r2.test/a.ogg?sig', ms: 4000, mime: 'audio/ogg; codecs=opus' },
  words: [
    { i: 0, t: 'Asad', s_ms: 200, e_ms: 600 },
    { i: 1, t: 'played', s_ms: 700, e_ms: 1100 },
    { i: 2, t: 'cricket.', s_ms: 1200, e_ms: 1800 },
    { i: 3, t: 'He', s_ms: 2600, e_ms: 2800 },
    { i: 4, t: 'won.', s_ms: 2900, e_ms: 3500 },
  ],
  pace_wpm: 100,
};
const lit = (el) => byClass(el, 'wqra-on').map((s) => s.getAttribute('data-i'));

describe('read-along player: the timing parser', () => {
  test('a valid file parses to words in order with numbers', () => {
    const { RA } = load();
    const d = RA.parse(DATA);
    expect(d.words.map((w) => [w.i, w.t, w.s, w.e])).toEqual([[0, 'Asad', 200, 600], [1, 'played', 700, 1100], [2, 'cricket.', 1200, 1800], [3, 'He', 2600, 2800], [4, 'won.', 2900, 3500]]);
    expect(d.dir).toBe('ltr');
    expect(RA.parse({ ...DATA, lang: 'ur', dir: undefined }).dir).toBe('rtl');
  });
  test.each([
    ['another version', { ...DATA, v: 2 }],
    ['an audio without a url', { ...DATA, audio: {} }],
    ['no words', { ...DATA, words: [] }],
    ['an index gap', { ...DATA, words: [DATA.words[0], { ...DATA.words[1], i: 2 }] }],
    ['an end before its start', { ...DATA, words: [{ i: 0, t: 'a', s_ms: 500, e_ms: 100 }] }],
    ['starts going back', { ...DATA, words: [{ i: 0, t: 'a', s_ms: 500, e_ms: 600 }, { i: 1, t: 'b', s_ms: 400, e_ms: 700 }] }],
    ['a time that is not a number', { ...DATA, words: [{ i: 0, t: 'a', s_ms: 'x', e_ms: 600 }] }],
  ])('refuses %s', (_, bad) => {
    const { RA } = load();
    expect(() => RA.parse(bad)).toThrow(/readalong/);
  });
  test('a bad file mounts as an error, never a crash, and its methods do nothing', () => {
    const { RA, document } = load();
    const states = [];
    const p = RA.mount(document.createElement('div'), { ...DATA, v: 9 }, { onState: (s) => states.push(s) });
    expect(p.state).toBe('error');
    expect(states).toEqual(['error']);
    expect(() => { p.play(); p.seekToWord(1); p.destroy(); }).not.toThrow();
  });
});

describe('read-along player: the highlight scheduler (fake clock)', () => {
  test('indexAt: the last word whose start is at or before t; −1 before the first', () => {
    const { RA } = load();
    const ws = RA.parse(DATA).words;
    expect([0, 199, 200, 650, 700, 2599, 2600, 9999].map((t) => RA.indexAt(ws, t))).toEqual([-1, -1, 0, 0, 1, 2, 3, 4]);
  });

  test('the pill leads each word by 50 ms, holds through a pause between sentences, and onWord fires once per word', () => {
    const { RA, document, at } = load();
    const el = document.createElement('div');
    const seen = [];
    const p = RA.mount(el, DATA, { onWord: (i) => seen.push(i) });
    p.play();
    at(100); expect(lit(el)).toEqual([]);
    at(149); expect(lit(el)).toEqual([]);
    at(150); expect(lit(el)).toEqual(['0']);       // 200 − 50
    at(400); expect(lit(el)).toEqual(['0']);
    at(650); expect(lit(el)).toEqual(['1']);
    at(1150); expect(lit(el)).toEqual(['2']);
    at(2200); expect(lit(el)).toEqual(['2']);      // the gap after "cricket." keeps it lit
    at(2550); expect(lit(el)).toEqual(['3']);
    at(2860); expect(lit(el)).toEqual(['4']);
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  test('leadMs is honoured and clamped to 0…90', () => {
    const a = load();
    const el = a.document.createElement('div');
    a.RA.mount(el, DATA, { leadMs: 0 }).play();
    a.at(199); expect(lit(el)).toEqual([]);
    a.at(200); expect(lit(el)).toEqual(['0']);
    const b = load();
    const el2 = b.document.createElement('div');
    b.RA.mount(el2, DATA, { leadMs: 500 }).play();
    b.at(109); expect(lit(el2)).toEqual([]);
    b.at(110); expect(lit(el2)).toEqual(['0']);   // 200 − 90
  });

  test('pause stops the frame loop and keeps the word; play resumes; events say so', () => {
    const { RA, document, at, frames, events, audio } = load();
    const el = document.createElement('div');
    const states = [];
    const p = RA.mount(el, DATA, { onState: (s) => states.push(s) });
    p.play();
    at(700);
    p.pause();
    expect(audio().paused).toBe(true);
    expect(frames.filter(Boolean)).toHaveLength(0);
    expect(lit(el)).toEqual(['1']);
    p.toggle();
    expect(p.state).toBe('playing');
    expect(states).toEqual(['ready', 'playing', 'paused', 'playing']);
    expect(events.map((e) => e.type)).toEqual(['started', 'word', 'paused', 'resumed']);
  });

  test('the end fires exactly once (ended, or the clock past the stored length), clears the pill, offers replay', () => {
    const { RA, document, at, audio, events } = load();
    const el = document.createElement('div');
    let ends = 0;
    const p = RA.mount(el, DATA, { onEnd: () => { ends += 1; } });
    p.play();
    at(3000);
    at(4000);                     // past audio.ms: the end, even if the stream never says 'ended'
    audio().fire('ended');        // and then it does: still once
    expect(ends).toBe(1);
    expect(p.state).toBe('ended');
    expect(lit(el)).toEqual([]);
    expect(events.filter((e) => e.type === 'finished')).toHaveLength(1);
    const btn = byClass(el, 'wqra-btn')[0];
    expect(btn.getAttribute('aria-label')).toBe('Again');
    btn.click();                  // replay from the start
    expect(audio().currentTime).toBe(0);
    expect(p.state).toBe('playing');
    at(300);
    expect(lit(el)).toEqual(['0']);
  });

  test('tap a word: the audio seeks to its start (less the lead), plays, and that word is lit at once', () => {
    const { RA, document, audio, events, at } = load();
    const el = document.createElement('div');
    const taps = [];
    const p = RA.mount(el, DATA, { onWordTap: (i) => taps.push(i) });
    byClass(el, 'wqra-w')[3].click();
    expect(audio().currentTime).toBeCloseTo(2.55, 5);
    expect(audio().plays).toBe(1);
    expect(lit(el)).toEqual(['3']);
    expect(taps).toEqual([3]);
    expect(events.map((e) => e.type)).toContain('tap_word');
    at(2560); expect(lit(el)).toEqual(['3']);
    expect(p.state).toBe('playing');
  });

  test('tap a word AFTER the story ended: it plays from that word, not from the start (play() on an ended clip rewinds)', () => {
    const { RA, document, audio, at } = load();
    const el = document.createElement('div');
    const p = RA.mount(el, DATA, {});
    p.play();
    at(3600);
    audio().ended = true;   // the element's own state at its end
    audio().fire('ended');
    expect(p.state).toBe('ended');
    byClass(el, 'wqra-w')[3].click();
    expect(audio().currentTime).toBeCloseTo(2.55, 5);
    at(2560);
    expect(lit(el)).toEqual(['3']);
    audio().ended = true;
    p.playWord(1);
    expect(audio().currentTime).toBeCloseTo(0.7, 5);
  });

  test('playWord(i): the one word in the same voice, then it stops at the word\'s end', () => {
    const { RA, document, audio, at } = load();
    const el = document.createElement('div');
    const p = RA.mount(el, DATA, {});
    p.playWord(1);
    expect(audio().currentTime).toBeCloseTo(0.7, 5);
    at(900); expect(p.state).toBe('playing');
    at(1100); expect(p.state).toBe('paused');
    expect(audio().paused).toBe(true);
  });
});

describe('read-along player: the page', () => {
  test('text mode: one span per printed word, in order, with the language and direction', () => {
    const { RA, document } = load();
    const el = document.createElement('div');
    RA.mount(el, { ...DATA, lang: 'ur', dir: 'rtl', words: [{ i: 0, t: 'عمیر', s_ms: 0, e_ms: 300 }, { i: 1, t: 'چچا', s_ms: 400, e_ms: 700 }] }, {});
    const text = byClass(el, 'wqra-text')[0];
    expect(text.getAttribute('dir')).toBe('rtl');
    expect(text.getAttribute('lang')).toBe('ur');
    expect(byClass(el, 'wqra-w').map((s) => s.textContent)).toEqual(['عمیر', 'چچا']);
    expect(document.getElementById('wqra-css')).not.toBeNull();
  });

  test('never autoplays: mounting plays nothing until play()', () => {
    const { RA, document, audio } = load();
    const p = RA.mount(document.createElement('div'), DATA, {});
    expect(audio().plays).toBe(0);
    expect(p.state).toBe('ready');
    expect(audio().src).toBe('https://r2.test/a.ogg?sig');
  });

  test('a refused play (no unlock) leaves the button pulsing and reports paused; a tap tries again', async () => {
    const { RA, document, audio, flush } = load({ playRejects: true });
    const el = document.createElement('div');
    const states = [];
    const p = RA.mount(el, DATA, { onState: (s) => states.push(s) });
    p.play();
    await flush();
    const btn = byClass(el, 'wqra-btn')[0];
    expect(btn.className).toContain('wqra-pulse');
    expect(states[states.length - 1]).toBe('paused');
    btn.click();
    expect(audio().plays).toBe(2);
  });

  test('the page hidden or left pauses the voice', () => {
    const { RA, document, audio, wl, dl } = load();
    const p = RA.mount(document.createElement('div'), DATA, {});
    p.play();
    document.visibilityState = 'hidden';
    dl.visibilitychange.forEach((f) => f());
    expect(audio().paused).toBe(true);
    p.play();
    wl.pagehide.forEach((f) => f());
    expect(p.state).toBe('paused');
  });

  test('destroy drops the audio and every listener', () => {
    const { RA, document, audio, wl, dl } = load();
    const el = document.createElement('div');
    const p = RA.mount(el, DATA, {});
    p.play();
    p.destroy();
    expect(audio().src).toBeUndefined();
    expect(wl.pagehide).toHaveLength(0);
    expect(dl.visibilitychange).toHaveLength(0);
    expect(el.children).toHaveLength(0);
  });

  test('image mode: the pill sits on the printed word\'s box, scaled to the shown picture, inset 2 px; hit areas ≥ 40 px tall', () => {
    const { RA, document, at } = load({ imgWidth: 540 });   // a 1080-px picture shown at 540: scale 0.5
    const el = document.createElement('div');
    const d = { ...DATA, image: { url: 'https://r2.test/p.webp', w: 1080, h: 1600 },
      words: DATA.words.map((w, k) => ({ ...w, box: [100 + k * 120, 1200, 100, 40] })) };
    const p = RA.mount(el, d, {});
    expect(p.mode).toBe('image');
    const hits = byClass(el, 'wqra-hit');
    expect(hits).toHaveLength(5);
    expect(parseFloat(hits[0].style.height)).toBeGreaterThanOrEqual(40);
    p.play();
    at(700);   // word 1: box x 220 → 110 + 2, y 1200 → 600 + 2, w 100 → 50 − 4, h 40 → 20 − 4
    const pill = byClass(el, 'wqra-pill')[0];
    expect(pill.style.transform).toBe('translate(112px,602px)');
    expect(pill.style.width).toBe('46px');
    expect(pill.style.height).toBe('16px');
    expect(pill.style.opacity).toBe('1');
  });

  test('the story reader\'s names: mode overlay|strip, lead_ms, onFinished (once)', () => {
    const { RA, document, at, audio } = load();
    const d = { ...DATA, image: { url: 'p.webp', w: 1080, h: 1600 }, words: DATA.words.map((w, k) => ({ ...w, box: [k * 100, 0, 90, 40] })) };
    expect(RA.mount(document.createElement('div'), d, { mode: 'overlay' }).mode).toBe('image');
    expect(RA.mount(document.createElement('div'), d, { mode: 'strip' }).mode).toBe('text');
    const el = document.createElement('div');
    let fin = 0;
    const p = RA.mount(el, DATA, { lead_ms: 0, onFinished: () => { fin += 1; } });
    p.play();
    at(199); expect(lit(el)).toEqual([]);
    at(200); expect(lit(el)).toEqual(['0']);
    at(4000); audio().fire('ended');
    expect(fin).toBe(1);
  });

  test('a page not voiced yet (audio null) still shows its words, with no button, in a silent state; methods do nothing', () => {
    const { RA, document } = load();
    const el = document.createElement('div');
    const states = [];
    const p = RA.mount(el, { ...DATA, audio: null }, { onState: (s) => states.push(s) });
    expect(p.state).toBe('silent');
    expect(states).toEqual(['silent']);
    expect(byClass(el, 'wqra-w').map((x) => x.textContent)).toEqual(['Asad', 'played', 'cricket.', 'He', 'won.']);
    expect(byClass(el, 'wqra-btn')).toHaveLength(0);
    expect(() => { p.play(); p.seekToWord(2); p.playWord(1); p.destroy(); }).not.toThrow();
  });

  test('band: never a second pill — a band beside the picture (overlay/image) is ignored: one picture, ONE pill', () => {
    const { RA, document, at } = load({ imgWidth: 540 });
    const el = document.createElement('div');
    const d = { ...DATA, image: { url: 'p.webp', w: 1080, h: 1600 }, words: DATA.words.map((w, k) => ({ ...w, box: [100 + k * 100, 1200, 90, 40] })) };
    const p = RA.mount(el, d, { mode: 'overlay', band: { url: 'band.webp', x: 100, y: 1180, w: 540, h: 100 } });
    expect(p.mode).toBe('image');
    expect(byClass(el, 'wqra-pill')).toHaveLength(1);
    expect(all(el, (x) => x.tag === 'img').map((x) => x.getAttribute('src'))).toEqual(['p.webp']);
    p.play(); at(700);
    expect(byClass(el, 'wqra-pill')[0].style.transform).toBe('translate(102px,602px)');
  });

  test('mode band: the crop REPLACES the picture — the only drawing, ONE pill, boxes moved into the crop; a word outside it shows no pill', () => {
    const { RA, document, at } = load({ imgWidth: 540 });   // the crop's 540 picture-px shown at 540: scale 1
    const el = document.createElement('div');
    const d = { ...DATA, image: { url: 'p.webp', w: 1080, h: 1600 },
      words: DATA.words.map((w, k) => ({ ...w, box: k < 4 ? [100 + k * 100, 1200, 90, 40] : [100, 100, 90, 40] })) };
    const p = RA.mount(el, d, { mode: 'band', band: { url: 'band.webp', x: 100, y: 1180, w: 540, h: 100 } });
    expect(p.mode).toBe('band');
    expect(all(el, (x) => x.tag === 'img').map((x) => x.getAttribute('src'))).toEqual(['band.webp']);
    const pills = byClass(el, 'wqra-pill');
    expect(pills).toHaveLength(1);
    p.play();
    at(700);   // word 1: box x 200 → (200 − 100) × 1 + 2 = 102; y (1200 − 1180) + 2 = 22; w 90 − 4; h 40 − 4
    expect(pills[0].style.transform).toBe('translate(102px,22px)');
    expect(pills[0].style.width).toBe('86px');
    expect(pills[0].style.opacity).toBe('1');
    at(2900);  // word 4 lies outside the crop
    expect(pills[0].style.opacity).toBe('0');
    expect(byClass(el, 'wqra-hit')[4].style.display).toBe('none');
  });

  test('mode band without a usable band falls back to the picture (never a blank)', () => {
    const { RA, document } = load();
    const d = { ...DATA, image: { url: 'p.webp', w: 1080, h: 1600 }, words: DATA.words.map((w, k) => ({ ...w, box: [k * 100, 0, 90, 40] })) };
    expect(RA.mount(document.createElement('div'), d, { mode: 'band' }).mode).toBe('image');
  });

  test('the picture pill is a tight inset box (30 % green, 3 px inset #15803D ring), no glow; colour snaps (0 ms), the box slides 100 ms', () => {
    const { RA, document } = load();
    RA.mount(document.createElement('div'), DATA, {});
    const css = all(document.head, (x) => x.id === 'wqra-css')[0].textContent;
    const pill = /\.wqra-pill\{([^}]*)\}/.exec(css)[1];
    expect(pill).toContain('background:rgba(187,247,208,.3)');
    expect(pill).toContain('box-shadow:inset 0 0 0 3px #15803D');
    expect(pill).not.toMatch(/blur|filter|opacity \.|opacity\s*\.1/);
    expect(pill).toMatch(/transition:transform \.1s/);
    const word = /\.wqra-w\{([^}]*)\}/.exec(css)[1];
    expect(word).not.toMatch(/transition:[^;]*(background|color)/);
    expect(css).not.toContain('wqra-band');
  });

  test('timing quality "low": the LINE is lit, not the word — the pill covers the whole printed line of the word being read', () => {
    const { RA, document, at } = load({ imgWidth: 540 });
    const el = document.createElement('div');
    // words 0–2 on one printed line (y 1200), 3–4 on the next (y 1260)
    const boxes = [[100, 1200, 90, 40], [200, 1204, 90, 36], [300, 1200, 120, 40], [100, 1260, 60, 40], [170, 1262, 80, 38]];
    const d = { ...DATA, quality: 'low', image: { url: 'p.webp', w: 1080, h: 1600 }, words: DATA.words.map((w, k) => ({ ...w, box: boxes[k] })) };
    const p = RA.mount(el, d, {});
    expect(p.quality).toBe('low');
    const pill = byClass(el, 'wqra-pill')[0];
    p.play();
    at(700);   // word 1 → line 0 = x 100…420, y 1200…1240 → (50 + 2, 600 + 2), w 160 − 4, h 20 − 4
    expect(pill.style.transform).toBe('translate(52px,602px)');
    expect(pill.style.width).toBe('156px');
    expect(pill.style.height).toBe('16px');
    at(2900);  // word 4 → line 1 = x 100…250, y 1260…1300
    expect(pill.style.transform).toBe('translate(52px,632px)');
    expect(pill.style.width).toBe('71px');
  });

  test('timing quality "low" in text mode: every word on the printed line of the current word is lit', () => {
    const { RA, document, at } = load();
    const el = document.createElement('div');
    const p = RA.mount(el, { ...DATA, quality: 'low' }, {});
    byClass(el, 'wqra-w').forEach((s, k) => { s.offsetTop = k < 3 ? 0 : 40; });   // what the browser's line wrap gives
    p.play();
    at(700); expect(lit(el)).toEqual(['0', '1', '2']);
    at(2600); expect(lit(el)).toEqual(['3', '4']);
    expect(RA.mount(document.createElement('div'), DATA, {}).quality).toBe('word');
  });

  test('a page whose words lack boxes falls back to text mode (per page)', () => {
    const { RA, document } = load();
    const p = RA.mount(document.createElement('div'), { ...DATA, image: { url: 'x', w: 10, h: 10 } }, {});
    expect(p.mode).toBe('text');
  });

  test('sayWord: one word in Jugnu\'s voice with no player on screen — play, then seek to its start, pause past its end; inside the tap', () => {
    const { RA, at, audio } = load();
    const h = RA.sayWord(DATA, 2);   // "cricket." 1200–1800 ms
    const a = audio();
    expect(a.src).toBe(DATA.audio.url);
    expect(a.plays).toBe(1);          // play() ran inside this call (the in-app browser's audio unlock)
    expect(a.currentTime).toBeCloseTo(1.2);
    at(1500); expect(a.paused).toBe(false);
    at(1810); expect(a.paused).toBe(true);
    expect(() => h.stop()).not.toThrow();
  });
  test('sayWord: a bad index, a page not voiced yet, or bad data does nothing and never throws', () => {
    const { RA } = load();
    expect(RA.sayWord(DATA, 9)).toBeNull();
    expect(RA.sayWord({ ...DATA, audio: null }, 0)).toBeNull();
    expect(RA.sayWord({ v: 9 }, 0)).toBeNull();
  });

  test('quality "low": no word slices — playWord does nothing, sayWord returns null (the word times are not trusted)', () => {
    const { RA, document, audio } = load();
    const p = RA.mount(document.createElement('div'), { ...DATA, quality: 'low' }, {});
    const a = audio();
    p.playWord(2);
    expect(a.plays).toBe(0);
    expect(RA.sayWord({ ...DATA, quality: 'low' }, 2)).toBeNull();
    expect(RA.sayWord(DATA, 2)).not.toBeNull();   // a word-timed file still says the word
  });

  test('size budget: ≤ 8 KB gzipped', () => {
    expect(SRC.length).toBeGreaterThan(0);
    expect(zlib.gzipSync(Buffer.from(SRC), { level: 9 }).length).toBeLessThanOrEqual(8192);
  });
});
