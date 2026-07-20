/**
 * bd-2138 — multi-answer ("msq") quiz questions on WhatsApp.
 *
 * Legacy NIETE questions of type 'msq' carry multiple correct answers
 * (answers = {1,2,3,5}); the migration collapsed them to a single
 * correct_option and the delivery is a single-tap interactive list, so
 * "Select all that apply" questions are unanswerable (26 Oxbridge module
 * questions in prod).
 *
 * Contract:
 *   - A question is MULTI iff its correct_option contains a comma
 *     (e.g. '1,3,5'). No schema change.
 *   - sendQuestion for a multi question appends a "Done" row
 *     (id training_quiz_<attemptId>_done) after the options and instructs
 *     "select all that apply".
 *   - Tapping an option on a multi question TOGGLES it into the stored
 *     selection (answers-row upsert, chosen_option '1,3' sorted), does NOT
 *     advance, and re-sends the same question showing the selection.
 *   - Tapping Done grades SET EQUALITY (exact set → correct; subset,
 *     superset, disjoint → wrong), then advances.
 *   - Done with an empty selection re-prompts without advancing or grading.
 *   - Single-answer questions keep the existing tap-to-grade behaviour.
 *
 * Harness cloned from tests/training/training-quiz.test.js.
 */

let QuizDelivery;
let supabaseFrom;
let whatsappInteractive;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, mutation: null };

  const chain = {};
  const finalize = () => {
    if (record.mutation && !record._mutationTracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._mutationTracked = true;
    }
    if (record.isCount) {
      const count = typeof state.count === 'function' ? state.count(record.filters) : (state.count ?? 0);
      return { count, data: null, error: null };
    }
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    if (state.error) return { data: null, error: state.error };
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (record.mutation && !record._mutationTracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._mutationTracked = true;
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

function setupAttempt({ correctOption, storedAnswerRow = null, questionIndex = 0 } = {}) {
  tableStates.training_assessment_attempts = {
    rows: [{
      id: ATTEMPT_ID,
      user_id: USER_ID,
      quiz_kind: 'training_module',
      grand_quiz_id: null,
      training_module_id: 42,
      level_id: 3,
      program_id: 'prog-1',
      current_question_index: questionIndex,
      total_questions: 2,
      status: 'in_progress',
    }],
  };
  tableStates.training_questions = {
    rows: [{
      id: 900,
      question_text: 'Which apply? (Select all that apply)',
      options: ['A text', 'B text', 'C text', 'D text'],
      correct_option: correctOption,
      order_index: 1,
    }],
  };
  // rows reflect the latest upsert so a re-read within the same handler run
  // (e.g. sendQuestion's "Selected: …" line after a toggle) sees the write,
  // mirroring production persistence.
  tableStates.training_assessment_answers = {
    rows: () => {
      const muts = (tableStates.training_assessment_answers._mutations || []).filter(m => m.op === 'upsert');
      if (muts.length) return [muts[muts.length - 1].payload];
      return storedAnswerRow ? [storedAnswerRow] : [];
    },
  };
  tableStates.training_grand_quizzes = { rows: [] };
  tableStates.training_modules = { rows: [{ id: 42, course_id: 7, title: 'M' }] };
}

function answerMutations() {
  return (tableStates.training_assessment_answers._mutations || []);
}
function attemptMutations() {
  return (tableStates.training_assessment_attempts._mutations || []);
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

  whatsappInteractive = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: whatsappInteractive,
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
  }));

  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
});

afterEach(() => jest.resetModules());

describe('bd-2138 — multi-select question delivery', () => {
  test('multi question renders a Done row and select-all instruction', async () => {
    setupAttempt({ correctOption: '1,3' });
    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);

    expect(whatsappInteractive).toHaveBeenCalledTimes(1);
    const msg = whatsappInteractive.mock.calls[0][1];
    const rows = msg.action.sections[0].rows;
    expect(rows.map(r => r.id)).toContain(`training_quiz_${ATTEMPT_ID}_done`);
    expect(`${msg.body.text} ${msg.footer.text}`.toLowerCase()).toMatch(/select all/);
  });

  test('single question renders NO Done row (regression)', async () => {
    setupAttempt({ correctOption: '2' });
    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);
    const msg = whatsappInteractive.mock.calls[0][1];
    const rows = msg.action.sections[0].rows;
    expect(rows.map(r => r.id)).not.toContain(`training_quiz_${ATTEMPT_ID}_done`);
  });
});

describe('bd-2138 — multi-select answering', () => {
  test('option tap toggles selection, does not advance, re-sends question', async () => {
    setupAttempt({ correctOption: '1,3' });
    const ok = await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_1`, PHONE);
    expect(ok).toBe(true);

    const up = answerMutations().find(m => m.op === 'upsert');
    expect(up).toBeTruthy();
    expect(up.payload.chosen_option).toBe('1');
    expect(up.payload.is_correct).toBe(false); // interim — graded on Done

    // must NOT advance the attempt index
    const advanced = attemptMutations().find(m => m.op === 'update' && m.payload.current_question_index !== undefined);
    expect(advanced).toBeUndefined();
    // question re-sent showing the selection
    expect(whatsappInteractive).toHaveBeenCalled();
    const msg = whatsappInteractive.mock.calls[0][1];
    expect(msg.body.text).toMatch(/Selected: A\b/);
  });

  test('second tap accumulates into a sorted set; tapping a selected option removes it', async () => {
    setupAttempt({
      correctOption: '1,3',
      storedAnswerRow: { attempt_id: ATTEMPT_ID, question_index: 0, question_id: 900, chosen_option: '3', is_correct: false },
    });
    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_1`, PHONE);
    let up = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(up.payload.chosen_option).toBe('1,3');

    // now tap 3 again — it should toggle OFF
    tableStates.training_assessment_answers.rows = [
      { attempt_id: ATTEMPT_ID, question_index: 0, question_id: 900, chosen_option: '1,3', is_correct: false },
    ];
    tableStates.training_assessment_answers._mutations = [];
    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_3`, PHONE);
    up = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(up.payload.chosen_option).toBe('1');
  });

  test('Done with the exact correct set grades correct and advances', async () => {
    setupAttempt({
      correctOption: '1,3',
      storedAnswerRow: { attempt_id: ATTEMPT_ID, question_index: 0, question_id: 900, chosen_option: '3,1', is_correct: false },
    });
    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_done`, PHONE);

    const graded = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(graded.payload.is_correct).toBe(true);
    const advanced = attemptMutations().find(m => m.op === 'update' && m.payload.current_question_index === 1);
    expect(advanced).toBeTruthy();
  });

  test('Done with a subset grades wrong and advances', async () => {
    setupAttempt({
      correctOption: '1,3',
      storedAnswerRow: { attempt_id: ATTEMPT_ID, question_index: 0, question_id: 900, chosen_option: '1', is_correct: false },
    });
    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_done`, PHONE);
    const graded = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(graded.payload.is_correct).toBe(false);
    const advanced = attemptMutations().find(m => m.op === 'update' && m.payload.current_question_index === 1);
    expect(advanced).toBeTruthy();
  });

  test('Done with nothing selected re-prompts without grading or advancing', async () => {
    setupAttempt({ correctOption: '1,3' });
    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_done`, PHONE);
    expect(answerMutations().filter(m => m.op === 'upsert')).toHaveLength(0);
    const advanced = attemptMutations().find(m => m.op === 'update' && m.payload.current_question_index !== undefined);
    expect(advanced).toBeUndefined();
    expect(whatsappInteractive).toHaveBeenCalled(); // re-prompt
  });

  test('single question tap still grades immediately and advances (regression)', async () => {
    setupAttempt({ correctOption: '2' });
    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_2`, PHONE);
    const graded = answerMutations().filter(m => m.op === 'upsert').pop();
    expect(graded.payload.is_correct).toBe(true);
    const advanced = attemptMutations().find(m => m.op === 'update' && m.payload.current_question_index === 1);
    expect(advanced).toBeTruthy();
  });
});
