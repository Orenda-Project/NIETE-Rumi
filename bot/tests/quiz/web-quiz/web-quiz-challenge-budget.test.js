'use strict';
/**
 * The read-aloud's daily cap (COS 7 Oct, P2 idea 1): app_settings `web_quiz_challenge_daily_reads` = read-alouds
 * scored per Pakistan day across the whole environment, default 500 (≈ USD 10 at ~$0.021 a reading); absent or a
 * failed read = the default; cached 60 s. At the cap the menu offers "Which is bigger?" only, a read already open
 * gets the existing "enough for today" answer (429 enough_for_today, its upload deleted), and the cap is logged ONCE.
 *
 * Faked boundaries only: Supabase (in memory), R2, logger; the challenge service and its budget run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000 })),
  presignKey: jest.fn(async () => null),
  getPresignedUploadUrl: jest.fn(async (k) => `https://r2.test/put/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
  downloadFromR2: jest.fn(async () => Buffer.from('x')),
}));
// Redis is a boundary: an in-memory SET NX / GET, so the hub's first-device binding runs for real.
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return { _store: store, isAvailable: () => true, get: async (k) => (store.has(k) ? store.get(k) : null),
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; } };
});
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-444444444444';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const HOUR = 3600 * 1000;
// Pakistan midnight (UTC+5) of today, as an instant.
const pkMidnight = () => { const d = new Date(Date.now() + 5 * HOUR).toISOString().slice(0, 10); return Date.parse(`${d}T00:00:00Z`) - 5 * HOUR; };
const at = (ms) => new Date(ms).toISOString();
const reads = (n, when = Date.now()) => Array.from({ length: n }, (_, i) => ({ id: `r-${when}-${i}`, student_id: `kid-${i}`, exercise: 'read', status: 'scored', meta: {}, created_at: at(when) }));

function seed(runs, setting) {
  const app = [{ key: 'web_quiz_challenge', value: true }];
  if (setting !== undefined) app.push({ key: 'web_quiz_challenge_daily_reads', value: setting });
  Object.assign(supabase, makeFake({
    app_settings: app,
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST }],
    quiz_share_codes: [], quiz_sessions: [],
    web_quiz_challenge_runs: runs,
  }));
  Ch.__reset();
  jest.clearAllMocks();
}
const hub = () => T.signHub([KID]);
const D = { device: 'BudgetTestPhoneRef_001' };
const ids = async () => (await Ch.menu(hub(), D)).exercises.map((e) => e.id);
const capped = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.ch_read_capped');

beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });

test('setting absent: the default, 500 readings a day', async () => {
  seed(reads(499));
  expect(await ids()).toEqual(['bigger', 'read']);
  seed(reads(500));
  expect(await ids()).toEqual(['bigger']);
});

test('setting present (number or JSON string): that many; reads before Pakistan midnight do not count', async () => {
  seed(reads(2), 3);
  expect(await ids()).toEqual(['bigger', 'read']);
  seed([...reads(2), ...reads(5, pkMidnight() - HOUR)], '3');
  expect(await ids()).toEqual(['bigger', 'read']);
  seed(reads(3), 3);
  expect(await ids()).toEqual(['bigger']);
  seed([], 0);
  expect(await ids()).toEqual(['bigger']);
});

test('a failed settings read is the default (not "off", not unlimited)', async () => {
  seed(reads(10), 3);
  const real = supabase.from;
  supabase.from = (t) => (t === 'app_settings'
    ? { select: () => ({ eq: (c, v) => (v === 'web_quiz_challenge_daily_reads' ? { maybeSingle: async () => ({ data: null, error: { message: 'down' } }) } : real(t).select('key, value').eq(c, v)) }) }
    : real(t));
  expect(await ids()).toEqual(['bigger', 'read']);   // 10 < 500
  supabase.from = real;
});

test('at the cap: logged once however often asked; read refused with "enough for today"', async () => {
  seed(reads(3), 3);
  expect(await ids()).toEqual(['bigger']);
  expect(await ids()).toEqual(['bigger']);
  await expect(Ch.exercise(hub(), 'read', D)).rejects.toMatchObject({ status: 429, body: { error: 'enough_for_today' } });
  await expect(Ch.exercise(hub(), 'bigger', D)).resolves.toMatchObject({ ex: 'bigger' });
  expect(capped()).toHaveLength(1);
  expect(capped()[0][1]).toMatchObject({ cap: 3, readsToday: 3 });
});

test('the cap reached while a reading is open: no upload URL, and an uploaded recording is refused AND deleted', async () => {
  seed(reads(1), 2);
  const ex = await Ch.exercise(hub(), 'read', D);
  const up = await Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 1000 });
  await supabase.from('web_quiz_challenge_runs').insert(reads(1)[0]);
  Ch.__reset();
  await expect(Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 1000 })).rejects.toMatchObject({ status: 429, body: { error: 'enough_for_today' } });
  await expect(Ch.submit({ ct: ex.ct, key: up.key, ms: 60000, lang: 'en' })).rejects.toMatchObject({ status: 429, body: { error: 'enough_for_today' } });
  expect(r2.deleteKey).toHaveBeenCalledWith(up.key, expect.anything());
});
