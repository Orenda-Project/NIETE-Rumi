'use strict';
/**
 * A child's recording leaves nothing behind (COS ruling, 7 Oct): scoring — or any refusal — deletes EVERY object
 * under the run's private prefix, and once more after the upload URL has expired, so a reused URL cannot leave an
 * orphan; and a run that is no longer open gets no new upload URL.
 *
 * Faked boundaries: Supabase (in memory), R2 (list / delete / head / download), logger. The challenge service runs
 * for real; the scorer is handed bytes that are not audio, so it fails and the clean-up path still has to run.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 4000 })),
  presignKey: jest.fn(async () => null),
  getPresignedUploadUrl: jest.fn(async (k) => `https://r2.test/put/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
  downloadFromR2: jest.fn(async () => Buffer.from('not audio')),
}));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn(async () => { throw new Error('no stt in tests'); }) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn(async () => { throw new Error('no llm in tests'); }) } } }) }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-444444444444';
const LIST = 'a0000000-0000-4000-8000-00000000003b';

beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_VOICE_BUCKET = 'voice-bucket'; });
beforeEach(() => {
  Object.assign(supabase, makeFake({
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST }],
    quiz_share_codes: [], quiz_sessions: [], web_quiz_challenge_runs: [],
  }));
  Ch.__reset();
  jest.clearAllMocks();
});
afterEach(() => { jest.useRealTimers(); });

const open = async () => Ch.exercise(T.signHub([KID]), 'read');

test('scored (here: scoring failed): every key under the run prefix is deleted, then again after the URL expires', async () => {
  const ex = await open();
  const up = await Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 4000 });
  const prefix = up.key.slice(0, up.key.lastIndexOf('/') + 1);
  const second = `${prefix}read-1791000000000.webm`;            // a second PUT a reused URL could have made
  r2.listKeys.mockImplementation(async (p) => (p === prefix ? [up.key, second] : []));
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance', 'hrtime', 'Date'] });
  const out = await Ch.submit({ ct: ex.ct, key: up.key, ms: 60000, lang: 'en' }, { waitMs: 60 * 60 * 1000 });
  expect(out).toMatchObject({ failed: true });
  expect(r2.listKeys).toHaveBeenCalledWith(prefix, { bucket: 'voice-bucket' });
  const deleted = r2.deleteKey.mock.calls.map(([k, o]) => [k, o && o.bucket]);
  expect(deleted).toEqual(expect.arrayContaining([[up.key, 'voice-bucket'], [second, 'voice-bucket']]));
  r2.listKeys.mockClear(); r2.deleteKey.mockClear();
  jest.advanceTimersByTime(181 * 1000);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  expect(r2.listKeys).toHaveBeenCalledWith(prefix, { bucket: 'voice-bucket' });
  expect(r2.deleteKey.mock.calls.map(([k]) => k)).toEqual(expect.arrayContaining([up.key, second]));
});

test('a refused upload (wrong key shape) also clears the run prefix', async () => {
  const ex = await open();
  const up = await Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 4000 });
  const prefix = up.key.slice(0, up.key.lastIndexOf('/') + 1);
  r2.listKeys.mockImplementation(async (p) => (p === prefix ? [up.key] : []));
  await expect(Ch.submit({ ct: ex.ct, key: `${prefix}read-x.webm`, ms: 1, lang: 'en' })).rejects.toMatchObject({ status: 403 });
  expect(r2.listKeys).toHaveBeenCalledWith(prefix, { bucket: 'voice-bucket' });
  expect(r2.deleteKey.mock.calls.map(([k]) => k)).toContain(up.key);
});

test('a run that is no longer open gets no new upload URL', async () => {
  const ex = await open();
  const up = await Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 4000 });
  await Ch.submit({ ct: ex.ct, key: up.key, ms: 60000, lang: 'en' }, { waitMs: 60 * 60 * 1000 });
  await expect(Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 4000 })).rejects.toMatchObject({ status: 409, body: { error: 'already_done' } });
  Ch.__reset();   // another process: the stored run says it is done
  await expect(Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 4000 })).rejects.toMatchObject({ status: 409, body: { error: 'already_done' } });
});
