/**
 * Web quiz page: the shared feedback lines ("Not yet. The answer is…", right / fixed / done) are spoken
 * in the language of the QUESTIONS, not the page. A library quiz is one set of rows in one language; an
 * English-text quiz opened from an Urdu class page said «ابھی نہیں۔ صحیح جواب ہے:» in the Urdu voice and
 * then the English answer in the English voice — two voices in one sentence (QA, live sandbox).
 * The page's own copy stays in the class language.
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

const HINT_CLIP = 'https://r2.example/web-quiz/audio/z/q1/hint-ab12cd34.ogg';
function hintQ(lang, { hint = true } = {}) {
  const en = lang === 'en';
  return {
    qid: '11111111-2222-3333-4444-555555555555', i: 1,
    text: en ? 'Which of these is a liquid?' : 'ان میں سے مائع کون سا ہے؟',
    options: [{ slot: 'A', text: en ? 'stone' : 'پتھر' }, { slot: 'B', text: en ? 'milk' : 'دودھ' }, { slot: 'C', text: en ? 'air' : 'ہوا' }],
    correct_slot: 'B',
    why: en ? 'A liquid flows.' : 'مائع بہتا ہے۔',
    ...(hint ? { hint: { text: en ? 'Think about what you can pour into a glass.' : 'سوچیں، گلاس میں کیا ڈالا جا سکتا ہے؟' } } : {}),
    audio: { q: 'https://r2.example/q.ogg', opts: [null, null, null, null], why: null, ...(hint ? { hint: HINT_CLIP } : {}) },
  };
}

function page({ lang = 'en', q = hintQ(lang) } = {}) {
  const voiced = [];
  const clips = [];
  const utterances = [];
  const timers = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.listeners = {}; clips.push(this); voiced.push({ url }); }
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }
    play() { (this.listeners.playing || []).forEach((f) => f()); return Promise.resolve(); }
    pause() {}
    canPlayType() { return 'probably'; }
  }
  const els = {};
  const root = fakeEl('#wq');
  root.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  root.querySelector = (sel) => { if (!els[sel]) els[sel] = fakeEl(sel); return els[sel]; };
  root.querySelectorAll = () => [];
  const boot = {
    textContent: JSON.stringify({
      code: 'TEST', cls: { label: 'Class 3', teacher: 'Teacher Testwala', chips: [] }, live: {}, video: null,
      quiz: { code: 'TEST', lang, topic: 'Matter', grade: 3, questions: [q] },
    }),
  };
  const ctx = {
    console, URLSearchParams,
    document: {
      visibilityState: 'visible',
      getElementById: (id) => (id === 'boot' ? boot : id === 'wq' ? root : null),
      createElement: (t) => (t === 'audio' ? { canPlayType: () => 'probably' } : fakeEl(t)),
      addEventListener() {}, querySelectorAll: () => [], dispatchEvent() { return true; }, body: fakeEl('body'),
    },
    location: { search: '', origin: 'https://example.test' },
    navigator: { userAgent: 'test' },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    Audio: FakeAudio,
    AudioContext: function AudioContext() { return { state: 'running', resume() {}, suspend() {} }; },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => { utterances.push(u); voiced.push({ text: u.text }); }, cancel() {} },
    setInterval: () => 0,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    scrollTo() {}, Image: function Image() {},
    addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(TAIL, '  else landing();\n  window.__wq = { question: question, feedback: feedback, T: T, evq: evq };\n})();'), ctx);
  const click = (sel) => ((els[sel] && els[sel].listeners.click) || []).forEach((fn) => fn({}));
  // End the question's reading: every clip that is playing ends.
  const finishReading = () => {
    for (let k = 0; k < 12; k += 1) {
      const last = voiced[voiced.length - 1];
      if (last && last.url) { const c = clips[clips.length - 1]; if (c.onended) c.onended(); }
      else if (last && last.text != null) { const u = utterances[utterances.length - 1]; if (u.onend) u.onend(); }
    }
  };
  const fireAfter = (ms) => timers.filter((t) => t.ms === ms).forEach((t) => t.fn());
  return { wq: ctx.__wq, els, root, voiced, timers, click, finishReading, fireAfter };
}

const EN_Q = {
  qid: '11111111-2222-3333-4444-555555555555', i: 1, text: 'What hatches from an egg?',
  options: [{ slot: 'A', text: 'A chick' }, { slot: 'B', text: 'A cat' }], correct_slot: 'A', why: 'A chick grows inside the egg.',
  audio: { q: 'https://r2.example/q.ogg', opts: [null, null, null, null], why: null },
};
const UR_Q = { ...EN_Q, text: 'انڈے سے کیا نکلتا ہے؟', options: [{ slot: 'A', text: 'چوزہ' }, { slot: 'B', text: 'بلی' }], why: 'چوزہ انڈے میں بڑا ہوتا ہے۔' };

describe('shared lines follow the questions\' language', () => {
  test('an English-text quiz on an Urdu page: the English "not yet" line', () => {
    const p = page({ lang: 'ur', q: EN_Q });
    p.wq.feedback(EN_Q, 0, 'B', false, false);
    expect(p.voiced[0].url).toMatch(/\/wq\/voice\/en\/notyet-/);
  });
  test('an Urdu quiz on an Urdu page: the Urdu line, as before', () => {
    const p = page({ lang: 'ur', q: UR_Q });
    p.wq.feedback(UR_Q, 0, 'B', false, false);
    expect(p.voiced[0].url).toMatch(/\/wq\/voice\/ur\/notyet-/);
  });
  test('the page copy stays in the class language', () => {
    const p = page({ lang: 'ur', q: EN_Q });
    expect(p.wq.T.next).toBe('اگلا');
  });
});
