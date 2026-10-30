/**
 * bd-s42dye.4 — the legacy "Taleemabad" provider (vendor key TALEEMABAD_LEGACY) is for the COACH Training Library
 * only. Operator, 2026-10-17: no teacher may see it, and no certificate may ever be issued for it.
 *
 * It is enforced by DATA, not by code:
 *   - visibility: a teacher reaches a vendor only through teacher_training_assignments -> training_program_scopes.
 *     The import creates no program, no scope and no assignment, and band selection can only ever assign the two
 *     fixed programs niete_primary / niete_middle_high. The coach library lists every active vendor straight from
 *     the tables (dashboard/services/training-library.service.js) and needs no scope.
 *   - certificates: the vendor row is unlock_logic 'chain' with has_grand_quiz false. maybeIssueQuizScoreCertificate
 *     returns issued:false for a chain vendor, and the other two issuance paths need a grand quiz or a capstone row,
 *     which the import never creates.
 * These tests pin both, so a later change that breaks the data contract fails here.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null };

  const chain = {};
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    // Apply .eq/.in filters so tests can put mixed rows in and let the harness
    // pretend the DB actually filtered them.
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        rows = rows.filter(r => val.in.includes(r[col]));
      } else {
        rows = rows.filter(r => r[col] === val);
      }
    }
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[record.orderCol], bv = b[record.orderCol];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -1 * dir : 1 * dir;
      });
    }
    return { data: rows, error: null };
  };

  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => {
    record.orderCol = col;
    record.orderDir = opts && opts.ascending ? 'asc' : 'desc';
    return chain;
  });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

function findVendorsRoute(router) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    const methods = layer.route.methods || {};
    if (methods.get && path === '/training/vendors') {
      return layer.route.stack.map(s => s.handle);
    }
  }
  return null;
}

async function invoke({ userId }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findVendorsRoute(routes);
  if (!stack) throw new Error('Route GET /training/vendors not found on router');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params: {},
    query: {},
    method: 'GET',
    path: `/training/vendors`,
    ip: '127.0.0.1',
    headers: {},
    get: () => undefined,
  };

  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };

  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => resolve(), () => resolve());
      } else if (advanced === false) {
        resolve();
      }
    });
  }
  return { statusCode, payload };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => supabaseFrom);

  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));

  jest.doMock('bcryptjs', () => ({
    hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn(),
  }), { virtual: true });
  jest.doMock('express-rate-limit', () => {
    return jest.fn(() => (_req, _res, next) => next());
  }, { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(),
    GetObjectCommand: jest.fn(),
  }), { virtual: true });
});

afterEach(() => jest.resetModules());


describe('bd-s42dye.4 — TALEEMABAD_LEGACY is invisible to teachers', () => {
  function seedCatalogue() {
    tableStates.training_vendors = { rows: [
      { id: 'v-tab', key: 'TALEEMABAD', name: 'NIETE', is_active: true },
      { id: 'v-leg', key: 'TALEEMABAD_LEGACY', name: 'Taleemabad', is_active: true },
    ] };
    tableStates.training_levels = { rows: [
      { id: 1, vendor_id: 'v-tab', is_active: true },
      { id: 2, vendor_id: 'v-leg', is_active: true },
    ] };
    tableStates.training_courses = { rows: [
      { id: 10, level_id: 1, is_active: true },
      { id: 20, level_id: 2, is_active: true },
    ] };
    tableStates.training_modules = { rows: [
      { id: 100, course_id: 10, is_active: true },
      { id: 200, course_id: 20, is_active: true },
    ] };
    tableStates.teacher_training_progress = { rows: [] };
    tableStates.training_assessment_attempts = { rows: [] };
  }

  it('GET /training/vendors omits it for a teacher assigned to the program that scopes the NIETE vendor', async () => {
    seedCatalogue();
    tableStates.teacher_training_assignments = { rows: [{ user_id: 't1', program_id: 'p-prim', is_active: true }] };
    // the import adds NO scope row for v-leg
    tableStates.training_program_scopes = { rows: [{ program_id: 'p-prim', vendor_id: 'v-tab', level_ids: null }] };

    const { statusCode, payload } = await invoke({ userId: 't1' });

    expect(statusCode).toBe(200);
    expect(payload.vendors.map(v => v.vendor_key)).toEqual(['TALEEMABAD']);
  });

  it('is shown only if someone adds a scope row (the negative control: the omission above is the data, not a bug)', async () => {
    seedCatalogue();
    tableStates.teacher_training_assignments = { rows: [{ user_id: 't1', program_id: 'p-prim', is_active: true }] };
    tableStates.training_program_scopes = { rows: [
      { program_id: 'p-prim', vendor_id: 'v-tab', level_ids: null },
      { program_id: 'p-prim', vendor_id: 'v-leg', level_ids: null },
    ] };

    const { payload } = await invoke({ userId: 't1' });

    expect(payload.vendors.map(v => v.vendor_key).sort()).toEqual(['TALEEMABAD', 'TALEEMABAD_LEGACY']);
  });

  it('band selection can only ever assign the two fixed NIETE programs', () => {
    const { bandsToPrograms, PROGRAM_PRIMARY, PROGRAM_MIDDLE_HIGH } = require('../../bot/shared/services/training/band-selection.service');
    expect(bandsToPrograms(['PRIMARY', 'MIDDLE', 'HIGH']).sort()).toEqual([PROGRAM_MIDDLE_HIGH, PROGRAM_PRIMARY].sort());
    expect(bandsToPrograms(['TALEEMABAD_LEGACY'])).toEqual([]);
  });
});

describe('bd-s42dye.4 — no certificate for a chain vendor with no grand quiz', () => {
  const MODULES = [{ id: 438, course_id: 9, is_active: true }, { id: 439, course_id: 9, is_active: true }];

  function makeSupabase({ unlockLogic, quizzes }) {
    const touched = [];
    const rows = {
      training_modules: MODULES,
      training_courses: [{ id: 9, level_id: 26, is_active: true }],
      training_levels: [{ id: 26, name: 'Aspiring Teacher', vendor_id: 7 }],
      training_vendors: [{ id: 7, unlock_logic: unlockLogic }],
      training_certificates: [],
      app_settings: [],
      training_grand_quizzes: quizzes,
      // EVERY module of the level passed at 100%
      teacher_training_progress: MODULES.map(m => ({ user_id: 'u1', module_id: m.id })),
      training_assessment_attempts: MODULES.map(m => ({
        user_id: 'u1', training_module_id: m.id, score: 6, total_questions: 6, total_score: 6,
        quiz_kind: 'training_module', is_passed: true,
      })),
    };
    function from(table) {
      touched.push(table);
      const eqs = {}; const ins = {};
      const run = () => {
        let out = rows[table] || [];
        for (const [c, v] of Object.entries(eqs)) out = out.filter(r => r[c] === v);
        for (const [c, v] of Object.entries(ins)) out = out.filter(r => v.includes(r[c]));
        return out;
      };
      const q = {
        select() { return q; },
        eq(c, v) { eqs[c] = v; return q; },
        in(c, v) { ins[c] = v; return q; },
        limit() { return Promise.resolve({ data: run() }); },
        maybeSingle() { return Promise.resolve({ data: run()[0] || null }); },
        then(res, rej) { return Promise.resolve({ data: run() }).then(res, rej); },
      };
      return q;
    }
    return { from, touched };
  }

  function load() {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    return require('../../bot/shared/services/training/certificate.service');
  }
  // issueCertificate is module-local; reaching its second training_certificates read means the guard decided to certify
  const reachedIssue = (touched) => touched.filter(t => t === 'training_certificates').length > 1;

  it('chain vendor, no grand quiz, every module passed at 100% -> nothing is issued', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({ unlockLogic: 'chain', quizzes: [] });
    const res = await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', moduleId: 438, attemptId: 'a1', programId: 'p1' });
    expect(res).toEqual({ issued: false });
    expect(reachedIssue(supabase.touched)).toBe(false);
  });

  it('positive control: the same fixture on an all_modules vendor DOES reach issuance', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({ unlockLogic: 'all_modules', quizzes: [] });
    await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', moduleId: 438, attemptId: 'a1', programId: 'p1' });
    expect(reachedIssue(supabase.touched)).toBe(true);
  });
});
