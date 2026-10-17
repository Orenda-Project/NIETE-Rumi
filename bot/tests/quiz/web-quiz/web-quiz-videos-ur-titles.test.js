'use strict';
/**
 * app_settings `web_quiz_videos_ur_titles` (default off; on only for the JSON true): the video library carries each
 * lesson's Urdu-script name (`student_videos.title_ur`, its chapter's `chapter_ur`) as `title_ur` / `name_ur` beside
 * today's `title` / `name`, so an Urdu child's Videos door can print Urdu letters. Off (or no names, or no column
 * yet): the answer is today's, byte for byte, and the names are not read at all.
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

const Flag = require('../../../shared/services/quiz/web-quiz-library-flag');
const UR = { key: 'web_quiz_videos_ur_titles', value: true };
const LIB = { key: 'web_quiz_library', value: true };
const both = (out) => out.chapters.map((c) => [c.name, c.name_ur, c.videos.map((v) => [v.title, v.title_ur])]);

/** Every select's table and columns, from here on (the fake does not keep the columns). */
function spySelects() {
  const seen = [];
  const from = supabase.from;
  supabase.from = (t) => { const q = from(t); const sel = q.select; q.select = (cols, ...r) => { seen.push([t, String(cols)]); return sel.call(q, cols, ...r); }; return q; };
  return seen;
}

/** Two Urdu lessons with their Urdu-script names, one without (its title stays the only one). */
async function urSeed(settings) {
  const fake = F.seed(supabase, settings);
  const row = (n, chapter, title, extra) => ({ id: F.V(n), grade: '3', subject: 'Urdu', clean_chapter: chapter, clean_title: title, language: 'ur',
    migration_status: 'done', superseded_by: null, r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${n}.mp4`, ...extra });
  await supabase.from('student_videos').insert(row(21, 'Haroof Ki Awaaz', 'Choti Yay Ki Awaaz', { title_ur: 'چھوٹی ی کی آواز', chapter_ur: 'حروف کی آواز' }));
  await supabase.from('student_videos').insert(row(22, 'Haroof Ki Awaaz', 'Bari Yay Ki Awaaz', { title_ur: 'بڑی ے کی آواز', chapter_ur: 'حروف کی آواز' }));
  await supabase.from('student_videos').insert(row(23, 'Haroof Ki Awaaz', 'Alif Ki Awaaz', {}));
  for (const n of [21, 22, 23]) await supabase.from('quizzes').insert({ id: F.VQ(n), video_id: F.V(n), quiz_source: 'video', status: 'ready', topic: `Video quiz ${n}`, grade: '3', subject: 'Urdu' });
  return fake;
}

describe('the switch web_quiz_videos_ur_titles', () => {
  test.each([
    ['absent', [LIB], false], ['false', [LIB, { ...UR, value: false }], false], ['the string true', [LIB, { ...UR, value: 'true' }], false],
    ['an object', [LIB, { ...UR, value: { enabled: true } }], false], ['true', [LIB, UR], true],
  ])('read strictly as the JSON true (%s), in the one settings read', async (_l, settings, on) => {
    const fake = F.seed(supabase, settings);
    expect(await Flag.urTitlesOn()).toBe(on);
    expect(await Flag.libraryOn()).toBe(true);
    expect(fake.calls.filter((c) => c.table === 'app_settings')).toHaveLength(1);
    expect(Flag.UR_TITLES_KEY).toBe('web_quiz_videos_ur_titles');
  });
});

describe('a chapter list', () => {
  test('ON: a lesson with an Urdu-script name carries it as title_ur, its chapter as name_ur; one without carries none', async () => {
    await urSeed([LIB, UR]);
    const out = await Lib.lib('AB12CD', { s: 'Urdu' });
    const ch = out.chapters.find((c) => c.name === 'Haroof Ki Awaaz');
    expect(ch.name_ur).toBe('حروف کی آواز');
    const by = Object.fromEntries(ch.videos.map((v) => [v.title, v]));
    expect(by['Choti Yay Ki Awaaz'].title_ur).toBe('چھوٹی ی کی آواز');
    expect(by['Bari Yay Ki Awaaz'].title_ur).toBe('بڑی ے کی آواز');
    expect('title_ur' in by['Alif Ki Awaaz']).toBe(false);
    // the other chapters (no Urdu names) carry no key at all
    out.chapters.filter((c) => c !== ch).forEach((c) => { expect('name_ur' in c).toBe(false); c.videos.forEach((v) => expect('title_ur' in v).toBe(false)); });
  });

  test('OFF: the answer is byte-identical to a library with no Urdu names at all, and the names are never read', async () => {
    await urSeed([LIB]);
    const seen = spySelects();
    const off = JSON.stringify(F.normPosters(await Lib.lib('AB12CD', { s: 'Urdu' })));
    Lib._reset();
    const fake = await urSeed([LIB]);
    fake.db.student_videos.forEach((r) => { delete r.title_ur; delete r.chapter_ur; });
    expect(JSON.stringify(F.normPosters(await Lib.lib('AB12CD', { s: 'Urdu' })))).toBe(off);
    expect(off).not.toMatch(/title_ur|name_ur/);
    expect(seen.filter(([, cols]) => /title_ur|chapter_ur/.test(cols))).toEqual([]);
  });

  test('ON but the names cannot be read (no column yet): the list is today\'s, nothing fails', async () => {
    await urSeed([LIB, UR]);
    const from = supabase.from;
    const down = new Proxy({}, { get: (_t, k) => (k === 'then' ? (res) => res({ data: null, error: { message: 'column student_videos.title_ur does not exist' } }) : () => down) });
    supabase.from = (t) => { const q = from(t); const sel = q.select; q.select = (cols, ...r) => (/title_ur/.test(String(cols)) ? down : sel.call(q, cols, ...r)); return q; };
    const out = await Lib.lib('AB12CD', { s: 'Urdu' });
    supabase.from = from;
    expect(JSON.stringify(out)).not.toMatch(/title_ur|name_ur/);
    expect(out.chapters.map((c) => c.name)).toContain('Haroof Ki Awaaz');
  });
});
