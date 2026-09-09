'use strict';
/**
 * The /quiz Flow was dead in production from go-live to 9 Sep: 187 action
 * submits, 0 completed, 25 teachers, 183 of the submits inside a retry burst.
 *
 * Two defects, and the second is why the first stayed hidden for four days:
 *
 *   1. `${form.tq_action}` arrives EMPTY, so stepAction falls into refuse().
 *      Proven on prod by elimination — loadLesson was not the failing gate (the
 *      screen never changed between retries) and the id could not be unknown
 *      (every id is minted server-side by actionsFor from the same inputs), so
 *      the only gate left is the empty-action check.
 *   2. Neither LESSON nor LESSONS declares `error_message`, but both error
 *      paths return it, so the client discards it and the screen re-renders
 *      unchanged. Declaring it is NOT fixed here — the first attempt to do so
 *      broke rendering on a real handset for reasons that survived every check
 *      available offline, so it was pulled back out (bd-on4t9). What IS fixed
 *      is that a refusal now emits an event with its reason, which is what
 *      makes the path diagnosable at all.
 *
 * These tests drive the real handler, so they fail for the real reason.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/transcript-quiz-handoff.service', () => ({
  sendHandoff: jest.fn().mockResolvedValue({ ok: true, reused: true, pdfSent: true }),
}));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({
  generate: jest.fn().mockResolvedValue(true),
}));

const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const endpoint = require('../../shared/routes/transcript-quiz-flow-endpoint');

const TEACHER = 'teacher-1';
const TOKEN = `${TEACHER}:transcript-quiz:1757100000000`;
const LONG_TRANSCRIPT = 'x'.repeat(4000);

/** A chain that really filters, so a missing .eq fails here and not at runtime. */
function makeChain(rows, writes) {
  let data = [...(rows || [])];
  const chain = {
    select: () => chain,
    eq: (f, v) => { data = data.filter((r) => r[f] === v); return chain; },
    neq: (f, v) => { data = data.filter((r) => r[f] !== v); return chain; },
    is: (f, v) => {
      data = data.filter((r) => (v === null ? (r[f] === null || r[f] === undefined) : r[f] === v));
      return chain;
    },
    in: (f, vs) => { data = data.filter((r) => vs.includes(r[f])); return chain; },
    order: () => chain,
    range: (from, to) => { data = data.slice(from, to + 1); return chain; },
    limit: (n) => { data = data.slice(0, n); return chain; },
    update: (patch) => { writes.push({ op: 'update', patch }); return chain; },
    insert: (row) => { writes.push({ op: 'insert', row }); data = [{ id: 'new-quiz', ...row }]; return chain; },
    single: async () => ({ data: data[0] || null, error: null }),
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return chain;
}

let writes;
function stub(tables) {
  writes = [];
  supabase.from.mockImplementation((t) => makeChain(tables[t] || [], writes));
}

const users = [{ id: TEACHER, phone_number: '923001112222', preferred_language: 'en' }];

/** Urdu is one of the two subjects with no language choice, so the lesson
 *  screen offers EXACTLY ONE action — the case a bare Continue must handle. */
function urduSession() {
  return {
    id: 's-1',
    user_id: TEACHER,
    status: 'completed',
    observation_type: null,
    created_at: new Date(Date.UTC(2026, 8, 8, 6, 0, 0)).toISOString(),
    transcript_text: LONG_TRANSCRIPT,
    analysis_data: { topic: 'Mutaradif alfaaz', subject: 'urdu' },
  };
}

const exchange = (screenData) =>
  endpoint.handleTranscriptQuizDataExchange(TOKEN, screenData.step === 'action' ? 'LESSON' : 'LESSONS', screenData);

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
describe('defect 1 — a bare Continue must not be a silent no-op', () => {
  test('with exactly one action available, Continue performs it', async () => {
    stub({ users, coaching_sessions: [urduSession()], quizzes: [], quiz_sessions: [] });

    const out = await exchange({ step: 'action', session_id: 's-1', action: '' });

    // The teacher asked for the only thing this lesson offers; give it to them.
    expect(out.screen).toBe('DONE');
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action',
      expect.objectContaining({ action: expect.stringMatching(/^make:/) }));
  });

  test('with several actions available, Continue refuses — and says so out loud', async () => {
    const many = { ...urduSession(), analysis_data: { topic: 'Photosynthesis', subject: 'science' } };
    stub({ users, coaching_sessions: [many], quizzes: [], quiz_sessions: [] });

    const out = await exchange({ step: 'action', session_id: 's-1', action: '' });

    expect(out.screen).toBe('LESSON');
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action_refused',
      expect.objectContaining({ reason: 'no_action_picked' }));
  });
});

// ---------------------------------------------------------------------------
describe('defect 1 — no early return may be silent', () => {
  test('a lesson that is not the teacher’s own is refused WITH a logged reason', async () => {
    stub({ users, coaching_sessions: [urduSession()], quizzes: [], quiz_sessions: [] });

    await exchange({ step: 'action', session_id: 'not-mine', action: 'make:ur' });

    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action_refused',
      expect.objectContaining({ reason: 'lesson_not_found' }));
  });

  test('an action the lesson does not offer is refused WITH a logged reason', async () => {
    stub({ users, coaching_sessions: [urduSession()], quizzes: [], quiz_sessions: [] });

    // 'report' needs a sent quiz with a share code; this lesson has no quiz.
    await exchange({ step: 'action', session_id: 's-1', action: 'report' });

    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action_refused',
      expect.objectContaining({ reason: 'action_unavailable', action: 'report' }));
  });
});
