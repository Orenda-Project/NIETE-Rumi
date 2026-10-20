'use strict';
/**
 * The name on a card picture fits (app_settings web_quiz_share_name_fit, default OFF): on an Urdu card a long Latin
 * name kept its end («…l Testwala») and on the square a long name ran past the picture. With the switch the name is
 * its own LTR run, sized down by its length to fit its column (never under 34 px), and cut only at its own end as a
 * last resort; the square's column never grows past the picture. Off: the input, the key and the HTML are today's.
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

const LONG = 'Amalbanoo Testwala Khan'; // 23 characters
const card = { first: LONG, animal: 'cat', correct: 4, total: 7, topic: 'کسور', cls: '' };
const html = (lang, ui, size) => renderArt({ kind: 'card', size, brand: 'niete', lang, d: card, ui }, { fonts: false, pictures: false });
const FIT = /\.name bdi\{display:inline-block;max-width:calc\(100% - \d+px\);font-size:max\(34px,min\(1em,(\d+)px\)\);overflow:hidden;text-overflow:ellipsis;white-space:nowrap/;
const fitPx = (h) => Number((h.match(FIT) || [])[1]);
const sized = (lang, first, size) => renderArt({ kind: 'card', size, brand: 'niete', lang, d: { ...card, first }, ui: { nf: true } }, { fonts: false, pictures: false });

describe('the template', () => {
  for (const lang of ['en', 'ur']) {
    for (const size of ['og', 'sq']) {
      test(`${lang} ${size}: with the switch the name is its own LTR run, sized to fit, cut only at its own end`, () => {
        const h = html(lang, { nf: true }, size);
        expect(h).toMatch(FIT);
        expect(h).toContain(`<bdi dir="ltr">${LONG}</bdi>`);
      });
      test(`${lang} ${size}: the switch off, the card is today's`, () => {
        expect(html(lang, null, size)).not.toMatch(FIT);
        expect(html(lang, null, size)).not.toContain('.main{max-width:100%}');
      });
    }
  }
  test('a longer name gets a smaller size; a short one keeps the line\'s own size (the cap is above it)', () => {
    expect(fitPx(sized('ur', 'Amalbanoo Testwala Khan', 'og'))).toBeLessThan(fitPx(sized('ur', 'Amal Testwala', 'og')));
    expect(fitPx(sized('ur', 'Amal Testwala', 'sq'))).toBeGreaterThanOrEqual(73);
    expect(fitPx(sized('ur', 'Ali', 'og'))).toBeGreaterThanOrEqual(68);
  });
  test('Nastaliq letters are narrower than Lexend ones: an Urdu name of the same length keeps a larger size', () => {
    expect(fitPx(sized('ur', 'محمد عبداللہ ٹیسٹ والا خان', 'og'))).toBeGreaterThan(fitPx(sized('ur', 'Muhammad Abdullah Testwala', 'og')));
  });
  test('the square\'s column never grows past the picture (a long name stretched it to 1456 px of 1080)', () => {
    expect(html('ur', { nf: true }, 'sq')).toContain('.main{width:100%;max-width:100%}.name{width:100%}');
    expect(html('ur', { nf: true }, 'og')).not.toContain('.main{max-width:100%}');
  });
  test('the name\'s run has the Nastaliq line height (an Urdu name on an English card lost the foot of its ل)', () => {
    expect(sized('en', 'آمنہ ٹیسٹ والا', 'og')).toMatch(/\.name bdi\{[^}]*;line-height:1\.9\}/);
    expect(sized('en', 'Amal Testwala', 'og')).not.toMatch(/\.name bdi\{[^}]*line-height/);
  });
  test('only the card has a name line: the other pictures are unchanged by the switch', () => {
    const inv = (ui) => renderArt({ kind: 'invite', size: 'og', brand: 'niete', lang: 'ur', d: { first: LONG, correct: 4, total: 7, topic: 'کسور' }, ui }, { fonts: false, pictures: false });
    expect(inv({ nf: true })).toBe(inv(null));
  });
});

describe('the input', () => {
  test('on: its own version in the ui (a new key); off: no ui', () => {
    expect(Input.artInput('card', 'og', 'niete', { lang: 'ur', d: card }, { nf: true }).ui).toEqual({ nf: true, nv: Input.ART_NF_V });
    expect(Input.artInput('card', 'og', 'niete', { lang: 'ur', d: card }, null).ui).toBeUndefined();
  });
});

describe('served', () => {
  const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  const seed = (lang, on) => {
    const now = Date.now();
    return {
      quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', teacher_user_id: 't-1', topic: 'Fractions', language: lang, active: true }],
      quizzes: [{ id: 'qz-1', topic: 'Fractions', grade: '3', subject: 'Maths', language: lang, meta: {} }],
      students: [{ id: 'st-1', student_name: LONG }],
      quiz_sessions: [{ id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: LONG, share_code_id: 'sc-1', status: 'completed',
        correct_answers: 4, total_questions_answered: 7, mastery_percentage: 57, completed_at: new Date(now - 60000).toISOString(), created_at: new Date(now - 300000).toISOString() }],
      app_settings: on ? [{ key: 'web_quiz_share_name_fit', value: true }] : [], users: [{ id: 't-1', school_id: 'SA' }],
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
    const out = await Art.artImage(Art.artId('c', SID), { size: 'sq' });
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

  test('on: an Urdu card is drawn with the fitted name under a new key', async () => {
    const off = await drawn('ur', false);
    const on = await drawn('ur', true);
    expect(off.html).not.toMatch(FIT);
    expect(on.html).toMatch(FIT);
    expect(on.key).not.toBe(off.key);
  });
  test('on: an English card is fitted too (a long name ran off the square), under a new key', async () => {
    const off = await drawn('en', false);
    const on = await drawn('en', true);
    expect(off.html).not.toMatch(FIT);
    expect(on.html).toMatch(FIT);
    expect(on.key).not.toBe(off.key);
  });
  test('off: the card is drawn as today under today\'s key, both languages', async () => {
    for (const lang of ['en', 'ur']) {
      const a = await drawn(lang, false);
      const b = await drawn(lang, false);
      expect(b.key).toBe(a.key);
      expect(a.html).not.toMatch(FIT);
    }
  });
});
