'use strict';
/**
 * The read-aloud's daily spend cap. Each scored read-aloud spends an STT call and a listening call (its cost is
 * stored on the run, meta.cost_usd). When today's (UTC) read-aloud spend reaches WEB_QUIZ_CHALLENGE_DAILY_USD
 * (default USD 10), the Challenge offers "Which is bigger?" only until midnight UTC, and says so in the logs ONCE.
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
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-444444444444';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const today = () => new Date().toISOString();
const yesterday = () => new Date(Date.now() - 26 * 3600 * 1000).toISOString();
const run = (cost, at = today(), extra = {}) => ({ id: `r-${Math.random()}`, student_id: 'someone', exercise: 'read', status: 'scored', meta: cost == null ? {} : { cost_usd: cost }, created_at: at, ...extra });

function seed(runs) {
  Object.assign(supabase, makeFake({
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST }],
    quiz_share_codes: [], quiz_sessions: [],
    web_quiz_challenge_runs: runs,
  }));
  Ch.__reset();
  jest.clearAllMocks();
}
const hub = () => T.signHub([KID]);
const ids = async () => (await Ch.menu(hub())).exercises.map((e) => e.id);
const capped = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.ch_read_capped');

beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
afterEach(() => { delete process.env.WEB_QUIZ_CHALLENGE_DAILY_USD; });

test('under the default cap (USD 10): both exercises', async () => {
  seed([run(4.9), run(5.0)]);
  expect(await ids()).toEqual(['bigger', 'read']);
  expect(capped()).toHaveLength(0);
});

test('at the default cap: "Which is bigger?" only, logged once however often it is asked', async () => {
  seed([run(6), run(4.01)]);
  expect(await ids()).toEqual(['bigger']);
  expect(await ids()).toEqual(['bigger']);
  await expect(Ch.exercise(hub(), 'read')).rejects.toMatchObject({ status: 503, body: { error: 'read_paused' } });
  await expect(Ch.exercise(hub(), 'bigger')).resolves.toMatchObject({ ex: 'bigger' });
  expect(capped()).toHaveLength(1);
  expect(capped()[0][1]).toMatchObject({ capUsd: 10, spentUsd: 10.01 });
});

test('the cap is per environment (WEB_QUIZ_CHALLENGE_DAILY_USD); yesterday does not count; a run with no cost yet counts at the estimate', async () => {
  process.env.WEB_QUIZ_CHALLENGE_DAILY_USD = '0.04';
  seed([run(0.021), run(5, yesterday())]);
  expect(await ids()).toEqual(['bigger', 'read']);
  seed([run(0.021), run(null, today(), { status: 'scoring' })]);
  expect(await ids()).toEqual(['bigger']);
  process.env.WEB_QUIZ_CHALLENGE_DAILY_USD = 'nonsense';
  seed([run(9)]);
  expect(await ids()).toEqual(['bigger', 'read']);
});

test('capped: no upload URL, and a recording already uploaded is refused AND deleted', async () => {
  process.env.WEB_QUIZ_CHALLENGE_DAILY_USD = '1';
  seed([]);
  const ex = await Ch.exercise(hub(), 'read');   // opened while under the cap
  const up = await Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 1000 });
  await supabase.from('web_quiz_challenge_runs').insert(run(1.5));
  Ch.__reset();                                  // the next read of today's spend sees the new run
  await expect(Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 1000 })).rejects.toMatchObject({ status: 503, body: { error: 'read_paused' } });
  await expect(Ch.submit({ ct: ex.ct, key: up.key, ms: 60000, lang: 'en' })).rejects.toMatchObject({ status: 503, body: { error: 'read_paused' } });
  expect(r2.deleteKey).toHaveBeenCalledWith(up.key, expect.anything());
});
