/**
 * bd-2237 — /training/levels must honour the teacher's program scopes.
 *
 * The WhatsApp endpoint already filters levels through
 * teacher_training_assignments → training_program_scopes (vendor allow-list
 * + optional level_ids). The portal listed EVERY active level regardless of
 * assignment, which breaks the NIETE team's visibility rules (Primary →
 * NIETE only; Middle/High → Oxbridge + NIETE L2-3 + Beacon House).
 *
 * Contract:
 *   - Levels outside the user's scoped vendors/level_ids never appear.
 *   - A NULL level_ids scope covers the whole vendor.
 *   - A user with no active assignment gets an empty list (same as WA).
 *
 * bd-2233 — GET /training/level/:id/capstone returns the teacher's capstone
 * attempt with per-answer text/score/feedback (no grading internals); an
 * empty shape when none exists.
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

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke(method, path, { userId, params = {}, query = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method} ${path} not found`);
  const req = { session: userId ? { portalUserId: userId, id: 's1' } : null, params, query, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (advanced === false) resolve();
    });
  }
  return { statusCode, payload };
}

const V_NIETE = 'v-niete';
const V_BH = 'v-bh';
const V_OX = 'v-ox';

function seedCatalog() {
  tableStates.training_vendors = {
    rows: [
      { id: V_NIETE, key: 'TALEEMABAD', unlock_logic: 'chain' },
      { id: V_BH, key: 'BEACONHOUSE', unlock_logic: 'all_modules' },
      { id: V_OX, key: 'OXBRIDGE', unlock_logic: 'all_modules' },
    ],
  };
  tableStates.training_levels = {
    rows: [
      { id: 1, name: 'Aspiring Teacher', order_index: 0, vendor_id: V_NIETE, is_active: true, training_vendors: { key: 'TALEEMABAD', unlock_logic: 'chain' } },
      { id: 2, name: 'Emerging Practitioner', order_index: 1, vendor_id: V_NIETE, is_active: true, training_vendors: { key: 'TALEEMABAD', unlock_logic: 'chain' } },
      { id: 3, name: 'Skilled Practitioner', order_index: 2, vendor_id: V_NIETE, is_active: true, training_vendors: { key: 'TALEEMABAD', unlock_logic: 'chain' } },
      { id: 4, name: 'Teacher Leader', order_index: 3, vendor_id: V_NIETE, is_active: true, training_vendors: { key: 'TALEEMABAD', unlock_logic: 'chain' } },
      { id: 18, name: 'English', order_index: 1, vendor_id: V_BH, is_active: true, training_vendors: { key: 'BEACONHOUSE', unlock_logic: 'all_modules' } },
      { id: 17, name: 'Game-Based Teaching', order_index: 4, vendor_id: V_OX, is_active: true, training_vendors: { key: 'OXBRIDGE', unlock_logic: 'all_modules' } },
    ],
  };
  tableStates.training_courses = { rows: [] };
  tableStates.training_modules = { rows: [] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [] };
  tableStates.training_assessment_answers = { rows: [] };
}

function assign(programId, scopes) {
  tableStates.teacher_training_assignments = { rows: [{ user_id: 'u1', program_id: programId, is_active: true }] };
  tableStates.training_program_scopes = { rows: scopes };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn().mockResolvedValue({ error: null }) }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

describe('bd-2237 — GET /training/levels honours program scopes', () => {
  test('middle/high program: Oxbridge + NIETE L2-3 + Beacon House only', async () => {
    seedCatalog();
    assign('prog-mh', [
      { program_id: 'prog-mh', vendor_id: V_NIETE, level_ids: [3, 4] },
      { program_id: 'prog-mh', vendor_id: V_BH, level_ids: null },
      { program_id: 'prog-mh', vendor_id: V_OX, level_ids: null },
    ]);
    const { payload } = await invoke('get', '/training/levels', { userId: 'u1' });
    const ids = payload.levels.map(l => l.id).sort((a, b) => a - b);
    expect(ids).toEqual([3, 4, 17, 18]);
  });

  test('primary program: NIETE levels only, no BH/Ox', async () => {
    seedCatalog();
    assign('prog-p', [{ program_id: 'prog-p', vendor_id: V_NIETE, level_ids: null }]);
    const { payload } = await invoke('get', '/training/levels', { userId: 'u1' });
    const ids = payload.levels.map(l => l.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  test('no active assignment → empty list (WA parity)', async () => {
    seedCatalog();
    tableStates.teacher_training_assignments = { rows: [] };
    tableStates.training_program_scopes = { rows: [] };
    const { payload } = await invoke('get', '/training/levels', { userId: 'u1' });
    expect(payload.levels).toEqual([]);
  });
});

describe('bd-2233 — GET /training/level/:id/capstone', () => {
  test('returns the attempt with per-answer text, score and feedback', async () => {
    seedCatalog();
    assign('prog-mh', [{ program_id: 'prog-mh', vendor_id: V_BH, level_ids: null }]);
    tableStates.training_assessment_attempts = {
      rows: [{
        id: 'cap-1', user_id: 'u1', level_id: 18, quiz_kind: 'capstone',
        status: 'passed', is_passed: true, score: 32, total_score: 40,
        completed_at: '2026-07-21T10:00:00Z',
      }],
    };
    tableStates.training_assessment_answers = {
      rows: [{
        attempt_id: 'cap-1', question_index: 0, question_id: 9001,
        answer_text: 'My answer', answer_score: 4, feedback_text: 'Nice work.',
      }],
    };
    tableStates.training_questions = {
      rows: [{ id: 9001, question_text: 'Open Q1?', order_index: 1, is_active: true }],
    };
    const { statusCode, payload } = await invoke('get', '/training/level/:id/capstone', { userId: 'u1', params: { id: '18' } });
    expect(statusCode).toBe(200);
    expect(payload.attempt.score).toBe(32);
    expect(payload.attempt.is_passed).toBe(true);
    expect(payload.answers[0].answer_text).toBe('My answer');
    expect(payload.answers[0].answer_score).toBe(4);
    expect(payload.answers[0].feedback_text).toBe('Nice work.');
    expect(payload.answers[0].question_text).toBe('Open Q1?');
  });

  test('no attempt → 200 with null attempt (panel hides)', async () => {
    seedCatalog();
    assign('prog-mh', [{ program_id: 'prog-mh', vendor_id: V_BH, level_ids: null }]);
    const { statusCode, payload } = await invoke('get', '/training/level/:id/capstone', { userId: 'u1', params: { id: '18' } });
    expect(statusCode).toBe(200);
    expect(payload.attempt).toBeNull();
  });
});
