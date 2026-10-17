/**
 * Jugnu's read-along on a quiz QUESTION (boot question_readalong, app_settings web_quiz_question_readalong, a quiz with
 * one voice): the question's words glide as its clip plays, through the SHARED player (wq-readalong.js) mounted on the
 * stem. The page's own 🔊 and reading sequence stay in charge: the q part is played by the player, the sequence goes on
 * to the options when it ends, a stop pauses it, the next question drops it.
 *
 * The edge loads the player only when the payload says so; off, the page HTML and the page's reading are today's.
 *
 * Runs the WHOLE shipped page in a vm with a small fake DOM (as web-quiz-voice-feedback.service.test.js); the player is
 * a fake with the shared player's surface.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = require('../routes/web-quiz.routes');
const I = require('./__golden__/juice-off-inputs');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const TAIL = '  else landing();\n})();';

function fakeEl(sel) {
  return {
    sel, listeners: {}, attrs: {}, style: {}, textContent: '', innerHTML: '', classes: [],
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild() {}, removeChild() {}, scrollIntoView() {}, focus() {},
    get classList() { const c = this.classes; return { add: (x) => c.push(x), remove() {}, toggle() {}, contains: (x) => c.includes(x) }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

const Q_URL = (n) => `https://r2.example/q${n}.ogg`;
const WORDS = [{ i: 0, t: 'Which', s_ms: 0, e_ms: 200 }, { i: 1, t: 'month?', s_ms: 240, e_ms: 600 }];
function questions({ ra = true } = {}) {
  return [1, 2].map((n) => ({
    qid: `q${n}`, i: n, text: 'Which month?', correct_slot: 'A',
    options: [{ slot: 'A', text: 'February' }, { slot: 'B', text: 'May' }],
    audio: { q: Q_URL(n), opts: [`https://r2.example/a${n}.ogg`, `https://r2.example/b${n}.ogg`, null, null], why: null,
      ...(ra ? { ra: { v: 1, lang: 'en', dir: 'ltr', ms: 800, words: WORDS } } : {}) },
  }));
}

function page({ flag = false, player = true, ra = true } = {}) {
  const voiced = [];
  const clips = [];
  const utterances = [];
  const mounts = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.paused = true; this.listeners = {}; clips.push(this); voiced.push({ url }); }
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }
    play() { this.paused = false; (this.listeners.playing || []).forEach((f) => f()); return Promise.resolve(); }
    pause() { this.paused = true; }
    canPlayType() { return 'probably'; }
  }
  const els = {};
  const root = fakeEl('#wq');
  root.querySelector = (sel) => { if (!els[sel]) els[sel] = fakeEl(sel); return els[sel]; };
  root.querySelectorAll = () => [];
  const boot = {
    textContent: JSON.stringify({
      code: 'TEST', cls: { label: 'Class 3', teacher: 'Teacher Example', chips: [] }, live: {}, video: null,
      quiz: { code: 'TEST', lang: 'en', topic: 'Months', grade: 1, questions: questions({ ra }) },
      one_voice: true, voice_sets: {}, ...(flag ? { question_readalong: true } : {}),
    }),
  };
  const ctx = {
    console, URLSearchParams,
    document: {
      visibilityState: 'visible', head: fakeEl('head'),
      getElementById: (id) => (id === 'boot' ? boot : id === 'wq' ? root : null),
      createElement: (t) => (t === 'audio' ? { canPlayType: () => 'probably' } : fakeEl(t)),
      addEventListener() {}, querySelectorAll: () => [], dispatchEvent() { return true; },
      body: fakeEl('body'),
    },
    location: { search: '', origin: 'https://example.test' },
    navigator: { userAgent: 'test' },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}'), json: () => Promise.resolve({}) }),
    Audio: FakeAudio,
    AudioContext: function AudioContext() { return { state: 'running', resume() {}, suspend() {} }; },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => { utterances.push(u); voiced.push({ text: u.text }); }, cancel() {} },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout() {}, clearInterval() {},
    scrollTo() {}, Image: function Image() {},
    addEventListener() {},
  };
  if (player) {
    ctx.WQReadAlong = {
      mount(el, data, opts) {
        const p = {
          el, data, opts, state: 'ready', plays: 0, pauses: 0, destroyed: false,
          play() { this.plays += 1; this.state = 'playing'; voiced.push({ ra: data.audio.url }); },
          replay() { this.play(); },
          pause() { this.pauses += 1; if (this.state === 'playing') this.state = 'paused'; },
          destroy() { this.destroyed = true; },
          end() { this.state = 'ended'; if (opts.onEnd) opts.onEnd(); },
        };
        mounts.push(p);
        return p;
      },
    };
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(TAIL, '  else landing();\n  window.__wq = { question: question, speakSeq: speakSeq, stopVoice: stopVoice, stopAll: stopAll };\n})();'), ctx);
  return { ctx, wq: ctx.__wq, voiced, clips, utterances, mounts, els };
}
const flush = () => new Promise((r) => setImmediate(r));
const endClip = (p) => { const c = p.clips[p.clips.length - 1]; if (c && c.onended) c.onended(); };

describe('on (question_readalong + timings + the shared player)', () => {
  test('the player is mounted on the question\'s stem with the clip and the printed words, its own button hidden', () => {
    const p = page({ flag: true });
    p.wq.question(0);
    expect(p.mounts).toHaveLength(1);
    const m = p.mounts[0];
    expect(m.el).toBe(p.els['.wq-qtext']);
    expect(JSON.parse(JSON.stringify(m.data))).toEqual({ v: 1, id: 'q/q1', lang: 'en', dir: 'ltr', audio: { url: Q_URL(1), ms: 800 }, words: WORDS });
    expect(m.opts).toMatchObject({ mode: 'text', leadMs: 50 });
    expect(typeof m.opts.onEnd).toBe('function');
    expect(m.el.classList.contains('wq-raq')).toBe(true);
  });

  test('the reading plays the question THROUGH the player (not the page\'s own audio), then goes on to the options', async () => {
    const p = page({ flag: true });
    p.wq.question(0);
    expect(p.mounts[0].plays).toBe(1);
    expect(p.voiced[0]).toEqual({ ra: Q_URL(1) });
    expect(p.clips.map((c) => c.url)).not.toContain(Q_URL(1));
    p.mounts[0].end();
    await flush();
    expect(p.clips.map((c) => c.url)).toEqual(['https://r2.example/a1.ogg']);
    endClip(p);
    expect(p.clips.map((c) => c.url)).toEqual(['https://r2.example/a1.ogg', 'https://r2.example/b1.ogg']);
  });

  test('a stop pauses the player, and a stopped reading never goes on when it ends late', () => {
    const p = page({ flag: true });
    p.wq.question(0);
    p.wq.stopVoice();
    expect(p.mounts[0].pauses).toBeGreaterThan(0);
    p.mounts[0].end();
    expect(p.clips).toEqual([]);
    p.wq.question(0);
    p.wq.stopAll();
    expect(p.mounts[p.mounts.length - 1].pauses).toBeGreaterThan(0);
  });

  test('the next question drops the player of the last one', () => {
    const p = page({ flag: true });
    p.wq.question(0);
    p.wq.question(1);
    expect(p.mounts[0].destroyed).toBe(true);
    expect(p.mounts[1].data.audio.url).toBe(Q_URL(2));
  });

  test.each([['no player script', { player: false }], ['no timings', { ra: false }]])('%s: today\'s reading', (_, o) => {
    const p = page({ flag: true, ...o });
    p.wq.question(0);
    expect(p.mounts).toHaveLength(0);
    expect(p.voiced[0]).toEqual({ url: Q_URL(1) });
  });

  test('a player that cannot mount (it throws): today\'s reading', () => {
    const p = page({ flag: true });
    p.ctx.WQReadAlong.mount = () => { throw new Error('boom'); };
    p.wq.question(0);
    expect(p.voiced[0]).toEqual({ url: Q_URL(1) });
  });
});

describe('off (no question_readalong): the page reads as today', () => {
  test('nothing is mounted; the q part goes through the page\'s own audio, then the options', () => {
    const p = page({ flag: false });
    p.wq.question(0);
    expect(p.mounts).toHaveLength(0);
    expect(p.voiced[0]).toEqual({ url: Q_URL(1) });
    endClip(p);
    expect(p.clips.map((c) => c.url)).toEqual([Q_URL(1), 'https://r2.example/a1.ogg']);
  });
});

describe('the edge loads the player only when the payload says so', () => {
  const mask = (s) => s.replace(/\?v=[0-9a-f]{10}/g, '?v=*');
  const TAG = /<script src="\/wq\/wq-readalong\.js\?v=[0-9a-f]{10}" defer><\/script>\n/;
  test('on: its own versioned script, before wq.js', () => {
    const html = I.quiz(R, { question_readalong: true });
    expect(html).toMatch(TAG);
    expect(html.indexOf('/wq/wq-readalong.js')).toBeLessThan(html.indexOf('/wq/wq.js'));
    expect(mask(html.replace(TAG, '').replace(',"question_readalong":true', ''))).toBe(mask(I.quiz(R)));
  });
  test.each([[undefined], [false], ['true'], [1]])('off (%p): the page HTML is byte-identical', (v) => {
    const html = v === undefined ? I.quiz(R) : I.quiz(R, { question_readalong: v });
    expect(html).not.toContain('wq-readalong.js');
    if (v === undefined) {
      const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, '__golden__', 'juice-off-pages.json'), 'utf8'));
      expect(mask(html)).toBe(mask(GOLD.quiz));
    }
  });
});
