/**
 * bd-2501 — multi-answer quiz questions delivered as a WhatsApp Flow
 * CheckboxGroup instead of the tap-each-then-Done interactive-list workaround.
 *
 * WHAT THIS LOCKS DOWN
 * --------------------
 *   1. ROUTING. A multi-answer question (correct_option contains a comma) goes
 *      out as a Flow when TRAINING_MSQ_FLOW_ID is configured. A single-answer
 *      question NEVER does — it keeps the interactive list.
 *
 *   2. ROLLBACK. With TRAINING_MSQ_FLOW_ID unset the multi question falls back
 *      to today's list + Done path and is still answerable AND gradable end to
 *      end. Clearing one Railway field must restore the old behaviour with no
 *      deploy, so this is a first-class contract, not a nicety.
 *
 *   3. ORDER. The Flow presents options in the SAME order the shuffle
 *      (buildOptionDisplayOrder) produces for the list path — same attempt,
 *      same question, same lettering — and the option ids are the CANONICAL
 *      1-based indices, never display positions.
 *
 *   4. STORAGE. Whichever surface delivered the question, chosen_option lands
 *      as the canonical comma-joined ascending set ('1,3,5'). 433k+ historical
 *      answer rows use that convention and every grader compares against it.
 *
 *   5. WIRING. The three points a new Flow ID needs (detector, bot switch,
 *      flow-response handler) plus the registration config, because without
 *      all of them the submission falls through to the unknown-flow reply.
 *
 * Harness cloned from tests/training/quiz-serving-delivery.test.js.
 */

const fs = require('fs');
const path = require('path');

const {
  buildOptionDisplayOrder,
} = require('../../bot/shared/services/training/quiz-serving.service');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FLOW_JSON_PATH = path.join(REPO_ROOT, 'docs/flows/training-msq-flow.json');

let QuizDelivery;
let MsqEndpoint;
let supabaseFrom;
let whatsappInteractive;
let whatsappSend;
let whatsappFlow;
let tableStates;

// ─── supabase chain double ─────────────────────────────────────────────────

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

// ─── fixtures ──────────────────────────────────────────────────────────────

const ATTEMPT_ID = '11111111-2222-3333-4444-555555555555';
const USER_ID = '99999999-8888-7777-6666-555555555555';
const PHONE = '92300xxxxxxx';
const MODULE_ID = 42;
const COURSE_ID = 7;
const LEVEL_ID = 3;
const VENDOR_ID = 'vendor-uuid-1';
const QUESTION_ID = 900;
const FLOW_ID = '1234509876543210';

/**
 * The real shape of every affected question in production: 5 options, a
 * comma-joined key. Vendor has shuffle_options on, so display order != canonical.
 */
const MSQ_OPTIONS = ['Opt one', 'Opt two', 'Opt three', 'Opt four', 'Opt five'];
const MSQ_KEY = '1,3,5';
// The list path reserves one of the 10 list rows for the Done action, so the
// display order it derives is built with cap = 9. The Flow must use the SAME
// cap or a >9-option question would letter differently across the two surfaces.
const MSQ_CAP = 9;

function expectedDisplayOrder({ shuffle = true, correctOption = MSQ_KEY } = {}) {
  return buildOptionDisplayOrder({
    optionCount: MSQ_OPTIONS.length,
    correctOption,
    cap: MSQ_CAP,
    attemptId: ATTEMPT_ID,
    questionId: QUESTION_ID,
    shuffle,
  });
}

function seedWorld({
  correctOption = MSQ_KEY,
  shuffleOptions = true,
  questionIndex = 0,
  storedAnswerRow = null,
  attemptStatus = 'in_progress',
} = {}) {
  tableStates.training_vendors = {
    rows: [{
      id: VENDOR_ID,
      key: 'OXBRIDGE',
      passing_pct: 70,
      module_passing_pct: 70,
      module_quiz_strategy: 'all',
      exam_question_cap: null,
      shuffle_options: shuffleOptions,
    }],
  };
  tableStates.training_levels = { rows: [{ id: LEVEL_ID, name: 'Level 1', order_index: 0, vendor_id: VENDOR_ID }] };
  tableStates.training_courses = { rows: [{ id: COURSE_ID, level_id: LEVEL_ID }] };
  tableStates.training_modules = { rows: [{ id: MODULE_ID, course_id: COURSE_ID, title: 'Module 1' }] };
  tableStates.training_grand_quizzes = { rows: [] };

  tableStates.training_assessment_attempts = {
    rows: [{
      id: ATTEMPT_ID,
      user_id: USER_ID,
      quiz_kind: 'training_module',
      grand_quiz_id: null,
      training_module_id: MODULE_ID,
      level_id: LEVEL_ID,
      program_id: 'prog-1',
      current_question_index: questionIndex,
      total_questions: 2,
      status: attemptStatus,
    }],
  };

  // The bank puts the multi-answer question AT questionIndex, padding the
  // earlier slots with ordinary single-answer questions — the served set is
  // re-derived by order_index, so the cursor has to land on a real row.
  const bank = [];
  for (let i = 0; i < questionIndex; i++) {
    bank.push({
      id: 800 + i,
      training_module_id: MODULE_ID,
      grand_quiz_id: null,
      question_text: `Filler Q${i + 1}`,
      options: ['a', 'b', 'c'],
      correct_option: '1',
      bloom_level: 'apply',
      order_index: i + 1,
      is_active: true,
    });
  }
  bank.push({
    id: QUESTION_ID,
    training_module_id: MODULE_ID,
    grand_quiz_id: null,
    question_text: 'Which of these apply?',
    options: MSQ_OPTIONS,
    correct_option: correctOption,
    bloom_level: 'apply',
    order_index: questionIndex + 1,
    is_active: true,
  });
  tableStates.training_questions = {
    rows: (f) => {
      let rows = bank;
      if (f.id !== undefined) rows = rows.filter(r => r.id === f.id);
      if (f.training_module_id !== undefined) rows = rows.filter(r => r.training_module_id === f.training_module_id);
      if (f.grand_quiz_id !== undefined) rows = rows.filter(r => r.grand_quiz_id === f.grand_quiz_id);
      return rows;
    },
  };

  tableStates.training_assessment_answers = {
    rows: () => {
      const muts = (tableStates.training_assessment_answers._mutations || []).filter(m => m.op === 'upsert');
      if (muts.length) return [muts[muts.length - 1].payload];
      return storedAnswerRow ? [storedAnswerRow] : [];
    },
  };
}

function answerMutations() {
  return (tableStates.training_assessment_answers?._mutations || []).filter(m => m.op === 'upsert');
}
function attemptMutations() {
  return (tableStates.training_assessment_attempts?._mutations || []);
}
function advancedTo(index) {
  return attemptMutations().find(m => m.op === 'update' && m.payload.current_question_index === index);
}

function bootstrap({ flowId = FLOW_ID } = {}) {
  jest.resetModules();
  tableStates = {};

  if (flowId) process.env.TRAINING_MSQ_FLOW_ID = flowId;
  else delete process.env.TRAINING_MSQ_FLOW_ID;

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
  whatsappFlow = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: whatsappSend,
    sendInteractiveMessage: whatsappInteractive,
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendFlow: whatsappFlow,
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
  }));

  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
  MsqEndpoint = require('../../bot/shared/routes/training-msq-endpoint');
}

beforeEach(() => bootstrap());
afterEach(() => {
  delete process.env.TRAINING_MSQ_FLOW_ID;
  jest.resetModules();
});

// ───────────────────────────────────────────────────────────────────────────
// 1. Routing — which surface a question is delivered on
// ───────────────────────────────────────────────────────────────────────────

describe('delivery routing', () => {
  it('a multi-answer question is sent as a Flow, not an interactive list', async () => {
    seedWorld();
    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);

    expect(whatsappFlow).toHaveBeenCalledTimes(1);
    expect(whatsappInteractive).not.toHaveBeenCalled();
    expect(whatsappFlow.mock.calls[0][0]).toBe(PHONE);
    expect(whatsappFlow.mock.calls[0][1].flowId).toBe(FLOW_ID);
  });

  it('the flow token leads with the user id and carries the attempt + question index', async () => {
    seedWorld({ questionIndex: 1 });
    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);

    const token = whatsappFlow.mock.calls[0][1].flowToken;
    expect(typeof token).toBe('string');
    const parts = token.split(':');
    expect(parts[0]).toBe(USER_ID);
    expect(token).toContain(ATTEMPT_ID);
    expect(parts[parts.length - 1]).toBe('1');
  });

  it('a single-answer question keeps the interactive list (no Flow)', async () => {
    seedWorld({ correctOption: '2' });
    await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);

    expect(whatsappFlow).not.toHaveBeenCalled();
    expect(whatsappInteractive).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Rollback — the unset-env lever
// ───────────────────────────────────────────────────────────────────────────

describe('rollback: TRAINING_MSQ_FLOW_ID unset', () => {
  beforeEach(() => bootstrap({ flowId: null }));

  it('falls back to the interactive list with a Done row — never silence, never a throw', async () => {
    seedWorld();
    const ok = await QuizDelivery.sendQuestion(ATTEMPT_ID, PHONE);

    expect(ok).toBe(true);
    expect(whatsappFlow).not.toHaveBeenCalled();
    expect(whatsappInteractive).toHaveBeenCalledTimes(1);
    const rows = whatsappInteractive.mock.calls[0][1].action.sections[0].rows;
    expect(rows.map(r => r.id)).toContain(`training_quiz_${ATTEMPT_ID}_done`);
  });

  it('the question is still answerable and gradable end to end via tap-then-Done', async () => {
    seedWorld();
    // tap the three canonical options that make up the key
    for (const canonical of ['1', '3', '5']) {
      await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_${canonical}`, PHONE);
    }
    await QuizDelivery.handleQuizButton(USER_ID, `training_quiz_${ATTEMPT_ID}_done`, PHONE);

    const graded = answerMutations().pop();
    expect(graded.payload.chosen_option).toBe('1,3,5');
    expect(graded.payload.is_correct).toBe(true);
    expect(advancedTo(1)).toBeTruthy();
    // every hop stayed on the list surface — no Flow was reached for at any point
    expect(whatsappFlow).not.toHaveBeenCalled();
    expect(whatsappInteractive).toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The endpoint's INIT screen data
// ───────────────────────────────────────────────────────────────────────────

describe('endpoint INIT', () => {
  const token = () => `${USER_ID}:training-msq:${ATTEMPT_ID}:0`;

  it('returns the MSQ screen and NEVER a version field', async () => {
    seedWorld();
    const res = await MsqEndpoint.handleTrainingMsqInit(USER_ID, token());

    expect(res.screen).toBe('MSQ_QUESTION');
    expect(Object.prototype.hasOwnProperty.call(res, 'version')).toBe(false);
  });

  it('presents options in the shuffled display order, with CANONICAL ids', async () => {
    seedWorld({ shuffleOptions: true });
    const res = await MsqEndpoint.handleTrainingMsqInit(USER_ID, token());

    const order = expectedDisplayOrder({ shuffle: true });
    expect(res.data.options.map(o => o.id)).toEqual(order.map(String));
    // bd-43496 — the answer text lives in `description` now, not `title`. The
    // Radio/Checkbox title cap is 30 chars, so a title carrying answer text was
    // clipped mid-word by the device and then repeated by the description. The
    // title is the option LETTER; the text is asserted where it now lives.
    expect(res.data.options.map(o => o.title)).toEqual(['A.', 'B.', 'C.', 'D.', 'E.']);
    expect(res.data.options.map(o => o.description))
      .toEqual(order.map(n => MSQ_OPTIONS[n - 1]));
    // the shuffle must actually be doing something, or this test proves nothing
    expect(order).not.toEqual([1, 2, 3, 4, 5]);
  });

  it('pre-checks the partially-answered selection so a resumed question is not lost', async () => {
    seedWorld({
      storedAnswerRow: {
        attempt_id: ATTEMPT_ID, question_index: 0, question_id: QUESTION_ID,
        chosen_option: '3,5', is_correct: false,
      },
    });
    const res = await MsqEndpoint.handleTrainingMsqInit(USER_ID, token());
    expect([...res.data.selected].sort()).toEqual(['3', '5']);
  });

  it('every field it returns is declared in the shipped screen data', async () => {
    seedWorld();
    const res = await MsqEndpoint.handleTrainingMsqInit(USER_ID, token());

    const flow = JSON.parse(fs.readFileSync(FLOW_JSON_PATH, 'utf-8'));
    const screen = flow.screens.find(s => s.id === 'MSQ_QUESTION');
    expect(screen).toBeTruthy();
    const declared = Object.keys(screen.data);
    expect(Object.keys(res.data).filter(k => !declared.includes(k))).toEqual([]);
  });

  it('refuses a token whose user does not own the attempt', async () => {
    seedWorld();
    const res = await MsqEndpoint.handleTrainingMsqInit(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:training-msq:${ATTEMPT_ID}:0`,
    );
    expect(res.data.error).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Submission — canonical storage + grading
// ───────────────────────────────────────────────────────────────────────────

describe('flow submission', () => {
  function payload(selected, { questionIndex = 0 } = {}) {
    return {
      flow_token: `${USER_ID}:training-msq:${ATTEMPT_ID}:${questionIndex}`,
      attempt_ref: `${ATTEMPT_ID}:${questionIndex}`,
      training_msq_action: 'submit',
      selected_options: selected,
    };
  }

  it('stores the exact correct set as a canonical ascending list and advances', async () => {
    seedWorld();
    const ok = await QuizDelivery.handleQuizFlowSubmission(USER_ID, payload(['5', '1', '3']), PHONE);

    expect(ok).toBe(true);
    const graded = answerMutations().pop();
    expect(graded.payload.chosen_option).toBe('1,3,5');
    expect(graded.payload.is_correct).toBe(true);
    expect(advancedTo(1)).toBeTruthy();
  });

  it('a selection made in DISPLAY order still stores canonical ascending', async () => {
    seedWorld({ shuffleOptions: true });
    const order = expectedDisplayOrder({ shuffle: true });
    // the teacher taps the boxes as rendered — ids arrive in display order
    const asRendered = order.filter(n => ['1', '3', '5'].includes(String(n))).map(String);
    expect(asRendered).not.toEqual(['1', '3', '5']); // display order really differs

    await QuizDelivery.handleQuizFlowSubmission(USER_ID, payload(asRendered), PHONE);
    expect(answerMutations().pop().payload.chosen_option).toBe('1,3,5');
  });

  it('accepts the selection when Meta delivers it as a JSON string', async () => {
    seedWorld();
    await QuizDelivery.handleQuizFlowSubmission(USER_ID, payload('["1","3","5"]'), PHONE);
    expect(answerMutations().pop().payload.chosen_option).toBe('1,3,5');
  });

  it('a subset is wrong and still advances', async () => {
    seedWorld();
    await QuizDelivery.handleQuizFlowSubmission(USER_ID, payload(['1', '3']), PHONE);
    const graded = answerMutations().pop();
    expect(graded.payload.chosen_option).toBe('1,3');
    expect(graded.payload.is_correct).toBe(false);
    expect(advancedTo(1)).toBeTruthy();
  });

  it('a superset is wrong', async () => {
    seedWorld();
    await QuizDelivery.handleQuizFlowSubmission(USER_ID, payload(['1', '2', '3', '5']), PHONE);
    expect(answerMutations().pop().payload.is_correct).toBe(false);
  });

  it('ignores a stale submission for a question the attempt has moved past', async () => {
    seedWorld({ questionIndex: 1 });
    const ok = await QuizDelivery.handleQuizFlowSubmission(USER_ID, payload(['1'], { questionIndex: 0 }), PHONE);

    expect(ok).toBe(false);
    expect(answerMutations()).toHaveLength(0);
    expect(attemptMutations().filter(m => m.op === 'update')).toHaveLength(0);
  });

  it('refuses a submission from a user who does not own the attempt', async () => {
    seedWorld();
    const ok = await QuizDelivery.handleQuizFlowSubmission('someone-else', payload(['1', '3', '5']), PHONE);
    expect(ok).toBe(false);
    expect(answerMutations()).toHaveLength(0);
  });

  it('drops option ids that are not real canonical indices for the question', async () => {
    seedWorld();
    await QuizDelivery.handleQuizFlowSubmission(USER_ID, payload(['1', '3', '5', '99', 'done']), PHONE);
    expect(answerMutations().pop().payload.chosen_option).toBe('1,3,5');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Wiring — the three points, plus registration
// ───────────────────────────────────────────────────────────────────────────

describe('flow wiring', () => {
  it('the detector recognises the submission and does not misroute it to attendance', () => {
    const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');
    const submission = {
      flow_token: `${USER_ID}:training-msq:${ATTEMPT_ID}:0`,
      attempt_ref: `${ATTEMPT_ID}:0`,
      training_msq_action: 'submit',
      selected_options: ['1', '3', '5'],
    };
    expect(detectFlowType(submission)).toBe('training_msq');
  });

  it('whatsapp-bot dispatches the training_msq flow type', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'bot/whatsapp-bot.js'), 'utf-8');
    expect(src).toMatch(/flowType === 'training_msq'/);
    expect(src).toMatch(/handleQuizFlowSubmission/);
  });

  it('the flow-response handler knows the flow id (no unknown-flow warning)', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'bot/shared/handlers/flow-response.handler.js'), 'utf-8');
    expect(src).toContain('TRAINING_MSQ_FLOW_ID');
  });

  it('the flow is registered with a real JSON asset and a mounted endpoint', () => {
    const { FLOW_CONFIGS } = require('../../bot/scripts/setup/flow-configs');
    const cfg = FLOW_CONFIGS.find(c => c.envVar === 'TRAINING_MSQ_FLOW_ID');
    expect(cfg).toBeTruthy();
    expect(cfg.type).toBe('endpoint');
    expect(cfg.endpointPath).toBe('/api/flows/training-msq');
    expect(fs.existsSync(cfg.jsonPath)).toBe(true);

    const routes = fs.readFileSync(path.join(REPO_ROOT, 'bot/shared/routes/flow-endpoint.routes.js'), 'utf-8');
    expect(routes).toMatch(/router\.post\(\s*'\/training-msq'/);
  });

  it('the Flow JSON is a single-screen CheckboxGroup bound to dynamic data', () => {
    const flow = JSON.parse(fs.readFileSync(FLOW_JSON_PATH, 'utf-8'));
    expect(flow.data_api_version).toBe('3.0');
    expect(flow.screens).toHaveLength(1);

    const form = flow.screens[0].layout.children.find(c => c.type === 'Form');
    const group = form.children.find(c => c.type === 'CheckboxGroup');
    expect(group['data-source']).toBe('${data.options}');
    expect(group['min-selected-items']).toBe(1);
    // pre-check must be Form-level init-values, never component-level init-value
    expect(form['init-values'][group.name]).toBe('${data.selected}');
    expect(group['init-value']).toBeUndefined();

    // routing_model must not declare a backward route (forward-only)
    for (const targets of Object.values(flow.routing_model || {})) {
      expect(targets).not.toContain('MSQ_QUESTION');
    }
  });
});
