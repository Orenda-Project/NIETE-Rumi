/**
 * Web quiz page voice, the screen a lost clip leaves behind (public/wq/wq.js + wq.css, web_quiz_voice_v2).
 *
 * The walk on sandbox (Nov 2026) found three things the voice fix still got wrong on a 360 px phone:
 * - "big words" were 24 px against the normal 23 px, and the answer words did not change at all;
 * - every answer's speaker was 44 px, under the 48 px a child's thumb needs;
 * - an iPhone that cannot play Ogg Opus still downloaded every Ogg clip the lookahead warmed, then the mp3 too.
 *
 * The lookahead test runs the page's OWN voice block and lookahead block, cut from the shipped file, in a vm with
 * fetch and timers faked, so it executes the real warmClips().
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', '..', 'public', 'wq');
const SRC = fs.readFileSync(path.join(WQ, 'wq.js'), 'utf8');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // comments are not selectors
const VOICE = SRC.slice(SRC.indexOf('  var player = null;'), SRC.indexOf('  /* ---------------- tiny DOM helpers'));
const WARM = SRC.slice(SRC.indexOf('  var warmed = {};'), SRC.indexOf('  /* Late clips:'));

const KEY = 'quiz-audio/production/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/en/7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f';
const ogg = (name) => `https://acct0123.r2.cloudflarestorage.com/digital-coach-audio/${KEY}/${name}.ogg?X-Amz-Signature=abc`;
const QS = [0, 1, 2].map((i) => ({ qid: `q${i}aaaaaaaa`, audio: { q: ogg(`q${i}`), opts: [ogg(`o${i}a`), ogg(`o${i}b`)] } }));

function lookahead({ v2, safari }) {
  const fetched = [];
  const timers = [];
  const canPlay = (t) => (safari && /ogg/.test(t) ? '' : 'probably');
  const ctx = {
    LANG: 'en', VLANG: 'en', SOUND: true, ONE_VOICE: true, GAP_PHONE: true, GAP_SLOW: true, QS,
    B: { voice_v2: v2 },
    ROOT: { classList: { add() {}, remove() {} } },
    speakable: () => true,
    ev() {},
    jv: (p) => p, JUG_DIR: '/wq/',
    WQI: { imageUrls: () => [] },
    Image: function Image() {},
    document: { visibilityState: 'visible', createElement: () => ({ canPlayType: canPlay }), addEventListener() {}, removeEventListener() {} },
    location: { origin: 'https://quiz.example.test' },
    navigator: { connection: { effectiveType: '4g', saveData: false } },
    Date, URL,
    Audio: function Audio() {},
    speechSynthesis: { speak() {}, cancel() {}, getVoices: () => [] },
    fetch: (u) => { fetched.push(u); return Promise.resolve(); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${VOICE}\n${WARM}\nthis.ahead = ahead;`, ctx);
  ctx.ahead(0);
  timers.filter((t) => t.ms === 1500).forEach((t) => t.fn());
  return fetched.slice().sort(); // the next two questions first, then the rest on 4G: the order is not the point
}
const STORED = QS.flatMap((q) => [q.audio.q, ...q.audio.opts]).sort();

describe('web_quiz_voice_v2 on: the lookahead warms the clip the phone will actually play', () => {
  test('a phone that cannot play Ogg Opus warms the mp3 twins from our origin, and no Ogg at all', () => {
    const fetched = lookahead({ v2: true, safari: true });
    expect(fetched.length).toBe(9);
    expect(fetched.filter((u) => /\.ogg(\?|$)/.test(u))).toEqual([]);
    expect(fetched).toContain(`/wq/clip/${KEY}/q1.mp3`);
  });

  test('a phone that plays Ogg Opus warms the stored clips, untouched', () => {
    expect(lookahead({ v2: true, safari: false })).toEqual(STORED);
  });

  test('off: today\'s lookahead (the stored clips, whatever the phone)', () => {
    expect(lookahead({ v2: false, safari: true })).toEqual(STORED);
  });
});

// The declarations of the last rule in wq.css whose selector list contains exactly `sel` (later rules win at equal
// specificity, and every selector checked here is the most specific one for its element).
function rule(sel) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let out = null;
  while ((m = re.exec(CSS))) {
    if (m[1].split(',').map((s) => s.trim()).includes(sel)) out = m[2];
  }
  return out;
}
const px = (decl, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(?:var\\(--tap\\)|(\\d+)px)`).exec(decl || '');
  if (!m) return null;
  return m[1] ? Number(m[1]) : 48; // --tap is 48px (wq.css :root)
};

describe('a clip the child did not hear leaves words big enough to read alone (wq-novoice)', () => {
  test('the --tap token is still 48px', () => {
    expect(/--tap:48px/.test(CSS)).toBe(true);
  });

  test('English: the question is at least 30 px and each answer at least 26 px (normal: 23 and 21)', () => {
    expect(px(rule('.wq-novoice .wq-qtext'), 'font-size')).toBeGreaterThanOrEqual(30);
    expect(px(rule('.wq-novoice .wq-opt'), 'font-size')).toBeGreaterThanOrEqual(26);
  });

  test('Urdu (the polished look outranks the plain rule): question at least 30 px, answers at least 26 px', () => {
    expect(px(rule('html.wq-ur2[lang=ur] .wq-novoice .wq-qtext'), 'font-size')).toBeGreaterThanOrEqual(30);
    expect(px(rule('html.wq-ur2[lang=ur] .wq-novoice .wq-opt'), 'font-size')).toBeGreaterThanOrEqual(26);
  });
});

describe('every answer\'s own speaker is a full 48 px tap target', () => {
  test('.wq-opt .wq-ohear is 48 × 48', () => {
    const d = rule('.wq-opt .wq-ohear');
    expect(px(d, 'width')).toBeGreaterThanOrEqual(48);
    expect(px(d, 'height')).toBeGreaterThanOrEqual(48);
  });
});

describe('a small text button (.wq-linkbtn) is still a 48 px tap target', () => {
  test('English rule: min-height 48', () => {
    expect(px(rule('.wq-linkbtn'), 'min-height')).toBeGreaterThanOrEqual(48);
  });

  test('Urdu rule (outranks the plain one): min-height 48', () => {
    expect(px(rule('html.wq-ur2[lang=ur] .wq-linkbtn'), 'min-height')).toBeGreaterThanOrEqual(48);
  });
});
