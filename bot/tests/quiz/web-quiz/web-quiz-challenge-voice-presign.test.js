'use strict';
/**
 * The read-aloud upload URL signs its content-type (R2 refuses a PUT with any other type) and lives ~3 minutes,
 * not 15. The real AWS presigner runs (it signs locally — no network); only the Supabase client and the logger
 * are faked.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

process.env.R2_ENDPOINT = 'https://acct.r2.test';
process.env.R2_ACCESS_KEY_ID = 'AKIDTESTONLY';
process.env.R2_SECRET_ACCESS_KEY = 'secret-test-only';
process.env.R2_BUCKET_NAME = 'r2-default';
process.env.INTERNAL_API_KEY = 'test-internal-key';
process.env.CHILD_TEST_R2_ENV = 'sandbox';
process.env.CHILD_VOICE_BUCKET = 'voice-bucket';

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

beforeEach(() => { Object.assign(supabase, makeFake({ web_quiz_challenge_runs: [] })); Ch.__reset(); });

test('the PUT URL signs content-type and host, and expires in 180 s', async () => {
  const ct = T.signChallenge({ studentId: '44444444-4444-4444-8444-444444444444', ex: 'read', runId: 'run-presign-1' });
  const out = await Ch.presignUpload({ ct, type: 'audio/webm;codecs=opus', size: 1000 });
  const u = new URL(out.put_url);
  expect(`${u.hostname}${u.pathname}`).toBe(`voice-bucket.acct.r2.test/${out.key}`);
  expect(u.searchParams.get('X-Amz-SignedHeaders').split(';')).toEqual(expect.arrayContaining(['content-type', 'host']));
  expect(u.searchParams.get('X-Amz-Expires')).toBe('180');
  expect(out).toMatchObject({ content_type: 'audio/webm', expires_in: 180 });
});
