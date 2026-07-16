/**
 * GET /api/portal/hcp/teachers?region=<region>
 *
 * The Priority Dashboard's home-screen data source. Coach opens the portal,
 * picks a region tab (ICT / Rawalpindi / Punjab / any), and this endpoint
 * returns every teacher in that region with:
 *
 *   { id, first_name, last_name, phone_number, school_name, region,
 *     avg_dc_score_pct,    // avg of coaching_sessions.analysis_data.overall_score * 100
 *     session_count,       // number of DC coaching_sessions for this teacher
 *     last_session_at,     // ISO timestamp of most recent session, or null
 *     weak_indicator_count,// how many indicators averaged < 55% across sessions
 *     is_flagged }         // true when weak_indicator_count >= 6 (HCP rule)
 *
 * Access rules:
 *   1. requirePortalAuth (401 without a session).
 *   2. `region` query param optional; when omitted, all regions returned.
 *   3. Only rows from the `users` table with registration_completed = true.
 *   4. Sorted: flagged first, then avg_dc_score_pct ascending (worst first).
 *   5. Empty array when the region has no teachers (not 404).
 *
 * Data sourced from Rumi's Supabase — NIETE deployment. HCP's own Postgres
 * (per Rifat's Q2 direction) is discarded; this endpoint reads NIETE's DC data.
 *
 * Test-harness shape mirrors tests/training/portal-training-vendors.test.js.
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
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        rows = rows.filter((r) => val.in.includes(r[col]));
      } else {
        rows = rows.filter((r) => r[col] === val);
      }
    }
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[record.orderCol];
        const bv = b[record.orderCol];
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
    chain[m] = jest.fn((col, val) => {
      record.filters[col] = val;
      return chain;
    });
  });
  chain.in = jest.fn((col, vals) => {
    record.filters[col] = { in: vals };
    return chain;
  });
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

function findRoute(router, method, pathToFind) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const p = layer.route.path;
    const methods = layer.route.methods || {};
    if (methods[method] && p === pathToFind) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke({ userId, query = {} }) {
  const routes = require('../../dashboard/routes/hcp.routes');
  const stack = findRoute(routes, 'get', '/teachers');
  if (!stack) throw new Error('Route GET /teachers not found on hcp router');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params: {},
    query,
    method: 'GET',
    path: '/teachers',
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
});

afterEach(() => jest.resetModules());

describe('GET /api/portal/hcp/teachers', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invoke({ userId: null });
    expect(statusCode).toBe(401);
  });

  it('returns an empty list when the region has no teachers', async () => {
    tableStates.users = { rows: [] };
    tableStates.coaching_sessions = { rows: [] };

    const { statusCode, payload } = await invoke({
      userId: 'coach-1',
      query: { region: 'ICT' },
    });

    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, teachers: [] });
  });

  it('returns teachers with computed DC rollups, sorted flagged-first then worst-score-first', async () => {
    tableStates.users = {
      rows: [
        {
          id: 't-1', first_name: 'Aisha', last_name: 'Khan', phone_number: '92300111',
          school_name: 'IMSG H-9', region: 'ICT', registration_completed: true,
        },
        {
          id: 't-2', first_name: 'Bilal', last_name: 'Ahmed', phone_number: '92300222',
          school_name: 'IMSB F-8', region: 'ICT', registration_completed: true,
        },
        {
          id: 't-3', first_name: 'Chand', last_name: 'Bibi', phone_number: '92300333',
          school_name: 'IMSG G-6', region: 'ICT', registration_completed: false,
        },
        {
          id: 't-4', first_name: 'Danish', last_name: 'Ali', phone_number: '92300444',
          school_name: 'RWP-1', region: 'Rawalpindi', registration_completed: true,
        },
      ],
    };
    // Aisha: 2 sessions, avg score 0.30, 7 weak indicators → FLAGGED
    // Bilal: 1 session, avg score 0.70, 2 weak indicators → not flagged
    // Chand: registration_completed=false → excluded
    // Danish: wrong region → excluded
    tableStates.coaching_sessions = {
      rows: [
        {
          id: 's-a1', user_id: 't-1', created_at: '2026-07-10T00:00:00Z',
          analysis_data: {
            overall_score: 0.25,
            indicators: [
              { code: 'SI4', score: 0.4 }, { code: 'SI5', score: 0.4 },
              { code: 'SI6', score: 0.5 }, { code: 'PIC6', score: 0.4 },
              { code: 'PIC7', score: 0.5 }, { code: 'PI1', score: 0.4 },
              { code: 'PI2', score: 0.5 }, { code: 'SE1', score: 0.8 },
            ],
          },
        },
        {
          id: 's-a2', user_id: 't-1', created_at: '2026-07-12T00:00:00Z',
          analysis_data: {
            overall_score: 0.35,
            indicators: [
              { code: 'SI4', score: 0.5 }, { code: 'SI5', score: 0.5 },
              { code: 'SI6', score: 0.4 }, { code: 'PIC6', score: 0.5 },
              { code: 'PIC7', score: 0.5 }, { code: 'PI1', score: 0.5 },
              { code: 'PI2', score: 0.5 }, { code: 'SE1', score: 0.8 },
            ],
          },
        },
        {
          id: 's-b1', user_id: 't-2', created_at: '2026-07-11T00:00:00Z',
          analysis_data: {
            overall_score: 0.70,
            indicators: [
              { code: 'SI4', score: 0.8 }, { code: 'SI5', score: 0.7 },
              { code: 'SI6', score: 0.7 }, { code: 'PIC6', score: 0.4 },
              { code: 'PIC7', score: 0.4 }, { code: 'PI1', score: 0.8 },
              { code: 'PI2', score: 0.9 }, { code: 'SE1', score: 0.9 },
            ],
          },
        },
        {
          id: 's-d1', user_id: 't-4', created_at: '2026-07-13T00:00:00Z',
          analysis_data: { overall_score: 0.9, indicators: [] },
        },
      ],
    };

    const { statusCode, payload } = await invoke({
      userId: 'coach-1',
      query: { region: 'ICT' },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.teachers).toHaveLength(2);
    // Flagged first
    expect(payload.teachers[0].id).toBe('t-1');
    expect(payload.teachers[0].is_flagged).toBe(true);
    expect(payload.teachers[0].session_count).toBe(2);
    expect(payload.teachers[0].avg_dc_score_pct).toBe(30);
    expect(payload.teachers[0].weak_indicator_count).toBeGreaterThanOrEqual(6);
    expect(payload.teachers[0].last_session_at).toBe('2026-07-12T00:00:00Z');
    // Not-flagged next
    expect(payload.teachers[1].id).toBe('t-2');
    expect(payload.teachers[1].is_flagged).toBe(false);
    expect(payload.teachers[1].avg_dc_score_pct).toBe(70);
  });

  it('includes teachers with zero sessions (session_count=0, avg_dc_score_pct=null)', async () => {
    tableStates.users = {
      rows: [
        {
          id: 't-new', first_name: 'Newby', last_name: 'Teacher', phone_number: '92300555',
          school_name: 'IMSG H-11', region: 'ICT', registration_completed: true,
        },
      ],
    };
    tableStates.coaching_sessions = { rows: [] };

    const { statusCode, payload } = await invoke({
      userId: 'coach-1',
      query: { region: 'ICT' },
    });

    expect(statusCode).toBe(200);
    expect(payload.teachers).toHaveLength(1);
    expect(payload.teachers[0]).toMatchObject({
      id: 't-new',
      session_count: 0,
      avg_dc_score_pct: null,
      weak_indicator_count: 0,
      is_flagged: false,
      last_session_at: null,
    });
  });

  it('returns all regions when region query param is omitted', async () => {
    tableStates.users = {
      rows: [
        { id: 't-1', first_name: 'A', region: 'ICT', registration_completed: true },
        { id: 't-2', first_name: 'B', region: 'Rawalpindi', registration_completed: true },
      ],
    };
    tableStates.coaching_sessions = { rows: [] };

    const { statusCode, payload } = await invoke({ userId: 'coach-1', query: {} });

    expect(statusCode).toBe(200);
    expect(payload.teachers).toHaveLength(2);
  });
});
