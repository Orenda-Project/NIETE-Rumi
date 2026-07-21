/**
 * bd-2233 — Beacon House open-ended capstone ("Grand Quiz") on WhatsApp.
 *
 * The legacy app ends each BH subject with 8 open-ended questions (400-char
 * min, scored /5 each, level passing bar). Operator + NIETE team rulings:
 * serve on WA, record answers, LLM per-answer score (0-5) + feedback,
 * pass bar = 70% of total, certificate on modules-complete + capstone-pass.
 *
 * Contract (capstone-delivery.service):
 *   maybeOfferCapstone(userId, moduleId, phone)
 *     → offers (interactive buttons, id capstone_start_<levelId>) ONLY when:
 *       vendor is all_modules AND an active quiz_type='capstone' row exists
 *       for the module's level AND every active module of the level is
 *       complete AND no passed capstone attempt exists. Returns bool.
 *   handleCapstoneButton(userId, 'capstone_start_<levelId>', phone)
 *     → creates attempt (quiz_kind='capstone', total_questions=N,
 *       total_score=5N) and sends Q1 as a plain text message.
 *   routeTextAnswer(phone, text)
 *     → false when the phone's user has no in-progress capstone attempt
 *       (message flows to normal handling). Otherwise: 'cancel' abandons;
 *       any other text is the answer — stored (answer_text), LLM-scored
 *       (answer_score 0-5 + feedback_text), feedback sent, next question
 *       sent; after the last answer the attempt is graded: >=70% → passed
 *       (+ certificate when all modules complete), else failed + retry
 *       message. Returns true (message consumed).
 *
 * bd-2234 (Oxbridge half): quiz-delivery gradeAttempt calls
 * maybeIssueOxbridgeCertificate after module-quiz grading — covered in
 * certificate-triggers.test.js.
 */

let Capstone;
let supabaseFrom;
let tableStates;
let waSend;
let waButtons;
let llmCreate;
let certIssue;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, mutation: null, orderCol: null };
  const chain = {};
  const applyFilters = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        out = out.filter(r => val.in.includes(r[col]));
      } else if (col.includes('.')) {
        // joined-path filters not modelled — ignore
      } else {
        out = out.filter(r => r[col] === val);
      }
    }
    return out;
  };
  const finalize = () => {
    if (record.mutation && !record._t) { (state._mutations ||= []).push(record.mutation); record._t = true; }
    if (record.isCount) {
      const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
      return { count: state.count ?? applyFilters(rows).length, data: null, error: null };
    }
    if (state.error) return { data: null, error: state.error };
    if (record.mutation && record.mutation.op === 'insert') {
      return { data: { id: state.insertId || 'new-row-id', ...record.mutation.payload }, error: null };
    }
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: applyFilters(rows)[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (record.mutation && !record._t) { (state._mutations ||= []).push(record.mutation); record._t = true; }
    if (record.isCount) {
      const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
      return { count: state.count ?? applyFilters(rows).length, data: null, error: null };
    }
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: applyFilters(rows), error: null };
  };
  chain.select = jest.fn((_c, opts) => { if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true; return chain; });
  chain.insert = jest.fn((payload) => { record.mutation = { op: 'insert', payload }; return chain; });
  chain.update = jest.fn((payload) => { record.mutation = { op: 'update', payload, filters: record.filters }; return chain; });
  chain.upsert = jest.fn((payload, opts) => { record.mutation = { op: 'upsert', payload, opts }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'not'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.single = jest.fn(async () => finalize());
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

const USER = 'user-1';
const PHONE = '92300xxxxxxx';
const LEVEL = 18;      // BH English
const ATTEMPT = '99999999-8888-7777-6666-555555555555';

function seed({
  vendorUnlock = 'all_modules',
  capstoneQuiz = true,
  completedModules = [101, 102],
  passedAttempt = false,
  inProgressAttempt = null,
  storedAnswers = [],
} = {}) {
  tableStates.users = { rows: [{ id: USER, phone_number: PHONE, first_name: 'Saira' }] };
  tableStates.training_modules = {
    rows: [
      { id: 101, course_id: 7, is_active: true },
      { id: 102, course_id: 7, is_active: true },
    ],
  };
  tableStates.training_courses = { rows: [{ id: 7, level_id: LEVEL, is_active: true }] };
  tableStates.training_levels = { rows: [{ id: LEVEL, name: 'English', order_index: 1, vendor_id: 'v-bh', is_active: true }] };
  tableStates.training_vendors = { rows: [{ id: 'v-bh', key: 'BEACONHOUSE', unlock_logic: vendorUnlock }] };
  tableStates.training_grand_quizzes = {
    rows: capstoneQuiz ? [{ id: 900, level_id: LEVEL, quiz_type: 'capstone', is_active: true }] : [],
  };
  tableStates.training_questions = {
    rows: [
      { id: 9001, grand_quiz_id: 900, question_text: 'Open Q1?', options: [], correct_option: '', order_index: 1, is_active: true },
      { id: 9002, grand_quiz_id: 900, question_text: 'Open Q2?', options: [], correct_option: '', order_index: 2, is_active: true },
    ],
  };
  tableStates.teacher_training_progress = {
    rows: completedModules.map(m => ({ user_id: USER, module_id: m, completed_at: '2026-07-21' })),
  };
  const attempts = [];
  if (passedAttempt) attempts.push({ id: 'old-a', user_id: USER, level_id: LEVEL, quiz_kind: 'capstone', status: 'passed', is_passed: true });
  if (inProgressAttempt) attempts.push(inProgressAttempt);
  tableStates.training_assessment_attempts = { rows: attempts, insertId: ATTEMPT };
  tableStates.training_assessment_answers = { rows: storedAnswers };
  tableStates.teacher_training_assignments = { rows: [{ user_id: USER, program_id: 'prog-1', is_active: true }] };
}

function inProgress(idx = 0) {
  return {
    id: ATTEMPT, user_id: USER, level_id: LEVEL, quiz_kind: 'capstone',
    grand_quiz_id: 900,
    status: 'in_progress', current_question_index: idx, total_questions: 2, total_score: 10,
    program_id: 'prog-1',
  };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn().mockResolvedValue({ error: null }) }));

  waSend = jest.fn().mockResolvedValue(true);
  waButtons = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: waSend,
    sendInteractiveButtons: waButtons,
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  }));

  llmCreate = jest.fn().mockResolvedValue({
    choices: [{ message: { content: '{"score": 4, "feedback": "Good grounding in classroom practice."}' } }],
  });
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({ chat: { completions: { create: llmCreate } } }),
    getDefaultModel: () => 'test-model',
  }));

  certIssue = jest.fn().mockResolvedValue({
    certificate_code: 'NIETE-TEST-0001', teacher_name: 'Saira', level_name: 'English',
    issued_at: '2026-07-21T00:00:00Z', already_issued: false,
  });
  jest.doMock('../../bot/shared/services/training/certificate.service', () => ({
    issueCertificate: certIssue,
  }));

  Capstone = require('../../bot/shared/services/training/capstone-delivery.service');
});

afterEach(() => jest.resetModules());

describe('maybeOfferCapstone', () => {
  test('offers when all modules complete on an all_modules level with a capstone', async () => {
    seed();
    const offered = await Capstone.maybeOfferCapstone(USER, 102, PHONE);
    expect(offered).toBe(true);
    expect(waButtons).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(waButtons.mock.calls[0]);
    expect(payload).toContain(`capstone_start_${LEVEL}`);
  });

  test('no offer while modules remain', async () => {
    seed({ completedModules: [101] });
    expect(await Capstone.maybeOfferCapstone(USER, 101, PHONE)).toBe(false);
    expect(waButtons).not.toHaveBeenCalled();
  });

  test('no offer without a capstone quiz row (NIETE-style levels)', async () => {
    seed({ capstoneQuiz: false });
    expect(await Capstone.maybeOfferCapstone(USER, 102, PHONE)).toBe(false);
  });

  test('no offer for chain vendors', async () => {
    seed({ vendorUnlock: 'chain' });
    expect(await Capstone.maybeOfferCapstone(USER, 102, PHONE)).toBe(false);
  });

  test('no re-offer after a passed capstone', async () => {
    seed({ passedAttempt: true });
    expect(await Capstone.maybeOfferCapstone(USER, 102, PHONE)).toBe(false);
  });
});

describe('handleCapstoneButton', () => {
  test('start button creates the attempt and sends Q1 by text', async () => {
    seed();
    const handled = await Capstone.handleCapstoneButton(USER, `capstone_start_${LEVEL}`, PHONE);
    expect(handled).toBe(true);
    const ins = (tableStates.training_assessment_attempts._mutations || []).find(m => m.op === 'insert');
    expect(ins).toBeTruthy();
    expect(ins.payload.quiz_kind).toBe('capstone');
    expect(ins.payload.total_questions).toBe(2);
    expect(ins.payload.total_score).toBe(10);
    expect(waSend.mock.calls.map(c => c[1]).join(' ')).toContain('Open Q1?');
  });

  test('unknown button ids are not handled', async () => {
    seed();
    expect(await Capstone.handleCapstoneButton(USER, 'something_else', PHONE)).toBe(false);
  });
});

describe('routeTextAnswer', () => {
  test('returns false with no in-progress attempt (message flows on)', async () => {
    seed();
    expect(await Capstone.routeTextAnswer(PHONE, 'hello rumi')).toBe(false);
    expect(waSend).not.toHaveBeenCalled();
  });

  test('stores the answer with LLM score + feedback, sends feedback and next question', async () => {
    seed({ inProgressAttempt: inProgress(0) });
    const handled = await Capstone.routeTextAnswer(PHONE, 'I verified facts against the textbook and removed student names before using the tool.');
    expect(handled).toBe(true);

    const up = (tableStates.training_assessment_answers._mutations || []).find(m => m.op === 'upsert' || m.op === 'insert');
    expect(up).toBeTruthy();
    expect(up.payload.answer_text).toContain('verified facts');
    expect(up.payload.answer_score).toBe(4);
    expect(up.payload.feedback_text).toContain('Good grounding');

    const sent = waSend.mock.calls.map(c => c[1]).join('\n');
    expect(sent).toContain('4/5');
    expect(sent).toContain('Open Q2?');
  });

  test('last answer grades the attempt — 70%+ passes and issues the certificate', async () => {
    seed({
      inProgressAttempt: inProgress(1),
      storedAnswers: [{ attempt_id: ATTEMPT, question_index: 0, answer_score: 4 }],
    });
    // LLM gives 4 again → total 8/10 = 80% ≥ 70%
    await Capstone.routeTextAnswer(PHONE, 'Final answer text with enough substance.');

    const upd = (tableStates.training_assessment_attempts._mutations || []).find(m => m.op === 'update');
    expect(upd).toBeTruthy();
    expect(upd.payload.status).toBe('passed');
    expect(upd.payload.is_passed).toBe(true);
    expect(upd.payload.score).toBe(8);
    expect(certIssue).toHaveBeenCalled();
    expect(waSend.mock.calls.map(c => c[1]).join('\n')).toContain('NIETE-TEST-0001');
  });

  test('below 70% fails with a retry message, no certificate', async () => {
    llmCreate.mockResolvedValue({ choices: [{ message: { content: '{"score": 1, "feedback": "Needs specifics."}' } }] });
    seed({
      inProgressAttempt: inProgress(1),
      storedAnswers: [{ attempt_id: ATTEMPT, question_index: 0, answer_score: 2 }],
    });
    await Capstone.routeTextAnswer(PHONE, 'Short weak answer.');
    const upd = (tableStates.training_assessment_attempts._mutations || []).find(m => m.op === 'update');
    expect(upd.payload.status).toBe('failed');
    expect(upd.payload.is_passed).toBe(false);
    expect(certIssue).not.toHaveBeenCalled();
    expect(waSend.mock.calls.map(c => c[1]).join('\n').toLowerCase()).toContain('try again');
  });

  test("'cancel' abandons the attempt", async () => {
    seed({ inProgressAttempt: inProgress(0) });
    const handled = await Capstone.routeTextAnswer(PHONE, 'cancel');
    expect(handled).toBe(true);
    const upd = (tableStates.training_assessment_attempts._mutations || []).find(m => m.op === 'update');
    expect(upd.payload.status).toBe('abandoned');
    expect(llmCreate).not.toHaveBeenCalled();
  });

  test('slash commands are never consumed even mid-attempt', async () => {
    seed({ inProgressAttempt: inProgress(0) });
    expect(await Capstone.routeTextAnswer(PHONE, '/training')).toBe(false);
  });
});
