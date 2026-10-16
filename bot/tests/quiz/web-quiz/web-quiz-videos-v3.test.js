'use strict';
/**
 * app_settings `web_quiz_videos_v3` ON (the JSON true only): the video library lists the videos in the child's
 * language (a video with no language shows for both), sorts chapters by their numbers (Latin, Urdu and
 * Arabic-Indic digits), and gives each chapter its art (its first poster) with a neutral tile as the last
 * fallback instead of the subject art. The switch-off answer is locked by web-quiz-videos-v3-off.test.js.
 */
process.env.R2_ENDPOINT = 'https://acct.r2.example.com';
process.env.R2_ACCESS_KEY_ID = 'test-only';
process.env.R2_SECRET_ACCESS_KEY = 'test-only';
process.env.R2_BUCKET_NAME = 'test-bucket';

jest.mock('../../../shared/config/supabase', () => ({}));
const mockKidFromHub = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: (...a) => mockKidFromHub(...a) }));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation((cfg) => {
      const real = new actual.S3Client(cfg);
      real.send = (...a) => mockS3Send(...a);
      return real;
    }),
  };
});

const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Lib = require('../../../shared/services/quiz/web-quiz-library');
const Videos = require('../../../shared/services/quiz/web-quiz-videos');
const F = require('./videos-v3-fixture');

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  Videos._metaCache.clear();
  Lib._reset();
  mockS3Send.mockImplementation(async () => ({}));
});
afterAll(() => { process.env = SAVED; });

const Order = require('../../../shared/services/quiz/video-bank-order');
const Flag = require('../../../shared/services/quiz/web-quiz-library-flag');

const ON = [{ key: 'web_quiz_library', value: true }, { key: 'web_quiz_videos_v3', value: true }];
const kid = (lang) => mockKidFromHub.mockResolvedValue({ studentId: F.KID_A, grade: '3', rootId: F.SC, lang });
const counts = (out) => ({ grades: out.grades.map((x) => [x.g, x.n]), subjects: out.subjects.map((x) => [x.key, x.n]) });
const titles = (out) => out.chapters.map((c) => [c.name, c.videos.map((v) => v.title)]);

describe('the switch', () => {
  test.each([
    ['absent', [{ key: 'web_quiz_library', value: true }], false],
    ['false', [{ key: 'web_quiz_library', value: true }, { key: 'web_quiz_videos_v3', value: false }], false],
    ['the string true', [{ key: 'web_quiz_library', value: true }, { key: 'web_quiz_videos_v3', value: 'true' }], false],
    ['an object', [{ key: 'web_quiz_library', value: true }, { key: 'web_quiz_videos_v3', value: { enabled: true } }], false],
    ['true', ON, true],
  ])('read strictly as the JSON true (%s)', async (_l, settings, on) => {
    F.seed(supabase, settings);
    expect(await Flag.videosV3On()).toBe(on);
    expect(Flag.VIDEOS_V3_KEY).toBe('web_quiz_videos_v3');
  });

  test('one settings read answers both switches; a failed read is off for both', async () => {
    const fake = F.seed(supabase, ON);
    expect(await Flag.libraryOn()).toBe(true);
    expect(await Flag.videosV3On()).toBe(true);
    expect(fake.calls.filter((c) => c.table === 'app_settings')).toHaveLength(1);
    Flag._reset();
    supabase.from = () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'down' } }) }) });
    expect(await Flag.videosV3On()).toBe(false);
    expect(await Flag.libraryOn()).toBe(false);
  });
});

describe('language', () => {
  test('an Urdu child: Urdu videos and videos with no language, counts to match', async () => {
    F.seed(supabase, ON);
    const out = await Lib.lib('AB12CD', { l: 'ur' });
    expect(counts(out)).toEqual({
      grades: [['KG', 1], ['3', 9]],
      subjects: [['English', 1], ['Maths', 3], ['Science', 2], ['Urdu', 3]],
    });
    expect(titles(await Lib.lib('AB12CD', { s: 'Science', l: 'ur' }))).toEqual([
      ['Animals', ['Life Cycle of a Hen']], ['Plants', ['Parts of a Flower']],
    ]);
  });

  test('an English child: English videos and videos with no language, counts to match', async () => {
    F.seed(supabase, ON);
    const out = await Lib.lib('AB12CD', { l: 'en' });
    expect(counts(out)).toEqual({
      grades: [['KG', 1], ['3', 7], ['4', 1]],
      subjects: [['English', 1], ['Maths', 4], ['Science', 2]],
    });
    expect(titles(await Lib.lib('AB12CD', { s: 'Science', l: 'en' }))).toEqual([['Plants', ['Leaves', 'Parts of a Flower']]]);
  });

  test('no language from the page, or one that is not en|ur: the quiz code\'s language', async () => {
    F.seed(supabase, ON);
    expect(counts(await Lib.lib('UR12CD', {})).subjects).toEqual([['English', 1], ['Maths', 3], ['Science', 2], ['Urdu', 3]]);
    expect(counts(await Lib.lib('UR12CD', { l: 'fr' })).subjects).toEqual([['English', 1], ['Maths', 3], ['Science', 2], ['Urdu', 3]]);
    expect(counts(await Lib.lib('AB12CD', {})).subjects).toEqual([['English', 1], ['Maths', 4], ['Science', 2]]);
  });

  test('from the hub: the child\'s own language wins over the page\'s; without one, the page\'s', async () => {
    F.seed(supabase, ON);
    kid('ur');
    expect(counts(await Lib.libHub('hubtoken', { kid: 'chip-1', l: 'en' })).subjects.map((x) => x[0])).toContain('Urdu');
    kid(null);
    expect(counts(await Lib.libHub('hubtoken', { kid: 'chip-1', l: 'en' })).subjects.map((x) => x[0])).not.toContain('Urdu');
    expect(titles(await Lib.libHub('hubtoken', { kid: 'chip-1', s: 'Science', l: 'ur' }))).toEqual([
      ['Animals', ['Life Cycle of a Hen']], ['Plants', ['Parts of a Flower']],
    ]);
  });

  test('the language comes from its own read; the bank\'s read is unchanged and a failed language read filters nothing', async () => {
    const fake = F.seed(supabase, ON);
    const cols = [];
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'student_videos') return b;
      const sel = b.select;
      b.select = (c, o) => { cols.push(c); if (/language/.test(c)) b.then = (res) => Promise.resolve({ data: null, error: { message: 'column student_videos.language does not exist' } }).then(res); return sel(c, o); };
      return b;
    };
    const out = await Lib.lib('AB12CD', { l: 'ur' });
    expect(cols).toContain('id, grade, subject, clean_chapter, clean_title, r2_url');
    expect(cols).toContain('id, language');
    expect(counts(out).subjects).toEqual([['English', 1], ['Maths', 5], ['Science', 3], ['Urdu', 3]]);
    expect(fake.calls.length).toBeGreaterThan(0);
  });
});

describe('chapter order', () => {
  test('Chapter 2 before Chapter 10, Unit 3 Part 2 before Unit 3 Part 12', async () => {
    F.seed(supabase, ON);
    expect(titles(await Lib.lib('AB12CD', { s: 'Maths', l: 'en' })).map((c) => c[0]))
      .toEqual(['Chapter 2', 'Chapter 10', 'Unit 3 Part 2', 'Unit 3 Part 12']);
  });

  test('Urdu and Arabic-Indic digits are numbers: باب ۲, باب ٣, باب ۱۰', async () => {
    F.seed(supabase, ON);
    expect(titles(await Lib.lib('AB12CD', { s: 'Urdu', l: 'ur' })).map((c) => c[0])).toEqual(['باب ۲', 'باب ٣', 'باب ۱۰']);
  });

  test('compareVideosNatural; compareVideos keeps its text order', () => {
    const rows = (...ch) => ch.map((c) => ({ clean_chapter: c, clean_title: 't' }));
    const names = (rs, cmp) => [...rs].sort(cmp).map((r) => r.clean_chapter);
    expect(names(rows('Chapter 10', 'Chapter 2'), Order.compareVideosNatural)).toEqual(['Chapter 2', 'Chapter 10']);
    expect(names(rows('باب ۱۰', 'باب ۲'), Order.compareVideosNatural)).toEqual(['باب ۲', 'باب ۱۰']);
    expect(names(rows('باب ١٠', 'باب ٢'), Order.compareVideosNatural)).toEqual(['باب ٢', 'باب ١٠']);
    expect(names(rows('Unit 3 Part 12', 'Unit 3 Part 2'), Order.compareVideosNatural)).toEqual(['Unit 3 Part 2', 'Unit 3 Part 12']);
    expect(names(rows('Chapter 10', 'Chapter 2'), Order.compareVideos)).toEqual(['Chapter 10', 'Chapter 2']);
    const t = (...ts) => ts.map((x) => ({ clean_chapter: 'Same', clean_title: x }));
    expect([...t('Part 10', 'part 2')].sort(Order.compareVideosNatural).map((r) => r.clean_title)).toEqual(['part 2', 'Part 10']);
  });
});

describe('posters', () => {
  test('each chapter carries its art (its first poster) and the payload names the neutral tile', async () => {
    F.seed(supabase, ON);
    const out = await Lib.lib('AB12CD', { s: 'Science', l: 'en' });
    expect(out.tile).toBe('neutral');
    const [plants] = out.chapters;
    expect(plants.art).toBe(plants.videos[0].poster);
    expect(plants.art).toMatch(/student-videos\/v2_poster\.jpg\?.*X-Amz-Signature=/);
  });

  test('switch off: no chapter art, no tile marker', async () => {
    F.seed(supabase, [{ key: 'web_quiz_library', value: true }]);
    const out = await Lib.lib('AB12CD', { s: 'Science', l: 'en' });
    expect(out.tile).toBeUndefined();
    expect(out.chapters.every((c) => c.art === undefined)).toBe(true);
  });
});

describe('the route', () => {
  let server; let base;
  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test('passes ?l= through when it is en or ur, nothing otherwise', async () => {
    const H = { 'x-api-key': 'test-key' };
    const hub = jest.spyOn(Lib, 'libHub').mockResolvedValue({ subjects: [] });
    const code = jest.spyOn(Lib, 'lib').mockResolvedValue({ subjects: [] });
    try {
      await fetch(`${base}/lib/h/abc.def?kid=k&l=ur`, { headers: H });
      expect(hub.mock.calls[0][1].l).toBe('ur');
      await fetch(`${base}/lib/AB12CD?l=en`, { headers: H });
      expect(code.mock.calls[0][1].l).toBe('en');
      await fetch(`${base}/lib/AB12CD?l=fr`, { headers: H });
      expect(code.mock.calls[1][1].l).toBeUndefined();
    } finally { hub.mockRestore(); code.mockRestore(); }
  });
});
