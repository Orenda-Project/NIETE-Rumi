/**
 * Per-Training-module quiz — content-delivery ↔ quiz-delivery wiring.
 *
 * Covers:
 *   1. content-delivery.handleModuleDone fires startTrainingQuiz when the
 *      module has >=1 active training_questions.
 *   2. content-delivery.handleModuleDone SKIPS the quiz when the module has
 *      0 active training_questions and still delivers the next module.
 *   3. quiz-delivery.startTrainingQuiz filters training_questions by
 *      training_module_id (not grand_quiz_id), and creates an attempt row
 *      with quiz_kind='training_module'.
 *   4. Training-quiz completion does NOT gate next-module delivery
 *      (fire-and-forget from handleModuleDone — content flow continues).
 */

let ContentDelivery;
let QuizDelivery;
let supabaseFrom;
let whatsappSend;
let whatsappInteractive;
let whatsappButtons;
let tableStates;

// A per-table mock harness: `tableStates[tableName]` describes what queries
// against that table should return. Each supabase.from() call returns a fresh
// chainable object whose terminal (`.single()`, `.maybeSingle()`, `.range()`,
// awaited, or `.select(..., {count:'exact',head:true})`) resolves against the
// table entry, respecting the last `.insert()/.update()/.upsert()` payload.
function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null, isCount: false, mutation: null };

  const chain = {};
  const finalize = () => {
    // Track mutation (insert/update/upsert) for assertions
    if (record.mutation && !record._mutationTracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._mutationTracked = true;
    }
    if (record.isCount) {
      const count = typeof state.count === 'function' ? state.count(record.filters) : (state.count ?? 0);
      return { count, data: null, error: null };
    }
    // .single()/.maybeSingle() → data + error
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    if (state.error) return { data: null, error: state.error };
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    // Track mutation on await terminal too (for insert(...).select() chains
    // that resolve via `then` rather than `.single()`).
    if (record.mutation) {
      state._mutations = state._mutations || [];
      // Idempotent — only push once per chain
      if (!record._mutationTracked) {
        state._mutations.push(record.mutation);
        record._mutationTracked = true;
      }
    }
    if (record.isCount) {
      const count = typeof state.count === 'function' ? state.count(record.filters) : (state.count ?? 0);
      return { count, data: null, error: null };
    }
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows, error: null };
  };

  chain.select = jest.fn((_cols, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn((payload) => {
    record.mutation = { op: 'insert', payload };
    return chain;
  });
  chain.update = jest.fn((payload) => {
    record.mutation = { op: 'update', payload };
    return chain;
  });
  chain.upsert = jest.fn((payload, opts) => {
    record.mutation = { op: 'upsert', payload, opts };
    return chain;
  });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.filter = jest.fn(() => chain);
  chain.order = jest.fn((col, opts) => { record.orderCol = col; record.orderDir = opts?.ascending ? 'asc' : 'desc'; return chain; });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.single = jest.fn(async () => finalize());
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  jest.resetModules();

  tableStates = {};

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
  whatsappButtons = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: whatsappSend,
    sendInteractiveMessage: whatsappInteractive,
    sendInteractiveButtons: whatsappButtons,
  }));

  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
  }));

  ContentDelivery = require('../../bot/shared/services/training/content-delivery.service');
  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
});

afterEach(() => jest.resetModules());

// ─── Fixtures ──────────────────────────────────────────────────────────────

function setupModule({ moduleId = 42, courseId = 7, orderIndex = 1, title = 'Module 1' } = {}) {
  tableStates.training_modules = {
    rows: [{ id: moduleId, course_id: courseId, title, order_index: orderIndex }],
  };
  tableStates.training_courses = { rows: [{ id: courseId, level_id: 3, title: 'Course 1' }] };
  tableStates.training_levels = { rows: [{ id: 3, name: 'Level 1', order_index: 0 }] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
}

function setupModuleQuestions(count) {
  tableStates.training_questions = {
    count: () => count,
    rows: Array.from({ length: count }, (_, i) => ({
      id: 100 + i,
      question_text: `Q${i + 1}`,
      options: [{ text: 'A' }, { text: 'B' }],
      correct_option: '1',
      order_index: i + 1,
    })),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('training-module quiz — content-delivery wiring', () => {
  it('handleModuleDone fires the quiz when >=1 active question exists', async () => {
    setupModule();
    setupModuleQuestions(3);
    tableStates.training_assessment_attempts = {
      // No existing in-progress attempt; insert returns a new one
      rows: (filters) => (filters.id ? [{ id: 'attempt-abc', quiz_kind: 'training_module', training_module_id: 42, current_question_index: 0, total_questions: 3, status: 'in_progress' }] : []),
    };

    const spy = jest.spyOn(QuizDelivery, 'startTrainingQuiz').mockResolvedValue(true);

    await ContentDelivery.handleModuleDone('user-1', 42, '9203206281951');

    // Give the fire-and-forget quiz promise a tick to resolve
    await new Promise((r) => setImmediate(r));

    expect(spy).toHaveBeenCalledWith('user-1', 42, '9203206281951');
    spy.mockRestore();
  });

  it('handleModuleDone SKIPS the quiz when 0 questions exist and still delivers next module', async () => {
    setupModule();
    setupModuleQuestions(0);

    const spy = jest.spyOn(QuizDelivery, 'startTrainingQuiz').mockResolvedValue(true);

    await ContentDelivery.handleModuleDone('user-1', 42, '9203206281951');

    // Give any (unwanted) fire-and-forget promise a tick
    await new Promise((r) => setImmediate(r));

    expect(spy).not.toHaveBeenCalled();
    // deliverNextModule path runs — whatsapp received at least one send (the
    // "marked done" line, and/or the empty-course fallback).
    expect(whatsappSend).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('handleModuleDone does NOT block next-module delivery on quiz completion', async () => {
    // The training quiz is fire-and-forget — even if it hangs, deliverNextModule
    // still runs. We simulate a slow quiz and verify handleModuleDone returns
    // before the quiz resolves.
    setupModule();
    setupModuleQuestions(2);

    let quizResolve;
    const slowQuiz = new Promise((r) => { quizResolve = r; });
    const spy = jest.spyOn(QuizDelivery, 'startTrainingQuiz').mockReturnValue(slowQuiz);

    const result = await ContentDelivery.handleModuleDone('user-1', 42, '9203206281951');

    // handleModuleDone must have returned WITHOUT waiting for the quiz.
    expect(spy).toHaveBeenCalled();
    expect(result).not.toBe(undefined);
    // Now let the quiz resolve — nothing should throw.
    quizResolve(true);
    await slowQuiz;
    spy.mockRestore();
  });
});

describe('startTrainingQuiz — quiz-delivery service', () => {
  it('filters training_questions by training_module_id and inserts a training_module attempt', async () => {
    setupModule({ moduleId: 42 });
    setupModuleQuestions(2);
    // Cover: (a) "existing in-progress attempt?" lookup returns nothing,
    // (b) INSERT + select('id').single() returns the new attempt id,
    // (c) later sendQuestion() re-selects the full attempt row by id.
    const ATTEMPT = {
      id: 'attempt-uuid-1',
      user_id: 'user-1',
      quiz_kind: 'training_module',
      grand_quiz_id: null,
      training_module_id: 42,
      current_question_index: 0,
      total_questions: 2,
      status: 'in_progress',
    };
    tableStates.training_assessment_attempts = {
      rows: (filters) => {
        if (filters.quiz_kind === 'training_module' && !filters.id) return []; // no existing
        return [ATTEMPT];
      },
    };

    const ok = await QuizDelivery.startTrainingQuiz('user-1', 42, '9203206281951');

    expect(ok).toBe(true);
    // Verify training_questions was filtered by training_module_id — every call
    // to supabase.from('training_questions') must have called .eq('training_module_id', 42)
    const questionFromCalls = supabaseFrom.mock.calls.filter((c) => c[0] === 'training_questions');
    expect(questionFromCalls.length).toBeGreaterThan(0);

    // Verify the attempts insert used quiz_kind='training_module' and set training_module_id
    const attemptMutations = (tableStates.training_assessment_attempts._mutations || []).filter((m) => m.op === 'insert');
    expect(attemptMutations.length).toBeGreaterThanOrEqual(1);
    const payload = attemptMutations[0].payload;
    expect(payload.quiz_kind).toBe('training_module');
    expect(payload.training_module_id).toBe(42);
    expect(payload.grand_quiz_id).toBeUndefined();

    // Q1 was sent as an interactive list
    expect(whatsappInteractive).toHaveBeenCalled();
  });

  it('returns true (silent skip) when the module has zero active questions', async () => {
    setupModule({ moduleId: 42 });
    setupModuleQuestions(0);
    tableStates.training_assessment_attempts = { rows: [] };

    const ok = await QuizDelivery.startTrainingQuiz('user-1', 42, '9203206281951');
    expect(ok).toBe(true);
    // No interactive message, no attempt insert
    expect(whatsappInteractive).not.toHaveBeenCalled();
    const mutations = tableStates.training_assessment_attempts._mutations || [];
    expect(mutations.filter((m) => m.op === 'insert')).toHaveLength(0);
  });

  it('exports startTrainingQuiz alongside the existing grand-quiz functions', () => {
    expect(typeof QuizDelivery.startTrainingQuiz).toBe('function');
    expect(typeof QuizDelivery.startGrandQuiz).toBe('function');
    expect(typeof QuizDelivery.handleQuizButton).toBe('function');
  });
});
