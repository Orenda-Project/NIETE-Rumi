/**
 * bd-2234 — per-subject certificates for all_modules vendors.
 *
 * NIETE team rules (21 Jul): Oxbridge — complete all 7 trainings with at
 * least 70% in each module quiz → certificate. Beacon House — modules +
 * capstone (the capstone path issues its own cert, covered in
 * capstone-delivery.test.js).
 *
 * Contract (certificate.service.maybeIssueQuizScoreCertificate):
 *   Fires after a module quiz is graded. Issues the level certificate ONLY
 *   when: the module's vendor is all_modules AND the level has NO capstone
 *   quiz (capstone levels certify through the capstone) AND every active
 *   module of the level is complete AND every module's BEST quiz score is
 *   >= 70% AND no certificate exists yet for (user, level).
 */

let CertService;
let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, mutation: null };
  const chain = {};
  const applyFilters = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) out = out.filter(r => val.in.includes(r[col]));
      else out = out.filter(r => r[col] === val);
    }
    return out;
  };
  const finalize = () => {
    if (record.mutation && !record._t) { (state._mutations ||= []).push(record.mutation); record._t = true; }
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: applyFilters(rows)[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (record.mutation && !record._t) { (state._mutations ||= []).push(record.mutation); record._t = true; }
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: applyFilters(rows), error: null };
  };
  chain.select = jest.fn(() => chain);
  chain.insert = jest.fn((payload) => { record.mutation = { op: 'insert', payload }; return chain; });
  chain.update = jest.fn((payload) => { record.mutation = { op: 'update', payload }; return chain; });
  chain.upsert = jest.fn((payload) => { record.mutation = { op: 'upsert', payload }; return chain; });
  ['eq', 'neq', 'is', 'not', 'gt', 'gte', 'lt', 'lte'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.single = jest.fn(async () => finalize());
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

const USER = 'user-1';
const LEVEL = 17; // Oxbridge
const supabaseMock = () => ({ from: supabaseFrom });

function seed({
  capstone = false,
  completed = [201, 202],
  bestScores = { 201: { score: 8, total: 10 }, 202: { score: 7, total: 10 } }, // 80%, 70%
  certExists = false,
} = {}) {
  tableStates.training_modules = {
    rows: [
      { id: 201, course_id: 71, is_active: true },
      { id: 202, course_id: 71, is_active: true },
    ],
  };
  tableStates.training_courses = { rows: [{ id: 71, level_id: LEVEL, is_active: true }] };
  tableStates.training_levels = { rows: [{ id: LEVEL, name: 'Game-Based Teaching', vendor_id: 'v-ox', is_active: true }] };
  tableStates.training_vendors = { rows: [{ id: 'v-ox', key: 'OXBRIDGE', unlock_logic: 'all_modules' }] };
  tableStates.training_grand_quizzes = {
    rows: capstone ? [{ id: 950, level_id: LEVEL, quiz_type: 'capstone', is_active: true }] : [],
  };
  tableStates.teacher_training_progress = {
    rows: completed.map(m => ({ user_id: USER, module_id: m })),
  };
  tableStates.training_assessment_attempts = {
    rows: Object.entries(bestScores).map(([mid, s], i) => ({
      id: `att-${i}`, user_id: USER, quiz_kind: 'training_module',
      training_module_id: Number(mid), score: s.score, total_questions: s.total, status: 'passed',
    })),
  };
  tableStates.training_certificates = {
    rows: certExists ? [{ user_id: USER, level_id: LEVEL, certificate_code: 'OLD' }] : [],
  };
  tableStates.users = { rows: [{ id: USER, first_name: 'Saira' }] };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  CertService = require('../../bot/shared/services/training/certificate.service');
});

afterEach(() => jest.resetModules());

async function run(attemptId = 'att-0', moduleId = 202) {
  return CertService.maybeIssueQuizScoreCertificate(supabaseMock(), {
    userId: USER, moduleId, attemptId, programId: 'prog-1',
  });
}

describe('bd-2234 — Oxbridge-style quiz-score certificate', () => {
  test('issues when all modules complete and every best score >= 70%', async () => {
    seed();
    const res = await run();
    expect(res && res.issued).toBe(true);
    const ins = (tableStates.training_certificates._mutations || []).find(m => m.op === 'insert');
    expect(ins).toBeTruthy();
    expect(ins.payload.level_id).toBe(LEVEL);
  });

  test('no certificate when any module best score is below 70%', async () => {
    seed({ bestScores: { 201: { score: 6, total: 10 }, 202: { score: 9, total: 10 } } }); // 60%
    const res = await run();
    expect(res && res.issued).toBeFalsy();
    expect(tableStates.training_certificates._mutations || []).toHaveLength(0);
  });

  test('no certificate while modules remain incomplete', async () => {
    seed({ completed: [201] });
    const res = await run();
    expect(res && res.issued).toBeFalsy();
  });

  test('capstone levels are excluded — the capstone path certifies them', async () => {
    seed({ capstone: true });
    const res = await run();
    expect(res && res.issued).toBeFalsy();
  });

  test('never double-issues for a (user, level)', async () => {
    seed({ certExists: true });
    const res = await run();
    expect(res && res.issued).toBeFalsy();
    expect(tableStates.training_certificates._mutations || []).toHaveLength(0);
  });
});
