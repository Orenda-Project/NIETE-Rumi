/**
 * GET /api/portal/hcp/teachers/:id/dc
 *
 * Feeds the DC Dashboard for a selected teacher. Returns the teacher's full
 * digital-coach observation history from Rumi's Supabase (per Rifat's Q2
 * direction: NIETE DB for DC data, discard HCP's Postgres). The shape mirrors
 * HCP's Priority Dashboard drill-down:
 *
 *   {
 *     success: true,
 *     teacher: { id, first_name, last_name, school_name, region, phone_number },
 *     summary: {
 *       avg_dc_score_pct,      // 0..100 average of overall_score across sessions
 *       session_count,
 *       first_session_at,
 *       last_session_at,
 *       trend,                 // "improving" | "declining" | "flat" | "insufficient"
 *       critical_area_count,   // indicators averaged < 55% across all sessions
 *     },
 *     sessions: [               // newest first
 *       { id, created_at, score_pct, delta_from_prev_pct, status },
 *       // status ∈ {"critical","below_average","above_average"} per HCP thresholds
 *     ],
 *     indicators: {
 *       red:   [ { code, avg_score_pct, weak_session_count, weak_frequency_pct } ],
 *       green: [ { code, avg_score_pct, weak_session_count, weak_frequency_pct } ],
 *     }
 *   }
 *
 * HCP thresholds (ported):
 *   status: <45% critical, 45-55% below_average, >=55% above_average
 *   red: an indicator is weak in >=60% of the teacher's sessions
 *   flagged (elsewhere): teacher has 6+ indicators averaged <55%
 *
 * Access:
 *   1. requirePortalAuth (401 without a session)
 *   2. 404 if the teacher id doesn't resolve to a users row
 *   3. Returns summary+sessions=[]+indicators={red:[],green:[]} when the
 *      teacher exists but has zero sessions
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
    let filtered = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        filtered = filtered.filter((r) => val.in.includes(r[col]));
      } else {
        filtered = filtered.filter((r) => r[col] === val);
      }
    }
    return { data: filtered[0] || null, error: null };
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

async function invoke({ userId, teacherId }) {
  const routes = require('../../dashboard/routes/hcp.routes');
  const stack = findRoute(routes, 'get', '/teachers/:id/dc');
  if (!stack) throw new Error('Route GET /teachers/:id/dc not found on hcp router');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params: { id: teacherId },
    query: {},
    method: 'GET',
    path: `/teachers/${teacherId}/dc`,
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

describe('GET /api/portal/hcp/teachers/:id/dc', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invoke({ userId: null, teacherId: 't-1' });
    expect(statusCode).toBe(401);
  });

  it('returns 404 when the teacher id has no matching users row', async () => {
    tableStates.users = { rows: [] };
    tableStates.coaching_sessions = { rows: [] };

    const { statusCode, payload } = await invoke({ userId: 'coach-1', teacherId: 't-missing' });

    expect(statusCode).toBe(404);
    expect(payload.success).toBe(false);
  });

  it('returns empty history when teacher exists but has no sessions', async () => {
    tableStates.users = {
      rows: [{
        id: 't-1', first_name: 'A', last_name: 'B', phone_number: '92300111',
        school_name: 'IMSG H-9', region: 'ICT', registration_completed: true,
      }],
    };
    tableStates.coaching_sessions = { rows: [] };

    const { statusCode, payload } = await invoke({ userId: 'coach-1', teacherId: 't-1' });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.teacher.id).toBe('t-1');
    expect(payload.summary.session_count).toBe(0);
    expect(payload.summary.avg_dc_score_pct).toBeNull();
    expect(payload.summary.trend).toBe('insufficient');
    expect(payload.sessions).toEqual([]);
    expect(payload.indicators).toEqual({ red: [], green: [] });
  });

  it('computes summary, session table, and RED/GREEN indicator split', async () => {
    tableStates.users = {
      rows: [{
        id: 't-1', first_name: 'Aisha', last_name: 'Khan', phone_number: '92300111',
        school_name: 'IMSG H-9', region: 'ICT', registration_completed: true,
      }],
    };
    // 5 sessions with mixed indicator scores.
    // Indicator SI4: weak (<0.55) in 4/5 sessions → weak_frequency=80% → RED
    // Indicator SE1: weak in 1/5 → weak_frequency=20% → GREEN
    tableStates.coaching_sessions = {
      rows: [
        { id: 's1', user_id: 't-1', created_at: '2026-07-01T00:00:00Z',
          analysis_data: { overall_score: 0.30, indicators: [
            { code: 'SI4', score: 0.40 }, { code: 'SE1', score: 0.80 },
          ] } },
        { id: 's2', user_id: 't-1', created_at: '2026-07-03T00:00:00Z',
          analysis_data: { overall_score: 0.40, indicators: [
            { code: 'SI4', score: 0.50 }, { code: 'SE1', score: 0.90 },
          ] } },
        { id: 's3', user_id: 't-1', created_at: '2026-07-05T00:00:00Z',
          analysis_data: { overall_score: 0.50, indicators: [
            { code: 'SI4', score: 0.45 }, { code: 'SE1', score: 0.85 },
          ] } },
        { id: 's4', user_id: 't-1', created_at: '2026-07-07T00:00:00Z',
          analysis_data: { overall_score: 0.60, indicators: [
            { code: 'SI4', score: 0.35 }, { code: 'SE1', score: 0.40 },
          ] } },
        { id: 's5', user_id: 't-1', created_at: '2026-07-09T00:00:00Z',
          analysis_data: { overall_score: 0.65, indicators: [
            { code: 'SI4', score: 0.70 }, { code: 'SE1', score: 0.90 },
          ] } },
      ],
    };

    const { statusCode, payload } = await invoke({ userId: 'coach-1', teacherId: 't-1' });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);

    // Summary
    expect(payload.summary.session_count).toBe(5);
    expect(payload.summary.avg_dc_score_pct).toBe(49);
    expect(payload.summary.first_session_at).toBe('2026-07-01T00:00:00Z');
    expect(payload.summary.last_session_at).toBe('2026-07-09T00:00:00Z');
    expect(payload.summary.trend).toBe('improving');

    // Sessions — newest first, with delta and status
    expect(payload.sessions).toHaveLength(5);
    expect(payload.sessions[0].id).toBe('s5');
    expect(payload.sessions[0].score_pct).toBe(65);
    expect(payload.sessions[0].delta_from_prev_pct).toBe(5);
    expect(payload.sessions[0].status).toBe('above_average');
    expect(payload.sessions[4].id).toBe('s1');
    expect(payload.sessions[4].status).toBe('critical');
    expect(payload.sessions[4].delta_from_prev_pct).toBeNull();

    // Indicators
    const redCodes = payload.indicators.red.map((i) => i.code);
    const greenCodes = payload.indicators.green.map((i) => i.code);
    expect(redCodes).toContain('SI4');
    expect(greenCodes).toContain('SE1');
    const si4 = payload.indicators.red.find((i) => i.code === 'SI4');
    expect(si4.weak_session_count).toBe(4);
    expect(si4.weak_frequency_pct).toBe(80);
  });
});
