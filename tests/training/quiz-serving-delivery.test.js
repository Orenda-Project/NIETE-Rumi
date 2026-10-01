/**
 * Quiz serving, wired through quiz-delivery.service.
 *
 * The pure decision layer is covered by quiz-serving-selection.test.js. This
 * file proves the three places the decision has to be applied CONSISTENTLY,
 * because the served set is recorded nowhere and is re-derived from scratch on
 * every hop:
 *
 *   - start*Quiz      — snapshots total_questions/total_score as the SERVED
 *                       count, so the pass ratio means something.
 *   - sendQuestion    — renders served[current_question_index].
 *   - handleQuizButton— grades the question sendQuestion actually displayed,
 *                       and persists chosen_option as the CANONICAL 1-based
 *                       option index even when the options were shuffled.
 *
 * Plus the compatibility rule: an attempt started BEFORE this shipped
 * snapshotted total_questions = the whole bank, so it keeps being served the
 * whole bank rather than being silently renumbered mid-quiz.
 */

const {
  selectServedQuestions,
  buildOptionDisplayOrder,
} = require('../../bot/shared/services/training/quiz-serving.service');

let QuizDelivery;
let supabaseFrom;
let whatsappInteractive;
let whatsappSend;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, mutation: null };

  const chain = {};
  const rowsFor = () => (typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  const track = () => {
    if (record.mutation && !record._mutationTracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._mutationTracked = true;
    }
  };
  const finalize = () => {
    track();
    if (record.isCount) return { count: rowsFor().length, data: null, error: null };
    if (state.error) return { data: null, error: state.error };
    // `.insert(...).select(...).single()` returns the row the DB wrote.
    if (record.mutation?.op === 'insert') return { data: { ...record.mutation.payload }, error: null };
    return { data: rowsFor()[0] || null, error: null };
  };
  const finalizeMany = () => {
    track();
    if (record.isCount) return { count: rowsFor().length, data: null, error: null };
    if (state.error) return { data: null, error: state.error };
    return { data: rowsFor(), error: null };
  };

  chain.select = jest.fn((_cols, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn((payload) => { record.mutation = { op: 'insert', payload }; return chain; });
  chain.update = jest.fn((payload) => { record.mutation = { op: 'update', payload }; return chain; });
  chain.upsert = jest.fn((payload, opts) => { record.mutation = { op: 'upsert', payload, opts }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.filter = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.single = jest.fn(async () => finalize());
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

const ATTEMPT_ID = '11111111-2222-3333-4444-555555555555';
const USER_ID = 'user-1';
const PHONE = '92300xxxxxxx';
const MODULE_ID = 42;
const COURSE_ID = 7;
const LEVEL_ID = 3;
const VENDOR_ID = 'vendor-uuid-niete';
const GRAND_QUIZ_ID = 77;

const BLOOMS = ['remember', 'understand', 'apply'];

/** 9 module questions across 3 Bloom levels — the real NIETE median shape. */
function moduleBank() {
  return Array.from({ length: 9 }, (_, i) => ({
    id: 100 + i,
    training_module_id: MODULE_ID,
    grand_quiz_id: null,
    question_text: `Module Q${i + 1}`,
    options: ['opt one', 'opt two', 'opt three', 'opt four'],
    correct_option: '2',
    bloom_level: BLOOMS[i % 3],
    order_index: i + 1,
    is_active: true,
  }));
}

function examBank(n = 72) {
  return Array.from({ length: n }, (_, i) => ({
    id: 500 + i,
    training_module_id: null,
    grand_quiz_id: GRAND_QUIZ_ID,
    question_text: `Exam Q${i + 1}`,
    options: ['a', 'b', 'c', 'd'],
    correct_option: '1',
    bloom_level: 'apply',
    order_index: i + 1,
    is_active: true,
  }));
}

function seedQuestions(bank) {
  tableStates.training_questions = {
    rows: (f) => {
      let rows = bank;
      if (f.id !== undefined) rows = rows.filter(r => r.id === f.id);
      if (f.training_module_id !== undefined) rows = rows.filter(r => r.training_module_id === f.training_module_id);
      if (f.grand_quiz_id !== undefined) rows = rows.filter(r => r.grand_quiz_id === f.grand_quiz_id);
      return rows;
    },
  };
}

/** The vendor whose serving policy is being switched on (NIETE in production). */
function seedVendor(overrides = {}) {
  tableStates.training_vendors = {
    rows: [{
      id: VENDOR_ID,
      key: 'TALEEMABAD',
      passing_pct: 80,
      module_passing_pct: 100,
      module_quiz_strategy: 'one_per_bloom',
      exam_question_cap: 20,
      shuffle_options: true,
      ...overrides,
    }],
  };
  tableStates.training_levels = { rows: [{ id: LEVEL_ID, name: 'Level 1', order_index: 0, vendor_id: VENDOR_ID }] };
  tableStates.training_courses = { rows: [{ id: COURSE_ID, level_id: LEVEL_ID }] };
  tableStates.training_modules = { rows: [{ id: MODULE_ID, course_id: COURSE_ID, title: 'Module 1' }] };
}

function seedAttempt(attempt) {
  tableStates.training_assessment_attempts = {
    rows: (f) => (f.id || f.quiz_kind === undefined ? [attempt] : []),
  };
}

function answerMutations() {
  return (tableStates.training_assessment_answers?._mutations || []);
}

const SERVING_CONFIG = { module_quiz_strategy: 'one_per_bloom', exam_question_cap: 20, shuffle_options: true };

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  tableStates.training_assessment_answers = { rows: [] };

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(),
    getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));

  whatsappSend = jest.fn().mockResolvedValue(true);
  whatsappInteractive = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: whatsappSend,
    sendInteractiveMessage: whatsappInteractive,
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
  }));

  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
});

afterEach(() => jest.resetModules());

// ─── start: the served count is what gets snapshotted ──────────────────────

describe('startTrainingQuiz — snapshots the SERVED count', () => {
  it('inserts total_questions = one per Bloom level, not the whole bank', async () => {
    seedVendor();
    seedQuestions(moduleBank());
    tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
    tableStates.training_assessment_attempts = {
      rows: (f) => (f.id ? [{
        id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'training_module',
        grand_quiz_id: null, training_module_id: MODULE_ID, level_id: LEVEL_ID,
        current_question_index: 0, total_questions: 3, status: 'in_progress',
      }] : []),
    };

    await QuizDelivery.startTrainingQuiz(USER_ID, MODULE_ID, PHONE);

    const insert = (tableStates.training_assessment_attempts._mutations || [])
      .find(m => m.op === 'insert');
    expect(insert).toBeTruthy();
    expect(insert.payload.total_questions).toBe(3);
    expect(insert.payload.total_score).toBe(3);
  });

  it('tells the teacher the served count, not the bank size', async () => {
    seedVendor();
    seedQuestions(moduleBank());
    tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
    tableStates.training_assessment_attempts = {
      rows: (f) => (f.id ? [{
        id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'training_module',
        grand_quiz_id: null, training_module_id: MODULE_ID, level_id: LEVEL_ID,
        current_question_index: 0, total_questions: 3, status: 'in_progress',
      }] : []),
    };

    await QuizDelivery.startTrainingQuiz(USER_ID, MODULE_ID, PHONE);

    // The intro opens Q1's list body now (bd-w2daa.8) — read both surfaces.
    const said = [
      ...whatsappSend.mock.calls.map(c => String(c[1])),
      ...whatsappInteractive.mock.calls.map(c => String(c[1]?.body?.text || '')),
    ].join('\n');
    expect(said).toMatch(/3 questions/);
    expect(said).not.toMatch(/9 questions/);
  });

  it("a vendor left on strategy 'all' keeps serving the whole bank", async () => {
    seedVendor({ module_quiz_strategy: 'all', shuffle_options: false, exam_question_cap: null });
    seedQuestions(moduleBank());
    tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
    tableStates.training_assessment_attempts = {
      rows: (f) => (f.id ? [{
        id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'training_module',
        grand_quiz_id: null, training_module_id: MODULE_ID, level_id: LEVEL_ID,
        current_question_index: 0, total_questions: 9, status: 'in_progress',
      }] : []),
    };

    await QuizDelivery.startTrainingQuiz(USER_ID, MODULE_ID, PHONE);

    const insert = (tableStates.training_assessment_attempts._mutations || [])
      .find(m => m.op === 'insert');
    expect(insert.payload.total_questions).toBe(9);
  });
});

describe('startGrandQuiz — caps the exam', () => {
  beforeEach(() => {
    jest.doMock('../../bot/shared/routes/teacher-training-endpoint', () => ({
      assertCanStartGrandQuiz: jest.fn().mockResolvedValue({
        ok: true,
        level: { id: LEVEL_ID, name: 'Level 1', order_index: 0, vendor_key: 'TALEEMABAD' },
      }),
    }));
    QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
  });

  it('snapshots total_questions at the cap, not the 72-question bank', async () => {
    seedVendor();
    seedQuestions(examBank(72));
    tableStates.training_grand_quizzes = {
      rows: [{ id: GRAND_QUIZ_ID, level_id: LEVEL_ID, quiz_type: 'grand_quiz' }],
    };
    tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
    tableStates.training_assessment_attempts = {
      rows: (f) => (f.id ? [{
        id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'grand',
        grand_quiz_id: GRAND_QUIZ_ID, training_module_id: null, level_id: LEVEL_ID,
        current_question_index: 0, total_questions: 20, status: 'in_progress',
      }] : []),
    };

    await QuizDelivery.startGrandQuiz(USER_ID, 1, PHONE);

    const insert = (tableStates.training_assessment_attempts._mutations || [])
      .find(m => m.op === 'insert');
    expect(insert).toBeTruthy();
    expect(insert.payload.total_questions).toBe(20);
    expect(insert.payload.total_score).toBe(20);
    const said = whatsappSend.mock.calls.map(c => String(c[1])).join('\n');
    expect(said).toMatch(/20 questions/);
  });

  it('a vendor with no cap still gets the whole exam', async () => {
    seedVendor({ exam_question_cap: null });
    seedQuestions(examBank(30));
    tableStates.training_grand_quizzes = {
      rows: [{ id: GRAND_QUIZ_ID, level_id: LEVEL_ID, quiz_type: 'grand_quiz' }],
    };
    tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
    tableStates.training_assessment_attempts = {
      rows: (f) => (f.id ? [{
        id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'grand',
        grand_quiz_id: GRAND_QUIZ_ID, training_module_id: null, level_id: LEVEL_ID,
        current_question_index: 0, total_questions: 30, status: 'in_progress',
      }] : []),
    };

    await QuizDelivery.startGrandQuiz(USER_ID, 1, PHONE);

    const insert = (tableStates.training_assessment_attempts._mutations || [])
      .find(m => m.op === 'insert');
    expect(insert.payload.total_questions).toBe(30);
  });
});

// ─── sendQuestion / handleQuizButton agree on the same served question ─────

describe('sendQuestion — serves the selected set, not the raw bank', () => {
  it('renders served[index], which is not the bank order', async () => {
    seedVendor();
    const bank = moduleBank();
    seedQuestions(bank);
    seedAttempt({
      id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'training_module',
      grand_quiz_id: null, training_module_id: MODULE_ID, level_id: LEVEL_ID,
      current_question_index: 1, total_questions: 3, status: 'in_progress',
    });

    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);

    const expected = selectServedQuestions(bank, {
      attemptId: ATTEMPT_ID, isModuleQuiz: true, config: SERVING_CONFIG,
    })[1];
    const msg = whatsappInteractive.mock.calls[0][1];
    expect(msg.body.text).toContain(expected.question_text);
    expect(msg.header.text).toBe('Q2/3');
  });

  it('the same attempt re-renders the identical question and option order (resume)', async () => {
    seedVendor();
    seedQuestions(moduleBank());
    seedAttempt({
      id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'training_module',
      grand_quiz_id: null, training_module_id: MODULE_ID, level_id: LEVEL_ID,
      current_question_index: 2, total_questions: 3, status: 'in_progress',
    });

    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);
    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);

    const [first, second] = whatsappInteractive.mock.calls.map(c => c[1]);
    expect(second.body.text).toBe(first.body.text);
    expect(second.action.sections[0].rows.map(r => r.id))
      .toEqual(first.action.sections[0].rows.map(r => r.id));
  });

  it('option rows carry CANONICAL option indices in their ids, in shuffled display order', async () => {
    seedVendor();
    const bank = moduleBank();
    seedQuestions(bank);
    seedAttempt({
      id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'training_module',
      grand_quiz_id: null, training_module_id: MODULE_ID, level_id: LEVEL_ID,
      current_question_index: 0, total_questions: 3, status: 'in_progress',
    });

    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);

    const served = selectServedQuestions(bank, {
      attemptId: ATTEMPT_ID, isModuleQuiz: true, config: SERVING_CONFIG,
    })[0];
    const order = buildOptionDisplayOrder({
      optionCount: served.options.length, correctOption: served.correct_option,
      cap: 10, attemptId: ATTEMPT_ID, questionId: served.id, shuffle: true,
    });
    const rows = whatsappInteractive.mock.calls[0][1].action.sections[0].rows;
    expect(rows.map(r => r.id)).toEqual(order.map(c => `training_quiz_${ATTEMPT_ID}_${c}`));
    // Letters stay sequential — it is the option TEXT that moves.
    expect(rows.map(r => r.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows.map(r => r.description)).toEqual(order.map(c => served.options[c - 1]));
  });
});

describe('handleQuizButton — grades what was displayed, stores canonical', () => {
  function seedForAnswering(index = 1) {
    seedVendor();
    const bank = moduleBank();
    seedQuestions(bank);
    seedAttempt({
      id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'training_module',
      grand_quiz_id: null, training_module_id: MODULE_ID, level_id: LEVEL_ID,
      current_question_index: index, total_questions: 3, status: 'in_progress',
    });
    return selectServedQuestions(bank, {
      attemptId: ATTEMPT_ID, isModuleQuiz: true, config: SERVING_CONFIG,
    })[index];
  }

  it('records the answer against the SERVED question, not bank[index]', async () => {
    const served = seedForAnswering(1);
    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_2`, PHONE);

    const up = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(up).toBeTruthy();
    expect(up.payload.question_id).toBe(served.id);
    expect(up.payload.question_index).toBe(1);
  });

  it('a tap on the canonical correct index grades correct even though options were shuffled', async () => {
    seedForAnswering(1);
    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_2`, PHONE);
    const up = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(up.payload.chosen_option).toBe('2');
    expect(up.payload.is_correct).toBe(true);
  });

  it('tapping the FIRST displayed row stores its canonical index, not "1"', async () => {
    // Use a served position where the shuffle genuinely moved row 1, so the
    // display position and the canonical index provably differ.
    let served = null;
    let order = null;
    let position = -1;
    for (let i = 0; i < 3; i++) {
      const candidate = selectServedQuestions(moduleBank(), {
        attemptId: ATTEMPT_ID, isModuleQuiz: true, config: SERVING_CONFIG,
      })[i];
      const candidateOrder = buildOptionDisplayOrder({
        optionCount: candidate.options.length, correctOption: candidate.correct_option,
        cap: 10, attemptId: ATTEMPT_ID, questionId: candidate.id, shuffle: true,
      });
      if (candidateOrder[0] !== 1) { served = candidate; order = candidateOrder; position = i; break; }
    }
    expect(position).toBeGreaterThanOrEqual(0); // the shuffle must move something
    seedForAnswering(position);

    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_${order[0]}`, PHONE);
    const up = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(up.payload.question_id).toBe(served.id);
    expect(up.payload.chosen_option).toBe(String(order[0]));
    expect(up.payload.is_correct).toBe(String(order[0]) === served.correct_option);
  });
});

describe('multi-select under a shuffled option order', () => {
  /** One multi-answer question, so the served set is unambiguous. */
  function seedMulti() {
    seedVendor();
    const bank = [{
      id: 300, training_module_id: MODULE_ID, grand_quiz_id: null,
      question_text: 'Which apply?', options: ['one', 'two', 'three', 'four'],
      correct_option: '1,3', bloom_level: 'apply', order_index: 1, is_active: true,
    }];
    seedQuestions(bank);
    seedAttempt({
      id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'training_module',
      grand_quiz_id: null, training_module_id: MODULE_ID, level_id: LEVEL_ID,
      current_question_index: 0, total_questions: 1, status: 'in_progress',
    });
    // Answers read back the latest upsert, mirroring production persistence.
    tableStates.training_assessment_answers = {
      rows: () => {
        const ups = (tableStates.training_assessment_answers._mutations || []).filter(m => m.op === 'upsert');
        return ups.length ? [ups[ups.length - 1].payload] : [];
      },
    };
    return bank[0];
  }

  it('stores the canonical index and echoes the DISPLAYED letter back', async () => {
    const question = seedMulti();
    // The Done row costs a slot, so the cap is MAX_OPTIONS - 1.
    const order = buildOptionDisplayOrder({
      optionCount: 4, correctOption: '1,3', cap: 9,
      attemptId: ATTEMPT_ID, questionId: question.id, shuffle: true,
    });
    const tapped = order[2];   // third row on screen → letter C

    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_${tapped}`, PHONE);

    const up = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(up.payload.chosen_option).toBe(String(tapped));   // canonical, not "3"

    const msg = whatsappInteractive.mock.calls.pop()[1];
    expect(msg.body.text).toMatch(/Selected: C\b/);
  });

  it('Done grades the canonical set, so shuffling cannot change the verdict', async () => {
    seedMulti();
    tableStates.training_assessment_answers = {
      rows: () => {
        const ups = (tableStates.training_assessment_answers._mutations || []).filter(m => m.op === 'upsert');
        return ups.length ? [ups[ups.length - 1].payload]
          : [{ attempt_id: ATTEMPT_ID, question_index: 0, question_id: 300, chosen_option: '3,1', is_correct: false }];
      },
    };

    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_done`, PHONE);

    const graded = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(graded.payload.chosen_option).toBe('1,3');
    expect(graded.payload.is_correct).toBe(true);
  });
});

// ─── compatibility with attempts started before this shipped ───────────────

describe('legacy in-progress attempts are not renumbered mid-quiz', () => {
  it('an attempt whose total_questions equals the whole bank keeps the whole bank', async () => {
    seedVendor();
    const bank = moduleBank();
    seedQuestions(bank);
    seedAttempt({
      id: ATTEMPT_ID, user_id: USER_ID, quiz_kind: 'training_module',
      grand_quiz_id: null, training_module_id: MODULE_ID, level_id: LEVEL_ID,
      current_question_index: 4, total_questions: 9, status: 'in_progress',
    });

    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);

    const msg = whatsappInteractive.mock.calls[0][1];
    expect(msg.body.text).toContain(bank[4].question_text);
    expect(msg.header.text).toBe('Q5/9');
  });
});
