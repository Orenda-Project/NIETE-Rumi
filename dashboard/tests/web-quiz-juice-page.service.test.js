/**
 * The quiz page (public/wq/wq.js) with the sound + motion kit: a right answer calls WQJ.correct and moves on by
 * itself 900 ms after Jugnu has said why; a wrong answer calls WQJ.wrong and waits for the child's tap; the end
 * calls WQJ.finish. With the kit absent (web_quiz_juice off: the edge never loads wq-juice.js) the page does
 * exactly today's: its own tones, a Next tap after every answer, no timer.
 *
 * Runs the WHOLE shipped page in a vm with a small fake DOM, the audio boundary faked, and WQJ a recorder.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const TAIL = '  else landing();\n})();';

function fakeEl(sel) {
  return {
    sel, listeners: {}, attrs: {}, style: {}, textContent: '', innerHTML: '',
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    fire(n) { (this.listeners[n] || []).forEach((fn) => fn({})); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild() {}, removeChild() {}, scrollIntoView() {}, focus() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

function recorder() {
  const calls = [];
  const later = [];
  const J = {};
  ['tap', 'correct', 'wrong', 'word', 'sentence', 'streak', 'finish', 'badge', 'dayDot', 'mic', 'stopAll', 'muted'].forEach((k) => { J[k] = (...a) => { calls.push([k, ...a]); }; });
  J.after = (ms, fn) => { calls.push(['after', ms]); later.push({ ms, fn }); return later.length; };
  return { J, calls, later, names: () => calls.map((c) => c[0]) };
}

const Q1 = { qid: 'q1', i: 1, text: 'Which part of a plant drinks water?', options: [{ slot: 'A', text: 'Leaf' }, { slot: 'B', text: 'Root' }], correct_slot: 'B', why: 'Roots drink up water.', audio: { q: 'https://r2.example/q.ogg', opts: [null, null], why: 'https://r2.example/why.ogg' } };
const Q2 = { ...Q1, qid: 'q2', i: 2 };

function page({ juice = null, store = {} } = {}) {
  const timers = [];
  const voiced = [];
  const clips = [];
  const contexts = [];
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
  const boot = { textContent: JSON.stringify({ code: 'TEST', cls: { label: 'Class 3', teacher: 'Teacher Testwala', chips: [] }, live: {}, video: null, quiz: { code: 'TEST', lang: 'en', topic: 'Plants', grade: 3, questions: [Q1, Q2] } }) };
  const ctx = {
    console, URLSearchParams,
    document: {
      visibilityState: 'visible',
      getElementById: (id) => (id === 'boot' ? boot : id === 'wq' ? root : null),
      createElement: (t) => (t === 'audio' ? { canPlayType: () => 'probably' } : fakeEl(t)),
      addEventListener() {}, querySelectorAll: () => [], dispatchEvent() { return true; }, body: fakeEl('body'),
      documentElement: { lang: 'en', classList: { contains: () => false, add() {} } },
    },
    location: { search: '', origin: 'https://example.test' },
    navigator: { userAgent: 'test' },
    localStorage: { setItem: (k, v) => { store[k] = String(v); }, getItem: (k) => (k in store ? store[k] : null), removeItem: (k) => { delete store[k]; } },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    Audio: FakeAudio,
    AudioContext: function AudioContext() {
      const c = { state: 'running', currentTime: 0, destination: {}, resume() {}, suspend() {},
        createOscillator: () => ({ frequency: {}, connect() {}, start() {}, stop() {} }),
        createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }) };
      contexts.push(c); return c;
    },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => { voiced.push({ text: u.text, u }); }, cancel() {} },
    setInterval: () => 0, setTimeout: (fn, ms) => { timers.push({ fn, ms: ms || 0 }); return timers.length; }, clearTimeout() {},
    scrollTo() {}, Image: function Image() {}, addEventListener() {},
  };
  if (juice) ctx.WQJ = juice.J;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(TAIL, '  else landing();\n  window.__wq = { feedback: feedback, results: results, question: question, S: S };\n})();'), ctx);
  // The voice moves on: the current clip or phone line ends by itself.
  const endVoice = () => {
    for (let k = 0; k < 8; k += 1) {
      const last = voiced[voiced.length - 1];
      if (last && last.url) { const c = clips[clips.length - 1]; if (c.onended && !c.__ended) { c.__ended = 1; c.onended(); } }
      else if (last && last.u && last.u.onend && !last.u.__ended) { last.u.__ended = 1; last.u.onend(); }
    }
  };
  return { ctx, wq: ctx.__wq, els, root, timers, contexts, endVoice, moment: () => root.attrs['data-m'], html: () => root.innerHTML };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('switch off (no kit on the page): today exactly', () => {
  test('a right answer plays the page\'s own tone and waits for Next; no timer moves it on', () => {
    const p = page();
    p.wq.question(0, false);
    p.wq.feedback(Q1, 0, 'B', true, false);
    expect(p.contexts.length).toBe(1); // wq.js sfx('right')
    p.endVoice();
    expect(p.timers.some((t) => t.ms === 900)).toBe(false);
    expect(p.moment()).toBe('M7');
    expect(p.els['#wq-fb'].innerHTML).toContain('id="wq-next"');
  });
});

describe('switch on (the kit on the page)', () => {
  test('a right answer: WQJ.correct with the picked option, the panel and the progress dots — the page\'s own tone is not played on top', () => {
    const j = recorder();
    const p = page({ juice: j });
    p.wq.question(0, false);
    p.wq.feedback(Q1, 0, 'B', true, false);
    const c = j.calls.find((x) => x[0] === 'correct');
    expect(c).toBeTruthy();
    expect(c[1].el.sel).toBe('.wq-opt[data-slot="B"]');
    expect(c[1].panel.sel).toBe('#wq-fb');
    expect(c[1].at.sel).toBe('.wq-dotrow');
    expect(p.contexts.length).toBe(0);
  });

  test('a right answer moves on by itself 900 ms after Jugnu has said why (no Next tap needed)', () => {
    const j = recorder();
    const p = page({ juice: j });
    p.wq.question(0, false);
    p.wq.feedback(Q1, 0, 'B', true, false);
    expect(j.names()).not.toContain('after'); // not while the reason is still being said
    p.endVoice();
    expect(j.calls.filter((x) => x[0] === 'after').map((x) => x[1])).toEqual([900]);
    expect(p.moment()).toBe('M7');
    j.later[0].fn();
    expect(p.moment()).toBe('M6'); // the next question
  });

  test('a child who tapped Next already is not moved on twice', () => {
    const j = recorder();
    const p = page({ juice: j });
    p.wq.question(0, false);
    p.wq.feedback(Q1, 0, 'B', true, false);
    p.endVoice();
    p.els['#wq-next'].fire('click');
    expect(p.moment()).toBe('M6');
    p.root.attrs['data-m'] = 'M6';
    const before = p.html();
    j.later[0].fn();
    expect(p.html()).toBe(before);
  });

  test('muted: the 900 ms start at once with the panel (there is no voice to wait for)', () => {
    const j = recorder();
    const p = page({ juice: j, store: { wq_sound: 'false' } });
    p.wq.question(0, false);
    p.wq.feedback(Q1, 0, 'B', true, false);
    expect(j.calls.filter((x) => x[0] === 'after').map((x) => x[1])).toEqual([900]);
  });

  test('a wrong answer: WQJ.wrong on the picked option, and the page waits for the child\'s tap', () => {
    const j = recorder();
    const p = page({ juice: j });
    p.wq.question(0, false);
    p.wq.feedback(Q1, 0, 'A', false, false);
    const w = j.calls.find((x) => x[0] === 'wrong');
    expect(w[1].el.sel).toBe('.wq-opt[data-slot="A"]');
    p.endVoice();
    expect(j.names()).not.toContain('after');
    expect(j.names()).not.toContain('correct');
    expect(p.contexts.length).toBe(0);
  });

  test('the feedback panel reads the same with or without the kit (the kit adds sound and motion, not words)', () => {
    const a = page(); a.wq.question(0, false); a.wq.feedback(Q1, 0, 'B', true, false);
    const b = page({ juice: recorder() }); b.wq.question(0, false); b.wq.feedback(Q1, 0, 'B', true, false);
    // the praise line is drawn at random from the recorded set: masked, the rest must match exactly
    const norm = (h) => h.replace(/(<div class="wq-fb wq-ok">)[^<]*/, '$1*');
    expect(norm(b.els['#wq-fb'].innerHTML)).toBe(norm(a.els['#wq-fb'].innerHTML));
  });

  test('the end of the quiz: WQJ.finish on the result card, not the page\'s own tone', async () => {
    const j = recorder();
    const p = page({ juice: j, store: { wq_s_TEST: JSON.stringify({ st: 's1', child: { first: 'Ali Testwala', chip: 'c1' }, answers: {}, queue: [], result: { score: { correct: 2, total: 2 }, card: {} } }) } });
    p.wq.results(0);
    await flush(); await flush();
    expect(p.moment()).toBe('M9');
    const f = j.calls.find((x) => x[0] === 'finish');
    expect(f).toBeTruthy();
    expect(f[1].el.sel).toBe('.wq-card');
    expect(f[1].kind).toBe('quiz');
    expect(p.contexts.length).toBe(0);
  });
});
