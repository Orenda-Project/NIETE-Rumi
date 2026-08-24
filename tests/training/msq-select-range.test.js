/**
 * bd-2502 — the MSQ Flow told teachers to "Select 1-10" on a 5-option question.
 *
 * `max-selected-items` was hardcoded to 10 in the Flow JSON. Meta renders that
 * bound as a hint, so every multi-answer question — all of which have exactly
 * 5 options today — advertised a ceiling four higher than the number of things
 * on screen. Confirmed live 2026-08-02.
 *
 * Verified against Meta before writing this: `max-selected-items` DOES accept a
 * data binding. Three probe drafts were uploaded; the only validation errors
 * returned were about unrelated keys, and a clean probe returned none at all.
 * So the ceiling can travel with the question instead of being frozen in JSON.
 *
 * The Flow JSON must declare `max_selected`, and the endpoint must send it, or
 * the binding renders as literal text (skill rule 5).
 */
const fs = require('fs');
const path = require('path');

const FLOW = path.join(__dirname, '../../docs/flows/training-msq-flow.json');

describe('bd-2502 — the Flow JSON binds the ceiling instead of freezing it', () => {
  const flow = JSON.parse(fs.readFileSync(FLOW, 'utf8'));
  const screen = flow.screens[0];
  const findCheckbox = (node) => {
    if (Array.isArray(node)) return node.map(findCheckbox).find(Boolean);
    if (node && typeof node === 'object') {
      if (node.type === 'CheckboxGroup') return node;
      return Object.values(node).map(findCheckbox).find(Boolean);
    }
    return undefined;
  };

  it('max-selected-items is data-bound, not a frozen number', () => {
    expect(findCheckbox(screen)['max-selected-items']).toBe('${data.max_selected}');
  });

  it('declares max_selected in the screen data, or the binding renders literally', () => {
    expect(screen.data.max_selected).toBeDefined();
    expect(screen.data.max_selected.__example__).toEqual(expect.any(Number));
  });

  it('keeps a floor of 1 — an empty submission is not an answer', () => {
    expect(findCheckbox(screen)['min-selected-items']).toBe(1);
  });

  // bd-43496 — Meta rejects `max-selected-items < 2` (MINIMUM_VALUE_REQUIRED).
  // A literal 1 fails at upload; a BINDING that resolves to 1 uploads clean and
  // then kills the screen on the device. Both halves are pinned: the JSON must
  // not hardcode a sub-2 number, and buildMsqFlowScreenData must never send one
  // (covered in bd-43496-exam-question-body-cap.test.js).
  it('never hardcodes a checkbox ceiling below Meta\'s floor of 2', () => {
    const max = findCheckbox(screen)['max-selected-items'];
    if (typeof max === 'number') expect(max).toBeGreaterThanOrEqual(2);
    else expect(max).toBe('${data.max_selected}');
  });

  // A CheckboxGroup cannot express "exactly one", so single-answer questions
  // need their own control on the same screen.
  it('offers a RadioButtonsGroup for single-answer questions', () => {
    const findRadio = (node) => {
      if (Array.isArray(node)) return node.map(findRadio).find(Boolean);
      if (node && typeof node === 'object') {
        if (node.type === 'RadioButtonsGroup') return node;
        return Object.values(node).map(findRadio).find(Boolean);
      }
      return undefined;
    };
    const radio = findRadio(screen);
    expect(radio).toBeDefined();
    expect(radio['data-source']).toBe('${data.options}');
    // No min/max properties exist on a radio — that is the whole point.
    expect(radio['max-selected-items']).toBeUndefined();
  });

  // Exactly one control is visible at a time, and `required` is BOUND to the
  // same flag as `visible` — so the shown control demands an answer (an exam
  // question is not optional) while the hidden one can never block submission.
  it('gates the two controls on complementary flags, required tracking visible', () => {
    const all = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object') {
        if (n.type === 'CheckboxGroup' || n.type === 'RadioButtonsGroup') all.push(n);
        Object.values(n).forEach(walk);
      }
    };
    walk(screen);
    expect(all).toHaveLength(2);
    expect(all.map(c => c.visible).sort()).toEqual(['${data.is_multi}', '${data.is_single}']);
    // required === visible, per control: answering is mandatory on the control
    // the teacher can actually see, and never demanded of the hidden one.
    for (const c of all) expect(c.required).toBe(c.visible);
  });
});

describe('bd-2502 — the endpoint sends a ceiling that matches what is on screen', () => {
  // Asserted on the builder's real OUTPUT rather than by grepping its source:
  // a source pattern breaks on any refactor that keeps the behaviour (bd-43496
  // made the ceiling conditional and did exactly that), and it cannot see
  // whether the number is actually right.
  const UID = 'u1', ATTEMPT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', QUIZ = 4, LEVEL = 4;
  let tableStates, chain;

  function makeChain(t) {
    const st = tableStates[t] || {};
    const rec = { filters: {} };
    const c = {};
    const rows = () => {
      let r = st.rows || [];
      for (const [col, v] of Object.entries(rec.filters)) {
        if (v && typeof v === 'object' && Array.isArray(v.in)) r = r.filter(x => v.in.includes(x[col]));
        else if (!col.includes('.')) r = r.filter(x => x[col] === v || String(x[col]) === String(v));
      }
      return r;
    };
    c.select = jest.fn(() => c);
    ['eq','neq','gt','gte','lt','lte','like','ilike','is','not'].forEach(m => { c[m] = jest.fn((col, v) => { rec.filters[col] = v; return c; }); });
    c.in = jest.fn((col, v) => { rec.filters[col] = { in: v }; return c; });
    c.order = jest.fn(() => c); c.limit = jest.fn(() => c);
    c.insert = jest.fn(() => c); c.update = jest.fn(() => c); c.upsert = jest.fn(() => c);
    c.maybeSingle = jest.fn(async () => ({ data: rows()[0] || null, error: null }));
    c.single = jest.fn(async () => ({ data: rows()[0] || null, error: null }));
    c.then = (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
    return c;
  }

  /** One in-progress attempt on a question with `nOptions` options. */
  function seed(correctOption, nOptions) {
    tableStates = {
      training_assessment_attempts: { rows: [{
        id: ATTEMPT, user_id: UID, quiz_kind: 'grand', grand_quiz_id: QUIZ,
        training_module_id: null, level_id: LEVEL, current_question_index: 0,
        total_questions: 1, status: 'in_progress',
      }] },
      training_questions: { rows: [{
        id: 1, grand_quiz_id: QUIZ, training_module_id: null, order_index: 0, is_active: true,
        question_text: 'Q', correct_option: correctOption,
        options: Array.from({ length: nOptions }, (_, i) => `opt${i + 1}`),
      }] },
      training_assessment_answers: { rows: [] },
      training_levels: { rows: [{ id: LEVEL, vendor_id: 'v1', order_index: 3, is_active: true }] },
      training_vendors: { rows: [{ id: 'v1', key: 'TALEEMABAD', exam_question_cap: null, shuffle_options: false, module_quiz_strategy: 'all' }] },
      training_grand_quizzes: { rows: [{ id: QUIZ, level_id: LEVEL, quiz_type: 'grand_quiz', is_active: true }] },
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
    ['@aws-sdk/client-s3','@aws-sdk/s3-request-presigner','exceljs','pdfkit','bullmq','aws-sdk'].forEach(m => jest.doMock(m, () => ({}), { virtual: true }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
    chain = jest.fn(t => makeChain(t));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: chain, rpc: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendInteractiveButtons: jest.fn(), sendInteractiveMessage: jest.fn(), sendFlow: jest.fn() }));
  });
  afterEach(() => jest.resetModules());

  const build = () => require('../../bot/shared/services/training/quiz-delivery.service').buildMsqFlowScreenData;

  it('a multi-answer question may select every option on screen', async () => {
    seed('1,3', 5);
    const data = await build()(UID, ATTEMPT, 0);
    expect(data.max_selected).toBe(data.options.length);
  });

  it('tracks the rendered count, not a constant', async () => {
    seed('1,3', 4);
    const data = await build()(UID, ATTEMPT, 0);
    expect(data.options.length).toBe(4);
    expect(data.max_selected).toBe(4);
  });

  // bd-43496 — single-answer questions now reach this Flow too (it is the only
  // surface that fits an oversized question), but they are served by the
  // RadioButtonsGroup, NOT by a checkbox capped at 1: Meta enforces
  // `max-selected-items >= 2`, and a binding that resolves to 1 kills the screen
  // on the device after it has already rendered. So the single-answer case is
  // asserted on the visibility flags, and the ceiling stays at or above the floor.
  it('a single-answer question is gated onto the radio, not a 1-capped checkbox', async () => {
    seed('2', 4);
    const data = await build()(UID, ATTEMPT, 0);
    expect(data.options.length).toBe(4);
    expect(data.is_single).toBe(true);
    expect(data.is_multi).toBe(false);
    expect(data.max_selected).toBeGreaterThanOrEqual(2);
  });
});
