/**
 * bd-2448 — a teacher must not be able to skip ahead through the module picker.
 *
 * The bot's own delivery path has always been sequential: deliverNextModule
 * picks the lowest order_index module without a progress row. The Flow's
 * LEVEL_DETAIL dropdown drove straight around it — `module_list` was built
 * from every module in the level with no gate, and `open_module` handed the
 * chosen id to deliverModuleById, which looks it up and sends it. A teacher
 * could open the last module of the last course on day one.
 *
 * Contract ("next-up + review"):
 *   1. Already-passed modules stay selectable — re-watching is the point.
 *   2. Exactly ONE unpassed module is selectable: the first in level order.
 *   3. Everything after it is locked, and the picker says so.
 *   4. Order is course order_index, then module order_index — the same order
 *      loadModulesWithProgress already renders, so course 2 stays shut while
 *      course 1 is unfinished.
 *   5. Selecting a locked module is REFUSED server-side, not just discouraged
 *      in the label. The published Flow's item schema is {id,title,description}
 *      with no `enabled` field, and per .claude/skills/whatsapp-flows a
 *      published Flow's JSON cannot be edited in place — so the label is
 *      advisory and the server is the actual gate.
 *
 * The lock rule lives in ONE function (annotateModuleLocks) used by both the
 * picker that renders the list and the gate that refuses the tap. Two copies
 * of "which module is next" is precisely how the label and the handler drift
 * apart (see bd-2446).
 */

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, orderCol: null, orderDir: null };
  const chain = {};
  const applyFilters = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) out = out.filter(r => val.in.includes(r[col]));
      else if (!col.includes('.')) out = out.filter(r => r[col] === val);
    }
    return out;
  };
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = applyFilters(typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
    if (record.isCount) return { count: rows.length, data: null, error: null };
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = applyFilters(typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
    if (record.isCount) return { count: rows.length, data: null, error: null };
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: rows, error: null };
  };
  chain.select = jest.fn((_cols, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => { record.orderCol = col; record.orderDir = opts && opts.ascending ? 'asc' : 'desc'; return chain; });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

const VENDOR = 'v-niete';
const UID = 'u1';
const LEVEL = 3;

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  supabaseFrom = jest.fn((t) => makeChain(t));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  }));
});

afterEach(() => jest.resetModules());

/**
 * Two courses of three modules each. Module ids are c*100+m, so the level
 * order is 101, 102, 103, 201, 202, 203.
 */
function seed({ doneModuleIds = [] } = {}) {
  tableStates.users = { rows: [{ id: UID, name: 'Aisha', phone_number: '92300', school_name: 'X' }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: [LEVEL] }] };
  tableStates.training_vendors = {
    rows: [{ id: VENDOR, key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', has_grand_quiz: true, passing_pct: 80 }],
  };
  tableStates.training_levels = {
    rows: [{ id: LEVEL, name: 'Skilled Practitioner', order_index: 0, vendor_id: VENDOR, is_active: true, cpd_level: null }],
  };
  const courseRows = [];
  const moduleRows = [];
  for (let c = 1; c <= 2; c++) {
    courseRows.push({ id: c, level_id: LEVEL, is_active: true, title: `Course ${c}`, order_index: c });
    for (let m = 1; m <= 3; m++) {
      moduleRows.push({ id: c * 100 + m, course_id: c, is_active: true, title: `Module ${c}.${m}`, order_index: m });
    }
  }
  tableStates.training_courses = { rows: courseRows };
  tableStates.training_modules = { rows: moduleRows };
  tableStates.teacher_training_progress = {
    rows: doneModuleIds.map(id => ({
      user_id: UID, module_id: id,
      module: { course_id: moduleRows.find(m => m.id === id)?.course_id },
    })),
  };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [{ id: 7, level_id: LEVEL, quiz_type: 'grand_quiz', is_active: true }] };
  tableStates.training_questions = { rows: [] };
}

const ORDER = [101, 102, 103, 201, 202, 203];

function ep() {
  return require('../../bot/shared/routes/teacher-training-endpoint');
}

/**
 * module_id → its rendered description, from the real LEVEL_DETAIL payload.
 * Driven through the actual data_exchange route (TRAINING_HOME → open_level)
 * rather than a direct call, so the test exercises the path the Flow uses.
 */
async function pickerRows() {
  const detail = await ep().handleTeacherTrainingDataExchange(UID, 'TRAINING_HOME', {
    _action: 'open_level',
    _level_order: '1',
  });
  expect(detail.screen).toBe('LEVEL_DETAIL');
  const out = new Map();
  for (const row of detail.data.module_list) out.set(Number(row.id), row.description);
  return out;
}

/** Attempt to open a module through the real data_exchange path. */
async function openModule(moduleId) {
  return ep().handleTeacherTrainingDataExchange(UID, 'LEVEL_DETAIL', {
    _action: 'open_module',
    module_id: String(moduleId),
  });
}

const wasDelivered = (res) => res?.data?.extension_message_response?.params?.training_action === 'open_module';
const wasRefused = (res) => res?.data?.extension_message_response?.params?.training_action === 'error';

describe('bd-2448 — the picker marks what is open and what is locked', () => {
  test('a fresh teacher sees module 1 as next up and everything else locked', async () => {
    seed({ doneModuleIds: [] });

    const rows = await pickerRows();

    expect(rows.get(101)).toMatch(/next up/i);
    for (const id of ORDER.slice(1)) expect(rows.get(id)).toMatch(/locked/i);
  });

  test('passed modules read as passed and stay listed for review', async () => {
    seed({ doneModuleIds: [101, 102] });

    const rows = await pickerRows();

    expect(rows.get(101)).toMatch(/passed/i);
    expect(rows.get(102)).toMatch(/passed/i);
    expect(rows.get(101)).not.toMatch(/locked/i);
  });

  test('exactly one unpassed module is ever open', async () => {
    seed({ doneModuleIds: [101, 102] });

    const rows = await pickerRows();

    const open = ORDER.filter(id => /next up/i.test(rows.get(id) || ''));
    expect(open).toEqual([103]);
  });

  test('course 2 stays locked while course 1 is unfinished', async () => {
    // Course order_index beats module order_index — 103 comes before 201.
    seed({ doneModuleIds: [101, 102] });

    const rows = await pickerRows();

    expect(rows.get(201)).toMatch(/locked/i);
    expect(rows.get(202)).toMatch(/locked/i);
  });

  test('finishing course 1 opens the first module of course 2', async () => {
    seed({ doneModuleIds: [101, 102, 103] });

    const rows = await pickerRows();

    expect(rows.get(201)).toMatch(/next up/i);
    expect(rows.get(202)).toMatch(/locked/i);
  });

  test('a fully finished level has nothing locked', async () => {
    seed({ doneModuleIds: ORDER });

    const rows = await pickerRows();

    for (const id of ORDER) expect(rows.get(id)).not.toMatch(/locked/i);
  });
});

describe('bd-2448 — the server refuses a locked module, not just the label', () => {
  test('the reported bug: opening the last module on day one is refused', async () => {
    seed({ doneModuleIds: [] });

    const res = await openModule(203);

    expect(wasDelivered(res)).toBe(false);
    expect(wasRefused(res)).toBe(true);
  });

  test('the refusal names what to finish first', async () => {
    seed({ doneModuleIds: [] });

    const res = await openModule(203);

    expect(String(res.data.message)).toMatch(/Module 1\.1/);
  });

  test('the next-up module opens', async () => {
    seed({ doneModuleIds: [101, 102] });

    const res = await openModule(103);

    expect(wasDelivered(res)).toBe(true);
    expect(res.data.extension_message_response.params.module_id).toBe('103');
  });

  test('an already-passed module opens for review', async () => {
    seed({ doneModuleIds: [101, 102] });

    const res = await openModule(101);

    expect(wasDelivered(res)).toBe(true);
  });

  test('the module one step past next-up is refused', async () => {
    // The off-by-one that a naive "is it the next id" check would let through.
    seed({ doneModuleIds: [101] });

    const res = await openModule(103);

    expect(wasRefused(res)).toBe(true);
  });

  test('a module id from outside the teacher\'s levels is refused, not delivered', async () => {
    seed({ doneModuleIds: [] });

    const res = await openModule(999999);

    expect(wasDelivered(res)).toBe(false);
  });
});
