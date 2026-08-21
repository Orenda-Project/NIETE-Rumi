/**
 * bd-43491 — a passed DIAGNOSTIC must not certify the LEVEL.
 *
 * The third instance of one bug class, after bd-2391 (a module quick check
 * certified a level) and bd-2485 (a capstone pass did NOT certify one). Both
 * were fixed on the `quiz_kind` axis — the shape of the ATTEMPT. This is the
 * axis they left open: the TYPE of the QUIZ the attempt was sat against.
 *
 * `training_grand_quizzes` holds three types against the same levels:
 *   grand_quiz  — the NIETE level exam        → certifies
 *   capstone    — the Beacon House terminal   → certifies
 *   diagnostic  — the test that gates ENTRY   → does NOT certify
 *
 * A diagnostic attempt is legitimately stored with quiz_kind='grand' (the
 * table's check constraint allows only grand / training_module / capstone, so
 * there is no third kind for it to take). `isGrandPass` therefore accepted it,
 * while the level's exam lookup and the certificate service both correctly
 * ignored it. The level screen said "passed" and no certificate existed.
 *
 * Production state that prompted this (NIETE prod, 2026-08-21):
 *   - 1,462 (user, level) pairs read as passed with no exam pass and no
 *     certificate, across 1,452 teachers — 674 on Skilled Practitioner,
 *     668 on Teacher Leader, 120 on Emerging Practitioner.
 *   - Sofia Safdar (the teacher named in the report) on Teacher Leader:
 *     a passed diagnostic (quiz 5, 80/45) alongside a genuinely FAILED exam
 *     (quiz 4). The screen showed passed; the database said failed; no
 *     certificate was ever due.
 *
 * Contract: only an attempt sat against a quiz whose quiz_type is an EXAM type
 * (grand_quiz or capstone) may make a level `certified`, satisfy a chain-lock's
 * previous-level requirement, or report the level exam as already passed.
 */

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null };
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
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: applyFilters(rows)[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    rows = applyFilters(rows);
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -1 * dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: rows, error: null };
  };
  chain.select = jest.fn(() => chain);
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

const V_NIETE = 'v-niete';
const UID = 'u1';

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
 * Sofia's production shape, reduced to two levels.
 *
 * Levels 3 and 4 are both fully complete (every module done), so each is
 * ready_for_quiz on merit. Level 3 carries a real exam pass. Level 4 carries a
 * passed DIAGNOSTIC (quiz 5) and nothing else — exactly the state that read as
 * certified with no certificate.
 *
 * Both diagnostics and exams are seeded against level 4 because that is the
 * real catalogue: quiz 4 is its grand_quiz, quiz 5 its diagnostic.
 */
function seed() {
  tableStates.teacher_training_assignments = {
    rows: [{ user_id: UID, program_id: 'p1', is_active: true }],
  };
  tableStates.training_program_scopes = {
    rows: [{ program_id: 'p1', vendor_id: V_NIETE, level_ids: [3, 4] }],
  };
  tableStates.training_vendors = {
    rows: [{ id: V_NIETE, key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', has_grand_quiz: true }],
  };
  tableStates.training_levels = {
    rows: [
      { id: 3, name: 'Skilled Practitioner', order_index: 2, vendor_id: V_NIETE, is_active: true, cpd_level: 2 },
      { id: 4, name: 'Teacher Leader', order_index: 3, vendor_id: V_NIETE, is_active: true, cpd_level: 3 },
    ],
  };
  tableStates.training_courses = {
    rows: [
      { id: 21, level_id: 3, is_active: true },
      { id: 30, level_id: 4, is_active: true },
    ],
  };
  tableStates.training_modules = {
    rows: [
      { id: 104, course_id: 21, is_active: true },
      { id: 300, course_id: 30, is_active: true },
    ],
  };
  // Every module in both levels is done → both are ready_for_quiz on merit.
  tableStates.teacher_training_progress = {
    rows: [
      { user_id: UID, module_id: 104, module: { course_id: 21 } },
      { user_id: UID, module_id: 300, module: { course_id: 30 } },
    ],
  };
  // Level 3: a real exam pass (quiz 7). Level 4: a passed DIAGNOSTIC (quiz 5)
  // plus a genuinely failed exam (quiz 4) — Sofia's exact production rows.
  tableStates.training_assessment_attempts = {
    rows: [
      {
        user_id: UID, level_id: 3, quiz_kind: 'grand', grand_quiz_id: 7,
        training_module_id: null, status: 'passed', is_passed: true,
        cooldown_until: null, completed_at: '2026-07-01T09:59:57Z',
      },
      {
        user_id: UID, level_id: 4, quiz_kind: 'grand', grand_quiz_id: 5,
        training_module_id: null, status: 'passed', is_passed: true,
        cooldown_until: null, completed_at: '2026-07-01T10:15:09Z',
      },
      {
        user_id: UID, level_id: 4, quiz_kind: 'grand', grand_quiz_id: 4,
        training_module_id: null, status: 'failed', is_passed: false,
        cooldown_until: null, completed_at: '2026-07-02T10:49:28Z',
      },
    ],
  };
  tableStates.training_grand_quizzes = {
    rows: [
      { id: 7, level_id: 3, quiz_type: 'grand_quiz', is_active: true },
      { id: 6, level_id: 3, quiz_type: 'diagnostic', is_active: true },
      { id: 4, level_id: 4, quiz_type: 'grand_quiz', is_active: true },
      { id: 5, level_id: 4, quiz_type: 'diagnostic', is_active: true },
    ],
  };
  tableStates.training_questions = { rows: [] };
  tableStates.training_certificates = { rows: [{ user_id: UID, level_id: 3 }] };
}

describe('bd-43491 — WhatsApp Flow: level state', () => {
  test('a passed diagnostic does NOT make the level certified', async () => {
    seed();
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);
    const lv4 = levels.find(l => l.id === 4);

    expect(lv4).toBeDefined();
    // The level she has NOT passed must not claim she has.
    expect(lv4.state).not.toBe('certified');
    // She finished the modules, so the exam is hers to sit — and the failed
    // attempt carries no live cooldown.
    expect(lv4.state).toBe('ready_for_quiz');
  });

  test('a real exam pass still certifies the level', async () => {
    seed();
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);

    // The guard must not overshoot: level 3's grand_quiz pass still counts.
    expect(levels.find(l => l.id === 3).state).toBe('certified');
  });

  test('a passed diagnostic does NOT chain-unlock the next level', async () => {
    seed();
    // Level 4's own exam pass is what should open a level 5, not its
    // diagnostic. Add one to prove the previous-level check reads the same way.
    tableStates.training_levels.rows.push({
      id: 5, name: 'Master Teacher', order_index: 4, vendor_id: V_NIETE, is_active: true, cpd_level: 4,
    });
    tableStates.training_program_scopes.rows[0].level_ids = [3, 4, 5];
    tableStates.training_courses.rows.push({ id: 40, level_id: 5, is_active: true });
    tableStates.training_modules.rows.push({ id: 400, course_id: 40, is_active: true });
    tableStates.training_grand_quizzes.rows.push({ id: 8, level_id: 5, quiz_type: 'grand_quiz', is_active: true });
    // Level 5's own modules are done too, so 'locked' can only come from the
    // chain gate — not from an absence of progress. Without this the level
    // reads 'not_started' whether the gate holds or leaks, and the assertion
    // could not tell the two apart.
    tableStates.teacher_training_progress.rows.push({
      user_id: UID, module_id: 400, module: { course_id: 40 },
    });

    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);

    expect(levels.find(l => l.id === 5).state).toBe('locked');
  });
});

describe('bd-43491 — WhatsApp Flow: LEVEL_DETAIL grand-quiz gate', () => {
  test('the exam is still offered when only a diagnostic was passed', async () => {
    seed();
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const gate = await ep.loadGrandQuizState(UID, 4);

    // The screen must not tell her she has passed a level exam she has not sat.
    expect(gate.cta).not.toBe('✓ Passed');
    expect(gate.body).not.toMatch(/You passed this level exam/i);
  });

  test('the gate still reports a genuinely passed exam as passed', async () => {
    seed();
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const gate = await ep.loadGrandQuizState(UID, 3);

    // The guard must not overshoot: level 3's real grand_quiz pass still shows.
    expect(gate.cta).toBe('✓ Passed');
  });
});
