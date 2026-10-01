/**
 * bd-2exhl — an I-SAPS module exam has a STATUS the teacher can see, and a
 * record of what she submitted (operator, 2026-10-01).
 *
 * "I submitted on portal an exam and it worked, successfully asked me to wait,
 * but when I went to a diff page and came back to it, i could attempt the exam
 * again ... If it is in_review ... we keep showing them ... the answers they
 * submitted as a review ... and let them know about the wait. If it is graded
 * and failed, it should say attempt again. If it is passed, they cannot take
 * it again, but they can review the questions and answers they submitted."
 *
 * Two defects behind it:
 *   1. the portal submit left the attempt `in_progress` until the background
 *      CRQ grader finished, so returning in that window reopened — and could
 *      resubmit — the same paper;
 *   2. nothing told the teacher what had happened to a submitted paper.
 *
 * The MCQ half is marked at submit, so the verdict the teacher can be told
 * (failed / pending review) is known THEN, not when the grader replies.
 */
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => global.__fromImpl(...a), rpc: jest.fn().mockResolvedValue({ error: null }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/training/capstone-delivery.service', () => ({
  scoreAnswer: jest.fn(() => new Promise(() => {})), // never replies: the background grader is not under test
}));
global.__fromImpl = () => { throw new Error('no DB'); };

let tableStates;
function matches(row, filters) {
  return Object.entries(filters).every(([c, v]) => {
    if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.map(String).includes(String(row[c]));
    if (c.includes('.') || !(c in row)) return true;
    return String(row[c]) === String(v);
  });
}
function makeChain(tableName) {
  const state = tableStates[tableName] || (tableStates[tableName] = { rows: [] });
  const record = { filters: {}, mutation: null };
  const chain = {};
  const apply = () => {
    if (record.mutation && !record.done) {
      record.done = true;
      (state.mutations = state.mutations || []).push({ ...record.mutation, filters: { ...record.filters } });
      if (record.mutation.op === 'update') {
        for (const r of state.rows) if (matches(r, record.filters)) Object.assign(r, record.mutation.payload);
      }
    }
  };
  const rows = () => state.rows.filter(r => matches(r, record.filters));
  chain.select = jest.fn(() => chain);
  chain.insert = jest.fn(p => { record.mutation = { op: 'insert', payload: p }; return chain; });
  chain.update = jest.fn(p => { record.mutation = { op: 'update', payload: p }; return chain; });
  chain.upsert = jest.fn(p => { record.mutation = { op: 'upsert', payload: p }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach(m => {
    chain[m] = jest.fn((c, v) => { if (m === 'eq') record.filters[c] = v; return chain; });
  });
  chain.in = jest.fn((c, v) => { record.filters[c] = { in: v }; return chain; });
  ['filter', 'order', 'limit', 'range'].forEach(m => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(async () => { apply(); return { data: rows()[0] || null, error: null }; });
  chain.maybeSingle = chain.single;
  chain.then = (res, rej) => { apply(); return Promise.resolve({ data: rows(), error: null }).then(res, rej); };
  return chain;
}

const Q = [
  { id: 101, question_text: 'MCQ one?', options: ['a', 'b', 'c'], correct_option: '1' },
  { id: 102, question_text: 'MCQ two?', options: ['a', 'b', 'c'], correct_option: '2' },
  { id: 103, question_text: 'MCQ three?', options: ['a', 'b', 'c'], correct_option: '0' },
  { id: 104, question_text: 'MCQ four?', options: ['a', 'b', 'c'], correct_option: '1' },
  { id: 105, question_text: 'Explain the taxonomy.', options: [], correct_option: '' },
];
function seed({ status = 'in_progress', released = false, extraAttempts = [], answers = [] } = {}) {
  tableStates = {
    app_settings: { rows: released ? [{ key: 'isaps_crq_results_released', value: true }] : [] },
    training_assessment_attempts: { rows: [{ id: 'att-1', user_id: 'u1', level_id: 27, program_id: 'p1', grand_quiz_id: 37,
      quiz_kind: 'grand', total_questions: 5, status, started_at: '2026-10-01T10:00:00Z' }, ...extraAttempts] },
    training_assessment_answers: { rows: answers },
    training_questions: { rows: Q.map(q => ({ ...q, grand_quiz_id: q.id === 105 ? 36 : 37, is_active: true })) },
    training_grand_quizzes: { rows: [
      { id: 37, source_quiz_id: 901, level_id: 27, quiz_type: 'grand_quiz', is_active: true },
      { id: 36, source_quiz_id: 901, level_id: 27, quiz_type: 'capstone', is_active: true }] },
    training_courses: { rows: [{ id: 67, level_id: 27, title: 'Module 1 - Philosophical Foundations' }] },
    training_levels: { rows: [{ id: 27, vendor_id: 'v' }] },
    training_vendors: { rows: [{ id: 'v', capstone_points_per_question: 10 }] },
  };
}
const paper = picks => [
  ...picks.map((p, i) => ({ question_id: 101 + i, chosen_option: p })),
  { question_id: 105, answer_text: 'My written answer' },
];
const attemptRow = () => tableStates.training_assessment_attempts.rows.find(r => r.id === 'att-1');

let QD;
afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  jest.resetModules();
  global.__fromImpl = t => makeChain(t);
  // The background grader is not under test; do not let it outlive the test.
  jest.spyOn(global, 'setImmediate').mockImplementation(() => 0);
  QD = require('../../bot/shared/services/training/quiz-delivery.service');
});

describe('submitting the paper leaves in_progress at once', () => {
  test('MCQs short (2/4) → failed immediately, and the response says so', async () => {
    seed();
    const out = await QD.submitModuleExamPaper({ userId: 'u1', attemptId: 'att-1', answers: paper(['1', '2', '2', '2']) });
    expect(attemptRow()).toMatchObject({ status: 'failed', is_passed: false });
    expect(out).toMatchObject({ crq_pending: true, outcome: 'failed', mcq_correct: 2, mcq_served: 4 });
  });

  test('MCQs cleared (3/4) → pending_review immediately, before the grader replies', async () => {
    seed();
    const out = await QD.submitModuleExamPaper({ userId: 'u1', attemptId: 'att-1', answers: paper(['1', '2', '0', '0']) });
    expect(attemptRow()).toMatchObject({ status: 'pending_review', is_passed: null });
    expect(out).toMatchObject({ crq_pending: true, outcome: 'pending_review', mcq_correct: 3, mcq_served: 4 });
  });

  test('a paper that is no longer in progress cannot be submitted again', async () => {
    seed({ status: 'pending_review' });
    const out = await QD.submitModuleExamPaper({ userId: 'u1', attemptId: 'att-1', answers: paper(['1', '2', '0', '1']) });
    expect(out).toMatchObject({ already_submitted: true, outcome: 'pending_review' });
    expect(tableStates.training_assessment_answers.mutations || []).toHaveLength(0);
    expect(tableStates.training_assessment_attempts.mutations || []).toHaveLength(0);
  });
});

describe('moduleExamAttempts — what she submitted, for review', () => {
  const submitted = (attempt, picks, crqScore = 4) => [
    ...picks.map((p, i) => ({ attempt_id: attempt, question_index: i, question_id: 101 + i, chosen_option: p,
      is_correct: String(p) === Q[i].correct_option, answer_text: null, answer_score: null, feedback_text: null })),
    { attempt_id: attempt, question_index: 4, question_id: 105, chosen_option: null, is_correct: null,
      answer_text: 'My written answer', answer_score: crqScore, feedback_text: 'Grader feedback' },
  ];
  const older = { id: 'att-0', user_id: 'u1', level_id: 27, grand_quiz_id: 37, quiz_kind: 'grand', total_questions: 5,
    status: 'failed', is_passed: false, started_at: '2026-10-01T09:00:00Z', completed_at: '2026-10-01T09:05:00Z' };
  const open = { id: 'att-2', user_id: 'u1', level_id: 27, grand_quiz_id: 37, quiz_kind: 'grand', total_questions: 5,
    status: 'in_progress', started_at: '2026-10-01T11:00:00Z' };
  const gone = { ...open, id: 'att-3', status: 'abandoned' };

  test('submitted attempts only, newest first, with her answers and the MCQ tally', async () => {
    seed({ status: 'pending_review', extraAttempts: [older, open, gone],
      answers: [...submitted('att-1', ['1', '2', '0', '0']), ...submitted('att-0', ['0', '0', '0', '1'])] });
    attemptRow().completed_at = '2026-10-01T10:05:00Z';
    const out = await QD.moduleExamAttempts({ userId: 'u1', courseId: 67 });
    expect(out.attempts.map(a => [a.id, a.status])).toEqual([['att-1', 'pending_review'], ['att-0', 'failed']]);
    const a = out.attempts[0];
    expect(a).toMatchObject({ mcq_correct: 3, mcq_served: 4, mcq_needed: 3 });
    expect(a.answers.map(x => x.question_text)).toEqual(['MCQ one?', 'MCQ two?', 'MCQ three?', 'MCQ four?', 'Explain the taxonomy.']);
    expect(a.answers[0]).toMatchObject({ is_open_ended: false, chosen_option: '1', options: ['a', 'b', 'c'] });
    expect(a.answers[4]).toMatchObject({ is_open_ended: true, answer_text: 'My written answer' });
  });

  test('while results are held: no answer key, no per-question right/wrong, no written mark or feedback', async () => {
    seed({ status: 'pending_review', answers: submitted('att-1', ['1', '2', '0', '0'], 7) });
    const out = await QD.moduleExamAttempts({ userId: 'u1', courseId: 67 });
    const s = JSON.stringify(out);
    expect(s).not.toMatch(/correct_option|is_correct|Grader feedback/);
    expect(out.attempts[0].crq).toEqual({ held: true, score: null, max: 10, feedback: null });
  });

  test('once released, the written mark and feedback are part of the review', async () => {
    seed({ status: 'passed', released: true, answers: submitted('att-1', ['1', '2', '0', '1'], 7) });
    const out = await QD.moduleExamAttempts({ userId: 'u1', courseId: 67 });
    expect(out.attempts[0].crq).toEqual({ held: false, score: 7, max: 10, feedback: 'Grader feedback' });
  });

  test('another teacher\'s attempts are never returned', async () => {
    seed({ status: 'failed', extraAttempts: [{ ...older, id: 'x', user_id: 'u2' }], answers: [] });
    const out = await QD.moduleExamAttempts({ userId: 'u1', courseId: 67 });
    expect(out.attempts.map(a => a.id)).toEqual(['att-1']);
  });
});
