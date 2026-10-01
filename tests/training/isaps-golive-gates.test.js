/**
 * I-SAPS go-live (bd-vej4h) — gates come back, inside a module.
 *
 * I-SAPS, Sept 2026 ("With regard to assessment administration"), confirmed by
 * the operator 2026-10-01:
 *   - Modules are OPEN: a teacher picks any of the nine.
 *   - Inside a module, units open in order; the next unit opens only when the
 *     previous unit's formative quiz reaches 70%.
 *   - The module exam opens once that module's units are passed.
 *   - Exam = 4 random MCQs (5 marks each) + 1 random CRQ (10 marks).
 *     Pass = at least 3 of 4 MCQs (75% of the MCQs served) AND at least 60% on
 *     the CRQ. Module 6's bank holds only 2 MCQs: serve both, need both (75%
 *     of what was served), until I-SAPS add more.
 *   - No cooldown after a failed attempt. Retakes draw at random again.
 *   - Certificates ship WITHOUT the pilot watermark.
 *
 * Other vendors (NIETE, Oxbridge, Beacon House) must not move.
 */

jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => global.__fromImpl(...a), rpc: jest.fn().mockResolvedValue({ error: null }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
}));
global.__fromImpl = () => { throw new Error('no DB in a pure test'); };

// ── Pure rules ───────────────────────────────────────────────────────────────

describe('unit order: chain_per_course', () => {
  const { annotateModuleLocks } = require('../../bot/shared/routes/teacher-training-endpoint');
  const rows = [
    { id: 1, title: 'U101', course_title: 'Module 1', done: true },
    { id: 2, title: 'U102', course_title: 'Module 1', done: false },
    { id: 3, title: 'U103', course_title: 'Module 1', done: false },
    { id: 4, title: 'U201', course_title: 'Module 2', done: false },
    { id: 5, title: 'U202', course_title: 'Module 2', done: false },
  ];

  test('each module has its own next-up unit; modules do not wait for each other', () => {
    const out = annotateModuleLocks(rows, 'chain_per_course');
    expect(out.map(r => r.lock)).toEqual(['passed', 'next', 'locked', 'next', 'locked']);
  });

  test("'chain' still sequences the whole level (NIETE / Oxbridge / Beacon House unchanged)", () => {
    const out = annotateModuleLocks(rows, 'chain');
    expect(out.map(r => r.lock)).toEqual(['passed', 'next', 'locked', 'locked', 'locked']);
  });

  test('an unknown value still fails closed to whole-level sequencing', () => {
    const out = annotateModuleLocks(rows, 'chain_per_coarse');
    expect(out.map(r => r.lock)).toEqual(['passed', 'next', 'locked', 'locked', 'locked']);
  });
});

describe('module exam waits for the module\'s units', () => {
  const { buildModuleExamSlot, shouldOfferModuleExam } =
    require('../../bot/shared/services/training/isaps-module-exam.rules');

  test('units unfinished → the exam is closed, and says why', () => {
    const slot = buildModuleExamSlot({ moduleTitle: 'Module 1', unitsTotal: 6, unitsDone: 4, mcqCount: 4, crqCount: 1 });
    expect(slot.ok).toBe(false);
    expect(slot.body).toMatch(/2 more session/i);
  });

  test('every unit passed → the exam opens', () => {
    const slot = buildModuleExamSlot({ moduleTitle: 'Module 1', unitsTotal: 6, unitsDone: 6, mcqCount: 4, crqCount: 1 });
    expect(slot.ok).toBe(true);
  });

  test('the exam is offered only after the last unit, not after every unit', () => {
    const base = { vendorKey: 'ISAPS', unitsTotal: 6, mcqCount: 4, crqCount: 1 };
    expect(shouldOfferModuleExam({ ...base, unitsDone: 3 })).toBe(false);
    expect(shouldOfferModuleExam({ ...base, unitsDone: 6 })).toBe(true);
  });
});

describe('the paper: 4 MCQs × 5 marks + 1 CRQ × 10', () => {
  const P = require('../../bot/shared/services/training/isaps-crq-paper.rules');
  const bank = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, options: ['a', 'b'], correct_option: '1' }));

  test('four MCQs are drawn from a large bank', () => {
    expect(P.MODULE_EXAM_MCQ_COUNT).toBe(4);
    expect(P.pickMcqs(bank(12), 'attempt-1')).toHaveLength(4);
  });

  test('a bank of two (Module 6) serves both', () => {
    expect(P.pickMcqs(bank(2), 'attempt-1')).toHaveLength(2);
  });

  test('MCQs are worth 5 each and the CRQ its 10', () => {
    const answers = [
      { question_index: 0, is_correct: true }, { question_index: 1, is_correct: true },
      { question_index: 2, is_correct: false }, { question_index: 3, is_correct: true },
      { question_index: 4, answer_score: 7 },
    ];
    const s = P.scoreMixedPaper({ answers, mcqCount: 4, crqMaxPoints: 10 });
    expect(s).toMatchObject({ earned: 22, possible: 30, mcqCorrect: 3, crqEarned: 7 });
  });

  test('marks for a served paper of n questions (n-1 MCQs + 1 CRQ)', () => {
    expect(P.isapsPaperMarks(5, 10)).toBe(30);
    expect(P.isapsPaperMarks(3, 10)).toBe(20);
  });
});

describe('the pass rule: MCQs ≥ 75% of those served AND CRQ ≥ 60%', () => {
  const { decideIsapsModuleExamPass: pass } = require('../../bot/shared/services/training/isaps-crq-paper.rules');

  test.each([
    // mcqCorrect, mcqServed, crqEarned, crqMax, expected
    [3, 4, 6, 10, true],    // the bar exactly
    [4, 4, 10, 10, true],
    [2, 4, 10, 10, false],  // perfect CRQ cannot rescue weak MCQs
    [4, 4, 5, 10, false],   // perfect MCQs cannot rescue a weak CRQ
    [2, 2, 6, 10, true],    // Module 6: both of two
    [1, 2, 10, 10, false],  // Module 6: one of two is 50%
  ])('%i/%i MCQ, CRQ %i/%i → %s', (mc, ms, ce, cm, expected) => {
    expect(pass({ mcqCorrect: mc, mcqServed: ms, crqEarned: ce, crqMax: cm })).toBe(expected);
  });

  test('a CRQ that is not marked yet is not a pass', () => {
    expect(pass({ mcqCorrect: 4, mcqServed: 4, crqEarned: null, crqMax: 10 })).toBe(false);
  });
});

describe('cooldown follows the vendor row', () => {
  const { cooldownUntilFor } = require('../../bot/shared/services/training/quiz-delivery.service');
  test('0 hours → no cooldown', () => expect(cooldownUntilFor(0, Date.UTC(2026, 9, 1))).toBeNull());
  test('24 hours → a day later', () => {
    expect(cooldownUntilFor(24, Date.UTC(2026, 9, 1))).toBe(new Date(Date.UTC(2026, 9, 2)).toISOString());
  });
  test('unreadable → 24 hours (fail closed, as before)', () => {
    expect(cooldownUntilFor(undefined, Date.UTC(2026, 9, 1))).toBe(new Date(Date.UTC(2026, 9, 2)).toISOString());
  });
});

describe('certificates ship without the pilot watermark', () => {
  const { shouldStampTestBanner, PILOT_WATERMARK_VENDORS } =
    require('../../bot/shared/services/training/certificate-env.rules');
  test('an I-SAPS certificate in production is clean', () => {
    expect(shouldStampTestBanner('production', 'ISAPS')).toBe(false);
  });
  test('the pilot list is empty', () => expect([...PILOT_WATERMARK_VENDORS]).toEqual([]));
  test('sandbox and staging certificates are still stamped', () => {
    expect(shouldStampTestBanner('sandbox', 'ISAPS')).toBe(true);
    expect(shouldStampTestBanner('staging', 'ISAPS')).toBe(true);
  });
});

// ── gradeAttempt, executed against a stubbed DB ──────────────────────────────

let QuizDelivery;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, mutation: null };
  const chain = {};
  const track = () => {
    if (record.mutation && !record._t) { (state._mutations = state._mutations || []).push(record.mutation); record._t = true; }
  };
  const rows = () => (typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  chain.select = jest.fn(() => chain);
  chain.insert = jest.fn(p => { record.mutation = { op: 'insert', payload: p }; return chain; });
  chain.update = jest.fn(p => { record.mutation = { op: 'update', payload: p }; return chain; });
  chain.upsert = jest.fn(p => { record.mutation = { op: 'upsert', payload: p }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach(m => {
    chain[m] = jest.fn((c, v) => { record.filters[c] = v; return chain; });
  });
  chain.in = jest.fn((c, v) => { record.filters[c] = { in: v }; return chain; });
  ['filter', 'order', 'limit', 'range'].forEach(m => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(async () => { track(); return { data: rows()[0] || null, error: null }; });
  chain.maybeSingle = chain.single;
  chain.then = (res, rej) => { track(); return Promise.resolve({ data: rows(), error: null }).then(res, rej); };
  return chain;
}

function loadGrader() {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn(t => makeChain(t)), rpc: jest.fn().mockResolvedValue({ error: null }) }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({ getPresignedUrl: jest.fn().mockResolvedValue('https://x') }));
  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
}

function moduleExam({ mcq = [true, true, true, false], crq = 6, cooldownHours = 0 } = {}) {
  tableStates = {
    training_assessment_attempts: { rows: [{
      id: 'att-1', user_id: 'u1', quiz_kind: 'grand', grand_quiz_id: 37, training_module_id: null,
      level_id: 27, program_id: 'p1', total_questions: mcq.length + 1, status: 'in_progress',
    }] },
    training_assessment_answers: { rows: [
      ...mcq.map((c, i) => ({ question_index: i, is_correct: c, answer_score: null })),
      { question_index: mcq.length, is_correct: null, answer_score: crq },
    ] },
    training_grand_quizzes: { rows: [{ id: 37, source_quiz_id: 905, level_id: 27, quiz_type: 'grand_quiz', is_active: true }] },
    training_levels: { rows: [{ id: 27, name: 'Level 1: Novice', vendor_id: 'v-isaps', order_index: 0 }] },
    training_vendors: { rows: [{ id: 'v-isaps', key: 'ISAPS', name: 'I-SAPS', passing_pct: 60, module_passing_pct: 70,
      capstone_points_per_question: 10, cooldown_hours: cooldownHours, unlock_logic: 'all_modules' }] },
    training_courses: { rows: [{ id: 71, level_id: 27, title: 'Module 5 - Assessment and Data Use', order_index: 5 }] },
    training_modules: { rows: [] }, teacher_training_progress: { rows: [] }, training_certificates: { rows: [] },
    users: { rows: [{ id: 'u1', name: 'T' }] },
  };
}
const verdict = () => (tableStates.training_assessment_attempts._mutations || [])
  .map(m => m.payload).find(p => p && 'is_passed' in p);

describe('gradeAttempt applies the split bars to an I-SAPS module exam', () => {
  beforeEach(loadGrader);

  test('3/4 MCQ + 6/10 CRQ passes, scored in marks (15 + 6 = 21 of 30)', async () => {
    moduleExam({ mcq: [true, true, true, false], crq: 6 });
    await QuizDelivery.gradeAttempt('att-1', '923000000000');
    expect(verdict()).toMatchObject({ is_passed: true, score: 21, status: 'passed' });
  });

  test('4/4 MCQ + 5/10 CRQ fails — 25/30 is 83% overall, but the CRQ bar is separate', async () => {
    moduleExam({ mcq: [true, true, true, true], crq: 5 });
    await QuizDelivery.gradeAttempt('att-1', '923000000000');
    expect(verdict()).toMatchObject({ is_passed: false });
  });

  test('2/4 MCQ + 10/10 CRQ fails', async () => {
    moduleExam({ mcq: [true, true, false, false], crq: 10 });
    await QuizDelivery.gradeAttempt('att-1', '923000000000');
    expect(verdict()).toMatchObject({ is_passed: false });
  });

  test('a failed attempt carries NO cooldown when the vendor says 0 hours', async () => {
    moduleExam({ mcq: [true, false, false, false], crq: 2, cooldownHours: 0 });
    await QuizDelivery.gradeAttempt('att-1', '923000000000');
    expect(verdict()).toMatchObject({ is_passed: false, cooldown_until: null });
  });

  test('Module 6 (2 MCQs served): both correct + 6/10 passes', async () => {
    moduleExam({ mcq: [true, true], crq: 6 });
    await QuizDelivery.gradeAttempt('att-1', '923000000000');
    expect(verdict()).toMatchObject({ is_passed: true, score: 16 });
  });
});

describe('WhatsApp advances inside the module (chain_per_course)', () => {
  let ContentDelivery;
  let delivered;
  function setup(moduleUnlockLogic) {
    tableStates = {
      training_modules: { rows: f => {
        const all = [
          { id: 101, course_id: 71, order_index: 1 }, { id: 102, course_id: 71, order_index: 2 },
          { id: 201, course_id: 72, order_index: 1 }, { id: 202, course_id: 72, order_index: 2 },
        ];
        if (f.id !== undefined && typeof f.id !== 'object') return all.filter(m => m.id === f.id);
        return all;
      } },
      training_courses: { rows: f => {
        const all = [{ id: 71, level_id: 27, order_index: 1, title: 'Module 1' }, { id: 72, level_id: 27, order_index: 2, title: 'Module 2' }];
        if (f.id !== undefined && typeof f.id !== 'object') return all.filter(c => c.id === f.id);
        return all;
      } },
      // Unit 101 of Module 1 is not done; the teacher just finished Unit 201 in Module 2.
      teacher_training_progress: { rows: [{ module_id: 201 }] },
      training_levels: { rows: [{ id: 27, vendor_id: 'v', vendor: { module_unlock_logic: moduleUnlockLogic } }] },
      training_vendors: { rows: [{ id: 'v', key: 'ISAPS', module_unlock_logic: moduleUnlockLogic }] },
    };
  }
  beforeEach(() => {
    jest.resetModules();
    global.__fromImpl = t => makeChain(t);
    ContentDelivery = require('../../bot/shared/services/training/content-delivery.service');
    delivered = [];
    jest.spyOn(ContentDelivery, 'deliverModuleById');
  });

  test('after Unit 201, the next unit is 202 — not Module 1\'s first unfinished unit', async () => {
    setup('chain_per_course');
    const out = await ContentDelivery.nextUnitAfter('u1', 201);
    expect(out && out.id).toBe(202);
  });

  test("whole-level 'chain' keeps level order (Unit 101 first)", async () => {
    setup('chain');
    const out = await ContentDelivery.nextUnitAfter('u1', 201);
    expect(out && out.id).toBe(101);
  });
});

describe('unit quick-check gate at 70% (I-SAPS module_passing_pct = 70)', () => {
  beforeEach(loadGrader);
  function unitQuiz(correct, total) {
    tableStates = {
      training_assessment_attempts: { rows: [{
        id: 'att-u', user_id: 'u1', quiz_kind: 'training_module', grand_quiz_id: null, training_module_id: 101,
        level_id: 27, program_id: 'p1', total_questions: total, status: 'in_progress',
      }] },
      training_assessment_answers: { rows: Array.from({ length: total }, (_, i) => ({ question_index: i, is_correct: i < correct })) },
      training_modules: { rows: [{ id: 101, course_id: 71, title: 'Unit 101', order_index: 1 }] },
      training_courses: { rows: [{ id: 71, level_id: 27, title: 'Module 1', order_index: 1 }] },
      training_levels: { rows: [{ id: 27, vendor_id: 'v-isaps', vendor: { module_unlock_logic: 'chain_per_course' } }] },
      training_vendors: { rows: [{ id: 'v-isaps', key: 'ISAPS', module_passing_pct: 70, passing_pct: 60, cooldown_hours: 0, module_unlock_logic: 'chain_per_course' }] },
      teacher_training_progress: { rows: [] }, training_grand_quizzes: { rows: [] }, training_questions: { rows: [] },
      training_certificates: { rows: [] },
    };
  }
  test.each([[1, 1, true], [1, 2, false], [2, 2, true], [2, 3, false], [3, 3, true]])(
    '%i of %i correct → passed=%s', async (c, t, expected) => {
      unitQuiz(c, t);
      await QuizDelivery.gradeAttempt('att-u', '923000000000');
      expect(verdict()).toMatchObject({ is_passed: expected });
      const progress = (tableStates.teacher_training_progress._mutations || []).filter(m => m.op !== 'update');
      expect(progress.length > 0).toBe(expected);
    });
});
