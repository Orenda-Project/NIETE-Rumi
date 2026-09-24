'use strict';
/**
 * WHY a quiz written from a coaching RECORDING failed, said truthfully.
 *
 * Every transcript-quiz failure except a blind-solve hold-back was told one
 * sentence, tqCouldNotMake: "I couldn't make a good quiz from this lesson's
 * recording — the transcript didn't carry enough of what was taught clearly."
 * When the MODEL failed — nothing came back, it was cut off, it was not JSON
 * even after the retry, or the provider refused the call — that sentence blames
 * the teacher's recording for our failure (root CLAUDE.md rule 24d). The lp_v8
 * quiz got this split first (lp-quiz-failure-reasons.test.js); this is the same
 * split for the quiz born of a recording:
 *   model_failed    — ours: tqCouldNotMakeModel, which says the recording was
 *                     not the problem and that /quiz can make it again;
 *   source_unusable — the transcript is below the length every other entry to
 *                     the quiz already requires; checked BEFORE any model call
 *                     (root rule 24c), and it keeps the recording sentence,
 *                     because that one is then true.
 *
 * Everything real except the network boundary: supabase, WhatsApp, the queue,
 * R2, the PDF renderer and `llm-client` are mocked, so the transcript digest, the
 * retry in completeJson, the author loop, the generate step and the offer all
 * run for real.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'A B', topic: 'x' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  introShownCount: jest.fn().mockResolvedValue(9),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
  hasSeenIntroVideo: jest.fn().mockResolvedValue(false),
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
const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
const { genderedTeacherForms } = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');

const QID = '88888888-8888-4888-8888-888888888888';
const SID = '99999999-9999-4999-8999-999999999999';
const PHONE = '923001234567';
const LESSON_TALK = 'Today we learned what a producer is: grass makes its own food, the goat eats the grass, the lion eats the goat. ';
const TRANSCRIPT = LESSON_TALK.repeat(30);             // ~3,300 characters — a real lesson's worth
const SHORT = LESSON_TALK.repeat(5);                   // ~550 — below what any quiz entry accepts

const QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: SID, quiz_source: 'transcript', topic: 'Food chains', subject: 'science',
  language: 'en', status: 'generating', grade: null, meta: { step: 'digest', source: 'list' },
};
const session = (transcript = TRANSCRIPT) => ({
  id: SID, user_id: 'u-1', status: 'completed', observation_type: null, transcript_text: transcript, transcript_language: 'en',
  analysis_data: { topic: 'Food chains', subject: 'science' }, lesson_plan_excerpt: null, created_at: '2026-09-22T05:00:00Z',
  users: { id: 'u-1', name: 'A B', phone_number: PHONE, preferred_language: 'en' },
});
const DIGEST_JSON = {
  topic: 'Food chains', topic_as_taught: 'Food chains', subject: 'science', subject_conflict: false,
  grade_band: '3-5', language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'name a producer', statement_en: 'name a producer', statement_ur: 'پیدا کنندہ', evidence_quote: 'grass makes its own food', taught_level: 'recall' },
    { id: 'S2', statement: 'order a food chain', statement_en: 'order a food chain', statement_ur: 'غذائی زنجیر', evidence_quote: 'the goat eats the grass', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'producer', as_spoken: 'producer' }], examples_used: ['grass → goat → lion'], misconceptions_surfaced: [],
};

const isDigestPrompt = (params) => String(params.messages[0].content).startsWith('You are reading the transcript');
const reply = (content, finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }], usage: { cost: 0.001 } });

function wire({ transcript = TRANSCRIPT, quiz = QUIZ } = {}) {
  installFrom(supabase.from, {
    quizzes: (calls) => {
      if (calls.some((c) => c[0] === 'insert')) return { data: [{ id: QID }], error: null };
      if (calls.some((c) => c[0] === 'update')) return { data: [{ id: QID }], error: null };
      return { data: [quiz], error: null };
    },
    coaching_sessions: { data: [session(transcript)] },
    niete_lp_downloads: { data: [] },
    users: { data: [{ id: 'u-1', phone_number: PHONE, preferred_language: 'en' }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
  });
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
const failedPatch = () => quizUpdates().find((u) => u.status === 'failed');
const skippedPatch = () => quizUpdates().find((u) => u.status === 'skipped');
const failedEvent = () => (logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.failed') || [])[1];

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  delete process.env.TRANSCRIPT_QUIZ_MODEL;
  delete process.env.TRANSCRIPT_QUIZ_OFFER_MODE;
  delete process.env.TRANSCRIPT_QUIZ_SUBJECTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
});
afterEach(() => { delete process.env.TRANSCRIPT_QUIZ_ENABLED; });

describe('generate: the MODEL failing at the digest is model_failed, never "the transcript didn’t carry enough"', () => {
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
    expect(failedEvent()).toEqual(expect.objectContaining({ reason: 'model_failed', step: 'digest', quiz_source: 'transcript' }));
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    // Never the sentence that blames the recording …
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalledWith(PHONE, UX_STRINGS.tqCouldNotMake.en);
    // … but the one that says the failure was ours.
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqCouldNotMakeModel.en);
  });

  test('the provider refusing the call is model_failed too', async () => {
    mockCreate.mockImplementation(async () => { throw Object.assign(new Error('429 Rate limit reached'), { status: 429 }); });
    wire();

    const r = await Gen.process(QID, {});

    expect(r.reason).toBe('model_failed');
    // Never the sentence that blames the recording …
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalledWith(PHONE, UX_STRINGS.tqCouldNotMake.en);
    // … but the one that says the failure was ours.
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqCouldNotMakeModel.en);
  });
});

describe('generate: no usable author reply on any attempt is model_failed', () => {
  test('every author attempt comes back empty → model_failed, told honestly', async () => {
    mockCreate.mockImplementation(async (params) => (isDigestPrompt(params) ? reply(JSON.stringify(DIGEST_JSON)) : reply('')));
    wire();

    const r = await Gen.process(QID, {});

    expect(mockCreate).toHaveBeenCalledTimes(7);            // 1 digest + 3 attempts × (1 + 1 retry)
    expect(r.reason).toBe('model_failed');
    expect(failedEvent()).toEqual(expect.objectContaining({ reason: 'model_failed', step: 'author', quiz_source: 'transcript' }));
    // Never the sentence that blames the recording …
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalledWith(PHONE, UX_STRINGS.tqCouldNotMake.en);
    // … but the one that says the failure was ours.
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqCouldNotMakeModel.en);
  });

  test('an author that DID reply, with questions that never validate, keeps the existing recording sentence', async () => {
    mockCreate.mockImplementation(async (params) => (isDigestPrompt(params)
      ? reply(JSON.stringify(DIGEST_JSON))
      : reply(JSON.stringify({ questions: [], lesson_summary: 'You taught the food chain.' }))));
    jest.spyOn(Gen, 'rewriteRejected').mockResolvedValue({ attempted: false });
    jest.spyOn(Gen, 'rewriteTeacherFields').mockResolvedValue({ attempted: false });
    wire();

    const r = await Gen.process(QID, {});

    expect(r.reason).toBe('validator_failed');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqCouldNotMake.en);
  });
});

describe('generate: a transcript too short to carry a quiz is source_unusable, checked before any model call', () => {
  test('no model call; persisted as source_unusable; the recording sentence, which is then true', async () => {
    wire({ transcript: SHORT });

    const r = await Gen.process(QID, {});

    expect(mockCreate).not.toHaveBeenCalled();
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'source_unusable' }));
    expect(failedPatch().meta.error).toBe('source_unusable');
    expect(failedEvent()).toEqual(expect.objectContaining({ reason: 'source_unusable', quiz_source: 'transcript' }));
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqCouldNotMake.en);
  });

  test('the threshold is the one /quiz and the offer already use — a transcript they list is never refused here', () => {
    expect(TRANSCRIPT.length).toBeGreaterThanOrEqual(Offer.MIN_TRANSCRIPT_CHARS);
    expect(SHORT.length).toBeLessThan(Offer.MIN_TRANSCRIPT_CHARS);
  });
});

describe('the offer: a digest the MODEL failed is skipped as model_failed, not digest_failed', () => {
  test('the skip reason persisted on the row names the model, and the skip is an event like every other skip', async () => {
    mockCreate.mockImplementation(async () => reply(''));
    wire();

    const r = await Offer.processOffer(SID, { phone: PHONE });

    expect(r).toEqual(expect.objectContaining({ skipped: 'model_failed' }));
    expect(skippedPatch().meta.skip_reason).toBe('model_failed');
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.skipped', expect.objectContaining({ reason: 'model_failed', coachingSessionId: SID }));
    // The teacher was never offered this quiz, so nothing is said to them.
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});

describe('tqCouldNotMakeModel — the sentence itself', () => {
  test('exists in every offered language, says the fault was ours and the recording was not the problem', () => {
    for (const lang of LANGUAGE_OFFER) {
      expect(typeof UX_STRINGS.tqCouldNotMakeModel[lang]).toBe('string');
      expect(UX_STRINGS.tqCouldNotMakeModel[lang]).not.toBe(UX_STRINGS.tqCouldNotMake[lang]);
    }
    expect(UX_STRINGS.tqCouldNotMakeModel.en).toMatch(/my side/i);
    expect(UX_STRINGS.tqCouldNotMakeModel.en).toMatch(/not your recording/i);
    expect(UX_STRINGS.tqCouldNotMakeModel.en).not.toMatch(/didn.t carry|not enough|unclear/i);
    expect(UX_STRINGS.tqCouldNotMakeModel.ur).toMatch(/میری طرف سے/);
    expect(UX_STRINGS.tqCouldNotMakeModel.ur).not.toMatch(/کافی واضح نہیں/);
  });

  test('points to /quiz, where a failed recording quiz CAN be made again', () => {
    for (const lang of LANGUAGE_OFFER) expect(UX_STRINGS.tqCouldNotMakeModel[lang]).toContain('/quiz');
  });

  test('is gender-neutral about the teacher, fits a body, and takes no parameters', () => {
    for (const lang of LANGUAGE_OFFER) {
      const s = UX_STRINGS.tqCouldNotMakeModel[lang];
      expect(s).not.toMatch(/\b(she|her|hers|herself|he|him|his|himself)\b/i);
      expect(genderedTeacherForms(s, lang)).toEqual([]);
      expect([...s].length).toBeLessThanOrEqual(1024);
      expect(s).not.toMatch(/\{\w+\}/);
    }
  });
});
