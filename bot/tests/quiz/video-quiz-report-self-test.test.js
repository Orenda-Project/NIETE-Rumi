'use strict';
/**
 * PLAN_R5 §1 D8 — a teacher's own test run of her class link must never
 * appear in the class report: not in the roster, not in the average, not in
 * "which question the class found hardest", and it must not turn a "nobody
 * started" report into "1 of 1 finished".
 *
 * The stub actually APPLIES `.eq`/`.is`/`.in` as real filters over a fixture,
 * so a test here fails red if the source query is missing the filter — not
 * just if the JS-level exclusion is missing.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The PDF path is a nicety, not the report itself (per the source's own
// comment) — force it to fail so every assertion here reads the plain-text
// fallback, exactly like the existing report suite does implicitly
// by never exercising a `done.length > 0` fixture.
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
}));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const report = require('../../shared/services/quiz/video-quiz-report.service');

const SHARE_CODE_ID = 'sc-1';
const TEACHER_ID = 'u1';

/** A row-array chain that actually applies eq/is/in as filters, so a query
 *  missing a filter genuinely returns the unfiltered rows — the same trap a
 *  real Postgres query would fall into. */
function makeListChain(rows) {
  let data = [...(rows || [])];
  const chain = {
    select: () => chain,
    eq: (field, val) => { data = data.filter((r) => r[field] === val); return chain; },
    is: (field, val) => {
      data = data.filter((r) => (val === null ? (r[field] === null || r[field] === undefined) : r[field] === val));
      return chain;
    },
    in: (field, vals) => { data = data.filter((r) => vals.includes(r[field])); return chain; },
    order: () => chain,
    limit: () => chain,
    update: () => chain,
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return chain;
}

function stubSupabase(tables) {
  supabase.from.mockImplementation((table) => makeListChain(tables[table] || []));
}

const shareCode = {
  id: SHARE_CODE_ID, code: 'K7RM2', quiz_id: 'q1', teacher_user_id: TEACHER_ID,
  teacher_name: 'Miss Ayesha', topic: 'Who Is Outside', language: 'en',
  report_sent_at: null,
};
const teacher = { id: TEACHER_ID, phone_number: '923001234567', preferred_language: 'en' };

beforeEach(() => jest.clearAllMocks());

describe('PLAN_R5 D8 — generate() excludes the teacher self-test', () => {
  test('a report with ONE self-test and NO children takes the "nobody started" branch', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode],
      users: [teacher],
      quizzes: [{ id: 'q1', quiz_source: 'video', meta: {}, language: 'en' }],
      quiz_sessions: [{
        id: 'self-1', share_code_id: SHARE_CODE_ID, user_id: TEACHER_ID, student_name: null,
        status: 'completed', total_questions_answered: 10, correct_answers: 8, mastery_percentage: 80,
      }],
    });

    const sent = await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(sent).toBe(true);
    const bodies = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    // vqReportNoOne — the "nobody has started yet" copy, not a scored report.
    expect(bodies.some((b) => /no one|nobody|has not started|hasn.?t started/i.test(b))).toBe(true);
    expect(bodies.some((b) => /8\/10|80%/.test(b))).toBe(false);
  });

  test('a report with one self-test and two children names two children, average excludes her score', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode],
      users: [teacher],
      quizzes: [{ id: 'q1', quiz_source: 'video', meta: {}, language: 'en' }],
      quiz_sessions: [
        {
          id: 'self-1', share_code_id: SHARE_CODE_ID, user_id: TEACHER_ID, student_name: null,
          status: 'completed', total_questions_answered: 10, correct_answers: 1, mastery_percentage: 10,
        },
        {
          id: 'c1', share_code_id: SHARE_CODE_ID, user_id: null, student_name: 'Hooria',
          status: 'completed', total_questions_answered: 10, correct_answers: 9, mastery_percentage: 90,
        },
        {
          id: 'c2', share_code_id: SHARE_CODE_ID, user_id: null, student_name: 'Zainab',
          status: 'completed', total_questions_answered: 10, correct_answers: 7, mastery_percentage: 70,
        },
      ],
    });

    const sent = await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(sent).toBe(true);
    const bodies = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    // "2 of 2 finished" — her session must not inflate the denominator.
    expect(bodies.some((b) => /2 of 2/.test(b))).toBe(true);
    // Average of 90 and 70 is 80 — her 10% must not drag it down.
    expect(bodies.some((b) => /80%/.test(b))).toBe(true);
    expect(bodies.some((b) => /Hooria/.test(b))).toBe(true);
    expect(bodies.some((b) => /Zainab/.test(b))).toBe(true);
  });

  test('logs video_quiz.self_test_excluded with the count when a self-test is present', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode],
      users: [teacher],
      quizzes: [{ id: 'q1', quiz_source: 'video', meta: {}, language: 'en' }],
      quiz_sessions: [
        {
          id: 'self-1', share_code_id: SHARE_CODE_ID, user_id: TEACHER_ID, student_name: null,
          status: 'completed', total_questions_answered: 10, correct_answers: 8, mastery_percentage: 80,
        },
        {
          id: 'c1', share_code_id: SHARE_CODE_ID, user_id: null, student_name: 'Hooria',
          status: 'completed', total_questions_answered: 10, correct_answers: 9, mastery_percentage: 90,
        },
      ],
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(logEvent).toHaveBeenCalledWith('video_quiz.self_test_excluded',
      expect.objectContaining({ shareCodeId: SHARE_CODE_ID, n: 1 }));
  });
});

describe('PLAN_R5 D8 — maybeSendEarly() ignores the self-test session', () => {
  test('the ONLY session being an old, terminal self-test does not trigger an early send', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode],
      users: [teacher],
      quizzes: [{ id: 'q1', quiz_source: 'video', meta: {}, language: 'en' }],
      // Terminal + old enough that, unfiltered, shouldSendEarly would fire.
      // With `.is('user_id', null)` applied this row is excluded, leaving an
      // empty list — shouldSendEarly treats that as "nothing to report yet".
      quiz_sessions: [{
        id: 'self-1', share_code_id: SHARE_CODE_ID, user_id: TEACHER_ID,
        status: 'completed', created_at: '2020-01-01T00:00:00Z',
      }],
    });

    const sent = await report.maybeSendEarly(SHARE_CODE_ID);
    expect(sent).toBe(false);
  });
});

describe('PLAN_R5 D8 — hardestQuestions() ignores the self-test session', () => {
  test('her own wrong practice answer does not inflate the class wrong-count', async () => {
    stubSupabase({
      // Only the sessions that survive `.is('user_id', null)` decide which
      // session ids reach the answers query.
      quiz_sessions: [
        { id: 'self-1', share_code_id: SHARE_CODE_ID, user_id: TEACHER_ID },
        { id: 'c1', share_code_id: SHARE_CODE_ID, user_id: null },
        { id: 'c2', share_code_id: SHARE_CODE_ID, user_id: null },
      ],
      // She also got this question wrong on her practice run. Unfiltered,
      // that would make total=3/wrong=3; filtered, total=2/wrong=2.
      quiz_answers: [
        { session_id: 'self-1', question_id: 'qq1', is_correct: false, selected_option: 'C' },
        { session_id: 'c1', question_id: 'qq1', is_correct: false, selected_option: 'B' },
        { session_id: 'c2', question_id: 'qq1', is_correct: false, selected_option: 'B' },
      ],
      quiz_questions: [{
        id: 'qq1', external_id: 'leg:1', question_text: 'Which one?',
        option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D',
        correct_option: 'A', option_feedback: {}, explanation: null,
      }],
    });

    const hardest = await report.hardestQuestions(SHARE_CODE_ID);
    const q1 = hardest.find((h) => h.question_text === 'Which one?');
    expect(q1).toBeDefined();
    // Proves the self-test's answer never reached the tally.
    expect(q1.total).toBe(2);
    expect(q1.wrong).toBe(2);
  });
});
