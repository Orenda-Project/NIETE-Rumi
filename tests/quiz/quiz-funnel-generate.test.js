'use strict';
/**
 * The quiz funnel, generate → hand-off: generation_started, generated,
 * generation_failed, sent, send_failed — and the durable trace each leaves on
 * the quizzes row.
 *
 * Two production findings this suite holds (prod, 9–15 Sep 2026):
 *
 *   D1 — 22 transcript quizzes were written `failed / session_missing` while
 *        every one of their coaching sessions existed and was `completed`. The
 *        session read in process() never looked at `error`: a PostgREST error
 *        (the select still joined a column V1.4.5 had dropped) came back as
 *        `data: null` and was recorded as a missing session — with no
 *        `transcript_quiz.failed` event and no message to a teacher who had been
 *        told "making it now". A read ERROR now throws, so the queue redelivers
 *        the job; a session that is genuinely gone fails like every other
 *        failure: an event, `meta.failed_at`, and the teacher is told.
 *
 *   G5 — `transcript_quiz.sent` fired even when the forwardable link — the one
 *        message the class needs — was not delivered. The funnel says so:
 *        `sent {link_sent:false}` + `send_failed {reason:'link_not_delivered'}`.
 *
 * Everything real except the network boundary and the authoring passes (the
 * digest and author are this suite's inputs, not its subject — the same seams
 * lp-quiz-generate.test.js uses): supabase, WhatsApp, the queue, R2, the PDF
 * engine, the share-code mint.
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
  lessonDrewBlock: jest.fn().mockReturnValue('WHAT THE LESSON DREW — sticks'),
}));
jest.mock('../../bot/shared/services/quiz/lp-asset-source.store', () => ({ resolveSlideScript: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({
  author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'T', topic: 'Carrying' }),
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
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { installNoPictureRepair } = require('./helpers/no-picture-repair');

const QID = '44444444-4444-4444-8444-444444444444';
const TID = '55555555-5555-4555-8555-555555555555';
const SID = '66666666-6666-4666-8666-666666666666';
const PHONE = '923001234567';
const LESSON = {
  lesson_id: 'grade_2_math_ch9_seg3', asset_id: 'a-1', version_stamp: 'v8-20260901', content_hash: 'h-abc', delivered_at: '2026-09-22T04:10:00Z',
};
const LP_QUIZ = {
  id: QID, teacher_id: TID, coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Add a 3-digit and a 2-digit number',
  subject: 'maths', language: 'en', status: 'generating', grade: '2',
  meta: { step: 'digest', source: 'lp_offer', nudge_id: 'n-1', lessons: [LESSON], class: { grade: 2, subject: 'maths' }, lesson_date: '2026-09-22' },
};
const TQ_QUIZ = {
  id: QID, teacher_id: TID, coaching_session_id: SID, quiz_source: 'transcript', topic: 'Carrying', subject: 'maths',
  language: 'en', status: 'generating', grade: '2', meta: { step: 'digest', source: 'list' },
};
const USER = { id: TID, name: 'T', phone_number: PHONE, preferred_language: 'en' };
const DIGEST = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', grade_band: '1-2', confidence: 0.9,
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
const TRANSCRIPT = 'Today we added numbers with carrying: 146 plus 27, ones first, then tens. '.repeat(40);
const SESSION = {
  id: SID, user_id: TID, status: 'completed', observation_type: null, transcript_text: TRANSCRIPT, transcript_language: 'en',
  analysis_data: { topic: 'Carrying', subject: 'maths' }, created_at: '2026-09-22T05:00:00Z', users: USER,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);   // the hand-off's own pacing
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  WhatsAppService.sendMessage.mockResolvedValue(true);
  Share.mintCode.mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'T', topic: 'Carrying' });
  Store.resolveSlideScript.mockResolvedValue({ slideScript: { meta: { lessonId: LESSON.lesson_id } }, verified: 'upload', assetId: 'a-1' });
  LpDigest.run.mockResolvedValue({ digest: DIGEST, grade: '2', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002 });
  Digest.run.mockResolvedValue({ digest: DIGEST, grade: '2', gradeSource: 'profile', lpHint: null, model: 'dm', costUsd: 0.002 });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned column addition.' });
});

function wire({ quiz = LP_QUIZ, session = { data: [SESSION] } } = {}) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: session,
    niete_lp_downloads: { data: [] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [USER] },
  }));
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
const funnel = (stage) => logEvent.mock.calls.filter((c) => c[0] === `quiz_funnel.${stage}`).map((c) => c[1]);

describe('a quiz that is made and sent leaves one event per stage, with its stream and channel', () => {
  test('lp_v8: generation_started → generated → sent, each carrying quiz_id, source and channel', async () => {
    wire();
    const r = await Gen.process(QID, { phone: PHONE });
    expect(r).toEqual(expect.objectContaining({ ok: true }));

    expect(funnel('generation_started')).toEqual([{ quiz_id: QID, teacher_id: TID, source: 'lp_v8', channel: 'lp_offer' }]);
    expect(funnel('generated')).toEqual([expect.objectContaining({ quiz_id: QID, source: 'lp_v8', channel: 'lp_offer', n: 8 })]);
    expect(funnel('sent')).toEqual([{
      quiz_id: QID, teacher_id: TID, source: 'lp_v8', channel: 'lp_offer', pdf_sent: true, link_sent: true,
    }]);
    expect(funnel('send_failed')).toEqual([]);
    expect(funnel('generation_failed')).toEqual([]);
  });

  test('a transcript quiz from /quiz is channel quiz_menu', async () => {
    wire({ quiz: TQ_QUIZ });
    await Gen.process(QID, { phone: PHONE });
    expect(funnel('generation_started')[0]).toEqual(expect.objectContaining({ source: 'transcript', channel: 'quiz_menu' }));
    expect(funnel('sent')[0]).toEqual(expect.objectContaining({ source: 'transcript', channel: 'quiz_menu', link_sent: true }));
  });

  test('the sent row records whether the link was delivered (meta.link_sent)', async () => {
    wire();
    await Gen.process(QID, { phone: PHONE });
    const sentPatch = quizUpdates().find((u) => u.status === 'sent');
    expect(sentPatch.meta.link_sent).toBe(true);
  });

  test('a quiz resumed at the hand-off (already ready) is not counted as a second generation', async () => {
    wire({ quiz: { ...LP_QUIZ, status: 'ready', meta: { ...LP_QUIZ.meta, step: 'ready', digest: DIGEST } } });
    await Gen.process(QID, { phone: PHONE });
    expect(funnel('generation_started')).toEqual([]);
    expect(funnel('generated')).toEqual([]);
    expect(funnel('sent')).toHaveLength(1);
  });
});

describe('G5 — a link that did not reach the teacher is a send failure, not a quiet success', () => {
  test('the forwardable link refused → sent {link_sent:false} and send_failed {link_not_delivered}', async () => {
    wire();
    // The PDF goes by sendDocument; the FIRST sendMessage is the forwardable link.
    WhatsAppService.sendMessage.mockResolvedValueOnce(false);
    await Gen.process(QID, { phone: PHONE });

    expect(funnel('sent')[0]).toEqual(expect.objectContaining({ quiz_id: QID, link_sent: false }));
    expect(funnel('send_failed')).toEqual([expect.objectContaining({ quiz_id: QID, source: 'lp_v8', reason: 'link_not_delivered' })]);
    const sentPatch = quizUpdates().find((u) => u.status === 'sent');
    expect(sentPatch.meta.link_sent).toBe(false);
  });

  test('a share code that could not be minted → send_failed {mint_failed}', async () => {
    wire();
    Share.mintCode.mockResolvedValueOnce(null);
    const r = await Gen.process(QID, { phone: PHONE });
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'mint_failed' }));
    expect(funnel('send_failed')).toEqual([expect.objectContaining({ quiz_id: QID, source: 'lp_v8', reason: 'mint_failed' })]);
    expect(funnel('sent')).toEqual([]);
  });
});

describe('every terminal failure is one generation_failed event and a failed_at on the row', () => {
  test('an author that never validates → generation_failed {reason, source}, meta.failed_at', async () => {
    wire();
    Author.author.mockResolvedValue({ questions: [], model: 'm', costUsd: 0.01, latencyMs: 100 });
    jest.spyOn(Gen, 'rewriteRejected').mockResolvedValue({ attempted: false });
    jest.spyOn(Gen, 'rewriteTeacherFields').mockResolvedValue({ attempted: false });
    const r = await Gen.process(QID, { phone: PHONE });

    expect(r.failed).toBe(true);
    expect(funnel('generation_failed')).toEqual([expect.objectContaining({ quiz_id: QID, source: 'lp_v8', reason: r.reason })]);
    const failed = quizUpdates().find((u) => u.status === 'failed');
    expect(Number.isNaN(Date.parse(failed.meta.failed_at))).toBe(false);
  });
});

describe('D1 — a session read that ERRORS is not a missing session', () => {
  test('a PostgREST error on the session read throws (the queue redelivers) and writes nothing, tells nobody', async () => {
    wire({ quiz: TQ_QUIZ, session: { data: null, error: { message: 'column users_1.grade does not exist', code: '42703' } } });

    await expect(Gen.process(QID, { phone: PHONE })).rejects.toThrow(/session/i);
    expect(quizUpdates().filter((u) => u.status === 'failed')).toEqual([]);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(funnel('generation_failed')).toEqual([]);
  });

  test('a session that is really gone fails like every other failure: event, failed_at, and the teacher is told', async () => {
    wire({ quiz: TQ_QUIZ, session: { data: [], error: null } });

    const r = await Gen.process(QID, { phone: PHONE });

    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'session_missing' }));
    const failed = quizUpdates().find((u) => u.status === 'failed');
    expect(failed.meta.error).toBe('session_missing');
    expect(Number.isNaN(Date.parse(failed.meta.failed_at))).toBe(false);
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.failed', expect.objectContaining({ quizId: QID, reason: 'session_missing', quiz_source: 'transcript' }));
    expect(funnel('generation_failed')).toEqual([expect.objectContaining({ quiz_id: QID, source: 'transcript', reason: 'session_missing' })]);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.tqCouldNotMake.en);
  });
});
