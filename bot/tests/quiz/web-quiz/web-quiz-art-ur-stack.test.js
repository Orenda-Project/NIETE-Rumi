'use strict';
/**
 * The Urdu share picture as one stack (app_settings web_quiz_share_ur_stack, default OFF). On the square challenge
 * picture a long name pushed the headline onto a second line with one lone word, and the stars ran into the top of the
 * pill; the Urdu pill was twice the English one, and it still said «ٹیپ». With the switch, on an Urdu card or challenge
 * picture (square and wide):
 *   - headline, sub line, stars and pill are one column with 24 px between them, nothing positioned over anything;
 *   - the headline breaks into balanced lines, and one that would need more than 2 lines drops one size step;
 *     a name that alone is wider than the line is sized to fit it (never cut);
 *   - the pill is the English pill's height and side padding, its Nastaliq a step larger, and it says «لنک کھولیں اور کھیلیں».
 * Off (absent or anything but JSON true), and on every English picture: the HTML, the input and the cache key are
 * exactly today's (pinned as hashes recorded on the base, in __golden__/web-quiz-art-off.json).
 */
jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();
  const cmd = (type) => jest.fn().mockImplementation((input) => ({ type, input }));
  return {
    __send: send,
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    GetObjectCommand: cmd('get'), HeadObjectCommand: cmd('head'), PutObjectCommand: cmd('put'),
    DeleteObjectCommand: cmd('delete'), ListObjectsV2Command: cmd('list'),
  };
});
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));

const crypto = require('crypto');
const sharp = require('sharp');
const S3 = require('@aws-sdk/client-s3');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const { renderArt, KINDS } = require('../../../shared/templates/web-quiz-art.template');
const Input = require('../../../shared/services/quiz/web-quiz-art-input');
const GOLDEN = require('./__golden__/web-quiz-art-off.json');

const LONG = 'محمدعبدالرحمان'; // 14 letters, one word
const OPEN = 'لنک کھولیں اور کھیلیں';
const TAP = 'لنک پر ٹیپ کریں اور کھیلیں';
const LIVE = { ur2: true, ink: true, ud: true, nf: true }; // the switches the share runs with today
const inv = (first, lang = 'ur') => ({ first, correct: 4, total: 7, topic: lang === 'ur' ? 'تفہیم - مکالمے کو سمجھنا' : 'Rocket and Space Vocabulary' });
const card = (first, lang = 'ur') => ({ ...inv(first, lang), animal: 'cat', cls: '', school: 'School Alpha', added: 18 });
const art = (kind, size, lang, d, ui, door) => renderArt({ kind, size, brand: 'niete', lang, d, ui, door }, { fonts: false, pictures: false });
const css = (h) => h.slice(h.indexOf('<style>'), h.indexOf('</style>'));
const ctaText = (h) => (/<div class="cta">([^<]*)<\/div>/.exec(h) || [])[1];
const headPx = (h) => Number((/\.head\{font-size:(\d+)px;line-height:1\.8;text-wrap:balance/.exec(css(h)) || [])[1]);
const pillOf = (h) => { const m = /\.cta\{height:(\d+)px;line-height:(\d+)px;padding:0 28px;font-size:(\d+)px/.exec(css(h)); return m ? { h: Number(m[1]), lh: Number(m[2]), fs: Number(m[3]) } : null; };

describe('the template, switch on', () => {
  for (const size of ['sq', 'og']) {
    test(`ur ${size} challenge: the pill says «${OPEN}», never «ٹیپ»`, () => {
      const h = art('invite', size, 'ur', inv('Iqra'), { ...LIVE, us: true });
      expect(ctaText(h)).toBe(OPEN);
      expect(h).not.toContain('ٹیپ');
    });
    test(`ur ${size}: the pill is the English pill's height and side padding (it was about twice it)`, () => {
      const en = art('invite', size, 'en', inv('Iqra', 'en'), LIVE);
      // the English pill: 26 px Lexend (a step up on the square) at 1.2, 14 px above and below, 28 px at the sides
      const enFs = Math.round(26 * (size === 'sq' ? 1.08 : 1));
      expect(css(en)).toContain(`font-size:${enFs}px;line-height:1.2;font-weight:800;padding:14px 28px`);
      const p = pillOf(art('invite', size, 'ur', inv('Iqra'), { ...LIVE, us: true }));
      expect(p).toEqual({ h: Math.round(enFs * 1.2 + 28), lh: Math.round(enFs * 1.2 + 28), fs: enFs + 2 });
    });
    test(`ur ${size}: one column, 24 px between the headline, sub line, stars and pill`, () => {
      for (const kind of ['invite', 'card']) {
        const c = css(art(kind, size, 'ur', kind === 'invite' ? inv(LONG) : card(LONG), { ...LIVE, us: true }));
        expect(c).toMatch(/\.main\{[^}]*gap:24px/);
        expect(c).toContain('.cta{margin:0}');
        if (size === 'sq') {
          expect(c).toContain('.art{gap:24px;justify-content:center}');
          // the picture of Jugnu gives up height first, so the words never run over each other or off the picture
          expect(c).toContain('.side{flex:0 1 190px;min-height:96px}');
        }
      }
    });
  }
  test('a headline that fits 2 lines keeps its size and balances them (no lone «نکلیں!»)', () => {
    const h = art('invite', 'sq', 'ur', inv(LONG), { ...LIVE, us: true });
    expect(headPx(h)).toBe(Math.round(58 * 1.08));
    expect(css(h)).toContain('text-wrap:balance');
  });
  test('a headline that would need 3 lines drops one size step', () => {
    // about 50 letters: at 63 px the headline is over 2 lines of the square's 936 px
    const longer = 'محمدعبدالرحمان عبداللہ ٹیسٹ والا خان صاحب بہادر';
    const base = headPx(art('invite', 'sq', 'ur', inv('Iqra'), { ...LIVE, us: true }));
    const h = headPx(art('invite', 'sq', 'ur', inv(longer), { ...LIVE, us: true }));
    expect(h).toBeLessThan(base);
    expect(h).toBeGreaterThanOrEqual(Math.round(base * 0.8));
    expect(headPx(art('invite', 'og', 'ur', inv('Iqra'), { ...LIVE, us: true }))).toBe(40);
    const og = headPx(art('invite', 'og', 'ur', inv(`${longer} ${longer}`), { ...LIVE, us: true }));
    expect(og).toBeLessThan(40);
  });
  test('a name wider than the line on its own is sized to fit it, never cut', () => {
    const one = 'محمدعبدالرحمانعبداللہٹیسٹوالاخانصاحب'; // 37 letters, no space to break at
    const h = art('invite', 'sq', 'ur', inv(one), { ...LIVE, us: true });
    expect(headPx(h) * 0.46 * Array.from(one).length).toBeLessThanOrEqual(936);
    expect(h).toContain(`<bdi dir="rtl">${one}</bdi>`);
  });
  test('the challenge sub line names the quiz in «»: «<name> نے «<quiz>» میں ۴/۷ لیے», the quiz still its own run', () => {
    for (const size of ['sq', 'og']) {
      const h = art('invite', size, 'ur', inv(LONG), { ...LIVE, us: true });
      expect(h).toContain(`<p class="sub"><bdi dir="rtl">${LONG}</bdi> نے «<bdi dir="rtl">تفہیم - مکالمے کو سمجھنا</bdi>» میں <span class="num">۴/۷</span> لیے</p>`);
    }
    // a Latin quiz name keeps its own LTR run inside the marks
    expect(art('invite', 'sq', 'ur', { ...inv('Iqra'), topic: 'Plants' }, { ...LIVE, us: true })).toContain('نے «<bdi dir="ltr">Plants</bdi>» میں');
    // off: today's line, no marks
    expect(art('invite', 'sq', 'ur', inv(LONG), LIVE)).toContain(`نے <bdi dir="rtl">تفہیم - مکالمے کو سمجھنا</bdi> میں`);
  });
  test('the friend\'s door keeps «آپ کی باری!» in the same pill', () => {
    const h = art('invite', 'sq', 'ur', inv('Iqra'), { ...LIVE, us: true }, true);
    expect(ctaText(h)).toBe('آپ کی باری!');
    expect(pillOf(h)).not.toBeNull();
  });
  test('English pictures, and the class and school pictures, are unchanged by the switch', () => {
    for (const size of ['sq', 'og']) {
      for (const kind of ['invite', 'card']) {
        const d = kind === 'invite' ? inv(LONG, 'en') : card(LONG, 'en');
        expect(art(kind, size, 'en', d, { ...LIVE, us: true })).toBe(art(kind, size, 'en', d, LIVE));
      }
      const cls = { topic: 'کسور', cls: '', played: 5, of: 9, avgPct: 64, rows: [] };
      expect(art('class', size, 'ur', cls, { ...LIVE, us: true })).toBe(art('class', size, 'ur', cls, LIVE));
    }
  });
});

describe('the template, switch off: exactly today (hashes recorded on the base)', () => {
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  const D = (first, lang) => ({ first, animal: 'cat', correct: 4, total: 7, topic: lang === 'ur' ? 'تفہیم - مکالمے کو سمجھنا' : 'Rocket and Space Vocabulary', cls: 'Grade 3', school: 'School Alpha', added: 18,
    played: 5, of: 9, avgPct: 64, top: { correct: 6, total: 7 }, rows: [{ place: 1, animal: 'owl', correct: 6, total: 7 }, { place: 2, animal: 'cat', correct: 4, total: 7, me: true, first }] });
  const UIS = { none: undefined, live: LIVE, ink: { ink: true } };
  const OFFS = [['absent', {}], ['false', { us: false }], ['the string "true"', { us: 'true' }], ['1', { us: 1 }]];
  test.each(OFFS)('us %s: every kind, size, language, name and switch set draws today\'s HTML', (_n, off) => {
    let n = 0;
    for (const kind of KINDS) for (const size of ['og', 'sq']) for (const lang of ['en', 'ur']) for (const first of ['Iqra', LONG]) for (const [u, ui] of Object.entries(UIS)) for (const door of [false, true]) {
      const d = kind === 'school' ? { rows: [{ rank: 1, name: 'School Alpha', sector: 'Sector One', points: 1234, kids: 15, move: 1, you: true }] } : D(first, lang);
      const key = `${kind}|${size}|${lang}|${first}|${u}|${door ? 'door' : ''}`;
      expect([key, sha(art(kind, size, lang, d, ui || Object.keys(off).length ? { ...(ui || {}), ...off } : ui, door))]).toEqual([key, GOLDEN[key]]);
      n += 1;
    }
    expect(n).toBe(Object.keys(GOLDEN).length);
  });
  test('off, the Urdu pill still says today\'s words', () => {
    expect(ctaText(art('invite', 'sq', 'ur', inv('Iqra'), LIVE))).toBe(TAP);
  });
});

describe('the input (and so the cache key)', () => {
  const f = { lang: 'ur', d: inv(LONG) };
  test('on: the stack rides in the ui with its own version (a new key)', () => {
    expect(Input.artInput('invite', 'sq', 'niete', f, { us: true }).ui).toEqual({ us: true, sv: Input.ART_US_V });
    expect(Input.artInput('invite', 'sq', 'niete', f, { ...LIVE, us: true }).ui).toMatchObject({ us: true, sv: Input.ART_US_V, nf: true, ud: true });
  });
  test('off: exactly today\'s input', () => {
    expect(Input.artInput('invite', 'sq', 'niete', f, null)).toEqual({ kind: 'invite', size: 'sq', brand: 'niete', lang: 'ur', d: inv(LONG) });
    expect(Input.artInput('invite', 'sq', 'niete', f, { us: false })).toEqual({ kind: 'invite', size: 'sq', brand: 'niete', lang: 'ur', d: inv(LONG) });
    expect(Input.artInput('invite', 'sq', 'niete', f, { ink: true, us: 'true' })).toEqual(Input.artInput('invite', 'sq', 'niete', f, { ink: true }));
  });
});

describe('served: the switch read in the card switches\' one read', () => {
  const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  const seed = (lang, settings) => {
    const now = Date.now();
    return {
      quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', teacher_user_id: 't-1', topic: 'Fractions', language: lang, active: true }],
      quizzes: [{ id: 'qz-1', topic: 'Fractions', grade: '3', subject: 'Maths', language: lang, meta: {} }],
      students: [{ id: 'st-1', student_name: `${LONG} Testwala` }],
      quiz_sessions: [{ id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: `${LONG} Testwala`, share_code_id: 'sc-1', status: 'completed',
        correct_answers: 4, total_questions_answered: 7, mastery_percentage: 57, completed_at: new Date(now - 60000).toISOString(), created_at: new Date(now - 300000).toISOString() }],
      app_settings: settings, users: [{ id: 't-1', school_id: 'SA' }],
      schools: [{ id: 'SA', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false }],
    };
  };
  let Art;
  let errSpy;
  async function drawn(lang, settings, size = 'sq') {
    const fake = makeFake(seed(lang, settings));
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
    require('../../../shared/services/quiz/web-quiz-card-switch')._reset();
    require('../../../shared/services/quiz/web-quiz-ur-polish')._reset();
    require('../../../shared/services/quiz/web-quiz-schools')._reset();
    Art._resetCache();
    htmlToImage.mockClear();
    const out = await Art.artImage(Art.artId('c', SID), { size });
    return { key: out.key, html: htmlToImage.mock.calls[0][0] };
  }
  beforeEach(() => {
    Object.assign(process.env, { R2_ENDPOINT: 'https://r2.example.test', R2_ACCESS_KEY_ID: 'test-only', R2_SECRET_ACCESS_KEY: 'test-only', INTERNAL_API_KEY: 'art-key' });
    delete process.env.WEB_QUIZ_TOKEN_SECRET;
    Art = require('../../../shared/services/quiz/web-quiz-art');
    S3.__send.mockReset().mockImplementation(async (c) => {
      if (c.type === 'head' || c.type === 'get') throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return {};
    });
    htmlToImage.mockReset().mockImplementation(async (h, o) => sharp({ create: { width: o.width, height: o.height || o.width, channels: 3, background: '#333748' } }).png().toBuffer());
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());
  const ON = [{ key: 'web_quiz_share_ur_stack', value: true }];

  test('on: an Urdu card is drawn as the stack under a new key', async () => {
    const off = await drawn('ur', []);
    const on = await drawn('ur', ON);
    expect(css(off.html)).not.toContain('.art{gap:24px;justify-content:center}');
    expect(css(on.html)).toContain('.art{gap:24px;justify-content:center}');
    expect(on.key).not.toBe(off.key);
  });
  test('on: an English card keeps its key and its HTML', async () => {
    const off = await drawn('en', []);
    const on = await drawn('en', ON);
    expect(on.key).toBe(off.key);
    expect(on.html).toBe(off.html);
  });
  test.each([['false', false], ['the string "true"', 'true'], ['1', 1]])('the key %s: today\'s key and HTML', async (_n, value) => {
    const today = await drawn('ur', []);
    const off = await drawn('ur', [{ key: 'web_quiz_share_ur_stack', value }]);
    expect(off.key).toBe(today.key);
    expect(off.html).toBe(today.html);
  });
});
