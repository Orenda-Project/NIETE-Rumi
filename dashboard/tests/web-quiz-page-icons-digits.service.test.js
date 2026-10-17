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

describe('the remaining marks: inline SVG with the sound kit on the page, today\'s emoji without it', () => {
  const H = require('./wq-page-harness');
  // the glyphs this batch replaces (kit on), never the speaker / bell / phone of the fix above
  const GLYPH = /[\u{1F446}\u{1F64B}\u{1F3EB}\u{1F3C6}\u{1F3E0}\u{1F7E2}⭐✓✗↩▶\u{1F9D2}\u{1F3D8}]/u;
  // a minimal sound kit: every call a no-op
  const kit = () => { const J = {}; ['tap', 'correct', 'wrong', 'word', 'sentence', 'streak', 'finish', 'badge', 'dayDot', 'mic', 'stopAll', 'skin', 'autoNext'].forEach((k) => { J[k] = () => {}; }); J.muted = () => false; J.after = () => 0; return J; };
  const modes = [['kit off', null], ['kit on', kit]];
  const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
  const card = (r) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: r } });
  const pick = (re, h) => { const m = re.exec(h); return m ? m[1] : null; };

  test.each([['en', {}], ['ur', {}], ['ur', { ui: { ur2: true } }]])('%s lesson screen (%j): the "how" icons and the play mark', (lang, bootExtra) => {
    const off = H.page({ lang, bootExtra, video: { url: 'https://r2.test/v.mp4' } });
    off.wq.video();
    const how = (h) => (pick(/<ul class="wq-how">([\s\S]*?)<\/ul>/, h) || '').match(/<li><span>([\s\S]*?)<\/span>/g) || [];
    expect(how(off.html()).map((x) => x.slice(10, -7))).toEqual(['🔊', '👆', '🙋']);
    expect(off.html()).toContain('<span class="wq-vplay" aria-hidden="true">▶</span>');
    const on = H.page({ lang, bootExtra, video: { url: 'https://r2.test/v.mp4' }, wqj: kit() });
    on.wq.video();
    const icons = how(on.html());
    expect(icons.length).toBe(3);
    icons.forEach((x) => expect(x).toMatch(/<svg[^>]*aria-hidden="true"/));
    expect(icons[0]).toContain('M4 9h4l5-4v14l-5-4H4z'); // the speaker is the same SVG as the question's
    expect(on.html()).toMatch(/<span class="wq-vplay" aria-hidden="true"><svg/);
    expect(on.html()).not.toMatch(GLYPH);
  });

  test('the live line: a green dot emoji off, an SVG dot on', () => {
    const off = H.page({ lang: 'en', live: { now: 7 } });
    off.wq.landing();
    expect(pick(/<p class="wq-proof">([\s\S]*?)<\/p>/, off.html())).toBe('🟢 7 classmates are playing right now — join them!');
    const on = H.page({ lang: 'en', live: { now: 7 }, wqj: kit() });
    on.wq.landing();
    expect(pick(/<p class="wq-proof">([\s\S]*?)<\/p>/, on.html())).toMatch(/^<svg[\s\S]*<\/svg>7 classmates/);
  });

  test('a true/false item: ✓ / ✗ off, SVG on', () => {
    const tf = [{ ...Q1, type: 'tf', options: [{ slot: 'A', text: 'True' }, { slot: 'B', text: 'False' }], correct_slot: 'A' }];
    const tfi = (h) => (h.match(/<span class="wq-tfi" aria-hidden="true">([\s\S]*?)<\/span>/g) || []).map((x) => x.replace(/^<span[^>]*>|<\/span>$/g, ''));
    const off = H.page({ lang: 'en', questions: tf });
    off.wq.question(0, false);
    expect(tfi(off.html())).toEqual(['✓', '✗']);
    const on = H.page({ lang: 'en', questions: tf, wqj: kit() });
    on.wq.question(0, false);
    const t = tfi(on.html());
    expect(t.length).toBe(2);
    t.forEach((x) => expect(x).toMatch(/^<svg/));
    expect(on.html()).not.toMatch(GLYPH);
  });

  test.each(['en', 'ur'])('%s card: the school league button, the invite ask (high and low), Watch more, the next video tile', (lang) => {
    const r = { card: { first: 'Zara', animal: 'owl', correct: 7, total: 9, stars: 7 }, challenge_code: 'CHAL12', score: { correct: 7, total: 9 }, next: { vid: 'v2', title: 'Water' } };
    const lo = { ...r, card: { ...r.card, correct: 2 }, score: { correct: 2, total: 9 } };
    const o = { lang, bootExtra: { invite_ask: 'on' }, video: { url: 'https://r2.test/v.mp4' } };
    const off = H.page({ ...o, store: card(r) }).html();
    expect(off).toContain(lang === 'en' ? 'id="wq-schools">🏫 School league<' : 'id="wq-schools">🏫 اسکولوں کی لیگ<');
    expect(pick(/<div class="wq-ask"><h2>([\s\S]*?)<\/h2>/, off)).toMatch(/^🏆 /);
    expect(off).toContain('<span class="wq-ani" aria-hidden="true">🏠</span>');
    expect(off).toContain('<span class="wq-ani" aria-hidden="true">🧒</span>');
    expect(off).toContain('<span class="wq-ani" aria-hidden="true">🏘️</span>');
    expect(off).toContain('<span class="wq-vtile wq-vt1" aria-hidden="true">▶</span>');
    expect(pick(/<div class="wq-ask"><h2>([\s\S]*?)<\/h2>/, H.page({ ...o, store: card(lo) }).html())).toMatch(/^🏠 /);
    const on = H.page({ ...o, store: card(r), wqj: kit() }).html();
    expect(on).toMatch(/id="wq-schools"><svg/);
    expect(pick(/<div class="wq-ask"><h2>([\s\S]*?)<\/h2>/, on)).toMatch(/^<svg/);
    expect(on).toMatch(/id="wq-more"><svg/);
    expect(on).not.toMatch(GLYPH);
    const onLo = H.page({ ...o, store: card(lo), wqj: kit() }).html();
    expect(pick(/<div class="wq-ask"><h2>([\s\S]*?)<\/h2>/, onLo)).toMatch(/^<svg/);
    expect(onLo).not.toMatch(GLYPH);
  });

  test('a new best: ⭐ off, an SVG star on', () => {
    const st = card({ card: { first: 'Omar', animal: 'owl', practice: true, kept: { correct: 3, total: 5 }, correct: 5, total: 5, best: { correct: 4, total: 5 } } });
    const best = (p) => { p.wq.card(); return pick(/<div class="wq-banner wq-best">([\s\S]*?)<\/div>/, p.html()); };
    expect(best(H.page({ lang: 'en', store: st }))).toMatch(/ ⭐$/);
    const on = best(H.page({ lang: 'en', store: st, wqj: kit() }));
    expect(on).toMatch(/<\/svg>$/);
    expect(on).not.toMatch(GLYPH);
  });

  test('the home sheet: 🏠 off, an SVG house on; the top bar\'s sound toggle and home button stay as today', () => {
    for (const [, k] of modes) {
      const p = H.page({ lang: 'en', store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [] } }, bootExtra: { nav: { home: true } }, questions: [Q1, Q2], ...(k ? { wqj: k() } : {}) });
      p.wq.question(0, false);
      expect(p.html()).toContain('aria-pressed="true">🔔</button>');
      expect(p.html()).toContain('<span aria-hidden="true">🏠</span><span class="wq-homet">');
      p.els['#wq-home'].fire('click');
      const sheet = pick(/<div class="wq-sheetbox"><p>([\s\S]*?)<\/p>/, p.html());
      expect(sheet).toBeTruthy();
      if (k) expect(sheet).toMatch(/^<svg/); else expect(sheet).toMatch(/^🏠 /);
    }
  });

  test('the peer pulse: the tick is "✓" text off, an SVG on', async () => {
    const src = H.SRC;
    expect(src).toContain("t.textContent = pl + ' ✓'");
    expect(src).toContain("t.innerHTML = esc(pl) + ' ' + IC.check");
  });

  test('the shipped page source: every remaining mark goes through ic(svg, emoji), outside the WhatsApp share lines', () => {
    const code = H.SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/ \/\/ .*$/, ''))
      .filter((l) => !/chalLine:/.test(l)) // a WhatsApp message: it goes to chat, not to this screen
      .filter((l) => !/^\s*how: \[\[/.test(l)) // the "how" copy keeps today's emoji: the list draws each through ic()
      .filter((l) => !/id="wq-snd"|this\.textContent = SOUND|class="wq-home" id="wq-home"/.test(l)) // the top bar: today's, the kit skins it
      .join('\n');
    const bare = code.split('\n').filter((l) => GLYPH.test(l.replace(/ic\([^()]*(\([^()]*\))?[^()]*\)/g, '').replace(/t\.textContent = pl \+ ' ✓'/, ''))).map((l) => l.trim().slice(0, 90));
    expect(bare).toEqual([]);
  });
});
