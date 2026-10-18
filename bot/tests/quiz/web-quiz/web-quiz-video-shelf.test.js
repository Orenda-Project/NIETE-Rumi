'use strict';
/**
 * app_settings `web_quiz_video_shelf` (default off; on only for the JSON true), the server's side of the Videos door's
 * picture shelves:
 *   - the hub's Videos door says `shelf: true`;
 *   - a subject's lessons from the kid's hub name each lesson's small thumbnail (`thumb`) and whether this child's
 *     quiz can be made (`quiz`: a class, or the watch root set; never without one);
 *   - the thumbnail itself: the lesson's poster shrunk once to a 320 x 180 WebP of at most 20 KB, kept in memory.
 * Off: every answer is today's, byte for byte, and no poster is downloaded.
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

const sharp = require('sharp');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const Lib = require('../../../shared/services/quiz/web-quiz-library');
const Videos = require('../../../shared/services/quiz/web-quiz-videos');
const Flag = require('../../../shared/services/quiz/web-quiz-library-flag');
const Home = require('../../../shared/services/quiz/web-quiz-hub-home');
const Thumb = require('../../../shared/services/quiz/web-quiz-video-thumb');
const F = require('./videos-v3-fixture');

const SAVED = { ...process.env };
let download;
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'test-secret-0123456789abcdef0123456789' };
  jest.clearAllMocks();
  Videos._metaCache.clear();
  Lib._reset();
  Thumb._reset();
  mockS3Send.mockImplementation(async () => ({}));
  download = jest.spyOn(r2, 'downloadFromR2');
});
afterEach(() => download.mockRestore());
afterAll(() => { process.env = SAVED; });

const LIB = { key: 'web_quiz_library', value: true };
const SHELF = { key: 'web_quiz_video_shelf', value: true };
const ROOT = { key: 'web_quiz_watch_root', value: JSON.stringify(F.SC) };
const CLASS_KID = { studentId: F.KID_A, grade: '3', rootId: F.SC, lang: 'en' };
const SOLO_KID = { studentId: F.KID_A, grade: '3', rootId: null, lang: 'en' };
const lessons = (out) => out.chapters.flatMap((c) => c.videos);

describe('the switch', () => {
  test.each([
    ['absent', [LIB], false], ['false', [LIB, { ...SHELF, value: false }], false], ['the string true', [LIB, { ...SHELF, value: 'true' }], false],
    ['an object', [LIB, { ...SHELF, value: { enabled: true } }], false], ['true', [LIB, SHELF], true],
  ])('read strictly as the JSON true (%s), in the library\'s one settings read', async (_l, settings, on) => {
    const fake = F.seed(supabase, settings);
    expect(await Flag.videoShelfOn()).toBe(on);
    expect(await Flag.libraryOn()).toBe(true);
    expect(fake.calls.filter((c) => c.table === 'app_settings')).toHaveLength(1);
    expect(Flag.VIDEO_SHELF_KEY).toBe('web_quiz_video_shelf');
  });
});

describe('the hub\'s Videos door', () => {
  const out = { lib: { href: '/lib/x', art: '/a.webp' } };
  test('on: the door says shelf; off: today\'s door, no key', () => {
    expect(Home.doorsOf({ out, videoShelf: true }).videos).toEqual({ href: '/lib/x', art: '/a.webp', watch: true, shelf: true });
    expect(Home.doorsOf({ out, hasRoot: true, videoShelf: true }).videos).toEqual({ href: '/lib/x', art: '/a.webp', shelf: true });
    expect(Home.doorsOf({ out }).videos).toEqual({ href: '/lib/x', art: '/a.webp', watch: true });
    expect(JSON.stringify(Home.doorsOf({ out, videoShelf: false }))).toBe(JSON.stringify(Home.doorsOf({ out })));
  });
});

// The door's switch rides the home's own settings read (web-quiz-home-flags.js): the hub asks nothing more of app_settings.
describe('the hub\'s Videos door: its switch in the home\'s one settings read', () => {
  const HomeFlags = require('../../../shared/services/quiz/web-quiz-home-flags');
  const HOME = { key: 'web_quiz_home_v3', value: true };
  const reads = (fake) => fake.calls.filter((c) => c.table === 'app_settings').length;
  beforeEach(() => HomeFlags._resetCache());
  test.each([
    ['absent', [LIB, HOME], false], ['false', [LIB, HOME, { ...SHELF, value: false }], false], ['the string true', [LIB, HOME, { ...SHELF, value: 'true' }], false],
    ['an object', [LIB, HOME, { ...SHELF, value: { enabled: true } }], false], ['true', [LIB, HOME, SHELF], true],
  ])('%s: read strictly as the JSON true, in the same one query; the library\'s own read is never asked', async (_l, settings, on) => {
    const fake = F.seed(supabase, settings);
    const lib = jest.spyOn(Flag, 'videoShelfOn');
    const p = Home.prefetch(F.KID_A);
    const f = await p.flags;
    await p.data;
    expect(f.home).toBe(true);
    expect(f.shelf).toBe(on);
    expect(lib).not.toHaveBeenCalled();
    lib.mockRestore();
    // the home's read alone: one query for every key
    HomeFlags._resetCache();
    const g = F.seed(supabase, settings);
    await HomeFlags.flags();
    expect(reads(g)).toBe(1);
  });
  test('held 30 s: a second ask in the window reads nothing and keeps the held value', async () => {
    const fake = F.seed(supabase, [HOME, SHELF]);
    expect((await HomeFlags.flags(1000)).shelf).toBe(true);
    F.seed(supabase, [HOME]);
    expect((await HomeFlags.flags(1000 + 29000)).shelf).toBe(true);
    expect(reads(fake)).toBe(1);
  });
  test('stale after 30 s: one fresh read, its value wins (the string true is off there too)', async () => {
    F.seed(supabase, [HOME, SHELF]);
    expect((await HomeFlags.flags(1000)).shelf).toBe(true);
    const fresh = F.seed(supabase, [HOME, { ...SHELF, value: 'true' }]);
    expect((await HomeFlags.flags(1000 + 31000)).shelf).toBe(false);
    expect(reads(fresh)).toBe(1);
  });
  test('a failed read: off, never thrown, and not held (the next ask reads again)', async () => {
    supabase.from = () => { throw new Error('down'); };
    expect((await HomeFlags.flags(1000)).shelf).toBe(false);
    const fake = F.seed(supabase, [HOME, SHELF]);
    expect((await HomeFlags.flags(1500)).shelf).toBe(true);
    expect(reads(fake)).toBe(1);
  });
});

describe('a subject\'s lessons from the kid\'s hub', () => {
  test('on, a class child: every lesson with a poster names its thumbnail; quiz: true', async () => {
    F.seed(supabase, [LIB, SHELF]);
    mockKidFromHub.mockResolvedValue(CLASS_KID);
    const out = await Lib.libHub('hubtoken', { kid: 'chip', s: 'Science' });
    const all = lessons(out);
    expect(all.length).toBeGreaterThan(1);
    all.forEach((v) => { expect(v.poster).toBeTruthy(); expect(v.thumb).toBe(`/wq/vt/${v.vid}.webp?v=1`); });
    expect(out.quiz).toBe(true);
  });
  test('on, a child with no class: quiz only when the watch root is set (absent: false, never a button that fails)', async () => {
    F.seed(supabase, [LIB, SHELF]);
    mockKidFromHub.mockResolvedValue(SOLO_KID);
    expect((await Lib.libHub('hubtoken', { kid: 'chip', s: 'Science' })).quiz).toBe(false);
    Lib._reset();
    F.seed(supabase, [LIB, SHELF, ROOT]);
    expect((await Lib.libHub('hubtoken', { kid: 'chip', s: 'Science' })).quiz).toBe(true);
    Lib._reset();
    F.seed(supabase, [LIB, SHELF, { ...ROOT, value: 'not an id' }]);
    expect((await Lib.libHub('hubtoken', { kid: 'chip', s: 'Science' })).quiz).toBe(false);
  });
  test('a child with no class opening Videos: the watch root is read once for all the subjects\' shelves, not once each', async () => {
    F.seed(supabase, [LIB, SHELF, ROOT]);
    mockKidFromHub.mockResolvedValue(SOLO_KID);
    expect((await Lib.libHub('hubtoken', { kid: 'chip', s: 'Science' })).quiz).toBe(true);
    const from = jest.spyOn(supabase, 'from');
    try {
      expect((await Lib.libHub('hubtoken', { kid: 'chip', s: 'Maths' })).quiz).toBe(true);
      expect((await Lib.libHub('hubtoken', { kid: 'chip', s: 'English' })).quiz).toBe(true);
      expect(from.mock.calls.filter(([t]) => t === 'app_settings')).toHaveLength(0);
    } finally { from.mockRestore(); }
  });
  test('the first Videos open, every subject\'s shelf asked at once: one watch-root read, not one per shelf', async () => {
    F.seed(supabase, [LIB, SHELF, ROOT]);
    mockKidFromHub.mockResolvedValue(SOLO_KID);
    await Lib.libHub('hubtoken', { kid: 'chip' });          // the subjects list: no root read
    const roots = jest.spyOn(Videos, 'watchRoot');
    try {
      const outs = await Promise.all(['Science', 'Maths', 'English'].map((s) => Lib.libHub('hubtoken', { kid: 'chip', s })));
      expect(outs.map((o) => o.quiz)).toEqual([true, true, true]);
      expect(roots).toHaveBeenCalledTimes(1);
    } finally { roots.mockRestore(); }
  });
  test('off: byte-identical to a library with no such switch; the subjects list never changes', async () => {
    mockKidFromHub.mockResolvedValue(CLASS_KID);
    F.seed(supabase, [LIB]);
    const before = JSON.stringify(F.normPosters(await Lib.libHub('hubtoken', { kid: 'chip', s: 'Science' })));
    Lib._reset();
    F.seed(supabase, [LIB, { ...SHELF, value: false }]);
    const off = JSON.stringify(F.normPosters(await Lib.libHub('hubtoken', { kid: 'chip', s: 'Science' })));
    expect(off).toBe(before);
    expect(off).not.toMatch(/"thumb"|"quiz"/);
    Lib._reset();
    F.seed(supabase, [LIB, SHELF]);
    const subjects = await Lib.libHub('hubtoken', { kid: 'chip' });
    expect(JSON.stringify(subjects)).not.toMatch(/"thumb"|"quiz"/);
  });
});

describe('the thumbnail', () => {
  const noSuchKey = () => Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
  // a poster like the bank's: 1280 x 720, smooth colour with a little texture
  async function poster(noise = 12) {
    const w = 1280; const h = 720; const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3; const n = () => Math.floor(Math.random() * noise);
      raw[i] = (x * 255 / w + n()) & 255; raw[i + 1] = (y * 255 / h + n()) & 255; raw[i + 2] = (128 + n()) & 255;
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
  }
  test('on: the lesson\'s own poster (its _poster.jpg beside the video), 320 x 180 WebP, at most 20 KB, drawn once', async () => {
    F.seed(supabase, [LIB, SHELF]);
    const jpg = await poster();
    download.mockResolvedValue(jpg);
    const a = await Thumb.thumb(F.V(1));
    expect(a.contentType).toBe('image/webp');
    expect(a.bytes.length).toBeLessThanOrEqual(20 * 1024);
    const m = await sharp(a.bytes).metadata();
    expect([m.format, m.width, m.height]).toEqual(['webp', 320, 180]);
    expect(download).toHaveBeenCalledWith('student-videos/v1_poster.jpg');
    const [b, c] = await Promise.all([Thumb.thumb(F.V(1)), Thumb.thumb(F.V(1))]);
    expect(b.bytes.equals(a.bytes) && c.bytes.equals(a.bytes)).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
  });
  test('a busy poster still fits in 20 KB (lower quality), else none', async () => {
    F.seed(supabase, [LIB, SHELF]);
    download.mockResolvedValue(await poster(255));
    const a = await Thumb.thumb(F.V(2));
    if (a) expect(a.bytes.length).toBeLessThanOrEqual(20 * 1024);
  });
  test('off, a lesson the library does not list, a bad id, or no poster: none, and nothing is downloaded for the first three', async () => {
    F.seed(supabase, [LIB]);
    download.mockResolvedValue(await poster());
    expect(await Thumb.thumb(F.V(1))).toBeNull();
    Lib._reset();
    F.seed(supabase, [LIB, SHELF]);
    expect(await Thumb.thumb(F.V(7))).toBeNull();          // no ready quiz: not in the bank
    expect(await Thumb.thumb('../../secret')).toBeNull();
    expect(download).not.toHaveBeenCalled();
    download.mockRejectedValue(new Error('NoSuchKey'));
    expect(await Thumb.thumb(F.V(3))).toBeNull();
  });
  test('no poster: remembered as none for 10 minutes (one storage read, not one per card view), then asked again', async () => {
    F.seed(supabase, [LIB, SHELF]);
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      download.mockRejectedValue(noSuchKey());
      expect(await Thumb.thumb(F.V(3))).toBeNull();
      expect(await Thumb.noPicture(F.V(3))).toBe(true);
      expect(await Thumb.noPicture(F.V(1))).toBe(false);
      download.mockResolvedValue(await poster());
      now += 9 * 60 * 1000;
      expect(await Thumb.thumb(F.V(3))).toBeNull();
      expect(download).toHaveBeenCalledTimes(1);
      now += 2 * 60 * 1000;
      expect(await Thumb.thumb(F.V(3))).not.toBeNull();
      expect(download).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });
  test('the kept pictures: the least recently shown goes first when full, never one a child just saw', async () => {
    F.seed(supabase, [LIB, SHELF]);
    Thumb._reset(2);
    download.mockResolvedValue(await poster());
    await Thumb.thumb(F.V(1));
    await Thumb.thumb(F.V(2));
    await Thumb.thumb(F.V(1));          // seen again: now the freshest
    await Thumb.thumb(F.V(3));          // full: V(2) goes, not V(1)
    expect(download).toHaveBeenCalledTimes(3);
    await Thumb.thumb(F.V(1));
    expect(download).toHaveBeenCalledTimes(3);
    await Thumb.thumb(F.V(2));
    expect(download).toHaveBeenCalledTimes(4);
  });
  test('only a true miss is remembered: a storage timeout, a failed lesson list or a lesson the library does not list is asked again next time', async () => {
    F.seed(supabase, [LIB, SHELF]);
    download.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }));
    expect(await Thumb.thumb(F.V(3))).toBeNull();
    expect(await Thumb.noPicture(F.V(3))).toBe(false);
    download.mockResolvedValue(await poster());
    expect(await Thumb.thumb(F.V(3))).not.toBeNull();
    expect(download).toHaveBeenCalledTimes(2);
    const stranger = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';   // a well-formed id the library does not list
    expect(await Thumb.thumb(stranger)).toBeNull();
    expect(await Thumb.noPicture(stranger)).toBe(false);
    Lib._reset(); Thumb._reset();
    const fake = F.seed(supabase, [LIB, SHELF]);
    const bank = require('../../../shared/services/quiz/web-quiz-bank');
    const failed = jest.spyOn(bank, 'bank').mockRejectedValueOnce(new Error('statement timeout'));
    try {
      expect(await Thumb.thumb(F.V(1))).toBeNull();
      expect(await Thumb.noPicture(F.V(1))).toBe(false);
      expect(await Thumb.thumb(F.V(1))).not.toBeNull();
    } finally { failed.mockRestore(); }
    expect(fake).toBeTruthy();
  });
  test('a remembered miss is not said once the switch is off (off never answers the kept variant)', async () => {
    F.seed(supabase, [LIB, SHELF]);
    download.mockRejectedValue(noSuchKey());
    expect(await Thumb.thumb(F.V(3))).toBeNull();
    expect(await Thumb.noPicture(F.V(3))).toBe(true);
    Lib._reset();
    F.seed(supabase, [LIB]);
    expect(await Thumb.noPicture(F.V(3))).toBe(false);
  });
});

describe('the home names the Videos shelf only on the switch\'s strict true', () => {
  const out = { lib: { href: '/lib/x', art: '/a.webp' }, lang: 'en' };
  const pre = (shelf) => ({ flags: Promise.resolve({ home: true, stories: false, shelf }), data: Promise.resolve({ runs: [], binds: [], card: {} }) });
  test.each([[undefined, false], [false, false], ['true', false], [1, false], [true, true]])('f.shelf=%p -> shelf key %p', async (v, on) => {
    F.seed(supabase, [LIB]);
    const r = await Home.homeField({ out, chosenId: F.KID_A, history: [], pre: pre(v) });
    expect(r.home_v3).toBe(1);
    expect('shelf' in r.doors.videos).toBe(on);
  });
});
