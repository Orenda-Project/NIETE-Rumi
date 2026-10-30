/**
 * bd-2489 / bd-2475 — the exam gate must report the REAL bar and the REAL
 * cooldown, per exam kind.
 *
 * bd-2489: the portal told every teacher the level exam needs 100%. The bar is
 * training_vendors.passing_pct. The gate route was fixed to send `pass_mark_pct`
 * from the bot's getVendorPassingPctByLevel(); these pin that so it cannot
 * regress back to a literal.
 *
 * bd-2475: the same payload asserted a 24h cooldown unconditionally. Capstones
 * have no cooldown — capstone-delivery.service grades an attempt without ever
 * writing `cooldown_until`, so there is no window to serve out and nothing for
 * a retry gate to read. Reporting 24 there is the API inventing a rule the
 * grader does not implement. Fixed at the source rather than papered over in
 * the SPA, because both surfaces read this field.
 *
 * These drive the ROUTES, not the UI: the number a teacher is shown is only as
 * honest as the payload behind it.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, orderCol: null, orderDir: null };
  const chain = {};
  const rowsNow = () => {
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        rows = rows.filter(r => val.in.includes(r[col]));
      } else if (!col.includes('.')) {
        rows = rows.filter(r => (r[col] === val)
          || (r[col] != null && val != null && String(r[col]) === String(val)));
      }
    }
    return rows;
  };
  const finalize = () => state.error ? { data: null, error: state.error } : { data: rowsNow()[0] || null, error: null };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = rowsNow();
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: rows, error: null };
  };
  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => { record.orderCol = col; record.orderDir = opts && opts.ascending ? 'asc' : 'desc'; return chain; });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.insert = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (res, rej) => Promise.resolve(finalizeMany()).then(res, rej);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke(method, path, { userId = 'user-1', params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const req = { session: { portalUserId: userId, id: 's1' }, params, query: {}, body, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const h of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = h(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

const UID = 'user-1';
const VENDOR = 'v1';
const LEVEL = 18;
const MODULE = 101;

/**
 * A level whose coursework is COMPLETE, so the bot's gate says the exam is
 * sittable and the route reports a live state rather than 'courses_incomplete'.
 */
function seed({ quizType = 'capstone', passingPct = 70 } = {}) {
  tableStates.training_vendors = { rows: [{ id: VENDOR, key: 'V', name: 'V', unlock_logic: 'all_modules', has_grand_quiz: true, passing_pct: passingPct, module_passing_pct: passingPct }] };
  tableStates.training_levels = { rows: [{ id: LEVEL, name: 'English', order_index: 1, vendor_id: VENDOR, is_active: true }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: null }] };
  tableStates.training_courses = { rows: [{ id: 1, level_id: LEVEL, is_active: true, title: 'C1', order_index: 1 }] };
  tableStates.training_modules = { rows: [{ id: MODULE, course_id: 1, is_active: true, title: 'M1', order_index: 1 }] };
  tableStates.teacher_training_progress = { rows: [{ user_id: UID, module_id: MODULE }] };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_certificates = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [{ id: 30, level_id: LEVEL, quiz_type: quizType, is_active: true }] };
  tableStates.training_questions = {
    rows: Array.from({ length: 3 }, (_, i) => ({
      id: 900 + i, grand_quiz_id: 30, training_module_id: MODULE,
      question_text: `Q${i + 1}`, order_index: i, is_active: true,
      options: quizType === 'capstone' ? [] : ['a', 'b'], correct_option: quizType === 'capstone' ? '' : '1',
    })),
  };
}

beforeEach(() => {
  jest.resetModules();
  delete process.env.PORTAL_ASSESSMENTS_TEST_ENABLE;
  tableStates = {};
  supabaseFrom = jest.fn(t => makeChain(t));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  require('../fixtures/delegate-training-to-bot').installTrainingDelegation(() => supabaseFrom);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_r, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

const gateFor = (opts) => {
  seed(opts);
  return invoke('get', '/training/level/:id/grand-quiz', { params: { id: String(LEVEL) } });
};

describe('bd-2489 — the gate reports the vendor pass mark, never a literal 100', () => {
  it('sends 70 for a 70% vendor', async () => {
    const { payload } = await gateFor({ quizType: 'grand_quiz', passingPct: 70 });
    expect(payload.grand_quiz.pass_mark_pct).toBe(70);
  });

  it('sends 80 for an 80% vendor — the number moves with the data', async () => {
    const { payload } = await gateFor({ quizType: 'grand_quiz', passingPct: 80 });
    expect(payload.grand_quiz.pass_mark_pct).toBe(80);
  });

  it('carries the same bar on a capstone level', async () => {
    const { payload } = await gateFor({ quizType: 'capstone', passingPct: 70 });
    expect(payload.grand_quiz.pass_mark_pct).toBe(70);
  });
});

describe('bd-2475 — cooldown_hours reflects what the grader actually does', () => {
  it('a capstone reports NO cooldown, because none is ever written', async () => {
    // capstone-delivery.service grades without setting cooldown_until. A UI
    // told "24" renders a threat the bot will not enforce; worse, a UI told
    // "0" by accident renders "0h cooldown".
    const { payload } = await gateFor({ quizType: 'capstone' });
    expect(payload.grand_quiz.exam_kind).toBe('capstone');
    expect(payload.grand_quiz.cooldown_hours).toBe(0);
  });

  it('an MCQ grand quiz still reports its real 24h cooldown', async () => {
    const { payload } = await gateFor({ quizType: 'grand_quiz' });
    expect(payload.grand_quiz.exam_kind).toBe('grand_quiz');
    expect(payload.grand_quiz.cooldown_hours).toBe(24);
  });

  it('the MCQ cooldown matches the window the submit path writes', async () => {
    // Pins the two together: the constant the gate advertises is the same one
    // the grading path uses to stamp cooldown_until.
    const src = require('fs').readFileSync(require.resolve('../../dashboard/routes/portal.routes'), 'utf8');
    expect(src).toMatch(/GRAND_QUIZ_COOLDOWN_HOURS\s*=\s*24/);
    const { payload } = await gateFor({ quizType: 'grand_quiz' });
    expect(payload.grand_quiz.cooldown_hours).toBe(24);
  });
});

describe('bd-2489 — the capstone result endpoint sends its own pass mark', () => {
  function seedAttempt() {
    seed({ quizType: 'capstone' });
    tableStates.training_assessment_attempts = { rows: [{
      id: 'att-1', user_id: UID, level_id: LEVEL, quiz_kind: 'capstone',
      status: 'failed', is_passed: false, score: 20, total_score: 40,
      completed_at: '2026-07-01T00:00:00Z',
    }] };
  }

  it('returns pass_mark_pct so the card need not hardcode one', async () => {
    seedAttempt();
    const { statusCode, payload } = await invoke('get', '/training/level/:id/capstone', { params: { id: String(LEVEL) } });
    expect(statusCode).toBe(200);
    expect(payload.pass_mark_pct).toBe(70);
  });

  it('the bar it sends is the one the bot grades capstones against', async () => {
    // Single source of truth: if the bot's PASS_PCT moves, this moves with it.
    const { CAPSTONE_PASS_PCT } = require('../../bot/shared/services/training/capstone-delivery.service');
    expect(Math.round(CAPSTONE_PASS_PCT * 100)).toBe(70);
    seedAttempt();
    const { payload } = await invoke('get', '/training/level/:id/capstone', { params: { id: String(LEVEL) } });
    expect(payload.pass_mark_pct).toBe(Math.round(CAPSTONE_PASS_PCT * 100));
  });

  it('still answers cleanly when there is no attempt', async () => {
    seed({ quizType: 'capstone' });
    const { statusCode, payload } = await invoke('get', '/training/level/:id/capstone', { params: { id: String(LEVEL) } });
    expect(statusCode).toBe(200);
    expect(payload.attempt).toBeNull();
  });
});
