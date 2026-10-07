/**
 * Web quiz page: clips recorded while the child is already playing (public/wq/wq.js late clips).
 *
 * A quiz's read-aloud clips are recorded by the worker the first time its page is opened (about a
 * minute). The page booted before that with no clips and kept that boot for the whole quiz: the first
 * child heard nothing in Urdu (no Urdu phone voice on Android) and the phone's voice in English.
 * Now the server marks such a boot `audio_pending`, the page asks for the quiz again, and every
 * question takes its recorded clips as soon as they exist.
 *
 * Runs the WHOLE shipped page in a vm with a small fake DOM; only the browser boundary is faked
 * (fetch, Audio, speechSynthesis, timers).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const TAIL = '  else landing();\n})();';

function fakeEl(sel) {
  return {
    sel, listeners: {}, attrs: {}, style: {}, textContent: '', innerHTML: '', className: '',
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild() {}, removeChild() {}, scrollIntoView() {}, focus() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

const QID1 = '11111111-2222-3333-4444-555555555551';
const QID2 = '11111111-2222-3333-4444-555555555552';
function urQ(qid, n) {
  return {
    qid, i: n, text: n === 1 ? 'انڈے سے کیا نکلتا ہے؟' : 'گائے کیا دیتی ہے؟',
    options: [{ slot: 'A', text: n === 1 ? 'چوزہ' : 'دودھ' }, { slot: 'B', text: 'بلی' }], correct_slot: 'A',
  };
}
const clip = (qid, part) => `https://r2.example/quiz-audio/z/ur/${qid}/${part}-sx-ishita-ab12cd34.ogg?sig=1`;
const recorded = (q) => ({ ...q, audio: { q: clip(q.qid, 'q'), opts: [clip(q.qid, 'a'), clip(q.qid, 'b'), null, null], why: null } });

/** The page booted with `quiz`; `serve` is what GET /api/wq/quiz/<code> answers, call by call. */
function page({ quiz, serve = [] }) {
  const voiced = [];
  const clips = [];
  const utterances = [];
  const timers = [];
  const gets = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.listeners = {}; clips.push(this); voiced.push({ url }); }
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }
    play() { (this.listeners.playing || []).forEach((f) => f()); return Promise.resolve(); }
    pause() {}
    canPlayType() { return 'probably'; }
  }
  const els = {};
  const root = fakeEl('#wq');
  root.querySelector = (sel) => { if (!els[sel]) els[sel] = fakeEl(sel); return els[sel]; };
  root.querySelectorAll = () => [];
  const boot = { textContent: JSON.stringify({ code: 'TEST', cls: { label: 'Class 5', teacher: 'Teacher Example', chips: [] }, live: {}, video: null, quiz }) };
  const ctx = {
    console, URLSearchParams,
    document: {
      visibilityState: 'visible',
      getElementById: (id) => (id === 'boot' ? boot : id === 'wq' ? root : null),
      createElement: (t) => (t === 'audio' ? { canPlayType: () => 'probably' } : fakeEl(t)),
      addEventListener() {}, querySelectorAll: () => [], dispatchEvent() { return true; }, body: fakeEl('body'),
    },
    location: { search: '', origin: 'https://example.test', pathname: '/q/TEST' },
    navigator: { userAgent: 'test' },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    fetch: (url, init) => {
      const u = String(url);
      if (/\/api\/wq\/quiz\//.test(u) && (!init || !init.method || init.method === 'GET')) {
        gets.push(u);
        const body = serve.length ? serve.shift() : { quiz };
        return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(body)) });
      }
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') });
    },
    Audio: FakeAudio,
    AudioContext: function AudioContext() { return { state: 'running', resume() {}, suspend() {} }; },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => { utterances.push(u); voiced.push({ text: u.text }); }, cancel() {}, getVoices: () => [] },
    setInterval: () => 0,
    setTimeout: (fn, ms) => { timers.push({ fn, ms: ms || 0 }); return timers.length; },
    clearTimeout() {},
    scrollTo() {}, Image: function Image() {},
    addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(TAIL, '  else landing();\n  window.__wq = { question: question, QS: QS };\n})();'), ctx);
  // Runs every timer recorded so far that has not run (the page's own delays, whatever their length).
  const runTimers = () => timers.filter((t) => !t.ran).forEach((t) => { t.ran = true; t.fn(); });
  const settle = async () => { for (let k = 0; k < 6; k += 1) await new Promise((r) => setImmediate(r)); };
  const lateDelays = () => timers.filter((t) => t.ms >= 10000).map((t) => t.ms);
  return { wq: ctx.__wq, voiced, gets, runTimers, settle, lateDelays };
}

describe('a quiz whose clips are recorded while the child plays', () => {
  test('the page asks again and the next question speaks with its recorded clip', async () => {
    const quiz = { code: 'TEST', lang: 'ur', voice_lang: 'ur', audio_pending: true, topic: 'جانور', grade: 5, questions: [urQ(QID1, 1), urQ(QID2, 2)] };
    const p = page({ quiz, serve: [{ quiz: { ...quiz, audio_pending: false, questions: [recorded(urQ(QID1, 1)), recorded(urQ(QID2, 2))] } }] });
    // Q1 at boot: no clip yet.
    p.wq.question(0, false);
    expect(p.voiced.some((v) => v.url)).toBe(false);
    // The page waits, then asks for the quiz again.
    p.runTimers();
    await p.settle();
    expect(p.gets.length).toBeGreaterThanOrEqual(1);
    expect(p.gets[0]).toMatch(/\/api\/wq\/quiz\/TEST$/);
    // Q2 now reads in the recorded voice: its question clip, then its options.
    const n = p.voiced.length;
    p.wq.question(1, false);
    expect(p.voiced[n]).toEqual({ url: clip(QID2, 'q') });
    // …and stops asking once the server says the clips are done.
    const asked = p.gets.length;
    p.runTimers();
    await p.settle();
    expect(p.gets.length).toBe(asked);
  });

  test('keeps asking (a few times, then gives up) while the recording is still running', async () => {
    const quiz = { code: 'TEST', lang: 'ur', voice_lang: 'ur', audio_pending: true, topic: 'جانور', grade: 5, questions: [urQ(QID1, 1)] };
    const p = page({ quiz, serve: Array.from({ length: 10 }, () => ({ quiz })) });
    for (let k = 0; k < 10; k += 1) { p.runTimers(); await p.settle(); }
    expect(p.gets.length).toBeGreaterThanOrEqual(2);
    expect(p.gets.length).toBeLessThanOrEqual(5);
    // Spaced out: never a tight loop on a slow connection.
    expect(Math.min(...p.lateDelays())).toBeGreaterThanOrEqual(10000);
  });

  test('the question still on screen, unanswered, is read again in the recorded voice when its clips land', async () => {
    const quiz = { code: 'TEST', lang: 'ur', voice_lang: 'ur', audio_pending: true, topic: 'جانور', grade: 5, questions: [urQ(QID1, 1), urQ(QID2, 2)] };
    const p = page({ quiz, serve: [{ quiz: { ...quiz, audio_pending: false, questions: [recorded(urQ(QID1, 1)), recorded(urQ(QID2, 2))] } }] });
    p.wq.question(0, false);
    expect(p.voiced.some((v) => v.url)).toBe(false);
    p.runTimers();
    await p.settle();
    expect(p.voiced.some((v) => v.url === clip(QID1, 'q'))).toBe(true);
  });

  test('a child who has moved on never hears the earlier question again', async () => {
    const quiz = { code: 'TEST', lang: 'ur', voice_lang: 'ur', audio_pending: true, topic: 'جانور', grade: 5, questions: [urQ(QID1, 1), urQ(QID2, 2)] };
    const p = page({ quiz, serve: [{ quiz: { ...quiz, audio_pending: false, questions: [recorded(urQ(QID1, 1)), recorded(urQ(QID2, 2))] } }] });
    p.wq.question(0, false);
    p.wq.question(1, false); // the child answered Q1 and is on Q2 when the clips land
    p.runTimers();
    await p.settle();
    expect(p.voiced.some((v) => v.url === clip(QID1, 'q'))).toBe(false);
    expect(p.voiced.some((v) => v.url === clip(QID2, 'q'))).toBe(true);
  });

  test('a quiz already recorded never asks again', async () => {
    const quiz = { code: 'TEST', lang: 'ur', voice_lang: 'ur', topic: 'جانور', grade: 5, questions: [recorded(urQ(QID1, 1))] };
    const p = page({ quiz });
    for (let k = 0; k < 3; k += 1) { p.runTimers(); await p.settle(); }
    expect(p.gets.length).toBe(0);
  });
});
