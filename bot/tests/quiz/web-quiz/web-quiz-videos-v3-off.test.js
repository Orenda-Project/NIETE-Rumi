'use strict';
/**
 * app_settings `web_quiz_videos_v3` OFF: the video library answers byte-identically to the code before the
 * switch existed. The snapshot was recorded on that code; the switch absent, false, and the string 'true'
 * (only the JSON true turns it on) must all give the same payloads AND the same database calls, even when
 * the page sends a language (?l=) and the bank rows carry one.
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

const LIB_ON = { key: 'web_quiz_library', value: true };
const OFF = [
  ['absent', [LIB_ON]],
  ['false', [LIB_ON, { key: 'web_quiz_videos_v3', value: false }]],
  ['the string true', [LIB_ON, { key: 'web_quiz_videos_v3', value: 'true' }]],
  ['an object', [LIB_ON, { key: 'web_quiz_videos_v3', value: { enabled: true } }]],
];

async function trace(settings) {
  const fake = F.seed(supabase, settings);
  const st = T.signSession({ sessionId: 's-a1', deviceRef: 'd1', shareCodeId: F.SC });
  mockKidFromHub.mockResolvedValue({ studentId: F.KID_A, grade: '3', rootId: F.SC, lang: 'ur' });
  const out = [];
  out.push(await Lib.lib('AB12CD', { st, l: 'ur' }));
  out.push(await Lib.lib('AB12CD', { st, s: 'Science', l: 'ur' }));
  out.push(await Lib.lib('AB12CD', { s: 'Maths', l: 'en' }));
  out.push(await Lib.lib('AB12CD', { s: 'Urdu' }));
  out.push(await Lib.lib('UR12CD', { s: 'Science' }));
  out.push(await Lib.libHub('hubtoken', { kid: 'chip-1', l: 'en' }));
  out.push(await Lib.libHub('hubtoken', { kid: 'chip-1', s: 'Maths', l: 'en' }));
  out.push(await Lib.libHub('hubtoken', { kid: 'chip-1', s: 'Science' }));
  await Lib._idle();
  return F.normPosters({ out, db: fake.calls.map((c) => ({ table: c.table, op: c.op })) });
}

describe('web_quiz_videos_v3 off: the library is byte-identical', () => {
  test.each(OFF)('lib and libHub payloads and database calls (%s)', async (_label, settings) => {
    expect(await trace(settings)).toMatchSnapshot();
  });

  test('every off value answers exactly as the switch absent', async () => {
    const base = await trace(OFF[0][1]);
    for (const [, settings] of OFF.slice(1)) {
      Lib._reset();
      Videos._metaCache.clear();
      expect(await trace(settings)).toEqual(base);
    }
  });
});
