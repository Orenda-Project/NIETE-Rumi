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
      grades: [['KG', 1], ['3', 11], ['4', 1]],
      subjects: [['English', 1], ['Maths', 5], ['Science', 2], ['Urdu', 3]],
    });
    expect(titles(await Lib.lib('AB12CD', { s: 'Science', l: 'ur' }))).toEqual([
      ['Animals', ['Life Cycle of a Hen']], ['Plants', ['Parts of a Flower']],
    ]);
  });

  test('an English child: English videos and videos with no language, counts to match', async () => {
    F.seed(supabase, ON);
    const out = await Lib.lib('AB12CD', { l: 'en' });
    expect(counts(out)).toEqual({
      grades: [['KG', 1], ['3', 10], ['4', 1]],
      subjects: [['English', 1], ['Maths', 4], ['Science', 2], ['Urdu', 3]],
    });
    expect(titles(await Lib.lib('AB12CD', { s: 'Science', l: 'en' }))).toEqual([['Plants', ['Leaves', 'Parts of a Flower']]]);
  });

  test('a subject with no video in the child\'s language is shown as it is: no subject disappears', async () => {
    F.seed(supabase, ON);
    // Grade 4 Science has only an English video: an Urdu child still sees it (no Urdu one to prefer).
    expect(titles(await Lib.lib('AB12CD', { g: '4', s: 'Science', l: 'ur' }))).toEqual([['Energy', ['Grade four video']]]);
    // The Urdu subject has only Urdu videos: an English child still sees all three.
    expect(titles(await Lib.lib('AB12CD', { s: 'Urdu', l: 'en' })).map(([, t]) => t.length).reduce((a, b) => a + b, 0)).toBe(3);
    // Subjects with videos in the child's language come first; none is dropped.
    expect(counts(await Lib.lib('AB12CD', { g: '4', l: 'ur' })).subjects).toEqual([['Science', 1]]);
    expect(counts(await Lib.lib('AB12CD', { l: 'en' })).subjects.map((x) => x[0])).toEqual(['English', 'Maths', 'Science', 'Urdu']);
    // Where the child's language exists in the subject, the other language is left out.
    expect(titles(await Lib.lib('AB12CD', { s: 'Science', l: 'ur' })).flatMap(([, t]) => t)).not.toContain('Leaves');
  });

  test('a subject shown only in another language is listed after the child\'s own subjects (Urdu first for an Urdu child)', async () => {
    F.seed(supabase, ON);
    await supabase.from('student_videos').insert({ id: F.V(20), grade: '3', subject: 'Art', clean_chapter: 'Colours', clean_title: 'Red', language: 'en',
      migration_status: 'done', superseded_by: null, r2_url: 'https://acct.r2.example.com/test-bucket/student-videos/v20.mp4' });
    await supabase.from('quizzes').insert({ id: F.VQ(20), video_id: F.V(20), quiz_source: 'video', status: 'ready', topic: 'Video quiz 20', grade: '3', subject: 'Art' });
    expect(counts(await Lib.lib('AB12CD', { l: 'ur' })).subjects).toEqual([['English', 1], ['Maths', 5], ['Science', 2], ['Urdu', 3], ['Art', 1]]);
    expect(counts(await Lib.lib('AB12CD', { l: 'en' })).subjects).toEqual([['Art', 1], ['English', 1], ['Maths', 4], ['Science', 2], ['Urdu', 3]]);
  });

  // A grade 3 subject of `n` videos, the last `own` of them in Urdu and the rest in English, one per chapter.
  const cell = async (subject, n, own) => {
    for (let i = 0; i < n; i += 1) {
      const id = 30 + i + (subject === 'Art' ? 0 : subject === 'Islamiyat' ? 20 : 40);
      await supabase.from('student_videos').insert({ id: F.V(id), grade: '3', subject, clean_chapter: `Lesson ${i + 1}`, clean_title: `${subject} ${i + 1}`,
        language: i >= n - own ? 'ur' : 'en', migration_status: 'done', superseded_by: null, r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${id}.mp4` });
      await supabase.from('quizzes').insert({ id: F.VQ(id), video_id: F.V(id), quiz_source: 'video', status: 'ready', topic: `Video quiz ${id}`, grade: '3', subject });
    }
  };

  test('a subject counts as in the child\'s language only with 3 or more of its videos, or 25 % of them, in it', async () => {
    F.seed(supabase, ON);
    await cell('Islamiyat', 11, 2); // 2 of 11: too thin, the whole subject is shown
    await cell('Art', 12, 3); // 3 of 12: filtered
    await cell('Geography', 4, 1); // 1 of 4 is 25 %: filtered
    const out = counts(await Lib.lib('AB12CD', { l: 'ur' }));
    expect(out.subjects).toEqual([['Art', 3], ['English', 1], ['Geography', 1], ['Islamiyat', 11], ['Maths', 5], ['Science', 2], ['Urdu', 3]]);
    // An English child: every one of these subjects has 3+ English videos.
    expect(counts(await Lib.lib('AB12CD', { l: 'en' })).subjects).toEqual([['Art', 9], ['English', 1], ['Geography', 3], ['Islamiyat', 9], ['Maths', 4], ['Science', 2], ['Urdu', 3]]);
  });

  test('a thin subject is shown whole with the child\'s language first, then the rest in their usual order', async () => {
    F.seed(supabase, ON);
    await cell('Islamiyat', 11, 2);
    const t = titles(await Lib.lib('AB12CD', { s: 'Islamiyat', l: 'ur' })).flatMap(([, x]) => x);
    expect(t).toEqual(['Islamiyat 10', 'Islamiyat 11', 'Islamiyat 1', 'Islamiyat 2', 'Islamiyat 3', 'Islamiyat 4', 'Islamiyat 5', 'Islamiyat 6', 'Islamiyat 7', 'Islamiyat 8', 'Islamiyat 9']);
    // The fixture's Maths: 1 Urdu video of 5, so the Urdu child sees all five, the Urdu one first, then chapter order.
    expect(titles(await Lib.lib('AB12CD', { s: 'Maths', l: 'ur' }))).toEqual([
      ['Chapter 2', ['Taking away', 'Adding']], ['Chapter 10', ['Big numbers']], ['Unit 3 Part 2', ['Lines']], ['Unit 3 Part 12', ['Shapes']],
    ]);
  });

  test('no language from the page, or one that is not en|ur: the quiz code\'s language', async () => {
    F.seed(supabase, ON);
    expect(counts(await Lib.lib('UR12CD', {})).subjects).toEqual([['English', 1], ['Maths', 5], ['Science', 2], ['Urdu', 3]]);
    expect(counts(await Lib.lib('UR12CD', { l: 'fr' })).subjects).toEqual([['English', 1], ['Maths', 5], ['Science', 2], ['Urdu', 3]]);
    expect(counts(await Lib.lib('AB12CD', {})).subjects).toEqual([['English', 1], ['Maths', 4], ['Science', 2], ['Urdu', 3]]);
    expect(titles(await Lib.lib('AB12CD', { s: 'Science' })).flatMap(([, t]) => t)).toEqual(['Leaves', 'Parts of a Flower']);
  });

  test('from the hub: the child\'s own language wins over the page\'s; without one, the page\'s', async () => {
    F.seed(supabase, ON);
    const science = async (q) => titles(await Lib.libHub('hubtoken', { kid: 'chip-1', s: 'Science', ...q })).flatMap(([, t]) => t);
    kid('ur');
    expect(await science({ l: 'en' })).toContain('Life Cycle of a Hen');
    expect(await science({ l: 'en' })).not.toContain('Leaves');
    kid(null);
    expect(await science({ l: 'en' })).toContain('Leaves');
    expect(await science({ l: 'en' })).not.toContain('Life Cycle of a Hen');
    expect(titles(await Lib.libHub('hubtoken', { kid: 'chip-1', s: 'Science', l: 'ur' }))).toEqual([
      ['Animals', ['Life Cycle of a Hen']], ['Plants', ['Parts of a Flower']],
    ]);
  });

  test('from the hub with the child\'s language following the child (web_quiz_return_lang on): the hub\'s own `l` wins over the child\'s read', async () => {
    const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
    F.seed(supabase, [...ON, { key: 'web_quiz_return_lang', value: true }]);
    Ret._resetCache();
    try {
      const science = async (q) => titles(await Lib.libHub('hubtoken', { kid: 'chip-1', s: 'Science', ...q })).flatMap(([, t]) => t);
      kid('en');
      expect(await science({ l: 'ur' })).toContain('Life Cycle of a Hen');
      expect(await science({ l: 'ur' })).not.toContain('Leaves');
      // no `l` (an old library link): the child's own
      expect(await science({})).toContain('Leaves');
      expect(await science({})).not.toContain('Life Cycle of a Hen');
    } finally { Ret._resetCache(); }
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
