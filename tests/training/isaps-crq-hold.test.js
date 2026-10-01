/**
 * bd-hxm7a — I-SAPS written answers are graded but HELD (operator, 2026-10-01).
 *
 * "We are not sure about our Grading Prompts right now. So we will grade the
 * CRQs but not show the results to the teacher yet, or issue them a
 * certificate. Instead ... we will show them that we are grading your CRQs and
 * this will take some time. Once passed, we will issue you a certificate."
 *
 * Decided the same day:
 *   - the CRQ is still graded against its own I-SAPS rubric and stored;
 *   - the teacher sees her MCQ result. MCQs under 3/4 → failed, retake now.
 *     MCQs cleared → the exam is PENDING REVIEW (neither passed nor failed);
 *   - no retake while pending; no certificate while held;
 *   - one switch releases: app_settings 'isaps_crq_results_released' = true.
 *     ABSENT, false or unreadable means HELD (fail closed).
 *   - what happens to a sub-6/10 CRQ after release is out of scope ("block").
 */
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => global.__fromImpl(...a), rpc: jest.fn().mockResolvedValue({ error: null }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const sent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, msg) => { sent.push(String(msg)); return true; }),
  sendInteractiveButtons: jest.fn(async (to, b) => { sent.push(JSON.stringify(b)); return true; }),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
}));
global.__fromImpl = () => { throw new Error('no DB in a pure test'); };

const HOLD = require('../../bot/shared/services/training/isaps-crq-hold.rules');

describe('the release switch', () => {
  test('absent, false, null or junk → held', () => {
    for (const v of [undefined, null, false, 'true', 0, {}, { released: false }]) {
      expect(HOLD.isReleasedValue(v)).toBe(false);
    }
  });
  test('only an explicit true releases', () => {
    expect(HOLD.isReleasedValue(true)).toBe(true);
    expect(HOLD.isReleasedValue({ released: true })).toBe(true);
  });
  test('the setting key is named, not a magic string', () => {
    expect(HOLD.CRQ_RELEASE_SETTING_KEY).toBe('isaps_crq_results_released');
  });
});

describe('heldModuleExamOutcome', () => {
  test('MCQs cleared → pending review (neither passed nor failed)', () => {
    expect(HOLD.heldModuleExamOutcome({ mcqCorrect: 3, mcqServed: 4 }))
      .toEqual({ status: 'pending_review', is_passed: null });
  });
  test('MCQs short → failed, whatever the written answer', () => {
    expect(HOLD.heldModuleExamOutcome({ mcqCorrect: 2, mcqServed: 4 }))
      .toEqual({ status: 'failed', is_passed: false });
  });
  test('Module 6 (2 served): both right → pending; one → failed', () => {
    expect(HOLD.heldModuleExamOutcome({ mcqCorrect: 2, mcqServed: 2 }).status).toBe('pending_review');
    expect(HOLD.heldModuleExamOutcome({ mcqCorrect: 1, mcqServed: 2 }).status).toBe('failed');
  });
});

describe('the exam slot while a written answer is being graded', () => {
  const { buildModuleExamSlot, shouldOfferModuleExam } = require('../../bot/shared/services/training/isaps-module-exam.rules');
  const base = { moduleTitle: 'Module 1', unitsTotal: 6, unitsDone: 6, mcqCount: 4, crqCount: 1 };
  test('pending → closed, says it is being graded, no mark', () => {
    const slot = buildModuleExamSlot({ ...base, pendingReview: true, bestScore: 21, bestTotal: 30, bestPct: 70 });
    expect(slot.ok).toBe(false);
    expect(slot.body).toMatch(/being graded/i);
    expect(JSON.stringify(slot)).not.toMatch(/21|\/30/);
  });
  test('pending → not offered again on WhatsApp', () => {
    expect(shouldOfferModuleExam({ vendorKey: 'ISAPS', ...base, pendingReview: true })).toBe(false);
  });
});

describe('the score sheet hides the written mark while held', () => {
  const { buildIsapsScoreSheet } = require('../../bot/shared/services/training/isaps-score-sheet.rules');
  const sheet = buildIsapsScoreSheet({
    courses: [{ id: 71, title: 'Module 1 - X', order_index: 1 }], units: [], exams: [{ id: 37, source_quiz_id: 901 }],
    crqMax: 10, crqHeld: true,
    examAttempts: [{ id: 'a1', grand_quiz_id: 37, is_passed: null, score: 21, total_questions: 5, status: 'pending_review' }],
    examAnswers: [0, 1, 2].map(i => ({ attempt_id: 'a1', question_index: i, is_correct: true }))
      .concat([{ attempt_id: 'a1', question_index: 3, is_correct: false }, { attempt_id: 'a1', question_index: 4, answer_score: 6 }]),
  });
  test('MCQs shown, written mark withheld, marked pending', () => {
    expect(sheet.modules[0].exam).toMatchObject({ pending: true, passed: false, mcq_correct: 3, mcq_earned: 15, crq_earned: null });
  });
});

// ── executed against a stubbed DB ────────────────────────────────────────────
let tableStates;
function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, mutation: null };
  const chain = {};
  const track = () => { if (record.mutation && !record._t) { (state._mutations = state._mutations || []).push(record.mutation); record._t = true; } };
  const rows = () => (typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  chain.select = jest.fn(() => chain);
  chain.insert = jest.fn(p => { record.mutation = { op: 'insert', payload: p }; return chain; });
  chain.update = jest.fn(p => { record.mutation = { op: 'update', payload: p }; return chain; });
  chain.upsert = jest.fn(p => { record.mutation = { op: 'upsert', payload: p }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach(m => { chain[m] = jest.fn((c, v) => { record.filters[c] = v; return chain; }); });
  chain.in = jest.fn((c, v) => { record.filters[c] = { in: v }; return chain; });
  ['filter', 'order', 'limit', 'range'].forEach(m => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(async () => { track(); return { data: rows()[0] || null, error: null }; });
  chain.maybeSingle = chain.single;
  chain.then = (res, rej) => { track(); return Promise.resolve({ data: rows(), error: null }).then(res, rej); };
  return chain;
}
function moduleExam({ mcq = [true, true, true, false], crq = 6, released = false } = {}) {
  tableStates = {
    app_settings: { rows: f => (released && f.key === 'isaps_crq_results_released' ? [{ key: f.key, value: true }] : []) },
    training_assessment_attempts: { rows: [{ id: 'att-1', user_id: 'u1', quiz_kind: 'grand', grand_quiz_id: 37, training_module_id: null,
      level_id: 27, program_id: 'p1', total_questions: mcq.length + 1, status: 'in_progress' }] },
    training_assessment_answers: { rows: [...mcq.map((c, i) => ({ question_index: i, is_correct: c, answer_score: null })),
      { question_index: mcq.length, is_correct: null, answer_score: crq }] },
    training_grand_quizzes: { rows: [{ id: 37, source_quiz_id: 901, level_id: 27, quiz_type: 'grand_quiz', is_active: true }] },
    training_levels: { rows: [{ id: 27, name: 'Level 1: Novice', vendor_id: 'v', order_index: 0 }] },
    training_vendors: { rows: [{ id: 'v', key: 'ISAPS', passing_pct: 60, module_passing_pct: 70, capstone_points_per_question: 10, cooldown_hours: 0, unlock_logic: 'all_modules' }] },
    training_courses: { rows: [{ id: 71, level_id: 27, title: 'Module 1 - X', order_index: 1 }] },
    training_modules: { rows: [] }, teacher_training_progress: { rows: [] }, training_certificates: { rows: [] },
    users: { rows: [{ id: 'u1', name: 'T' }] },
  };
}
const verdict = () => (tableStates.training_assessment_attempts._mutations || []).map(m => m.payload).find(p => p && 'is_passed' in p);

describe('gradeAttempt holds an I-SAPS module exam', () => {
  let QD;
  beforeEach(() => { jest.resetModules(); global.__fromImpl = t => makeChain(t); sent.length = 0; QD = require('../../bot/shared/services/training/quiz-delivery.service'); });

  test('held + MCQs cleared → pending_review, told it is being graded, no written mark said', async () => {
    moduleExam({ mcq: [true, true, true, false], crq: 9 });
    await QD.gradeAttempt('att-1', '923000000000');
    expect(verdict()).toMatchObject({ status: 'pending_review', is_passed: null, cooldown_until: null });
    const said = sent.join('\n');
    expect(said).toMatch(/being graded/i);
    expect(said).not.toMatch(/\b9\s*\/\s*10\b|\b24\s*\/\s*30\b|passed this module/i);
  });

  test('held + MCQs short → failed now, told to retake, written mark not said', async () => {
    moduleExam({ mcq: [true, false, false, false], crq: 10 });
    await QD.gradeAttempt('att-1', '923000000000');
    expect(verdict()).toMatchObject({ status: 'failed', is_passed: false });
    expect(sent.join('\n')).toMatch(/3 of 4/);
    expect(sent.join('\n')).not.toMatch(/10\s*\/\s*10/);
  });

  test('held: no certificate is attempted from a module exam', async () => {
    moduleExam({ mcq: [true, true, true, true], crq: 10 });
    await QD.gradeAttempt('att-1', '923000000000');
    const certReads = (tableStates.training_certificates._mutations || []).length;
    expect(verdict().status).toBe('pending_review');
    expect(certReads).toBe(0);
  });

  test('released → the split-bar verdict applies exactly as before', async () => {
    moduleExam({ mcq: [true, true, true, false], crq: 6, released: true });
    await QD.gradeAttempt('att-1', '923000000000');
    expect(verdict()).toMatchObject({ status: 'passed', is_passed: true, score: 21 });
  });
});

describe('the certificate guard refuses while held', () => {
  test('all nine exams passed, results held → no certificate', async () => {
    jest.resetModules();
    const EXAMS = Array.from({ length: 9 }, (_, i) => ({ id: 36 + i, level_id: 26, source_quiz_id: 901 + i, quiz_type: 'grand_quiz', is_active: true }));
    tableStates = {
      app_settings: { rows: [] },
      training_levels: { rows: [{ id: 26, name: 'Level 1: Novice', vendor_id: 7 }] },
      training_vendors: { rows: [{ id: 7, unlock_logic: 'all_modules' }] },
      training_grand_quizzes: { rows: f => EXAMS.filter(q => (f.quiz_type === undefined || q.quiz_type === f.quiz_type)
        && (f.is_active === undefined || q.is_active === f.is_active)) },
      training_assessment_attempts: { rows: EXAMS.map(e => ({ user_id: 'u1', grand_quiz_id: e.id, is_passed: true, quiz_kind: 'grand' })) },
      training_certificates: { rows: [] },
    };
    const touched = [];
    global.__fromImpl = t => { touched.push(t); return makeChain(t); };
    const { maybeIssueQuizScoreCertificate } = require('../../bot/shared/services/training/certificate.service');
    const out = await maybeIssueQuizScoreCertificate({ from: t => { touched.push(t); return makeChain(t); } },
      { userId: 'u1', levelId: 26, attemptId: 'a', programId: 'p' });
    expect(out.issued).toBe(false);
    // Reaching issuance = a SECOND read of training_certificates (issueCertificate's
    // own one-per-level check). The guard must stop before it.
    expect(touched.filter(t => t === 'training_certificates').length).toBeLessThanOrEqual(1);
  });
});

describe('WhatsApp does not say the written mark while held', () => {
  test('the CRQ acknowledgement carries no score or feedback', () => {
    const msg = HOLD.crqAnswerAck({ held: true, score: 7, max: 10, feedback: 'Good use of the rubric.' });
    expect(msg).toMatch(/being graded/i);
    expect(msg).not.toMatch(/7\s*\/\s*10|Good use/);
  });
  test('released → the score and feedback, as before', () => {
    const msg = HOLD.crqAnswerAck({ held: false, score: 7, max: 10, feedback: 'Good use of the rubric.' });
    expect(msg).toMatch(/7\/10/);
    expect(msg).toMatch(/Good use/);
  });
});
