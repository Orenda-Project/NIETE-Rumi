/**
 * The quiz page (public/wq/wq.js) as a child sees it today: every number on an Urdu screen in Urdu digits, and the
 * speaker, sound and phone-voice marks drawn as inline SVG (old Android phones draw newer emoji as empty boxes).
 *
 * Runs the WHOLE shipped page in a vm with a small fake DOM (the same harness as web-quiz-juice-page).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const KIT = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-juice.js'), 'utf8');
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

const Q1 = { qid: 'q1', i: 1, text: 'Which part of a plant drinks water?', options: [{ slot: 'A', text: 'Leaf' }, { slot: 'B', text: 'Root' }], correct_slot: 'B', why: 'Roots drink up water.', audio: { q: 'https://r2.example/q.ogg', opts: [null, null], why: 'https://r2.example/why.ogg' } };
const Q2 = { ...Q1, qid: 'q2', i: 2 };

function page({ juice = null, store = {}, realKit = false, lang = 'en', questions = [Q1, Q2], ur2 = false } = {}) {
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
  const boot = { textContent: JSON.stringify({ code: 'TEST', cls: { label: 'Class 3', teacher: 'Teacher Testwala', chips: [] }, live: {}, video: null, quiz: { code: 'TEST', lang, topic: 'Plants', grade: 3, questions } }) };
  const ctx = {
    console, URLSearchParams,
    document: {
      visibilityState: 'visible',
      getElementById: (id) => (id === 'boot' ? boot : id === 'wq' ? root : null),
      createElement: (t) => (t === 'audio' ? { canPlayType: () => 'probably' } : fakeEl(t)),
      addEventListener() {}, querySelectorAll: () => [], dispatchEvent() { return true; }, body: fakeEl('body'),
      documentElement: { lang, classList: { contains: (c) => ur2 && c === 'wq-ur2', add() {} } },
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
  if (realKit) vm.runInContext(KIT, ctx); // the edge's order: the kit before the page's own script
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

const EMOJI = /🔊|🔔|📱/;
const WESTERN = /[0-9]/;
// the top bar's sound on/off toggle is drawn elsewhere and is not part of this change
const noSnd = (html) => html.replace(/<button class="wq-icon" id="wq-snd"[^>]*>[^<]*<\/button>/, '');
const URDU_DIGIT = /[\u06F0-\u06F9]/;
const counter = (html) => { const m = /<p class="wq-qof">([^<]*)<\/p>/.exec(html); return m ? m[1] : null; };
const inside = (html, id) => { const m = new RegExp('id="' + id + '"[^>]*>([\\s\\S]*?)</button>').exec(html); return m ? m[1] : null; };

const QU = { ...Q1, text: 'پودے کا کون سا حصہ پانی پیتا ہے؟', options: [{ slot: 'A', text: 'پتا' }, { slot: 'B', text: 'جڑ' }] };
const QS12 = Array.from({ length: 12 }, (_, k) => ({ ...QU, qid: 'q' + (k + 1), i: k + 1 }));

describe('Urdu screens: every number in Urdu digits', () => {
  test('the question counter (switch off) uses Urdu digits only', () => {
    const p = page({ lang: 'ur', questions: QS12 });
    p.wq.question(10, false);
    const c = counter(p.html());
    expect(c).toBeTruthy();
    expect(c).not.toMatch(WESTERN);
    expect(c).toContain('\u06F1\u06F1'); // 11
    expect(c).toContain('\u06F1\u06F2'); // 12
  });

  test('the question counter in the polished Urdu copy uses Urdu digits only', () => {
    const p = page({ lang: 'ur', questions: QS12, ur2: true });
    p.wq.question(10, false);
    const c = counter(p.html());
    expect(c).toBeTruthy();
    expect(c).not.toMatch(WESTERN);
    expect(c).toMatch(URDU_DIGIT);
  });

  test('English keeps Western digits', () => {
    const p = page({ questions: QS12 });
    p.wq.question(10, false);
    expect(counter(p.html())).toBe('Question 11 of 12');
  });
});

describe('speaker, sound and phone marks are inline SVG, never emoji', () => {
  test('the question screen has no emoji speaker; the question speaker holds an svg', () => {
    const p = page();
    p.wq.question(0, false);
    const h = p.html();
    expect(noSnd(h)).not.toMatch(EMOJI);
    const spk = inside(h, 'wq-spk');
    expect(spk).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(h).toContain('aria-label="Listen again"');
  });

  test('a listen item: the big speaker holds an svg', () => {
    const p = page({ questions: [{ ...Q1, type: 'listen' }, Q2] });
    p.wq.question(0, false);
    const h = p.html();
    expect(noSnd(h)).not.toMatch(EMOJI);
    expect(inside(h, 'wq-spk')).toMatch(/^<svg/);
  });

  test('the play-the-sound button holds an svg, no bell emoji', () => {
    const p = page({ questions: [{ ...Q1, audio: { ...Q1.audio, stim: 'https://r2.example/stim.ogg' } }, Q2] });
    p.wq.question(0, false);
    const h = p.html();
    const stim = inside(h, 'wq-stim');
    expect(stim).toBeTruthy();
    expect(stim).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(stim).not.toMatch(EMOJI);
    expect(stim).toContain('Play the sound');
  });

  test('an option with its own clip: its hear button holds an svg', () => {
    const p = page({ questions: [{ ...Q1, audio: { ...Q1.audio, opts: ['https://r2.example/a.ogg', null] } }, Q2] });
    p.wq.question(0, false);
    const h = p.html();
    const m = /<span class="wq-ohear"[^>]*aria-label="Hear this one">([\s\S]*?)<\/span><\/button>/.exec(h);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/^<svg/);
    expect(noSnd(h)).not.toMatch(EMOJI);
  });

  test('sound tiles: each tile\'s speaker is an svg', () => {
    const au = { ...Q1.audio, stim: 'https://r2.example/stim.ogg', opts: ['https://r2.example/a.ogg', 'https://r2.example/b.ogg'] };
    const p = page({ questions: [{ ...Q1, audio: au }, Q2] });
    p.wq.question(0, false);
    const h = p.html();
    expect(h).toContain('wq-shear');
    expect(noSnd(h)).not.toMatch(EMOJI);
    expect((h.match(/class="wq-shear"[\s\S]*?<\/button>/g) || []).every((b) => /<svg/.test(b.replace(/<span class="wq-shp"[\s\S]*?<\/span>/, '')))).toBe(true);
  });

  test('the help speaker shown after a quiet while holds an svg', () => {
    const p = page();
    p.wq.question(0, false);
    // the question is read out; when the voice ends, a quiet while later the help speaker shows
    for (let k = 0; k < 4 && !(p.els['#wq-help'] && /wq-help-spk/.test(p.els['#wq-help'].innerHTML)); k += 1) {
      p.endVoice();
      p.timers.splice(0).forEach((t) => t.fn());
    }
    const h = p.els['#wq-help'].innerHTML;
    expect(h).toContain('id="wq-help-spk"');
    expect(noSnd(h)).not.toMatch(EMOJI);
    expect(inside(h, 'wq-help-spk')).toMatch(/^<svg/);
  });

  test('the phone-voice mark is not an emoji in the stylesheet', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
    expect(css).toMatch(/\.wq-phonevoice \.wq-spk::after\{/);
    expect(css).not.toMatch(/content:\s*"[^"]*📱/);
  });
});

describe('the results card: the score in Urdu digits on an Urdu card', () => {
  const H = require('./wq-page-harness');
  const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
  const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
  const store = { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } };
  const big = (html) => { const m = /<div class="wq-big">([^<]*)<\/div>/.exec(html); return m ? m[1] : null; };

  test('UR: the big score is ۳/۵', () => {
    const p = H.page({ lang: 'ur', store });
    expect(p.moment()).toBe('M10');
    expect(big(p.html())).toBe('۳/۵');
  });

  test('EN: the big score keeps Western digits', () => {
    const p = H.page({ lang: 'en', store });
    expect(big(p.html())).toBe('3/5');
  });
});
