'use strict';
/**
 * WHY an lp_v8 quiz failed, said truthfully — to the teacher and in the row.
 *
 * Before this suite, every exception out of the digest step was one reason,
 * `digest_failed`, and one sentence: "I couldn't read enough of that lesson
 * plan to write a good quiz." That sentence is true of exactly one of the ways
 * the step can stop — a slide script with no lesson in it. Every other way is
 * ours: the model answered with nothing, was cut off, wrote something that is
 * not JSON even after the retry, or the provider refused the call. Telling the
 * teacher their lesson plan was unreadable then points them (and whoever reads
 * the field report) at the wrong thing (root CLAUDE.md rule 24d).
 *
 * Two reasons now, each with its own sentence and its own persisted marker:
 *   source_unusable — the slide script really carries no lesson;
 *   model_failed    — the model gave us nothing usable (digest OR author).
 *
 * Everything real except the network boundary: supabase, WhatsApp, the queue,
 * R2 and the PDF renderer are mocked, and so is `llm-client` — so the LP digest,
 * the one retry in `completeJson`, the author loop and the generate step all
 * run for real.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'A B', topic: 'x' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const QID = '77777777-7777-4777-8777-777777777777';
const LESSON = { lesson_id: 'grade_2_math_ch9_seg3', version_stamp: 'v8-1', content_hash: 'h-1', asset_id: 'a-1' };
const PHONE = '923001234567';
const LP_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Carrying', subject: 'maths',
  language: 'en', status: 'generating', grade: '2',
  meta: { step: 'digest', source: 'lp_offer', lessons: [LESSON], class: { grade: 2, subject: 'maths' }, lesson_date: '2026-09-22' },
};
/** A slide script with a lesson in it: it passes the digest's own usability check. */
const PLAN = {
  meta: { lessonId: LESSON.lesson_id, grade: 2, subject: 'math', topic: 'Adding with carrying' },
  goal: 'Add a 3-digit and a 2-digit number, carrying into the tens',
  bloom: 'apply',
  iDo: { keyFact: 'When the ones make ten or more, carry one ten into the tens column.' },
};
/** A slide script that carries no lesson at all — only its header. */
const EMPTY_PLAN = { meta: { lessonId: LESSON.lesson_id, grade: 2, subject: 'math' } };

const DIGEST_JSON = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', subject_conflict: false,
  grade_band: '1-2', language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'add with carrying', statement_en: 'add with carrying', statement_ur: 'حاصل کے ساتھ جمع', evidence_quote: 'carry one ten', taught_level: 'apply' },
    { id: 'S2', statement: 'explain the carry', statement_en: 'explain the carry', statement_ur: 'حاصل سمجھانا', evidence_quote: 'ones make ten', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'carry', as_spoken: 'carry' }], examples_used: ['146 + 27'], misconceptions_surfaced: ['carries from every column'],
};

const isDigestPrompt = (params) => String(params.messages[0].content).startsWith('You are reading the LESSON PLAN');
const reply = (content, finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }], usage: { cost: 0.001 } });

/**
 * @param {object} o
 * @param {object} [o.plan]         the slide script the store returns
 * @param {Function} [o.onUpdate]   (patch, nth) → a supabase result for the nth quizzes update
 */
function wire({ plan = PLAN, onUpdate = null } = {}) {
  let updates = 0;
  installFrom(supabase.from, {
    quizzes: (calls) => {
      const upd = calls.find((c) => c[0] === 'update');
      if (upd) {
        updates += 1;
        return onUpdate ? onUpdate(upd[1], updates) : { data: [{ id: QID }], error: null };
      }
      return { data: [LP_QUIZ], error: null };
    },
    users: { data: [{ id: 'u-1', name: 'A B', phone_number: PHONE, preferred_language: 'en' }] },
    niete_lp_asset_sources: {
      data: [{ asset_id: 'a-1', ...LESSON, slide_script: plan, verified: 'upload' }],
    },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
  });
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
const failedPatch = () => quizUpdates().find((u) => u.status === 'failed');
const failedEvent = () => (logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.failed') || [])[1];

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  delete process.env.TRANSCRIPT_QUIZ_MODEL;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
});

describe('the digest step: the MODEL failing is model_failed, never "the lesson plan could not be read"', () => {
  test.each([
    ['an empty reply, twice', () => reply('')],
    ['a reply cut off at the token limit, twice', () => reply('', 'length')],
    ['a reply that is not JSON, twice', () => reply('{ "topic":')],
  ])('%s → model_failed, persisted, told honestly', async (_label, make) => {
    mockCreate.mockImplementation(async () => make());
    wire();

    const r = await Gen.process(QID, {});

    expect(mockCreate).toHaveBeenCalledTimes(2);             // the one retry in completeJson ran
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'model_failed' }));
    expect(failedPatch().meta.error).toBe('model_failed');
    expect(failedPatch().meta.error_detail).toMatch(/^digest: /);
    expect(failedEvent()).toEqual(expect.objectContaining({ reason: 'model_failed', step: 'digest', quiz_source: 'lp_v8' }));
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqFailedLpModel.en);
  });

  test('the provider refusing the call (no reply at all) is model_failed too', async () => {
    mockCreate.mockImplementation(async () => {
      const err = new Error('429 Rate limit reached for requests');
      err.status = 429;
      throw err;
    });
    wire();

    const r = await Gen.process(QID, {});

    expect(r.reason).toBe('model_failed');
    expect(failedPatch().meta.error).toBe('model_failed');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqFailedLpModel.en);
  });
});

describe('the digest step: a slide script with no lesson in it is source_unusable', () => {
  test('never reaches the model, is persisted as source_unusable, and the teacher is told the plan had too little in it', async () => {
    wire({ plan: EMPTY_PLAN });

    const r = await Gen.process(QID, {});

    expect(mockCreate).not.toHaveBeenCalled();
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'source_unusable' }));
    expect(failedPatch().meta.error).toBe('source_unusable');
    expect(failedEvent()).toEqual(expect.objectContaining({ reason: 'source_unusable', step: 'digest', quiz_source: 'lp_v8' }));
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqFailedLpSourceUnusable.en);
  });

  test('the two sentences are different, and only the source one says the plan was the problem', () => {
    for (const lang of ['en', 'ur']) {
      expect(UX_STRINGS.tqFailedLpModel[lang]).not.toBe(UX_STRINGS.tqFailedLpSourceUnusable[lang]);
    }
    // The model sentence must not claim the plan was unreadable.
    expect(UX_STRINGS.tqFailedLpModel.en).not.toMatch(/couldn.t read|could not read|not enough/i);
    expect(UX_STRINGS.tqFailedLpModel.en).toMatch(/my side/i);
  });
});

describe('a database error writing the digest result is not a digest failure', () => {
  test('the job throws so the queue redelivers it; the quiz is not failed and the teacher is told nothing', async () => {
    mockCreate.mockImplementation(async () => reply(JSON.stringify(DIGEST_JSON)));
    // The first quizzes update is the digest result; it fails. A second one
    // (the "failed" mark the old catch wrote) would succeed.
    wire({ onUpdate: (_patch, nth) => (nth === 1 ? { data: null, error: { message: 'connection reset' } } : { data: [{ id: QID }], error: null }) });

    await expect(Gen.process(QID, {})).rejects.toThrow(/connection reset/);
    expect(failedPatch()).toBeUndefined();
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});

describe('the author step: no usable reply on any attempt is model_failed, not "the questions were not clear"', () => {
  test('every author attempt comes back empty → model_failed, persisted, told honestly', async () => {
    mockCreate.mockImplementation(async (params) => (isDigestPrompt(params) ? reply(JSON.stringify(DIGEST_JSON)) : reply('')));
    wire();

    const r = await Gen.process(QID, {});

    // 1 digest call + 3 author attempts × (1 call + 1 retry)
    expect(mockCreate).toHaveBeenCalledTimes(7);
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'model_failed' }));
    expect(failedPatch().meta.error).toBe('model_failed');
    expect(failedEvent()).toEqual(expect.objectContaining({ reason: 'model_failed', step: 'author', quiz_source: 'lp_v8' }));
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqFailedLpModel.en);
  });

  test('an author that DID reply, with questions that never validate, is still validator_failed', async () => {
    mockCreate.mockImplementation(async (params) => (isDigestPrompt(params)
      ? reply(JSON.stringify(DIGEST_JSON))
      : reply(JSON.stringify({ questions: [], lesson_summary: 'The plan was column addition.' }))));
    jest.spyOn(Gen, 'rewriteRejected').mockResolvedValue({ attempted: false });
    jest.spyOn(Gen, 'rewriteTeacherFields').mockResolvedValue({ attempted: false });
    wire();

    const r = await Gen.process(QID, {});

    expect(r.reason).toBe('validator_failed');
    expect(failedPatch().meta.error).toBe('validator_failed');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqFailedLpAuthor.en);
  });
});
