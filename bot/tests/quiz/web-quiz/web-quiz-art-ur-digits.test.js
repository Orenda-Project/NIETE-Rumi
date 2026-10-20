'use strict';
/**
 * Urdu share pictures draw their numbers in Urdu digits (app_settings web_quiz_share_ur_digits, default OFF): the
 * page says ۴/۷, so the picture under it says ۴/۷ too, never 4/7. Every kind (card, invite, class, school) and both
 * sizes. Off, or an English picture: the input, the cache key and the HTML are exactly today's.
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

const sharp = require('sharp');
const S3 = require('@aws-sdk/client-s3');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const { renderArt } = require('../../../shared/templates/web-quiz-art.template');
const Input = require('../../../shared/services/quiz/web-quiz-art-input');

const WESTERN = /[0-9]/;
// the numbers' own runs only: the CSS and the embedded pictures carry ASCII digits of their own
const nums = (html) => Array.from(html.matchAll(/<span class="num">([^<]*)<\/span>/g), (m) => m[1]);

const D = {
  card: { first: 'Amal Testwala', animal: 'cat', correct: 4, total: 7, topic: 'کسور', cls: 'جماعت ۳', school: 'School Alpha', added: 18 },
  invite: { first: 'Amal Testwala', correct: 4, total: 7, topic: 'کسور' },
  class: { topic: 'کسور', cls: 'جماعت ۳', played: 12, of: 30, avgPct: 64, top: { correct: 7, total: 7 },
    rows: [{ place: 1, animal: 'cat', correct: 7, total: 7 }, { place: 2, animal: 'dog', correct: 4, total: 7, me: true, first: 'Amal Testwala' }] },
  school: { rows: [{ rank: 1, name: 'School Alpha', sector: 'Sector One', points: 1234, kids: 15, move: 1, you: true }, { rank: 2, name: 'School Beta', sector: '', points: 980, kids: 9, move: 0 }] },
};
const html = (kind, lang, ui, size = 'og') => renderArt({ kind, size, brand: 'niete', lang, d: D[kind], ui }, { fonts: false, pictures: false });

describe('the template', () => {
  for (const kind of Object.keys(D)) {
    for (const size of ['og', 'sq']) {
      test(`${kind} ${size}: an Urdu picture with the switch draws every number in Urdu digits`, () => {
        const n = nums(html(kind, 'ur', { ud: true }, size));
        expect(n.length).toBeGreaterThan(0);
        for (const s of n) expect(s).not.toMatch(WESTERN);
      });
      test(`${kind} ${size}: the switch off, the Urdu picture is today's (Western digits, same HTML)`, () => {
        expect(nums(html(kind, 'ur', null, size)).some((s) => WESTERN.test(s))).toBe(true);
      });
      test(`${kind} ${size}: an English picture is byte-identical with or without the switch`, () => {
        expect(html(kind, 'en', { ud: true }, size)).toBe(html(kind, 'en', null, size));
      });
    }
  }
  test('the invite says ۴/۷ (the page line) and its stars stay 4 of 7', () => {
    const h = html('invite', 'ur', { ud: true });
    expect(h).toContain('<span class="num">۴/۷</span>');
    expect(h).not.toContain('<span class="num">4/7</span>');
    expect((h.match(/class="star on"/g) || []).length).toBe(4);
    expect((h.match(/class="star( on)?"/g) || []).length).toBe(7);
  });
  test('the school rule line (digits typed in the copy) says ۱۰ too; the switch off it is today\'s', () => {
    const cta = (h) => (h.match(/<div class="cta">([^<]*)<\/div>/) || [])[1];
    expect(cta(html('school', 'ur', { ud: true }))).toBe('کھیلنے کے ۱۰ پوائنٹس، اسکور کے ۱۰ تک');
    expect(cta(html('school', 'ur', null))).toBe('کھیلنے کے 10 پوائنٹس، اسکور کے 10 تک');
  });
  test('no middle dot beside an Urdu digit (in Nastaliq it reads as ۰: «۱۵ ·» looks like ۱۵۰); the Urdu comma instead', () => {
    const school = html('school', 'ur', { ud: true });
    expect(school).toContain('پوائنٹس،&ensp;<span class="num">۱۵</span>');
    expect(school).not.toMatch(/·\s*<span class="num">/);
    for (const kind of ['card', 'class']) {
      const h = html(kind, 'ur', { ud: true }).replace(/<style>[\s\S]*<\/style>/, '');
      expect(h).not.toContain('·');
    }
    // the switch off: today's dots
    expect(html('school', 'ur', null)).toContain('پوائنٹس · <span class="num">15</span>');
  });
  test('the school points keep their grouping: 1,234 → ۱,۲۳۴', () => {
    expect(html('school', 'ur', { ud: true })).toContain('۱,۲۳۴');
  });
  test('Urdu digits have a face to draw them in (the numbers run falls back to the Nastaliq face)', () => {
    const h = renderArt({ kind: 'invite', size: 'og', brand: 'niete', lang: 'ur', d: D.invite, ui: { ud: true } }, { pictures: false });
    expect(h).toMatch(/\.num\{font-family:'Lexend','NastaliqUrdu'/);
  });
});

describe('the input (and so the cache key)', () => {
  const f = { lang: 'ur', d: D.invite };
  test('off: no ui at all, exactly today', () => {
    expect(Input.artInput('invite', 'og', 'niete', f, null)).toEqual({ kind: 'invite', size: 'og', brand: 'niete', lang: 'ur', d: D.invite });
  });
  test('on: the Urdu digits ride in the ui with their own version (a new key)', () => {
    expect(Input.artInput('invite', 'og', 'niete', f, { ud: true }).ui).toEqual({ ud: true, dv: Input.ART_UD_V });
  });
});

describe('served: the switch read in the card switches\' one read', () => {
  const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  const seed = (lang, on) => {
    const now = Date.now();
    return {
      quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', teacher_user_id: 't-1', topic: 'Fractions', language: lang, active: true }],
      quizzes: [{ id: 'qz-1', topic: 'Fractions', grade: '3', subject: 'Maths', language: lang, meta: {} }],
      students: [{ id: 'st-1', student_name: 'Amal Testwala' }],
      quiz_sessions: [{ id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed',
        correct_answers: 4, total_questions_answered: 7, mastery_percentage: 57, completed_at: new Date(now - 60000).toISOString(), created_at: new Date(now - 300000).toISOString() }],
      app_settings: on ? [{ key: 'web_quiz_share_ur_digits', value: true }] : [], users: [{ id: 't-1', school_id: 'SA' }],
      schools: [{ id: 'SA', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false }],
    };
  };
  let Art;
  let errSpy;
  async function drawn(lang, on) {
    const fake = makeFake(seed(lang, on));
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
    require('../../../shared/services/quiz/web-quiz-card-switch')._reset();
    require('../../../shared/services/quiz/web-quiz-ur-polish')._reset();
    require('../../../shared/services/quiz/web-quiz-schools')._reset();
    Art._resetCache();
    htmlToImage.mockClear();
    const out = await Art.artImage(Art.artId('c', SID), { size: 'og' });
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

  test('on: an Urdu card is drawn ۴/۷ under a new key', async () => {
    const off = await drawn('ur', false);
    const on = await drawn('ur', true);
    expect(nums(off.html)).toContain('4/7');
    expect(nums(on.html)).toContain('۴/۷');
    expect(on.key).not.toBe(off.key);
  });
  test('on: an English card keeps its key and its HTML', async () => {
    const off = await drawn('en', false);
    const on = await drawn('en', true);
    expect(on.key).toBe(off.key);
    expect(on.html).toBe(off.html);
  });
});
