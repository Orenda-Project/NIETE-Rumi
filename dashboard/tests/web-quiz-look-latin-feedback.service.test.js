/**
 * The adventure look (<html class="wq-adv">, app_settings web_quiz_adventure_look) on an Urdu child's page that plays an
 * ENGLISH quiz: Jugnu's feedback bubble and the answer options carry English lines, which the Urdu page laid out right to
 * left, so their marks jumped to the wrong end ("!Brilliant, that's right", ".Yes! That's the one", a lone ".water").
 * Each English line (no Urdu letter) is marked left to right; an Urdu line, an English page and every page without the
 * look are today's, byte for byte.
 *
 * Runs the WHOLE shipped page in a vm with a small fake DOM (as web-quiz-page-picture-reason does). Invented content only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WQI = require('../public/wq/wq.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const TAIL = '  else landing();\n})();';

function fakeEl(sel) {
  return {
    sel, listeners: {}, attrs: {}, style: {}, textContent: '', innerHTML: '',
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild() {}, removeChild() {}, scrollIntoView() {}, focus() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

function page(lang, { ui = lang, classes = [] } = {}) {
  const voiced = [];
  const utterances = [];
  const clips = [];
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
  const boot = {
    textContent: JSON.stringify({
      code: 'TEST', ui_lang: ui, cls: { label: 'Class 1', teacher: 'Teacher Testwala', chips: [] }, live: {}, video: null,
      quiz: { code: 'TEST', lang, voice_lang: lang, topic: 'Plants', grade: 1, questions: [{ qid: 'q1', text: 'a?', options: [{ slot: 'A', text: 'x' }], correct_slot: 'A' }] },
    }),
  };
  const ctx = {
    console, URLSearchParams,
    document: {
      visibilityState: 'visible',
      getElementById: (id) => (id === 'boot' ? boot : id === 'wq' ? root : null),
      createElement: (t) => (t === 'audio' ? { canPlayType: () => 'probably' } : fakeEl(t)),
      addEventListener() {}, querySelectorAll: () => [], dispatchEvent() { return true; },
      body: fakeEl('body'),
      documentElement: { lang: ui, classList: { add() {}, remove() {}, toggle() {}, contains: (c) => classes.indexOf(c) >= 0 } },
    },
    location: { search: '', origin: 'https://example.test' },
    navigator: { userAgent: 'test' },
    localStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    Audio: FakeAudio,
    AudioContext: function AudioContext() { return { state: 'running', suspend() { return Promise.resolve(); }, resume() { return Promise.resolve(); } }; },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => { utterances.push(u); voiced.push({ text: u.text }); }, cancel() {} },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout() {},
    scrollTo() {}, Image: function Image() {}, addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(TAIL, '  else landing();\n  window.__wq = { feedback: feedback };\n})();'), ctx);
  const advance = () => {
    const last = voiced[voiced.length - 1];
    if (last && last.url) { const c = clips[clips.length - 1]; if (c.onended) c.onended(); }
    else if (last && last.text != null) { const u = utterances[utterances.length - 1]; if (u.onend) u.onend(); }
  };
  return { wq: ctx.__wq, els, voiced, advance };
}


const T = { check: 'Check', listenBig: 'Listen', listen: 'Listen' };
const EN_Q = () => ({ qid: 'q1', i: 1, text: 'Which word describes the shirt?', correct_slot: 'B', why: 'Red tells us what colour the shirt is.',
  options: [{ slot: 'A', text: 'shirt', fb: 'Shirt is the thing, not what it is like.' }, { slot: 'B', text: 'red' }] });
const UR_Q = () => ({ qid: 'q1', i: 1, text: 'قمیض کا رنگ کیا ہے؟', correct_slot: 'B', why: 'سرخ قمیض کا رنگ بتاتا ہے۔',
  options: [{ slot: 'A', text: 'قمیض' }, { slot: 'B', text: 'سرخ' }] });
const shown = (p) => p.els['#wq-fb'].innerHTML;
const LOOK = ['wq-adv'];

function withHtml(classes, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'document');
  const prev = global.document;
  global.document = { documentElement: { classList: { contains: (c) => classes.indexOf(c) >= 0 } } };
  try { return fn(); } finally { if (had) global.document = prev; else delete global.document; }
}

describe('an English quiz on an Urdu page (the look on): the feedback bubble', () => {
  test('a right answer: Jugnu\'s line and the reason are each left to right', () => {
    const p = page('en', { ui: 'ur', classes: LOOK });
    p.wq.feedback(EN_Q(), 0, 'B', true, false);
    const h = shown(p);
    expect(h).toMatch(/<div class="wq-fb wq-ok"><div dir="ltr">[^<]+<\/div><div class="wq-why" dir="ltr">Red tells us/);
  });
  test('a wrong pick: the picked option\'s own line is left to right', () => {
    const p = page('en', { ui: 'ur', classes: LOOK });
    p.wq.feedback(EN_Q(), 0, 'A', false, false);
    expect(shown(p)).toContain('<div class="wq-why" dir="ltr">Shirt is the thing');
  });
  test('an Urdu quiz on the Urdu page stays as it is', () => {
    const p = page('ur', { ui: 'ur', classes: LOOK });
    p.wq.feedback(UR_Q(), 0, 'B', true, false);
    expect(shown(p)).not.toContain('dir=');
  });
  test('an English page is today\'s', () => {
    const p = page('en', { ui: 'en', classes: LOOK });
    p.wq.feedback(EN_Q(), 0, 'B', true, false);
    expect(shown(p)).not.toContain('dir=');
  });
  test('switch off (no wq-adv): the Urdu page is today\'s, with no mark', () => {
    const p = page('en', { ui: 'ur', classes: [] });
    p.wq.feedback(EN_Q(), 0, 'B', true, false);
    expect(shown(p)).not.toContain('dir=');
    expect(shown(p)).toMatch(/<div class="wq-fb wq-ok">[^<]+<div class="wq-why">Red tells us/);
  });
});

describe('an English quiz on an Urdu page (the look on): the answer options', () => {
  const labs = (h) => h.match(/<span class="wq-lab"[^>]*>/g);
  test('an English option label is left to right', () => {
    const h = withHtml(LOOK, () => WQI.itemHtml(EN_Q(), T, 'ur'));
    expect(labs(h)).toEqual(['<span class="wq-lab" dir="ltr">', '<span class="wq-lab" dir="ltr">']);
  });
  test('an Urdu option label stays as it is', () => {
    const h = withHtml(LOOK, () => WQI.itemHtml(UR_Q(), T, 'ur'));
    expect(labs(h)).toEqual(['<span class="wq-lab">', '<span class="wq-lab">']);
  });
  test('switch off (no wq-adv) and an English page: today\'s, byte for byte', () => {
    const none = WQI.itemHtml(EN_Q(), T, 'ur');
    expect(withHtml([], () => WQI.itemHtml(EN_Q(), T, 'ur'))).toBe(none);
    expect(withHtml(LOOK, () => WQI.itemHtml(EN_Q(), T, 'en'))).toBe(none);
    expect(none).not.toContain('wq-lab" dir');
  });
});
