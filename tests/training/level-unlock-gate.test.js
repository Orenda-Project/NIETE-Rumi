/**
 * bd-2479 — checkLevelUnlocked, the level-scoped gate.
 *
 * The portal asks "may this teacher open this level's contents?" before every
 * courses / modules / questions / quiz-submit call, and until now answered it
 * with its own copy of the rule. That copy had drifted in three ways, one of
 * which is encoded below as an explicit test: the portal's isGrandPass accepts
 * only quiz_kind='grand', so a level certified by a CAPSTONE reads as
 * un-passed and the next level stays locked forever.
 *
 * That is not hypothetical. The first Beacon House capstone certificate was
 * issued on 2026-08-01; the portal cannot see it.
 *
 * These tests drive the real loadVisibleLevelsWithProgress through the supabase
 * mock rather than stubbing it, because the value of this function is entirely
 * in which level state it reads and how it derives the previous level.
 *
 * Display numbering is 0-based for ladder vendors (bd-2235) — deliberately, and
 * the message here reuses the Flow's existing phrasing at
 * teacher-training-endpoint.js:353 rather than inventing a second one.
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
  const rowsNow = () => applyFilters(typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const r = rowsNow();
    if (record.isCount) return { count: r.length, data: null, error: null };
    return { data: r[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let r = rowsNow();
    if (record.isCount) return { count: r.length, data: null, error: null };
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      r = [...r].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: r, error: null };
  };
  chain.select = jest.fn((_c, opts) => {
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

const UID = 'u1';
const VENDOR = 'v-chain';
const L1 = 11;   // order_index 1 — first in the ladder, never chain-locked
const L2 = 12;   // order_index 2 — locked until L1's exam is passed

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn(), PutObjectCommand: jest.fn() }), { virtual: true });
  jest.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }), { virtual: true });
  jest.doMock('exceljs', () => ({ Workbook: jest.fn() }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
  jest.doMock('bullmq', () => ({ Queue: jest.fn(), Worker: jest.fn() }), { virtual: true });
  jest.doMock('aws-sdk', () => ({ SQS: jest.fn() }), { virtual: true });
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
 * Two chain-locked levels, one course of two modules each.
 * `attempts` seeds exam history on L1, which is what unlocks L2.
 */
function seed({ attempts = [], done = [] } = {}) {
  tableStates.users = { rows: [{ id: UID, name: 'A', phone_number: '92300' }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: [L1, L2] }] };
  tableStates.training_vendors = {
    rows: [{ id: VENDOR, key: 'CHAINVENDOR', name: 'Chain', unlock_logic: 'chain', has_grand_quiz: true, passing_pct: 80, module_passing_pct: 100 }],
  };
  tableStates.training_levels = {
    rows: [
      { id: L1, name: 'One', order_index: 1, vendor_id: VENDOR, is_active: true, cpd_level: null },
      { id: L2, name: 'Two', order_index: 2, vendor_id: VENDOR, is_active: true, cpd_level: null },
    ],
  };
  tableStates.training_courses = { rows: [
    { id: 1, level_id: L1, is_active: true, title: 'C1', order_index: 1 },
    { id: 2, level_id: L2, is_active: true, title: 'C2', order_index: 1 },
  ] };
  tableStates.training_modules = { rows: [
    { id: 101, course_id: 1, is_active: true, title: 'M1', order_index: 1 },
    { id: 102, course_id: 1, is_active: true, title: 'M2', order_index: 2 },
    { id: 201, course_id: 2, is_active: true, title: 'M3', order_index: 1 },
    { id: 202, course_id: 2, is_active: true, title: 'M4', order_index: 2 },
  ] };
  tableStates.teacher_training_progress = { rows: done.map(id => ({ user_id: UID, module_id: id })) };
  tableStates.training_assessment_attempts = { rows: attempts };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [
    { id: 7, level_id: L1, quiz_type: 'grand_quiz', is_active: true },
    { id: 8, level_id: L2, quiz_type: 'grand_quiz', is_active: true },
  ] };
  tableStates.training_questions = { rows: [] };
  tableStates.training_certificates = { rows: [] };
}

const ep = () => require('../../bot/shared/routes/teacher-training-endpoint');

describe('bd-2479 — checkLevelUnlocked', () => {
  it('opens the first level in a ladder, which has nothing before it', async () => {
    seed();
    const gate = await ep().checkLevelUnlocked(UID, L1);
    expect(gate.ok).toBe(true);
  });

  it('refuses a chain-locked level with 403', async () => {
    seed();
    const gate = await ep().checkLevelUnlocked(UID, L2);
    expect(gate.ok).toBe(false);
    expect(gate.status).toBe(403);
  });

  it('reports the previous level using the 0-based display convention (bd-2235)', async () => {
    seed();
    const gate = await ep().checkLevelUnlocked(UID, L2);
    // L2 is order_index 2, so the level before it displays as 1.
    expect(gate.previous_level_order).toBe(1);
    expect(gate.message).toContain('Level 1');
  });

  it('opens the next level once the previous level exam is passed', async () => {
    seed({ attempts: [{ id: 'a1', user_id: UID, level_id: L1, is_passed: true, quiz_kind: 'grand', status: 'passed' }] });
    const gate = await ep().checkLevelUnlocked(UID, L2);
    expect(gate.ok).toBe(true);
  });

  it('accepts a CAPSTONE pass as a level pass — the rule the portal copy denies', async () => {
    // bd-2474: for all_modules vendors the capstone IS the level exam, and
    // isGrandPass accepts it regardless of vendor. The portal's own copy tests
    // `quiz_kind === 'grand'` and would leave this level locked.
    seed({ attempts: [{ id: 'a1', user_id: UID, level_id: L1, is_passed: true, quiz_kind: 'capstone', status: 'passed' }] });
    const gate = await ep().checkLevelUnlocked(UID, L2);
    expect(gate.ok).toBe(true);
  });

  it('does NOT accept a module quiz as a level pass (bd-2391)', async () => {
    seed({ attempts: [{ id: 'a1', user_id: UID, level_id: L1, is_passed: true, quiz_kind: 'training_module', status: 'passed' }] });
    const gate = await ep().checkLevelUnlocked(UID, L2);
    expect(gate.ok).toBe(false);
  });

  it('404s a level outside this teacher\'s programme', async () => {
    seed();
    const gate = await ep().checkLevelUnlocked(UID, 9999);
    expect(gate.ok).toBe(false);
    expect(gate.status).toBe(404);
  });

  it('404s a non-numeric level id without touching the catalogue', async () => {
    seed();
    const gate = await ep().checkLevelUnlocked(UID, 'not-a-level');
    expect(gate.ok).toBe(false);
    expect(gate.status).toBe(404);
  });

  it('returns the level itself so a caller need not re-fetch it', async () => {
    seed();
    const gate = await ep().checkLevelUnlocked(UID, L1);
    expect(gate.level).toMatchObject({ id: L1, order_index: 1 });
  });
});

/**
 * bd-2485 — found by the capstone case above.
 *
 * bd-2474 widened isGrandPass and EXAM_QUIZ_TYPES to accept capstones, but
 * missed the attempts query inside loadVisibleLevelsWithProgress:
 *
 *     .eq('quiz_kind', 'grand')
 *
 * So the in-memory guard correctly accepts a capstone that the query already
 * excluded. A capstone pass therefore never sets state='certified', with three
 * consequences — all live, since the first capstone certificate was issued
 * 2026-08-01:
 *
 *   1. The level renders as ready_for_quiz rather than certified.
 *   2. assertCanStartGrandQuiz never reaches its already_passed branch, so the
 *      exam can be re-sat — and issueCertificate dedupes per attempt_id, not
 *      per level, so a re-pass mints a SECOND certificate. That is exactly the
 *      bug bd-2453 fixed for grand quizzes, still open for capstones.
 *   3. For a chain vendor, the next level stays locked forever.
 *
 * The select must carry quiz_kind too: widen the filter without it and every
 * row defaults to 'grand' in isGrandPass, leaving the guard blind.
 */
describe('bd-2485 — a capstone pass certifies its level', () => {
  const capstonePass = [{
    id: 'a1', user_id: UID, level_id: L1, is_passed: true,
    quiz_kind: 'capstone', status: 'passed', completed_at: '2026-08-01T19:55:47Z',
  }];

  it('marks the level certified, not ready_for_quiz', async () => {
    seed({ attempts: capstonePass });
    const levels = await ep().loadVisibleLevelsWithProgress(UID);
    expect(levels.find(l => l.id === L1).state).toBe('certified');
  });

  it('refuses a re-sit, so no duplicate certificate can be minted', async () => {
    seed({ attempts: capstonePass });
    // L1 is order_index 1, and assertCanStartGrandQuiz takes a 1-based order.
    const gate = await ep().assertCanStartGrandQuiz(UID, 2, 'CHAINVENDOR');
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('already_passed');
  });

  it('still refuses to treat a module quiz as a level pass', async () => {
    seed({ attempts: [{ id: 'a2', user_id: UID, level_id: L1, is_passed: true, quiz_kind: 'training_module', status: 'passed' }] });
    const levels = await ep().loadVisibleLevelsWithProgress(UID);
    expect(levels.find(l => l.id === L1).state).not.toBe('certified');
  });
});
