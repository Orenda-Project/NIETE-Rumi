'use strict';
/**
 * Every share picture served logs one web_quiz.art_served event: which picture, how long, and where it came
 * from (drawn now, R2, or this process's memory). A link preview fetches the picture with no session and the
 * route was untimed, so nothing showed whether a phone ever fetched one. The event names no child and no id.
 * The real r2 storage module runs; only the S3 client (the network) is faked.
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
const { logEvent } = require('../../../shared/utils/structured-logger');
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
  logEvent.mockClear();
  htmlToImage.mockReset().mockImplementation(async (html, o) => sharp({ create: { width: o.width, height: o.height || o.width, channels: 3, background: '#333748' } }).png().toBuffer());
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

const served = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.art_served').map(([, p]) => p);

test('a first request draws the picture and says so; the next one says it came from memory', async () => {
  S3.__send.mockImplementation(async (c) => {
    if (c.type === 'head') throw notFound('NotFound');
    if (c.type === 'get') throw notFound('NoSuchKey');
    return {};
  });
  await Art.artImage(Art.artId('c', SID), { size: 'og' });
  await Art.artImage(Art.artId('c', SID), { size: 'og' });
  const ev = served();
  expect(ev).toHaveLength(2);
  expect(ev[0]).toMatchObject({ kind: 'card', size: 'og', from: 'drawn' });
  expect(ev[1]).toMatchObject({ kind: 'card', size: 'og', from: 'mem' });
  expect(typeof ev[0].ms).toBe('number');
});

test('the event carries no id, code or name — only kind, size, ms and where it came from', async () => {
  S3.__send.mockImplementation(async (c) => {
    if (c.type === 'head') throw notFound('NotFound');
    if (c.type === 'get') throw notFound('NoSuchKey');
    return {};
  });
  await Art.artImage(Art.artId('c', SID), { size: 'sq' });
  const [ev] = served();
  expect(Object.keys(ev).sort()).toEqual(['from', 'kind', 'ms', 'size']);
  expect(JSON.stringify(ev)).not.toMatch(/Amal|CLS001|0f8e2c1a/);
});

test('a picture that does not exist logs no served event', async () => {
  await expect(Art.artImage('c.AAAAAAAAAAAAAAAAAAAAAA.abcdefghijkl', { size: 'og' })).rejects.toMatchObject({ status: 404 });
  expect(served()).toHaveLength(0);
});

describe('a repeat of the same picture id', () => {
  const missEverywhere = async (c) => {
    if (c.type === 'head') throw notFound('NotFound');
    if (c.type === 'get') throw notFound('NoSuchKey');
    return {};
  };
  let reads;
  beforeEach(() => {
    reads = 0;
    const from = supabase.from;
    supabase.from = (t) => { reads += 1; return from(t); };
  });

  test('is answered from memory without asking the database again (the preview fetch after the card warmed it)', async () => {
    S3.__send.mockImplementation(missEverywhere);
    const id = Art.artId('c', SID);
    const a = await Art.artImage(id, { size: 'og' });
    const before = reads;
    const b = await Art.artImage(id, { size: 'og' });
    expect(reads).toBe(before);
    expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
    expect(served().pop()).toMatchObject({ kind: 'card', from: 'mem' });
  });

  test('a class picture is looked up afresh after two minutes (the table moves as children play)', async () => {
    S3.__send.mockImplementation(missEverywhere);
    const id = Art.artId('l', 'CLS001');
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    await Art.artImage(id, { size: 'og' });
    const before = reads;
    await Art.artImage(id, { size: 'og' });
    expect(reads).toBe(before);
    spy.mockReturnValue(now + 121000);
    await Art.artImage(id, { size: 'og' });
    expect(reads).toBeGreaterThan(before);
    spy.mockRestore();
  });
});
