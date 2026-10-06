/**
 * Web quiz page: a wrong pick on a PICTURE question says why (public/wq/wq.js feedback).
 *
 * Bug: a picture question's options carry no words, so a wrong pick was answered with only
 * "Not yet. Look, this one is right." — or, when the picked tile had its own line, with that line
 * alone ("That is a seed."), which names the mistake but never says why the right picture is right.
 * A text question names the right answer aloud; a picture question cannot, so its reason (the
 * question's why) must always follow.
 *
 * Runs the WHOLE shipped page in a vm with a small fake DOM and the audio boundary faked.
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
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild() {}, removeChild() {}, scrollIntoView() {}, focus() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

function page(lang) {
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
      code: 'TEST', cls: { label: 'Class 1', teacher: 'Teacher Testwala', chips: [] }, live: {}, video: null,
      quiz: { code: 'TEST', lang, topic: 'Plants', grade: 1, questions: [{ qid: 'q1', text: 'a?', options: [{ slot: 'A', text: 'x' }], correct_slot: 'A' }] },
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

const WHY = { en: 'The green, flat part is the leaf. It makes food for the plant.', ur: 'سبز اور چپٹا حصہ پتا ہے۔ یہ پودے کے لیے خوراک بناتا ہے۔' };
const SEED = { en: 'That is a seed.', ur: 'یہ بیج ہے۔' };
const PIC = { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><circle cx="36" cy="36" r="20"/></svg>' };

function leafQ(lang, { seedFb = true, why = true } = {}) {
  return {
    qid: 'q1', i: 1, text: lang === 'en' ? 'Which one is a LEAF?' : 'ان میں سے پتا کون سا ہے؟',
    options: [
      { slot: 'A', text: '', pic: PIC, ...(seedFb ? { fb: SEED[lang] } : {}) },
      { slot: 'B', text: '', pic: PIC },
      { slot: 'C', text: '', img: '/api/wq/media/TEST/q1?k=C' },
    ],
    correct_slot: 'B', ...(why ? { why: WHY[lang] } : {}),
  };
}

const shown = (p) => p.els['#wq-fb'].innerHTML;
const spoken = (p) => { for (let k = 0; k < 8; k += 1) p.advance(); return p.voiced.map((v) => v.text || '').join(' '); };

describe.each(['en', 'ur'])('a wrong pick on a picture question (%s)', (lang) => {
  test('shows AND says the reason even when the picked tile has its own line', () => {
    const p = page(lang);
    p.wq.feedback(leafQ(lang), 0, 'A', false, false);
    expect(shown(p)).toContain(SEED[lang]);
    expect(shown(p)).toContain(WHY[lang].split('۔')[0].split('.')[0]);
    const said = spoken(p);
    expect(said).toContain(WHY[lang].split('۔')[0].split('.')[0]);
  });

  test('shows the reason when the picked tile has no line', () => {
    const p = page(lang);
    p.wq.feedback(leafQ(lang, { seedFb: false }), 0, 'A', false, false);
    expect(shown(p)).toContain(WHY[lang].split('۔')[0].split('.')[0]);
  });
});

describe('a wrong pick on a TEXT question keeps the picked option\'s own line (unchanged)', () => {
  test('the reason is not repeated after an option line that already explains the mix-up', () => {
    const p = page('en');
    const q = { qid: 'q1', i: 1, text: 'Which part takes in water?', correct_slot: 'B', why: 'Roots drink up water.',
      options: [{ slot: 'A', text: 'Leaf', fb: 'Leaves make food from sunlight.' }, { slot: 'B', text: 'Root' }] };
    p.wq.feedback(q, 0, 'A', false, false);
    expect(shown(p)).toContain('Leaves make food from sunlight.');
    expect(shown(p)).not.toContain('Roots drink up water.');
  });
});
