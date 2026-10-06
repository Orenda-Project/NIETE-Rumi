/**
 * Web quiz page: Jugnu helps with the question in mind (public/wq/wq.js question()).
 *
 * A question that carries a hint shows a small thinking Jugnu ("Need a hint?"). A tap shows the hint
 * beside Jugnu, plays the hint's own recorded clip, and logs hint_used. Twenty seconds after the
 * voice has finished, a child who has not asked is nudged ("Stuck? Tap me for a hint."). A question
 * with no hint keeps today's help ("Shall we listen again?"). Answering takes the help away.
 *
 * Runs the WHOLE shipped page in a vm with a small fake DOM and the browser's audio and timer
 * boundaries faked, so each test executes the real screen code.
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
  vm.runInContext(SRC.replace(TAIL, '  else landing();\n  window.__wq = { question: question, T: T, evq: evq };\n})();'), ctx);
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
const events = (p, n) => p.wq.evq.filter((e) => e.n === n);

describe.each(['en', 'ur'])('Jugnu\'s hint (%s)', (lang) => {
  test('a question with a hint shows a tappable thinking Jugnu', () => {
    const p = page({ lang });
    p.wq.question(0);
    expect(p.root.innerHTML).toMatch(/id="wq-jhelp"/);
    expect(p.root.innerHTML).toMatch(/thinking\.webp/);
    expect(p.root.innerHTML).toContain(p.wq.T.hintAsk);
    expect((p.els['#wq-jhelp'].listeners.click || []).length).toBe(1);
  });

  test('a tap shows the hint beside Jugnu, plays the hint clip and logs hint_used', () => {
    const q = hintQ(lang);
    const p = page({ lang, q });
    p.wq.question(0);
    // The question is still being read: the hint replaces that voice, and the speaker stops showing it.
    const spk = p.root.querySelector('#wq-spk');
    spk.classList.remove = jest.fn();
    p.click('#wq-jhelp');
    expect(spk.classList.remove).toHaveBeenCalledWith('wq-speaking');
    expect(p.els['#wq-hintbox'].innerHTML).toContain(q.hint.text);
    expect(p.els['#wq-hintbox'].innerHTML).toMatch(/data-jpose="thinking"/);
    expect(p.voiced[p.voiced.length - 1]).toEqual({ url: HINT_CLIP });
    const used = events(p, 'hint_used');
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ qid: q.qid, i: 1, src: 'first' });
  });

  test('20 s after the voice ends, a child who has not asked is nudged', () => {
    const p = page({ lang });
    p.wq.question(0);
    p.finishReading();
    expect(p.timers.some((t) => t.ms === 20000)).toBe(true);
    p.fireAfter(20000);
    expect(p.els['#wq-jhelp'].className).toMatch(/wq-nudge/);
    expect(p.els['#wq-jhelp-t'].textContent).toBe(p.wq.T.hintNudge);
    expect(events(p, 'help_shown')[0]).toMatchObject({ src: 'hint' });
    // The tap after a nudge: the button settles back, and the hint is scrolled into view (long stems push it below the fold).
    p.root.querySelector('#wq-hintbox').scrollIntoView = jest.fn();
    p.click('#wq-jhelp');
    expect(p.els['#wq-jhelp'].className).not.toMatch(/wq-nudge/);
    expect(p.els['#wq-jhelp-t'].textContent).toBe(p.wq.T.hintAsk);
    expect(p.els['#wq-hintbox'].scrollIntoView).toHaveBeenCalled();
  });

  test('no hint: no Jugnu button, and the 20 s help is today\'s "listen again"', () => {
    const p = page({ lang, q: hintQ(lang, { hint: false }) });
    p.wq.question(0);
    expect(p.root.innerHTML).not.toMatch(/id="wq-jhelp"/);
    p.finishReading();
    p.fireAfter(20000);
    expect(p.els['#wq-help'].innerHTML).toContain(p.wq.T.helpAgain);
  });

  test('the copy exists in both languages and names no gender', () => {
    const p = page({ lang });
    expect(p.wq.T.hintAsk).toBeTruthy();
    expect(p.wq.T.hintNudge).toBeTruthy();
    if (lang === 'ur') expect(`${p.wq.T.hintAsk} ${p.wq.T.hintNudge}`).not.toMatch(/(رہی|سکتی|گئی|کرتی) (ہو|ہیں)/);
  });
});
