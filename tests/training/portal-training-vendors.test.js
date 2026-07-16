/**
 * GET /api/portal/training/vendors
 *
 * Returns the vendors (Taleemabad / Beacon House / Oxbridge / …) whose
 * training content the authenticated teacher can access through her assigned
 * training programs, along with per-vendor rollups:
 *
 *   { vendor_key, vendor_name, level_count, course_count, module_count,
 *     completed_module_count, avg_score_pct }
 *
 * Access logic:
 *   1. requirePortalAuth (401 without a session).
 *   2. Look up the teacher's active `teacher_training_assignments` → set of
 *      program_ids.
 *   3. Look up `training_program_scopes` for those programs → set of vendor_ids.
 *      A scope with NULL level_ids/course_ids/module_ids covers the entire
 *      vendor; this endpoint operates at vendor granularity so any scope row
 *      pulls the vendor in.
 *   4. Rollups are constrained to active levels/courses/modules for those
 *      vendors:
 *        level_count            = active training_levels for the vendor
 *        course_count           = active training_courses under those levels
 *        module_count           = active training_modules under those courses
 *        completed_module_count = teacher_training_progress rows for this user
 *                                  whose module_id ∈ vendor's module set
 *        avg_score_pct          = avg(score/total_score * 100) over the user's
 *                                  training_assessment_attempts with
 *                                  quiz_kind='training_module' AND
 *                                  training_module_id ∈ vendor's module set;
 *                                  null when the teacher has no attempts on that
 *                                  vendor yet (frontend renders "—").
 *   5. Empty array when the teacher has no active assignments.
 *   6. Sorted alphabetically by vendor_name.
 *
 * Testing shape mirrors tests/training/portal-training-attempts.test.js — a
 * per-table mock harness that intercepts supabase.from() and answers with the
 * per-table rows the test set up.
 */

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

describe('GET /api/portal/training/vendors', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invoke({ userId: null });
    expect(statusCode).toBe(401);
  });

  it('returns an empty list when the teacher has no active program assignments', async () => {
    tableStates.teacher_training_assignments = { rows: [] };

    const { statusCode, payload } = await invoke({ userId: 'user-1' });

    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, vendors: [] });
  });

  it('returns per-vendor aggregate for a teacher assigned to a multi-vendor program', async () => {
    // Teacher assigned to one program that scopes 2 vendors
    tableStates.teacher_training_assignments = {
      rows: [
        { user_id: 'user-1', program_id: 'prog-1', is_active: true },
      ],
    };
    tableStates.training_program_scopes = {
      rows: [
        { program_id: 'prog-1', vendor_id: 'v-tab', level_ids: null, course_ids: null, module_ids: null },
        { program_id: 'prog-1', vendor_id: 'v-ox',  level_ids: null, course_ids: null, module_ids: null },
      ],
    };
    tableStates.training_vendors = {
      rows: [
        { id: 'v-tab', key: 'TALEEMABAD',  name: 'Taleemabad',   is_active: true },
        { id: 'v-ox',  key: 'OXBRIDGE',    name: 'Oxbridge',     is_active: true },
        { id: 'v-bh',  key: 'BEACONHOUSE', name: 'Beacon House', is_active: true },
      ],
    };
    tableStates.training_levels = {
      rows: [
        { id: 1, vendor_id: 'v-tab', is_active: true },
        { id: 2, vendor_id: 'v-tab', is_active: true },
        { id: 3, vendor_id: 'v-ox',  is_active: true },
        { id: 4, vendor_id: 'v-bh',  is_active: true }, // not scoped for this teacher
      ],
    };
    tableStates.training_courses = {
      rows: [
        { id: 10, level_id: 1, is_active: true },
        { id: 11, level_id: 1, is_active: true },
        { id: 12, level_id: 2, is_active: true },
        { id: 13, level_id: 3, is_active: true },
        { id: 14, level_id: 4, is_active: true }, // Beacon House, excluded
      ],
    };
    tableStates.training_modules = {
      rows: [
        { id: 100, course_id: 10, is_active: true },
        { id: 101, course_id: 10, is_active: true },
        { id: 102, course_id: 11, is_active: true },
        { id: 103, course_id: 12, is_active: true }, // Taleemabad total = 4
        { id: 200, course_id: 13, is_active: true }, // Oxbridge total = 1
        { id: 300, course_id: 14, is_active: true }, // Beacon House — excluded
      ],
    };
    tableStates.teacher_training_progress = {
      rows: [
        { user_id: 'user-1', module_id: 100 },
        { user_id: 'user-1', module_id: 101 },
        { user_id: 'user-1', module_id: 200 },
        { user_id: 'user-1', module_id: 300 }, // completion on excluded vendor — should not count
        { user_id: 'user-2', module_id: 102 }, // other teacher — should not count
      ],
    };
    tableStates.training_assessment_attempts = {
      rows: [
        // Taleemabad module scores: 80% + 100% → avg 90
        { user_id: 'user-1', training_module_id: 100, quiz_kind: 'training_module',
          score: 4, total_score: 5, completed_at: '2026-07-10T00:00:00Z', status: 'passed' },
        { user_id: 'user-1', training_module_id: 101, quiz_kind: 'training_module',
          score: 5, total_score: 5, completed_at: '2026-07-11T00:00:00Z', status: 'passed' },
        // Oxbridge module score: 50%
        { user_id: 'user-1', training_module_id: 200, quiz_kind: 'training_module',
          score: 1, total_score: 2, completed_at: '2026-07-12T00:00:00Z', status: 'passed' },
        // Grand-quiz attempt — must NOT be included in avg_score_pct
        { user_id: 'user-1', training_module_id: null, quiz_kind: 'grand',
          score: 8, total_score: 10, completed_at: '2026-07-13T00:00:00Z', status: 'passed' },
        // Other user — must not count
        { user_id: 'user-2', training_module_id: 100, quiz_kind: 'training_module',
          score: 1, total_score: 5, completed_at: '2026-07-14T00:00:00Z', status: 'passed' },
      ],
    };

    const { statusCode, payload } = await invoke({ userId: 'user-1' });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.vendors).toHaveLength(2);

    // Alphabetical sort — Oxbridge before Taleemabad
    expect(payload.vendors[0].vendor_key).toBe('OXBRIDGE');
    expect(payload.vendors[1].vendor_key).toBe('TALEEMABAD');

    const tab = payload.vendors.find(v => v.vendor_key === 'TALEEMABAD');
    expect(tab).toEqual({
      vendor_key: 'TALEEMABAD',
      vendor_name: 'Taleemabad',
      level_count: 2,
      course_count: 3,
      module_count: 4,
      completed_module_count: 2,
      avg_score_pct: 90,
    });

    const ox = payload.vendors.find(v => v.vendor_key === 'OXBRIDGE');
    expect(ox).toEqual({
      vendor_key: 'OXBRIDGE',
      vendor_name: 'Oxbridge',
      level_count: 1,
      course_count: 1,
      module_count: 1,
      completed_module_count: 1,
      avg_score_pct: 50,
    });

    // Beacon House must NOT appear — no scope row for this teacher
    expect(payload.vendors.find(v => v.vendor_key === 'BEACONHOUSE')).toBeUndefined();
  });

  it('returns avg_score_pct = null for a vendor with no training-module attempts yet', async () => {
    tableStates.teacher_training_assignments = {
      rows: [{ user_id: 'user-1', program_id: 'prog-1', is_active: true }],
    };
    tableStates.training_program_scopes = {
      rows: [{ program_id: 'prog-1', vendor_id: 'v-tab', level_ids: null, course_ids: null, module_ids: null }],
    };
    tableStates.training_vendors = {
      rows: [{ id: 'v-tab', key: 'TALEEMABAD', name: 'Taleemabad', is_active: true }],
    };
    tableStates.training_levels = { rows: [{ id: 1, vendor_id: 'v-tab', is_active: true }] };
    tableStates.training_courses = { rows: [{ id: 10, level_id: 1, is_active: true }] };
    tableStates.training_modules = { rows: [{ id: 100, course_id: 10, is_active: true }] };
    tableStates.teacher_training_progress = { rows: [] };
    tableStates.training_assessment_attempts = { rows: [] };

    const { statusCode, payload } = await invoke({ userId: 'user-1' });

    expect(statusCode).toBe(200);
    expect(payload.vendors).toHaveLength(1);
    expect(payload.vendors[0]).toEqual({
      vendor_key: 'TALEEMABAD',
      vendor_name: 'Taleemabad',
      level_count: 1,
      course_count: 1,
      module_count: 1,
      completed_module_count: 0,
      avg_score_pct: null,
    });
  });

  it('sorts vendors alphabetically by vendor_name', async () => {
    tableStates.teacher_training_assignments = {
      rows: [{ user_id: 'user-1', program_id: 'prog-1', is_active: true }],
    };
    tableStates.training_program_scopes = {
      rows: [
        { program_id: 'prog-1', vendor_id: 'v-z',  level_ids: null, course_ids: null, module_ids: null },
        { program_id: 'prog-1', vendor_id: 'v-a',  level_ids: null, course_ids: null, module_ids: null },
        { program_id: 'prog-1', vendor_id: 'v-m',  level_ids: null, course_ids: null, module_ids: null },
      ],
    };
    tableStates.training_vendors = {
      rows: [
        { id: 'v-z', key: 'ZED',   name: 'Zed Academy',   is_active: true },
        { id: 'v-a', key: 'ALPHA', name: 'Alpha Trainers', is_active: true },
        { id: 'v-m', key: 'MID',   name: 'Middle Vendor',  is_active: true },
      ],
    };
    tableStates.training_levels = { rows: [] };
    tableStates.training_courses = { rows: [] };
    tableStates.training_modules = { rows: [] };
    tableStates.teacher_training_progress = { rows: [] };
    tableStates.training_assessment_attempts = { rows: [] };

    const { statusCode, payload } = await invoke({ userId: 'user-1' });

    expect(statusCode).toBe(200);
    const names = payload.vendors.map(v => v.vendor_name);
    expect(names).toEqual(['Alpha Trainers', 'Middle Vendor', 'Zed Academy']);
  });

  it('excludes assignments where is_active=false', async () => {
    tableStates.teacher_training_assignments = {
      rows: [
        // The mock's harness filters by is_active=true so a false row here should
        // NOT contribute a program.
        { user_id: 'user-1', program_id: 'prog-inactive', is_active: false },
      ],
    };
    // Even though a scope row exists for prog-inactive, the endpoint must not
    // pull it in because the assignment is inactive.
    tableStates.training_program_scopes = {
      rows: [{ program_id: 'prog-inactive', vendor_id: 'v-tab', level_ids: null, course_ids: null, module_ids: null }],
    };
    tableStates.training_vendors = {
      rows: [{ id: 'v-tab', key: 'TALEEMABAD', name: 'Taleemabad', is_active: true }],
    };

    const { statusCode, payload } = await invoke({ userId: 'user-1' });

    expect(statusCode).toBe(200);
    expect(payload.vendors).toEqual([]);
  });
});
