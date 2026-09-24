'use strict';
/**
 * A lesson-plan quiz that could not be STARTED — what the teacher is told, and
 * whether /quiz can make it again.
 *
 * Staging E2E, 25 Sep: a Grades 6-12 lesson tapped in the /quiz Flow failed
 * `source_off` (its switch was on where the menu runs and off on the worker that
 * writes quizzes). The teacher was told "I couldn't start that quiz just now —
 * sorry. The next lessons you plan will get a new offer." — a line written for
 * the 15:00 offer, wrong for a quiz asked for from the menu. The lesson's /quiz
 * screen then said the quiz "could not be made from the lesson plan", offered
 * only Done, and stayed a dead end after the switch was back on.
 *
 * What holds now:
 *   - the chat line is chosen by what can happen NEXT: made again from /quiz
 *     when it can be (either channel — every lesson-plan quiz is listed in
 *     /quiz), "try again later" while the 6-12 source is off, and otherwise the
 *     15:00 offer's "next offer" line or the menu's "pick another lesson";
 *   - source_off is made again once the switch is on; a queue refusal as
 *     before; source_missing only when the lesson plan can be read NOW;
 *   - the lesson screen names the failure for what it was ("could not be
 *     started on my side"), and offers "Make it again" when it can.
 *
 * Driven through the real /quiz Flow endpoint, list service, remake and queue
 * step over an in-memory database; WhatsApp, the queue, Redis and R2 mocked.
 */

const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: { get: jest.fn(async () => null), set: jest.fn(), del: jest.fn() },
  isAvailable: () => true,
  get: jest.fn(async () => null),
  set: jest.fn(async () => true),
  setNX: jest.fn(async () => true),
  delete: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm-1' }),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => {
  const actual = jest.requireActual('../../bot/shared/utils/structured-logger');
  return { ...actual, logEvent: jest.fn() };
});

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const r2 = require('../../bot/shared/storage/r2');
const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');
const Endpoint = require('../../bot/shared/routes/transcript-quiz-flow-endpoint');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');

const T = 'u-teacher';
const PHONE = '920000000009';
const TOKEN = `${T}:transcript-quiz:1`;
const Q612 = '66666666-6666-4666-8666-666666666666';
const QV8 = '77777777-7777-4777-8777-777777777777';
const LESSON_612 = { segment_id: 'grade_9_general_science.c01.p010-011', lang: 'en', template_version: 'v9.6', render_id: 'r-1' };
const LESSON_V8 = { lesson_id: 'grade_4_math_ch1_seg1', version_stamp: 'v8-a', content_hash: 'h-a', asset_id: 'a-1' };

const flush = () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));

function quiz612(meta = {}, extra = {}) {
  return {
    id: Q612, teacher_id: T, coaching_session_id: null, quiz_source: 'lp612', status: 'failed',
    topic: 'Precision and accuracy', subject: 'science', language: 'en', grade: '9',
    meta: {
      step: 'failed', error: 'source_off', source: 'flow', lessons: [LESSON_612],
      class: { grade: 9, subject: 'science' }, lesson_date: '2026-09-24', ...meta,
    },
    created_at: new Date(Date.now() - 3600e3).toISOString(),
    ...extra,
  };
}
function quizV8(meta = {}) {
  return {
    id: QV8, teacher_id: T, coaching_session_id: null, quiz_source: 'lp_v8', status: 'failed',
    topic: 'Place value', subject: 'math', language: 'en', grade: '4',
    meta: {
      step: 'failed', error: 'source_missing', source: 'list', lessons: [LESSON_V8],
      class: { grade: 4, subject: 'math' }, lesson_date: '2026-09-24', ...meta,
    },
    created_at: new Date(Date.now() - 3600e3).toISOString(),
  };
}
function seed({ quizzes = [], language = 'en', sources = [] } = {}) {
  return {
    users: [{ id: T, phone_number: PHONE, preferred_language: language, role: 'teacher' }],
    niete_lp_assets: [],
    niete_lp_asset_sources: sources,
    niete_lp_downloads: [],
    niete_lp612_deliveries: [],
    coaching_sessions: [],
    quizzes,
    quiz_sessions: [],
    teacher_nudges: [],
  };
}
const rowOf = (id) => mockDb.tables.quizzes.find((q) => q.id === id);
const texts = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
const lesson = (id) => Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: `lp_${id}` });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  process.env.QUIZ_LP612_SOURCE = 'on';
  SQS.queueJob.mockResolvedValue({ MessageId: 'm-1' });
  r2.downloadFromR2.mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
});
afterAll(() => { delete process.env.QUIZ_LP612_SOURCE; });

describe('the chat line when the queue refuses the quiz — by what can happen next', () => {
  test.each([
    ['a /quiz menu tap', 'list'],
    ['the 15:00 offer', 'lp_offer'],
  ])('%s, the lessons kept: "pick this lesson in /quiz to try again" — never "the next lessons will get a new offer"', async (_, source) => {
    mockDb = makeDb(seed({ quizzes: [quizV8({ error: undefined, step: 'digest', source })] }));
    rowOf(QV8).status = 'generating';
    SQS.queueJob.mockRejectedValueOnce(new Error('queue refused'));
    const ok = await Offer.queueLpQuiz({ quizId: QV8, nudgeId: null, phone: PHONE, language: 'en' });
    expect(ok).toBe(false);
    expect(rowOf(QV8).meta.error).toBe('queue_failed');
    expect(texts()[0]).not.toMatch(/offer/i);
    expect(texts()).toEqual([UX_STRINGS.lpQuizCouldNotStartRetry.en]);
  });

  test('a menu tap that cannot be made again (two remakes spent): "pick another lesson", not the offer line', async () => {
    mockDb = makeDb(seed({ quizzes: [quizV8({ error: undefined, step: 'digest', source: 'flow', remakes: 2 })] }));
    rowOf(QV8).status = 'generating';
    SQS.queueJob.mockRejectedValueOnce(new Error('queue refused'));
    await Offer.queueLpQuiz({ quizId: QV8, nudgeId: null, phone: PHONE, language: 'ur' });
    expect(texts()).not.toEqual([UX_STRINGS.lpQuizCouldNotStart.ur]);
    expect(texts()).toEqual([UX_STRINGS.lpQuizCouldNotStartMenu.ur]);
  });

  test('the 15:00 offer that cannot be made again keeps its own line (a new offer comes with the next lessons)', async () => {
    mockDb = makeDb(seed({ quizzes: [quizV8({ error: undefined, step: 'digest', source: 'lp_offer', remakes: 2 })] }));
    rowOf(QV8).status = 'generating';
    SQS.queueJob.mockRejectedValueOnce(new Error('queue refused'));
    await Offer.queueLpQuiz({ quizId: QV8, nudgeId: null, phone: PHONE, language: 'en' });
    expect(texts()).toEqual([UX_STRINGS.lpQuizCouldNotStart.en]);
  });
});

describe('the /quiz Flow lesson screen of a 6-12 quiz that failed source_off', () => {
  test('switch back on: "could not be started on my side", and "Make it again" — the staging dead end is gone', async () => {
    mockDb = makeDb(seed({ quizzes: [quiz612()] }));
    const res = await lesson(Q612);
    expect(res.screen).toBe('LESSON');
    expect(res.data.results).toContain(resolveUx('tqFlowResultsFailedLpStart', { language: 'en' }));
    expect(res.data.results).toContain(resolveUx('tqFlowResultsRemakeHint', { language: 'en' }));
    expect(res.data.results).not.toContain(resolveUx('tqFlowResultsFailedLp', { language: 'en' }));
    expect(res.data.actions.map((a) => a.id)).toEqual(['remake', 'done']);
  });

  test('"Make it again" makes it: failed → generating, one quiz_generate job, the teacher told it is being made', async () => {
    mockDb = makeDb(seed({ quizzes: [quiz612()] }));
    const res = await Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', { step: 'action', session_id: `lp_${Q612}`, tq_action: 'remake' });
    expect(res.screen).toBe('SUCCESS');
    await flush();
    expect(rowOf(Q612).status).toBe('generating');
    expect(rowOf(Q612).meta.remakes).toBe(1);
    expect(rowOf(Q612).meta.previous_error).toBe('source_off');
    expect(SQS.queueJob).toHaveBeenCalledWith(Q612, 'quiz_generate', expect.any(Object), expect.any(Object));
    expect(texts()).toEqual([UX_STRINGS.lpQuizMaking.en]);
  });

  test('switch still off: no remake that would fail the same way — Done, and "try again later", in Urdu too', async () => {
    process.env.QUIZ_LP612_SOURCE = 'off';
    mockDb = makeDb(seed({ quizzes: [quiz612()], language: 'ur' }));
    const res = await lesson(Q612);
    expect(res.data.actions.map((a) => a.id)).toEqual(['done']);
    expect(res.data.results).toContain(resolveUx('tqFlowResultsFailedLpStart', { language: 'ur' }));
    expect(res.data.results).toContain(resolveUx('tqFlowResultsLater', { language: 'ur' }));
    expect(res.data.results).not.toContain(resolveUx('tqFlowResultsNextLesson', { language: 'ur' }));
  });
});

describe('the list message — a tap on that row', () => {
  test('switch on: the tap makes it again', async () => {
    mockDb = makeDb(seed({ quizzes: [quiz612()] }));
    await List.handleListPick(`tq_pick_lp_${Q612}`, PHONE, { id: T, preferred_language: 'en' });
    expect(rowOf(Q612).status).toBe('generating');
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  });

  test('switch off: "try again from /quiz later" — not the 15:00 offer\'s "next lessons" line', async () => {
    process.env.QUIZ_LP612_SOURCE = 'off';
    mockDb = makeDb(seed({ quizzes: [quiz612()] }));
    await List.handleListPick(`tq_pick_lp_${Q612}`, PHONE, { id: T, preferred_language: 'en' });
    expect(texts()).not.toEqual([UX_STRINGS.lpQuizCouldNotStart.en]);
    expect(texts()).toEqual([UX_STRINGS.lpQuizCouldNotStartLater.en]);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });
});

describe('source_missing — made again only when the lesson plan can be read now', () => {
  const source = { ...LESSON_V8, verified: 'upload', slide_script: { slides: [] } };

  test('the K-5 slide script is there now: the lesson screen offers "Make it again"', async () => {
    mockDb = makeDb(seed({ quizzes: [quizV8()], sources: [source] }));
    const res = await lesson(QV8);
    expect(res.data.actions.map((a) => a.id)).toEqual(['remake', 'done']);
    expect(res.data.results).toContain(resolveUx('tqFlowResultsRemakeHint', { language: 'en' }));
  });

  test('still not there: Done only, and the next-lesson line', async () => {
    mockDb = makeDb(seed({ quizzes: [quizV8()] }));
    const res = await lesson(QV8);
    expect(res.data.actions.map((a) => a.id)).toEqual(['done']);
    expect(res.data.results).toContain(resolveUx('tqFlowResultsNextLesson', { language: 'en' }));
  });

  test('a tap in the list: made again when it is back, told why when it is not', async () => {
    mockDb = makeDb(seed({ quizzes: [quizV8()], sources: [source] }));
    await List.handleListPick(`tq_pick_lp_${QV8}`, PHONE, { id: T, preferred_language: 'en' });
    expect(rowOf(QV8).status).toBe('generating');
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockDb = makeDb(seed({ quizzes: [quizV8()] }));
    await List.handleListPick(`tq_pick_lp_${QV8}`, PHONE, { id: T, preferred_language: 'en' });
    expect(rowOf(QV8).status).toBe('failed');
    expect(texts()).toEqual([UX_STRINGS.tqFailedLpSource.en]);
  });

  test('a 6-12 lesson whose stored document is there now can be made again; an R2 error is not "there"', async () => {
    const missing = quiz612({ error: 'source_missing' });
    r2.downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify({ sections: [] })));
    mockDb = makeDb(seed({ quizzes: [missing] }));
    expect((await lesson(Q612)).data.actions.map((a) => a.id)).toEqual(['remake', 'done']);

    r2.downloadFromR2.mockRejectedValue(new Error('R2 unreachable'));
    mockDb = makeDb(seed({ quizzes: [quiz612({ error: 'source_missing' })] }));
    expect((await lesson(Q612)).data.actions.map((a) => a.id)).toEqual(['done']);
  });
});
