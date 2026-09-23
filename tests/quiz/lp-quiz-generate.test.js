'use strict';
/**
 * R8 lane D task 3.2 — generate a quiz for a lesson that was PLANNED, not recorded.
 *
 * An `lp_v8` quiz row has no coaching session (`coaching_session_id = null`):
 * the quiz is written from the slide script of the exact lesson version the
 * teacher was served. Before this change `process()` looked the session up
 * first and failed every such row as `session_missing`.
 *
 * The network boundary is mocked (supabase, WhatsApp, the queue, the LLM-backed
 * digest and author, R2, the PDF renderer) and so is the slide-script store,
 * which lane S owns — by its contract `resolveSlideScript({lessonId,
 * versionStamp, contentHash}) → {slideScript, verified, assetId} | null`.
 * The generate step itself runs for real.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn(), normaliseDigest: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/lp-quiz-digest.service', () => ({
  run: jest.fn(), lessonExcerpts: jest.fn().mockReturnValue('WHAT THE CLASS WAS TO LEARN: add with carrying'),
}));
jest.mock('../../bot/shared/services/quiz/lp-asset-source.store', () => ({ resolveSlideScript: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({
  author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor', topic: 'Carrying' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const Store = require('../../bot/shared/services/quiz/lp-asset-source.store');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
// The blind solve is not this suite's subject: an agreeing solver on its seam (see the helper).
const { installAgreeingSolver } = require('./helpers/key-verify-agree');

const QID = '44444444-4444-4444-8444-444444444444';
const LESSON = {
  lesson_id: 'grade_2_math_ch9_seg3', asset_id: 'a-1', version_stamp: 'v8-20260901', content_hash: 'h-abc', delivered_at: '2026-09-22T04:10:00Z',
};
const LP_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Add a 3-digit and a 2-digit number',
  subject: 'maths', language: 'en', status: 'generating', grade: '2',
  meta: {
    step: 'generating', source: 'lp_offer', nudge_id: 'n-1', lessons: [LESSON], class: { grade: 2, subject: 'maths' }, lesson_date: '2026-09-22',
  },
};
const USER = { id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'en' };
const SLIDE_SCRIPT = { meta: { lessonId: LESSON.lesson_id, grade: 2, subject: 'math' }, goal: 'Add with carrying', bloom: 'apply' };
const DIGEST = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', grade_band: '1-2', confidence: 0.9,
  taught_level: 'apply',
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'apply' },
    { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'understand' }],
  key_terms: [], examples_used: ['146 + 27'], misconceptions_surfaced: ['carries out of every column'],
};

function goodQuestion(i, slo, level) {
  return {
    slo_id: slo, level, question: `Question ${i}: what is ${100 + i} + ${20 + i}?`,
    options: [`${120 + 2 * i}`, `${130 + 2 * i}`, `${110 + 2 * i}`], correct_index: 0,
    explanation: `Add the ones, then the tens: ${120 + 2 * i}.`,
    selected_because: `Question ${i} checks adding two numbers in columns.`,
    distractor_misconceptions: { 1: 'carried when no column reached ten', 2: 'dropped a ten' },
    option_feedback: { correct: 'Yes — ones first, then tens.', wrong: { 1: 'No column reached ten, so nothing carries.', 2: 'A ten was lost from the tens column.' } },
  };
}
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => goodQuestion(i, i % 2 ? 'S1' : 'S2', i % 2 ? 'apply' : 'understand'));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  Store.resolveSlideScript.mockResolvedValue({ slideScript: SLIDE_SCRIPT, verified: 'upload', assetId: 'a-1' });
  LpDigest.run.mockResolvedValue({
    digest: DIGEST, grade: '2', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002, latencyMs: 10,
  });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned column addition.' });
});

function wire({ quiz = LP_QUIZ } = {}) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: () => { throw new Error('an lp_v8 quiz must never query coaching_sessions'); },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [USER] },
  }));
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);

describe('process — an lp_v8 quiz has no coaching session', () => {
  test('does not fail session_missing; digests the slide script of the exact served version and authors from it', async () => {
    wire();
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(supabase.from.callsFor('coaching_sessions')).toHaveLength(0);

    expect(Store.resolveSlideScript).toHaveBeenCalledWith({
      lessonId: LESSON.lesson_id, versionStamp: LESSON.version_stamp, contentHash: LESSON.content_hash,
    });
    expect(Digest.run).not.toHaveBeenCalled();
    expect(LpDigest.run).toHaveBeenCalledWith(expect.objectContaining({
      slideScript: SLIDE_SCRIPT, language: 'en', grade: '2', subject: 'maths',
    }));
    const authorArgs = Author.author.mock.calls[0][0];
    expect(authorArgs.digest).toBe(DIGEST);
    expect(authorArgs.transcript).toBeNull();
    // The author reads the planned lesson where a transcript quiz reads excerpts.
    expect(authorArgs.lessonPlan).toContain('add with carrying');

    const updates = quizUpdates();
    expect(updates.some((u) => u.meta && u.meta.digest === DIGEST)).toBe(true);
    expect(updates[updates.length - 1].status).toBe('sent');
  });

  test('the teacher is found from quizzes.teacher_id, and the link goes to that number', async () => {
    wire();
    await Gen.process(QID, {});
    expect(supabase.from.callsFor('users').length).toBeGreaterThan(0);
    expect(WhatsAppService.sendDocument.mock.calls[0][0]).toBe(USER.phone_number);
  });

  test('the student message carries the lesson date (meta.lesson_date), not today', async () => {
    wire({ quiz: { ...LP_QUIZ, meta: { ...LP_QUIZ.meta, lesson_date: '2026-09-18' } } });
    await Gen.process(QID, {});
    const forwardable = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(forwardable).toMatch(/18 Sep/);
  });

  test('telemetry on this path carries quiz_source', async () => {
    wire();
    await Gen.process(QID, {});
    const ready = logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.ready');
    expect(ready[1].quiz_source).toBe('lp_v8');
  });

  test('a missing slide script → failed / source_missing, and the teacher is told with tqFailedLpSource', async () => {
    Store.resolveSlideScript.mockResolvedValue(null);
    wire();
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'source_missing' }));
    const failed = quizUpdates().find((u) => u.status === 'failed');
    expect(failed.meta.error).toBe('source_missing');
    expect(LpDigest.run).not.toHaveBeenCalled();
    expect(Author.author).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(USER.phone_number, UX_STRINGS.tqFailedLpSource.en);
    const ev = logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.failed');
    expect(ev[1]).toEqual(expect.objectContaining({ reason: 'source_missing', quiz_source: 'lp_v8' }));
  });

  test('a store ERROR is not source_missing: the job throws so SQS redelivers it, and the teacher is told nothing', async () => {
    Store.resolveSlideScript.mockRejectedValue(new Error('niete_lp_asset_sources: connection reset'));
    wire();
    await expect(Gen.process(QID, {})).rejects.toThrow(/connection reset/);
    expect(quizUpdates().some((u) => u.status === 'failed')).toBe(false);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('an lp_v8 row with no lessons in meta is source_missing', async () => {
    wire({ quiz: { ...LP_QUIZ, meta: { ...LP_QUIZ.meta, lessons: [] } } });
    const r = await Gen.process(QID, {});
    expect(r.reason).toBe('source_missing');
    expect(Store.resolveSlideScript).not.toHaveBeenCalled();
  });

  test('a slide script with no lesson in it tells the teacher with tqFailedLpSourceUnusable', async () => {
    LpDigest.run.mockRejectedValue(Object.assign(new Error('lp digest: the slide script carries no lesson to digest'), { code: 'SOURCE_UNUSABLE' }));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.reason).toBe('source_unusable');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(USER.phone_number, UX_STRINGS.tqFailedLpSourceUnusable.en);
  });

  test('any other digest throw is the model’s, and says so with tqFailedLpModel', async () => {
    LpDigest.run.mockRejectedValue(Object.assign(new Error('lp_quiz.digest: empty reply from m'), { code: 'EMPTY' }));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.reason).toBe('model_failed');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(USER.phone_number, UX_STRINGS.tqFailedLpModel.en);
  });

  test('an author that never validates tells the teacher with tqFailedLpAuthor', async () => {
    Author.author.mockResolvedValue({ questions: [], model: 'm', costUsd: 0, latencyMs: 1, lessonSummary: '' });
    jest.spyOn(Gen, 'rewriteRejected').mockResolvedValue({ attempted: false });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.reason).toBe('validator_failed');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(USER.phone_number, UX_STRINGS.tqFailedLpAuthor.en);
  });

  test('a row whose digest is already stored skips the store and the LLM digest', async () => {
    wire({ quiz: { ...LP_QUIZ, meta: { ...LP_QUIZ.meta, digest: DIGEST } } });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(LpDigest.run).not.toHaveBeenCalled();
    // …but the author still needs the plan to read, so the source is resolved.
    expect(Store.resolveSlideScript).toHaveBeenCalledTimes(1);
  });
});

describe('process — a transcript quiz is untouched', () => {
  test('a transcript row with no session still fails session_missing and never reads the slide-script store', async () => {
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : {
        data: [{ ...LP_QUIZ, quiz_source: 'transcript', coaching_session_id: 's-1', meta: {} }],
      }),
      coaching_sessions: { data: [] },
    }));
    const r = await Gen.process(QID, {});
    expect(r.reason).toBe('session_missing');
    expect(Store.resolveSlideScript).not.toHaveBeenCalled();
    expect(LpDigest.run).not.toHaveBeenCalled();
  });
});
