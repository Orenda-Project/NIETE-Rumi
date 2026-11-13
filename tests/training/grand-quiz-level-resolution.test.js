/**
 * bd-2392 — startGrandQuiz must resolve the level within the teacher's own
 * scoped catalog, not by a global order_index lookup.
 *
 * `training_levels.order_index` is per-VENDOR, so it is not unique:
 *
 *   order_index 1 → NIETE Emerging Practitioner  AND  Beacon House English
 *   order_index 2 → NIETE Skilled Practitioner   AND  Beacon House Mathematics
 *   order_index 3 → NIETE Teacher Leader         AND  Beacon House Gen Science
 *   order_index 4 → Oxbridge Game-Based Teaching AND  Beacon House Comp Science
 *
 * The old lookup was `.eq('order_index', n).maybeSingle()` with no vendor
 * filter. Two rows match, maybeSingle() errors, and the teacher gets
 * "Could not find that level. Send /training to try again." — i.e. EVERY NIETE
 * level exam except Aspiring Teacher (order_index 0) was unreachable.
 *
 * bd-2393 — the pass bar in the teacher-facing copy must come from the vendor
 * (NIETE 80%), not the hardcoded "100% required to pass".
 */

let QuizDelivery;
let tableStates;
let whatsappSend;
let whatsappInteractive;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, mutation: null };
  const chain = {};
  const applyFilters = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) out = out.filter(r => val.in.includes(r[col]));
      else if (!col.includes('.')) out = out.filter(r => r[col] === val);
    }
    return out;
  };
  const track = () => {
    if (record.mutation && !record._t) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._t = true;
    }
  };
  const rowsNow = () => applyFilters(
    typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || [])
  );
  const finalize = () => {
    track();
    if (record.isCount) return { count: rowsNow().length, data: null, error: null };
    // An insert(...).select().single() returns the created row, not a query
    // result — mirror that so callers get an id back.
    if (record.mutation && record.mutation.op === 'insert' && state.inserted) {
      return { data: state.inserted, error: null };
    }
    const rows = rowsNow();
    // Real PostgREST: .maybeSingle() ERRORS when more than one row matches.
    if (rows.length > 1) {
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
    }
    if (state.error) return { data: null, error: state.error };
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    track();
    if (record.isCount) return { count: rowsNow().length, data: null, error: null };
    if (state.error) return { data: null, error: state.error };
    return { data: rowsNow(), error: null };
  };
  chain.select = jest.fn((_c, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn((p) => { record.mutation = { op: 'insert', payload: p }; return chain; });
  chain.update = jest.fn((p) => { record.mutation = { op: 'update', payload: p }; return chain; });
  chain.upsert = jest.fn((p, o) => { record.mutation = { op: 'upsert', payload: p, opts: o }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not', 'contains'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (res, rej) => Promise.resolve(finalizeMany()).then(res, rej);
  return chain;
}

const V_NIETE = 'v-niete';
const V_BH = 'v-bh';
const UID = 'u1';
const PHONE = '923433890650';

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((t) => makeChain(t)), rpc: jest.fn(),
  }));
  whatsappSend = jest.fn().mockResolvedValue(true);
  whatsappInteractive = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: whatsappSend,
    sendInteractiveMessage: whatsappInteractive,
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));

  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
});

afterEach(() => jest.resetModules());

/** The real production shape: NIETE and Beacon House share order_index values. */
function seed() {
  tableStates.training_vendors = {
    rows: [
      { id: V_NIETE, key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', has_grand_quiz: true, passing_pct: 80, module_passing_pct: 100 },
      { id: V_BH, key: 'BEACONHOUSE', name: 'Beacon House', unlock_logic: 'all_modules', has_grand_quiz: false, passing_pct: 70, module_passing_pct: 70 },
    ],
  };
  tableStates.training_levels = {
    rows: [
      { id: 3, name: 'Skilled Practitioner', order_index: 2, vendor_id: V_NIETE, is_active: true },
      { id: 19, name: 'Mathematics', order_index: 2, vendor_id: V_BH, is_active: true },   // ← collision
    ],
  };
  tableStates.training_grand_quizzes = {
    rows: [{ id: 7, level_id: 3, quiz_type: 'grand_quiz', is_active: true }],
  };
  tableStates.training_questions = {
    rows: Array.from({ length: 10 }, (_, i) => ({
      id: 900 + i, grand_quiz_id: 7, question_text: `GQ Q${i + 1}`,
      options: ['A', 'B', 'C', 'D'], correct_option: '1', is_active: true, order_index: i,
    })),
  };
  tableStates.teacher_training_assignments = {
    rows: [{ user_id: UID, program_id: 'p1', is_active: true, program: { id: 'p1' } }],
  };
  tableStates.training_program_scopes = {
    rows: [{ program_id: 'p1', vendor_id: V_NIETE, level_ids: [3, 4] }],
  };
  tableStates.training_courses = { rows: [{ id: 21, level_id: 3, is_active: true }] };
  tableStates.training_modules = { rows: [{ id: 104, course_id: 21, is_active: true }] };
  tableStates.teacher_training_progress = { rows: [{ user_id: UID, module_id: 104 }] };
  // `.insert(...).select('id').single()` must yield the new attempt, and the
  // later sendQuestion() re-reads the full row by id. Keyed on the filter so
  // the pre-insert "existing attempt?" probe still sees nothing.
  tableStates.training_assessment_attempts = {
    inserted: { id: 'gq-attempt-1' },
    rows: (f) => (f.id ? [{
      id: 'gq-attempt-1', user_id: UID, quiz_kind: 'grand', grand_quiz_id: 7,
      training_module_id: null, level_id: 3, program_id: 'p1',
      current_question_index: 0, total_questions: 10, status: 'in_progress',
    }] : []),
  };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_certificates = { rows: [] };
}

describe('bd-2392 — grand quiz level resolution', () => {
  test('does not fail with "could not find that level" when order_index collides', async () => {
    seed();
    await QuizDelivery.startGrandQuiz(UID, 3 /* levelOrder = order_index+1 */, PHONE);

    const said = whatsappSend.mock.calls.map(c => String(c[1])).join('\n');
    expect(said).not.toMatch(/Could not find that level/i);
    expect(said).not.toMatch(/Could not start the exam/i);
  });

  test('creates a grand attempt on the NIETE level, not the Beacon House one', async () => {
    seed();
    await QuizDelivery.startGrandQuiz(UID, 3, PHONE);

    const inserts = (tableStates.training_assessment_attempts._mutations || [])
      .filter(m => m.op === 'insert');
    expect(inserts.length).toBeGreaterThan(0);
    const payload = inserts[0].payload;
    expect(payload.level_id).toBe(3);        // Skilled Practitioner, NOT 19
    expect(payload.grand_quiz_id).toBe(7);
    expect(payload.quiz_kind).toBe('grand');
  });
});

describe('bd-2393 — the pass bar shown to the teacher', () => {
  test('the intro says 80% for NIETE, not 100%', async () => {
    seed();
    await QuizDelivery.startGrandQuiz(UID, 3, PHONE);

    const said = whatsappSend.mock.calls.map(c => String(c[1])).join('\n')
      + whatsappInteractive.mock.calls.map(c => JSON.stringify(c[1])).join('\n');
    expect(said).not.toMatch(/100% to pass/i);
    expect(said).not.toMatch(/100% required/i);
    expect(said).toMatch(/80%/);
  });
});

// bd-r2uzg1.10 — the exam intro numbers the level the way its certificate
// does (CPD-LEVEL-2 SKILLED PRACTITIONER) and the training Flow does (bd-2235),
// not order_index + 1.
describe('bd-r2uzg1.10 — the exam intro names the level by its certificate number', () => {
  test('Skilled Practitioner (order_index 2) is announced as Level 2', async () => {
    seed();
    await QuizDelivery.startGrandQuiz(UID, 3, PHONE);

    const said = whatsappSend.mock.calls.map(c => String(c[1])).join('\n');
    expect(said).toContain('Level 2 · Skilled Practitioner — Grand Quiz');
    expect(said).not.toMatch(/Level 3 · Skilled Practitioner/);
  });
});
