'use strict';
/**
 * Homework (the WhatsApp Flow's chapter bundle) — its request row gains the lifecycle columns, its
 * plan rows name the request, and the request's outcome says why.
 *
 * The homework path already keeps a lesson_plan_requests row: the Flow endpoint inserts it (pending)
 * and queues one job per grade × subject group; the LAST group's job marks it completed or failed.
 * That rule — status words and when they are written — is unchanged. With LP_LIFECYCLE_PATHS on for
 * homework_bundle the same writes ADD: path, channel, region, grade/subject (when the selection is one
 * of each), the selection, the log id; generated_at + delivered_at on delivery; error_code NO_ASSET
 * (every chapter missing), DELIVERY_FAILED (WhatsApp refused the file) or GENERATION_FAILED (anything
 * else); and every lesson_plans row the worker writes carries request_id.
 *
 * Driven through the real endpoint, the real chapter lookup and the real worker. Faked: the queue,
 * R2, pdf-lib (a bot-only package), WhatsApp, the logs; Supabase is the in-memory double.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const mockEvent = jest.fn();
let mockCorrelationId = 'corr-flow-1';
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => mockCorrelationId,
}));
jest.mock('pdf-lib', () => ({
  PDFDocument: {
    create: async () => ({
      copyPages: async (_src, idxs) => idxs.map(() => ({})),
      addPage: () => {},
      save: async () => new Uint8Array([37, 80, 68, 70]),
    }),
    load: async () => ({ getPageIndices: () => [0] }),
  },
}), { virtual: true });
const mockDownload = jest.fn();
jest.mock('../../bot/shared/storage/r2', () => ({ downloadFromR2: (...a) => mockDownload(...a) }));
const mockSendDocument = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendDocument: (...a) => mockSendDocument(...a) }));
const mockQueueJob = jest.fn();
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: (...a) => mockQueueJob(...a) }));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
jest.mock('../../bot/shared/config/supabase', () => mockDb);

const fs = require('fs');
const Endpoint = require('../../bot/shared/routes/homework-request-endpoint');
const Worker = require('../../bot/workers/homework-bundle.worker');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';
const REQ = '99999999-9999-4999-8999-999999999999';
const chapter = (grade, subject, n) => ({
  id: `h-${grade}-${subject}-${n}`, grade, subject, chapter_number: n, chapter_title: `Ch ${n}`, lang: 'en',
  r2_key: `hw/g${grade}/${subject}/${n}.pdf`, version: 'v7',
});
const rows = (t) => mockDb.rows(t);
const pick = (selections) => Endpoint.handleHomeworkDataExchange(`${TEACHER}:homework`, 'SELECT_CHAPTERS', {
  selections_json: JSON.stringify(selections),
});
const job = (over = {}) => ({
  userId: TEACHER, phone: PHONE, requestId: REQ, grade: 3, subject: 'maths',
  chapters: [{ chapter: 1, chapter_title: 'Ch 1', r2_key: 'k1' }, { chapter: 2, chapter_title: 'Ch 2', r2_key: 'k2' }],
  groupIndex: 0, groupCount: 1, isLastGroup: true, ...over,
});

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  jest.clearAllMocks();
  mockCorrelationId = 'corr-flow-1';
  mockDb.reset({
    users: [{ id: TEACHER, phone_number: PHONE, preferred_language: 'en' }],
    homework_chapters: [chapter(3, 'maths', 1), chapter(3, 'maths', 2), chapter(3, 'english', 4)],
    lesson_plan_requests: [{ id: REQ, user_id: TEACHER, phone_number: PHONE, topic: 'Homework', status: 'pending' }],
    lesson_plans: [],
  });
  mockQueueJob.mockResolvedValue({ MessageId: 'm-1' });
  mockDownload.mockResolvedValue(Buffer.from('%PDF-1.4 chapter'));
  mockSendDocument.mockResolvedValue(true);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

const newRequest = () => rows('lesson_plan_requests').find((r) => r.id !== REQ);
const theRequest = () => rows('lesson_plan_requests').find((r) => r.id === REQ);

describe('the Flow endpoint — the request row it writes', () => {
  test('switched OFF: the insert is exactly the old row', async () => {
    const res = await pick([{ grade: 3, subject: 'maths', chapters: [1, 2] }]);
    expect(res.screen).toBe('SUCCESS');
    expect(Object.keys(newRequest()).sort()).toEqual(
      ['content_type', 'full_message', 'id', 'language', 'phone_number', 'status', 'topic', 'user_id'],
    );
  });

  test('switched ON: the insert carries path, channel, region, grade, subject, the selection and the log id', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'homework_bundle';
    await pick([{ grade: 3, subject: 'maths', chapters: [2, 1] }]);
    const req = newRequest();
    expect(req).toEqual(expect.objectContaining({
      status: 'pending', source: 'homework_bundle', channel: 'whatsapp', region: 'niete', grade: 3, subject: 'maths',
      artifact_ref: 'grade_3:maths:1,2', correlation_id: 'corr-flow-1',
    }));
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.request.created', expect.objectContaining({ requestId: req.id, source: 'homework_bundle' }));
    // the jobs carry the same request id, as before
    expect(mockQueueJob.mock.calls[0][2]).toEqual(expect.objectContaining({ requestId: req.id }));
  });

  test('switched ON: a selection across two subjects names both, and leaves subject empty', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'homework_bundle';
    await pick([{ grade: 3, subject: 'maths', chapters: [1] }, { grade: 3, subject: 'english', chapters: [4] }]);
    expect(newRequest()).toEqual(expect.objectContaining({ grade: 3, subject: null, artifact_ref: 'grade_3:maths:1;grade_3:english:4' }));
  });
});

describe('switched ON against a database that has NOT had V1.6.4 — every write still lands as it always did', () => {
  const { withoutV164 } = require('./helpers/pre-migration');
  let original;
  beforeEach(() => {
    process.env.LP_LIFECYCLE_PATHS = 'all';
    original = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation(withoutV164(original));
  });
  afterEach(() => { mockDb.from.mockImplementation(original); });

  test('the endpoint still writes its request row and queues the jobs with its id', async () => {
    const res = await pick([{ grade: 3, subject: 'maths', chapters: [1, 2] }]);
    expect(res.screen).toBe('SUCCESS');
    const req = newRequest();
    expect(Object.keys(req).sort()).toEqual(['content_type', 'full_message', 'id', 'language', 'phone_number', 'status', 'topic', 'user_id']);
    expect(mockQueueJob.mock.calls[0][2]).toEqual(expect.objectContaining({ requestId: req.id }));
  });

  test('the worker still marks the request completed and writes its plan row', async () => {
    const res = await Worker.process(job());
    expect(res.success).toBe(true);
    expect(theRequest()).toEqual({ id: REQ, user_id: TEACHER, phone_number: PHONE, topic: 'Homework', status: 'completed' });
    expect(rows('lesson_plans')).toHaveLength(1);
    expect(rows('lesson_plans')[0]).not.toHaveProperty('request_id');
  });
});

describe('the bundle worker — the request\'s outcome and the plan rows', () => {
  test('switched ON, the last group delivered: generated_at + delivered_at, no error, and the plan row names the request', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'homework_bundle';
    const res = await Worker.process(job());
    expect(res.success).toBe(true);
    expect(theRequest()).toEqual(expect.objectContaining({ status: 'completed', error_code: null }));
    expect(theRequest().generated_at).toBeTruthy();
    expect(theRequest().delivered_at).toBeTruthy();
    expect(rows('lesson_plans')[0]).toEqual(expect.objectContaining({ type: 'homework_bundle', request_id: REQ }));
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.delivery.sent', expect.objectContaining({ requestId: REQ, source: 'homework_bundle' }));
  });

  test('switched ON, every chapter missing: failed with NO_ASSET', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'homework_bundle';
    mockDownload.mockRejectedValue(new Error('NoSuchKey'));
    await Worker.process(job());
    expect(theRequest()).toEqual(expect.objectContaining({ status: 'failed', error_code: 'NO_ASSET' }));
  });

  test('switched ON, WhatsApp refused the file: failed with DELIVERY_FAILED and generated_at — and it still throws, as before', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'homework_bundle';
    mockSendDocument.mockResolvedValue(false);
    await expect(Worker.process(job())).rejects.toThrow(/sendDocument/);
    expect(theRequest()).toEqual(expect.objectContaining({ status: 'failed', error_code: 'DELIVERY_FAILED' }));
    expect(theRequest().generated_at).toBeTruthy();
  });

  test('switched ON, anything else that throws before the send: GENERATION_FAILED', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'homework_bundle';
    const spy = jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error('disk full'); });
    await expect(Worker.process(job())).rejects.toThrow(/disk full/);
    spy.mockRestore();
    expect(theRequest()).toEqual(expect.objectContaining({ status: 'failed', error_code: 'GENERATION_FAILED' }));
  });

  test('switched ON, an earlier group: the request is left alone (the last group decides, as before) but its plan row names it', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'homework_bundle';
    await Worker.process(job({ isLastGroup: false, groupIndex: 0, groupCount: 2 }));
    expect(theRequest()).toEqual({ id: REQ, user_id: TEACHER, phone_number: PHONE, topic: 'Homework', status: 'pending' });
    expect(rows('lesson_plans')[0].request_id).toBe(REQ);
  });

  test('switched OFF: the request update is the old one and the plan row has no request_id key', async () => {
    await Worker.process(job());
    expect(theRequest()).toEqual({ id: REQ, user_id: TEACHER, phone_number: PHONE, topic: 'Homework', status: 'completed' });
    expect(rows('lesson_plans')[0]).not.toHaveProperty('request_id');
  });
});
