/**
 * Portal level lockdown must honour training_vendors.unlock_logic (bd-2129).
 *
 * The WhatsApp endpoint chain-locks a level ONLY when its vendor has
 * unlock_logic='chain' (teacher-training-endpoint.js). The portal's
 * _computeLevelStates applied the chain rule unconditionally AND looked up
 * the previous level across ALL vendors globally — so Beacon House and
 * Oxbridge (unlock_logic='all_modules', levels are subjects not a ladder)
 * showed locked on the portal while WhatsApp correctly kept them open.
 *
 * Behaviour under test (GET /training/levels + the /training/courses gate):
 *   1. all_modules vendor: no level is ever `locked`, regardless of attempts.
 *   2. chain vendor: level N locked until level N-1's grand quiz is passed
 *      (existing Taleemabad behaviour preserved).
 *   3. chain vendor: level N unlocks once level N-1 is passed.
 *   4. Previous-level lookup is scoped within the vendor — another vendor's
 *      level with the adjacent order_index neither locks nor unlocks it.
 *   5. Levels with no vendor row default to chain (legacy behaviour).
 *   6. /training/courses 403s for a chain-locked level, 200s for an
 *      all_modules vendor's level with no progress at all.
 *
 * Same mock harness as tests/training/portal-quiz-questions.test.js.
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
    // Honour .in() filters so a single seeded table can serve scoped queries.
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        rows = rows.filter(r => val.in.includes(r[col]));
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
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach((m) => {
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

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const p = layer.route.path;
    const methods = layer.route.methods || {};
    if (methods[method] && p === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke(path, { userId, query = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', path);
  if (!stack) throw new Error(`Route GET ${path} not found`);

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params: {},
    query,
    method: 'GET',
    path,
    ip: '127.0.0.1',
    headers: {},
    get: () => undefined,
  };

  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
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

const V_CHAIN = 'vendor-taleemabad';
const V_OPEN = 'vendor-beaconhouse';

// Two vendors side by side: a 3-level chain ladder and a 3-level open
// (all_modules) vendor whose order_index values interleave with the chain
// vendor's — which is exactly the shape that broke the global previous-level
// lookup.
function seedLevels({ attempts = [] } = {}) {
  tableStates.training_vendors = {
    rows: [
      { id: V_CHAIN, key: 'TALEEMABAD', unlock_logic: 'chain' },
      { id: V_OPEN, key: 'BEACONHOUSE', unlock_logic: 'all_modules' },
    ],
  };
  tableStates.training_levels = {
    rows: [
      { id: 1, name: 'T-L1', order_index: 0, vendor_id: V_CHAIN, is_active: true, training_vendors: { key: 'TALEEMABAD', unlock_logic: 'chain' } },
      { id: 2, name: 'T-L2', order_index: 1, vendor_id: V_CHAIN, is_active: true, training_vendors: { key: 'TALEEMABAD', unlock_logic: 'chain' } },
      { id: 3, name: 'T-L3', order_index: 2, vendor_id: V_CHAIN, is_active: true, training_vendors: { key: 'TALEEMABAD', unlock_logic: 'chain' } },
      { id: 11, name: 'BH-English', order_index: 1, vendor_id: V_OPEN, is_active: true, training_vendors: { key: 'BEACONHOUSE', unlock_logic: 'all_modules' } },
      { id: 12, name: 'BH-Maths', order_index: 2, vendor_id: V_OPEN, is_active: true, training_vendors: { key: 'BEACONHOUSE', unlock_logic: 'all_modules' } },
      { id: 13, name: 'BH-Science', order_index: 3, vendor_id: V_OPEN, is_active: true, training_vendors: { key: 'BEACONHOUSE', unlock_logic: 'all_modules' } },
    ],
  };
  // bd-2237 — the levels endpoint now filters by program scopes; give the
  // test user an all-access assignment so the unlock-logic behaviour under
  // test stays isolated from scoping.
  tableStates.teacher_training_assignments = { rows: [{ user_id: 'user-1', program_id: 'prog-all', is_active: true }] };
  tableStates.training_program_scopes = { rows: [
    { program_id: 'prog-all', vendor_id: V_CHAIN, level_ids: null },
    { program_id: 'prog-all', vendor_id: V_OPEN, level_ids: null },
    { program_id: 'prog-all', vendor_id: 'vendor-unknown', level_ids: null },
  ] };
  tableStates.training_courses = { rows: [] };
  tableStates.training_modules = { rows: [] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_assessment_attempts = { rows: attempts };
  tableStates.training_grand_quizzes = { rows: [] };
}

function stateOf(payload, levelId) {
  return payload.levels.find(l => l.id === levelId).state;
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
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

describe('GET /training/levels — unlock_logic-aware lockdown', () => {
  it('exposes unlock_logic per level so the client can label vendors correctly (bd-2235)', async () => {
    seedLevels();
    const { payload } = await invoke('/training/levels', { userId: 'user-1' });
    expect(payload.levels.find(l => l.id === 1).unlock_logic).toBe('chain');
    expect(payload.levels.find(l => l.id === 11).unlock_logic).toBe('all_modules');
  });

  it('never locks an all_modules vendor, even with zero attempts', async () => {
    seedLevels();
    const { statusCode, payload } = await invoke('/training/levels', { userId: 'user-1' });
    expect(statusCode).toBe(200);
    expect(stateOf(payload, 11)).toBe('not_started');
    expect(stateOf(payload, 12)).toBe('not_started');
    expect(stateOf(payload, 13)).toBe('not_started');
  });

  it('still chain-locks the chain vendor: L2/L3 locked until L1 passed', async () => {
    seedLevels();
    const { payload } = await invoke('/training/levels', { userId: 'user-1' });
    expect(stateOf(payload, 1)).toBe('not_started'); // first level always open
    expect(stateOf(payload, 2)).toBe('locked');
    expect(stateOf(payload, 3)).toBe('locked');
  });

  it('unlocks the chain vendor level once the previous level is passed', async () => {
    seedLevels({ attempts: [{ level_id: 1, status: 'passed', is_passed: true, cooldown_until: null, completed_at: '2026-07-01' }] });
    const { payload } = await invoke('/training/levels', { userId: 'user-1' });
    expect(stateOf(payload, 1)).toBe('certified');
    expect(stateOf(payload, 2)).toBe('not_started'); // unlocked, no progress yet
    expect(stateOf(payload, 3)).toBe('locked'); // still gated on L2
  });

  it("scopes the previous-level lookup within the vendor — another vendor's adjacent order_index does not gate it", async () => {
    // BH-English has order_index 1; the chain vendor's T-L1 has order_index 0.
    // Under the old global lookup BH-English's "previous level" resolved to
    // T-L1 (unpassed) and locked it. With vendor scoping it has NO previous
    // level within an all_modules vendor and stays open. Symmetrically,
    // passing T-L1 must not be what unlocks BH levels.
    seedLevels();
    const { payload } = await invoke('/training/levels', { userId: 'user-1' });
    expect(stateOf(payload, 11)).toBe('not_started');
    // And the chain vendor's T-L2 (order 1) must key off T-L1, not BH-English.
    expect(stateOf(payload, 2)).toBe('locked');
  });

  it('defaults to chain when the level has no matching vendor row (legacy behaviour)', async () => {
    seedLevels();
    tableStates.training_levels.rows = [
      { id: 21, name: 'Legacy-L1', order_index: 0, vendor_id: 'vendor-unknown', is_active: true, training_vendors: { key: 'X' } },
      { id: 22, name: 'Legacy-L2', order_index: 1, vendor_id: 'vendor-unknown', is_active: true, training_vendors: { key: 'X' } },
    ];
    const { payload } = await invoke('/training/levels', { userId: 'user-1' });
    expect(stateOf(payload, 21)).toBe('not_started');
    expect(stateOf(payload, 22)).toBe('locked');
  });
});

describe('GET /training/courses — lockdown guard honours unlock_logic', () => {
  it('403s a chain-locked level', async () => {
    seedLevels();
    const { statusCode, payload } = await invoke('/training/courses', { userId: 'user-1', query: { level_id: '2' } });
    expect(statusCode).toBe(403);
    expect(payload.success).toBe(false);
  });

  it("200s an all_modules vendor's level with no progress at all", async () => {
    seedLevels();
    const { statusCode, payload } = await invoke('/training/courses', { userId: 'user-1', query: { level_id: '13' } });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.courses).toEqual([]);
  });
});
