'use strict';
/**
 * A share picture that is not in R2 yet is a cache MISS, not an error.
 *
 * The first request for a picture draws it and stores it. Asking R2 for it first
 * used to go through downloadFromR2, which logs every failure, a miss included,
 * as "❌ Error downloading from R2". Here the real r2 storage module runs; only
 * the S3 client (the network) is faked, so what the module logs is what the
 * logs would show.
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
const { logToFile } = require('../../../shared/utils/logger');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');

const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
let Art;
let errSpy;

function seed() {
  const now = Date.now();
  return {
    quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', teacher_user_id: 't-1', topic: 'Fractions', language: 'en', active: true }],
    quizzes: [{ id: 'qz-1', topic: 'Fractions', grade: '3', subject: 'Maths', language: 'en', meta: {} }],
    students: [{ id: 'st-1', student_name: 'Amal Testwala' }],
    quiz_sessions: [{ id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed',
      correct_answers: 7, total_questions_answered: 8, mastery_percentage: 88, completed_at: new Date(now - 60000).toISOString(), created_at: new Date(now - 300000).toISOString() }],
    app_settings: [], users: [{ id: 't-1', school_id: 'SA' }],
    schools: [{ id: 'SA', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false }],
  };
}

const notFound = (name) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });

beforeEach(() => {
  Object.assign(process.env, { R2_ENDPOINT: 'https://r2.example.test', R2_ACCESS_KEY_ID: 'test-only', R2_SECRET_ACCESS_KEY: 'test-only', INTERNAL_API_KEY: 'art-key' });
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  const fake = makeFake(seed());
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Art = require('../../../shared/services/quiz/web-quiz-art');
  Art._resetCache();
  require('../../../shared/services/quiz/web-quiz-schools')._reset();
  S3.__send.mockReset();
  logToFile.mockClear();
  htmlToImage.mockReset().mockImplementation(async (html, o) => sharp({ create: { width: o.width, height: o.height || o.width, channels: 3, background: '#333748' } }).png().toBuffer());
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

test('a miss: no error-level log, the picture is drawn and stored', async () => {
  S3.__send.mockImplementation(async (c) => {
    if (c.type === 'get') throw notFound('NoSuchKey');
    if (c.type === 'head') throw notFound('NotFound');
    return {};
  });
  const out = await Art.artImage(Art.artId('c', SID), { size: 'og' });
  expect((await sharp(out.bytes).metadata()).format).toBe('jpeg');
  expect(htmlToImage).toHaveBeenCalledTimes(1);
  expect(S3.__send.mock.calls.some(([c]) => c.type === 'put')).toBe(true);
  expect(errSpy).not.toHaveBeenCalled();
});

test('a real R2 failure (500): one warning with the key, and the picture is still drawn', async () => {
  const boom = Object.assign(new Error('InternalError'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } });
  S3.__send.mockImplementation(async (c) => { if (c.type === 'put') return {}; throw boom; });
  const out = await Art.artImage(Art.artId('c', SID), { size: 'og' });
  expect(out.bytes.length).toBeGreaterThan(0);
  expect(errSpy).not.toHaveBeenCalled();
  const warns = logToFile.mock.calls.filter((c) => /R2 read failed/.test(c[0]));
  expect(warns).toEqual([[expect.any(String), { key: out.key, error: 'InternalError' }, 'warn']]);
});

test('a hit: read from R2, nothing drawn', async () => {
  const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).jpeg().toBuffer();
  S3.__send.mockImplementation(async (c) => {
    if (c.type === 'head') return { ContentLength: jpg.length, ContentType: 'image/jpeg' };
    if (c.type === 'get') return { Body: (async function* () { yield jpg; })() };
    return {};
  });
  const out = await Art.artImage(Art.artId('c', SID), { size: 'og' });
  expect(out.bytes.equals(jpg)).toBe(true);
  expect(htmlToImage).not.toHaveBeenCalled();
  expect(errSpy).not.toHaveBeenCalled();
});
