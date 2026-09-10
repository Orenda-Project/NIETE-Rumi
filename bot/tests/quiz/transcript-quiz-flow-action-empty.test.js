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

    const out = await exchange({ step: 'action', session_id: 's-1', tq_action: '' });

    // The teacher asked for the only thing this lesson offers; give it to them.
    expect(out.screen).toBe('SUCCESS'); // a make closes the Flow from the endpoint
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action',
      expect.objectContaining({ action: expect.stringMatching(/^make_/) }));
  });

  test('with several actions available, Continue refuses — and says so out loud', async () => {
    const many = { ...urduSession(), analysis_data: { topic: 'Photosynthesis', subject: 'science' } };
    stub({ users, coaching_sessions: [many], quizzes: [], quiz_sessions: [] });

    const out = await exchange({ step: 'action', session_id: 's-1', tq_action: '' });

    expect(out.screen).toBe('LESSON');
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action_refused',
      expect.objectContaining({ reason: 'no_action_picked' }));
  });
});

// ---------------------------------------------------------------------------
describe('defect 1 — no early return may be silent', () => {
  test('a lesson that is not the teacher’s own is refused WITH a logged reason', async () => {
    stub({ users, coaching_sessions: [urduSession()], quizzes: [], quiz_sessions: [] });

    await exchange({ step: 'action', session_id: 'not-mine', tq_action: 'make_ur' });

    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action_refused',
      expect.objectContaining({ reason: 'lesson_not_found' }));
  });

  test('an action the lesson does not offer is refused WITH a logged reason', async () => {
    stub({ users, coaching_sessions: [urduSession()], quizzes: [], quiz_sessions: [] });

    // 'report' needs a sent quiz with a share code; this lesson has no quiz.
    await exchange({ step: 'action', session_id: 's-1', tq_action: 'report' });

    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action_refused',
      expect.objectContaining({ reason: 'action_unavailable', action: 'report' }));
  });
});

// ---------------------------------------------------------------------------
describe('an action id has to survive the round trip', () => {
  test('every id a lesson offers is plain [A-Za-z0-9_] — a colon does not come back', async () => {
    stub({ users, coaching_sessions: [urduSession()], quizzes: [], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizDataExchange(
      TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    for (const a of out.data.actions) expect(a.id).toMatch(/^[A-Za-z0-9_]+$/);
  });
});

// ---------------------------------------------------------------------------
// Three theories about this bug have now been wrong, every one of them argued
// from what the client OUGHT to send rather than from what it does. Nothing in
// this endpoint has ever recorded the shape of an arriving payload, so the one
// question that settles it — does `action` arrive absent, empty, or under some
// other key? — has never been answerable from the logs. It is now.
describe('the arriving payload is recorded, so the next refusal is diagnosable', () => {
  test('a data exchange records the keys it arrived with and the action length', async () => {
    stub({ users, coaching_sessions: [urduSession()], quizzes: [], quiz_sessions: [] });

    await exchange({ step: 'action', session_id: 's-1', tq_action: '' });

    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_payload',
      expect.objectContaining({ step: 'action', keys: 'session_id,step,tq_action', actionLen: 0 }));
  });

  test('an action that DID arrive is recorded with its value and length', async () => {
    stub({ users, coaching_sessions: [urduSession()], quizzes: [], quiz_sessions: [] });

    await exchange({ step: 'action', session_id: 's-1', tq_action: 'make_ur' });

    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_payload',
      expect.objectContaining({ action: 'make_ur', actionLen: 7 }));
  });

  test('a payload whose action key is missing entirely is distinguishable from an empty one', async () => {
    stub({ users, coaching_sessions: [urduSession()], quizzes: [], quiz_sessions: [] });

    await exchange({ step: 'action', session_id: 's-1' });

    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_payload',
      expect.objectContaining({ keys: 'session_id,step', actionLen: 0 }));
  });
});

// The client drops a payload key named `action` (it is the request's own
// top-level field), so the chooser ships as `tq_action`. The endpoint reads
// that key; the old name is not read, because it never arrived once.
describe('the choice arrives as tq_action', () => {
  test('a submit carrying tq_action performs it', async () => {
    const many = { ...urduSession(), analysis_data: { topic: 'Photosynthesis', subject: 'science' } };
    stub({ users, coaching_sessions: [many], quizzes: [], quiz_sessions: [] });

    const out = await exchange({ step: 'action', session_id: 's-1', tq_action: 'make_en' });

    expect(out.screen).toBe('SUCCESS'); // a make closes the Flow from the endpoint
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action',
      expect.objectContaining({ action: 'make_en' }));
  });
});

// A terminal screen's Done tap completes with an EMPTY payload today, and the
// detector's attendance rule swallows any payload that is only a flow_token: the
// operator's Done tap on 10 Sep was logged as flowType=attendance_marking. The
// DONE screen therefore carries its kind, and the Footer ships it as tq_action.
describe('the DONE screen carries what it is closing', () => {
  test('a lesson with nothing to tap closes on DONE with kind=wait', async () => {
    const making = { id: 'q-1', teacher_id: TEACHER, coaching_session_id: 's-1', status: 'generating', quiz_source: 'transcript', meta: {} };
    stub({ users, coaching_sessions: [urduSession()], quizzes: [making], quiz_sessions: [] });

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });

    expect(out.screen).toBe('DONE');
    expect(out.data.kind).toBe('wait');
  });
});
