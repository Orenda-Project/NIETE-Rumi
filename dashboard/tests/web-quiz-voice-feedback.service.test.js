/**
 * Web quiz page: what the voice says after an answer, and silence when the page goes away
 * (public/wq/wq.js feedback / speak / stopAll).
 *
 * Runs the WHOLE shipped page in a vm with a small fake DOM and the browser's audio boundary
 * faked (Audio, speechSynthesis, AudioContext), so each test executes the real screen code.
 *
 * Bug 1: a child answered wrong and heard "Well done!". The page played the question's recorded
 * "why" clip on a wrong answer, that clip had been recorded from the praise line, and the clip
 * replaced the spoken "Not yet…" line entirely.
 * Bug 2: closing WhatsApp's in-app browser left the voice playing.
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

function page({ lang = 'en' } = {}) {
  const voiced = []; // in order: { url } for a clip, { text } for the phone's voice
  const clips = [];
  const utterances = [];
  const media = []; // <audio>/<video> elements already in the page (e.g. the lesson video)
  let cancels = 0;
  class FakeAudio {
    constructor(url) { this.url = url; this.paused = true; this.listeners = {}; clips.push(this); voiced.push({ url }); }
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }
    play() { this.paused = false; this.plays = (this.plays || 0) + 1; (this.listeners.playing || []).forEach((f) => f()); return Promise.resolve(); }
    pause() { this.paused = true; }
    canPlayType() { return 'probably'; }
  }
  const docListeners = {};
  const winListeners = {};
  const els = {};
  const root = fakeEl('#wq');
  root.querySelector = (sel) => { if (!els[sel]) els[sel] = fakeEl(sel); return els[sel]; };
  root.querySelectorAll = () => [];
  const boot = {
    textContent: JSON.stringify({
      code: 'TEST', cls: { label: 'Class 3', teacher: 'Teacher Testwala', chips: [] }, live: {}, video: null,
      quiz: { code: 'TEST', lang, topic: 'Plants', grade: 3, questions: [{ qid: 'q1', text: 'a?', options: [{ slot: 'A', text: 'x' }], correct_slot: 'A' }] },
    }),
  };
  const actx = { state: 'running', suspended: 0, suspend() { this.suspended += 1; this.state = 'suspended'; return Promise.resolve(); }, resume() { this.state = 'running'; return Promise.resolve(); } };
  const ctx = {
    console, URLSearchParams,
    document: {
      visibilityState: 'visible',
      getElementById: (id) => (id === 'boot' ? boot : id === 'wq' ? root : null),
      createElement: (t) => (t === 'audio' ? { canPlayType: () => 'probably' } : fakeEl(t)),
      addEventListener: (n, fn) => { (docListeners[n] = docListeners[n] || []).push(fn); },
      querySelectorAll: (sel) => (/audio|video/.test(sel) ? media : []),
      dispatchEvent() { return true; },
      body: fakeEl('body'),
    },
    location: { search: '', origin: 'https://example.test' },
    navigator: { userAgent: 'test' },
    localStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    Audio: FakeAudio,
    AudioContext: function AudioContext() { return actx; },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => { utterances.push(u); voiced.push({ text: u.text }); }, cancel: () => { cancels += 1; } },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout() {},
    scrollTo() {}, Image: function Image() {},
    addEventListener: (n, fn) => { (winListeners[n] = winListeners[n] || []).push(fn); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(TAIL, '  else landing();\n  window.__wq = { feedback: feedback, speak: speak, speakSeq: speakSeq, sfx: sfx, results: results, VOICE: typeof VOICE === \'undefined\' ? null : VOICE };\n})();'), ctx);
  // Moving the voice on: the current clip or phone-voice line ends by itself.
  const advance = () => {
    const last = voiced[voiced.length - 1];
    if (last && last.url) { const c = clips[clips.length - 1]; if (c.onended) c.onended(); }
    else if (last && last.text != null) { const u = utterances[utterances.length - 1]; if (u.onend) u.onend(); }
  };
  const fire = (target, n) => ((target === 'doc' ? docListeners : winListeners)[n] || []).forEach((fn) => fn({}));
  return { ctx, wq: ctx.__wq, voiced, clips, media, actx, advance, fire, cancels: () => cancels, els };
}
const flush = () => new Promise((r) => setImmediate(r));

const WHY_CLIP = 'https://r2.example/web-quiz/audio/z/q1/why-abc.ogg';
function plantQ(lang, { pickedFb = false } = {}) {
  const en = lang === 'en';
  return {
    qid: 'q1', i: 1, text: en ? 'Which part of a plant takes in water from the soil?' : 'پودے کا کون سا حصہ مٹی سے پانی لیتا ہے؟',
    options: [
      { slot: 'A', text: en ? 'Leaf' : 'پتا', ...(pickedFb ? { fb: en ? 'Leaves make food from sunlight.' : 'پتے دھوپ سے خوراک بناتے ہیں۔' } : {}) },
      { slot: 'B', text: en ? 'Root' : 'جڑ' },
    ],
    correct_slot: 'B',
    why: en ? 'Roots grow under the soil and drink up water.' : 'جڑیں مٹی کے نیچے ہوتی ہیں اور پانی لیتی ہیں۔',
    fb_right: en ? 'Well done!' : 'شاباش!',
    audio: { q: 'https://r2.example/q.ogg', opts: ['https://r2.example/a.ogg', 'https://r2.example/b.ogg', null, null], why: WHY_CLIP },
  };
}
const PRAISE = /well done|great|brilliant|you got it|شاباش|بہت خوب|زبردست|درست!/i;

describe.each(['en', 'ur'])('a wrong answer (%s)', (lang) => {
  const NOT_YET = lang === 'en' ? /not yet/i : /ابھی نہیں/;

  test('is voiced as "not yet" first — never the recorded why clip in its place', () => {
    const p = page({ lang });
    p.wq.feedback(plantQ(lang), 0, 'A', false, false);
    expect(p.voiced.length).toBeGreaterThan(0);
    const first = p.voiced[0];
    // The "not yet" line comes first, as a recorded line or the phone's voice — not the why clip.
    expect(first.url === WHY_CLIP).toBe(false);
    if (first.text != null) expect(first.text).toMatch(NOT_YET);
    else expect(first.url).toMatch(/notyet/);
  });

  test('then names the right answer and says why, with no praise anywhere in what is spoken', () => {
    const p = page({ lang });
    p.wq.feedback(plantQ(lang), 0, 'A', false, false);
    for (let k = 0; k < 6; k += 1) p.advance();
    const said = p.voiced.filter((v) => v.text != null).map((v) => v.text).join(' ');
    expect(said).not.toMatch(PRAISE);
    // The right answer is named: its own option clip or its words.
    expect(p.voiced.some((v) => v.url === 'https://r2.example/b.ogg' || (v.text || '').includes(lang === 'en' ? 'Root' : 'جڑ'))).toBe(true);
    // The why comes last, from the question's why clip (recorded from the explanation).
    expect(p.voiced[p.voiced.length - 1]).toEqual({ url: WHY_CLIP });
  });

  test('a picked option with its own feedback is voiced with THAT feedback, not the question\'s why clip', () => {
    const p = page({ lang });
    p.wq.feedback(plantQ(lang, { pickedFb: true }), 0, 'A', false, false);
    for (let k = 0; k < 6; k += 1) p.advance();
    expect(p.voiced.some((v) => v.url === WHY_CLIP)).toBe(false);
    const said = p.voiced.filter((v) => v.text != null).map((v) => v.text).join(' ');
    expect(said).toContain(lang === 'en' ? 'Leaves make food from sunlight' : 'پتے دھوپ سے خوراک بناتے ہیں');
  });
});

describe.each(['en', 'ur'])('a right answer (%s)', (lang) => {
  test('praises, then gives the reason (the why), not the praise-only feedback line twice', () => {
    const p = page({ lang });
    p.wq.feedback(plantQ(lang), 0, 'B', true, false);
    for (let k = 0; k < 6; k += 1) p.advance();
    const said = p.voiced.map((v) => v.text || v.url).join(' ');
    expect(said).toMatch(lang === 'en' ? /Roots grow under the soil|why-abc/ : /جڑیں مٹی کے نیچے|why-abc/);
    expect(said).not.toMatch(lang === 'en' ? /Well done!/ : /شاباش!/);
  });
});

describe('leaving the page silences everything and nothing starts again by itself', () => {
  const cases = [['doc', 'visibilitychange', true], ['win', 'pagehide', false], ['doc', 'freeze', false], ['win', 'beforeunload', false]];
  test.each(cases)('%s %s', async (target, name, setHidden) => {
    const p = page({ lang: 'ur' });
    const video = { paused: false, pause() { this.paused = true; } };
    p.media.push(video);
    const done = jest.fn();
    p.wq.speakSeq([{ text: 'سوال', url: 'https://r2.example/q.ogg' }, { text: 'پتا', url: 'https://r2.example/a.ogg' }], done);
    p.ctx.__wq.sfx && p.ctx.__wq.sfx('right');
    await flush();
    const clip = p.clips[p.clips.length - 1];
    expect(clip.paused).toBe(false);
    const before = p.cancels();
    if (setHidden) p.ctx.document.visibilityState = 'hidden';
    p.fire(target, name);
    expect(clip.paused).toBe(true);
    expect(p.cancels()).toBeGreaterThan(before);
    expect(video.paused).toBe(true);
    // Coming back: the stopped clip "ends" late and its stalled timer would fire — nothing more plays.
    p.ctx.document.visibilityState = 'visible';
    p.fire('doc', 'visibilitychange');
    const n = p.voiced.length;
    if (clip.onended) clip.onended();
    await flush();
    expect(p.voiced.length).toBe(n);
    expect(done).not.toHaveBeenCalled();
  });
});

/* ---------------- the shared feedback voice library (recorded once, used by every quiz) ---------------- */
const VOICE_DIR = path.join(__dirname, '..', 'public', 'wq', 'voice');
const MANIFEST = fs.existsSync(path.join(VOICE_DIR, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(VOICE_DIR, 'manifest.json'), 'utf8')) : {};
const shown = (p) => p.els['#wq-fb'].innerHTML;

describe('the feedback voice library', () => {
  test('every line the page can say has its recorded clip, and the page holds exactly the recorded words', () => {
    const p = page({ lang: 'en' });
    const lib = JSON.parse(JSON.stringify(p.wq.VOICE || {}));
    expect(lib).toEqual(MANIFEST);
    for (const lang of ['en', 'ur']) {
      for (const set of ['right', 'notyet', 'fixed', 'done', 'cheer']) expect((lib[lang] || {})[set].length).toBeGreaterThanOrEqual(8);
      Object.entries(lib[lang]).forEach(([set, lines]) => lines.forEach((_, i) => {
        const f = path.join(VOICE_DIR, lang, `${set}-${i}.mp3`);
        expect(fs.existsSync(f)).toBe(true);
        expect(fs.statSync(f).size).toBeLessThan(40000);
      }));
    }
  });

  test('Urdu lines address the child without gendered verb stems, and no not-yet line praises', () => {
    const ur = MANIFEST.ur || {};
    Object.values(ur).flat().forEach((t) => expect(t).not.toMatch(/سکتے|سکتی|گئیں|آپ نے|کرتے ہو|کرتی ہو/));
    [...(ur.notyet || []), ...(ur.notyetpic || [])].forEach((t) => expect(t).not.toMatch(/شاباش|بہت خوب|زبردست|کمال/));
    [...((MANIFEST.en || {}).notyet || []), ...((MANIFEST.en || {}).notyetpic || [])].forEach((t) => expect(t).not.toMatch(/well done|great|brilliant|good job/i));
  });

  describe.each(['en', 'ur'])('%s', (lang) => {
    const clip = (set) => new RegExp(`^/wq/voice/${lang}/${set}-\\d+\\.mp3(\\?v=\\w+)?$`);
    test('a right answer plays a recorded praise line, and the screen shows those same words', () => {
      const p = page({ lang });
      p.wq.feedback(plantQ(lang), 0, 'B', true, false);
      expect(p.voiced[0].url).toMatch(clip('right'));
      const i = Number(p.voiced[0].url.match(/-(\d+)\.mp3/)[1]);
      expect(shown(p)).toContain(MANIFEST[lang].right[i].replace(/'/g, '&#39;'));
    });
    test('a wrong answer plays a recorded "not yet" lead-in, then the right option\'s own clip, then why', () => {
      const p = page({ lang });
      p.wq.feedback(plantQ(lang), 0, 'A', false, false);
      for (let k = 0; k < 6; k += 1) p.advance();
      expect(p.voiced.map((v) => v.url || v.text)).toEqual([expect.stringMatching(clip('notyet')), 'https://r2.example/b.ogg', WHY_CLIP]);
    });
    test('a second try that is right plays a recorded "fixed it" line', () => {
      const p = page({ lang });
      p.wq.feedback(plantQ(lang), 0, 'B', true, true);
      expect(p.voiced[0].url).toMatch(clip('fixed'));
    });
    test('a wrong answer whose right option is only a picture says "this one is right", never empty quotes', () => {
      const p = page({ lang });
      const q = plantQ(lang);
      q.options = [{ slot: 'A', text: '' }, { slot: 'B', text: '' }];
      q.why = null; q.audio = {};
      p.wq.feedback(q, 0, 'A', false, false);
      expect(p.voiced[0].url).toMatch(clip('notyetpic'));
      expect(shown(p).replace(/alt=""/g, "")).not.toMatch(/""|«»|&quot;&quot;/);
    });
    test('the results screen plays a recorded "quiz complete" line', async () => {
      const p = page({ lang });
      p.wq.results(0);
      for (let k = 0; k < 4; k += 1) await flush();
      expect(p.voiced.some((v) => clip('done').test(v.url || ''))).toBe(true);
    });
  });
});
