'use strict';
/**
 * A lesson-plan quiz whose generate job could not be queued keeps what it is
 * written from.
 *
 * queueLpQuiz marked the row failed with a meta it built from scratch —
 * `{ step, error, source, nudge_id }` — so the lessons, the class and the lesson
 * date were gone. That row could never be made again (a remake reads
 * meta.lessons), /quiz dated it by nothing, and the failure it repeated was the
 * "questions didn't come out clear" copy, for a quiz that was never written.
 *
 * Executed against the real offer service, the real /quiz Flow endpoint and
 * the real failure rules; the queue, the database and WhatsApp are the
 * boundary.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const SQS = require('../../shared/services/queue/sqs-queue.service');
const { UX_STRINGS } = require('../../shared/config/ux-strings');
const { failureCopyKey, failureReasonOf, LP_V8 } = require('../../shared/services/quiz/quiz-sources');
const Offer = require('../../shared/services/quiz/transcript-quiz-offer.service');
const endpoint = require('../../shared/routes/transcript-quiz-flow-endpoint');

const TEACHER = 'teacher-1';
const QUIZ_ID = 'a1b2c3d4-0000-4000-8000-0000000b1b1a';
const LESSONS = [{ lesson_id: 'grade_4_math_ch5_seg3', asset_id: 'a-1', version_stamp: 'v1' }];
const META = {
  step: 'digest', source: 'lp_offer', nudge_id: 'nudge-1', lessons: LESSONS,
  class: { grade: 4, subject: 'maths' }, lesson_date: '2026-09-24', claimed_at: '2026-09-24T10:00:00Z',
};

/** A table that really filters, and applies an update to the rows it matches. */
function stub(tables) {
  const updates = [];
  supabase.from.mockImplementation((table) => {
    const rows = tables[table] || [];
    const filters = [];
    let patch = null;
    const matched = () => rows.filter((r) => filters.every(([f, v]) => r[f] === v));
    const chain = {
      select: () => chain,
      eq: (f, v) => { filters.push([f, v]); return chain; },
      is: () => chain, in: () => chain, order: () => chain, limit: () => chain, range: () => chain,
      update: (p) => { patch = p; return chain; },
      maybeSingle: async () => ({ data: matched()[0] || null, error: null }),
      single: async () => ({ data: matched()[0] || null, error: null }),
      then: (res, rej) => {
        if (patch) {
          const hit = matched();
          hit.forEach((r) => Object.assign(r, patch));
          updates.push({ table, patch });
          return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(res, rej);
        }
        return Promise.resolve({ data: matched(), error: null }).then(res, rej);
      },
    };
    return chain;
  });
  return updates;
}

beforeEach(() => jest.clearAllMocks());

describe('the queue refuses a lesson-plan quiz', () => {
  test('the row is marked failed with its lessons, class and lesson date kept', async () => {
    const row = { id: QUIZ_ID, teacher_id: TEACHER, quiz_source: LP_V8, status: 'generating', meta: { ...META } };
    stub({ quizzes: [row] });
    SQS.queueJob.mockRejectedValue(new Error('queue unavailable'));

    const queued = await Offer.queueLpQuiz({ quizId: QUIZ_ID, nudgeId: 'nudge-1', phone: '923001112222', language: 'en' });

    expect(queued).toBe(false);
    expect(row.status).toBe('failed');
    expect(row.meta).toEqual(expect.objectContaining({
      step: 'failed', error: 'queue_failed', lessons: LESSONS, class: META.class, lesson_date: '2026-09-24', nudge_id: 'nudge-1', source: 'lp_offer',
    }));
    // Its lessons are kept and it is listed in /quiz, where it can be made again —
    // so the offer's own line ("the next lessons will get a new offer") is not
    // the whole truth any more; the line says where to try again.
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923001112222', UX_STRINGS.lpQuizCouldNotStartRetry.en);
  });

  test('/quiz repeats what happened — it could not be started — never "the questions did not come out clear"', () => {
    expect(failureCopyKey(failureReasonOf({ error: 'queue_failed' }), LP_V8)).toBe('lpQuizCouldNotStart');
  });

  test('its /quiz lesson screen says it could not be started and offers Make it again, which queues it', async () => {
    const row = { id: QUIZ_ID, teacher_id: TEACHER, quiz_source: LP_V8, status: 'failed', topic: 'Fractions', subject: 'maths', language: 'en',
      meta: { ...META, step: 'failed', error: 'queue_failed' } };
    stub({ users: [{ id: TEACHER, phone_number: '923001112222', preferred_language: 'en' }], quizzes: [row], quiz_sessions: [], coaching_sessions: [] });
    const TOKEN = `${TEACHER}:transcript-quiz:1757100000000`;

    const lesson = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: `lp_${QUIZ_ID}` });
    expect(lesson.screen).toBe('LESSON');
    expect(lesson.data.actions.map((a) => a.id)).toEqual(['remake', 'done']);
    expect(lesson.data.results).toContain((UX_STRINGS.tqFlowResultsFailedLpStart || {}).en);

    SQS.queueJob.mockResolvedValue({ MessageId: 'm1' });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', session_id: `lp_${QUIZ_ID}`, quiz_id: QUIZ_ID, tq_action: 'remake',
    });
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    expect(out.screen).toBe('SUCCESS');
    expect(row.status).toBe('generating');
    expect(SQS.queueJob).toHaveBeenCalledWith(QUIZ_ID, 'quiz_generate', expect.objectContaining({ quizId: QUIZ_ID }), expect.anything());
  });
});
