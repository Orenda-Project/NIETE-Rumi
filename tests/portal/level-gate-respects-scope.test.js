/**
 * bd-2468 — the level gate must respect the teacher's program scope.
 *
 * Reported: a Middle & High teacher whose NIETE program scopes them to levels
 * 3 and 4 sees "Skilled Practitioner — Ready for exam" in the portal, opens
 * the exam, and is told to pass Level 1 first. Level 1 isn't in their program
 * and doesn't appear anywhere in their list. The same account works on the bot.
 *
 * Cause: the portal has a scope filter and uses it in exactly one place.
 *
 *   line 1859  const visibleLevels = await _filterLevelsByScopes(userId, levels)   ← the LIST
 *   line 1982  .from('training_levels')...eq('is_active', true)                    ← the GATE
 *
 * _computeLevelStates derives each level's predecessor from the array it is
 * handed (`levels.find(l => l.order_index === lv.order_index - 1)`), so with
 * the full table it finds Level 2 behind Level 3 and locks it. Handed the
 * scoped array it finds nothing, sets isFirst, and unlocks — which is exactly
 * what the bot does, and why the bot was never wrong.
 *
 * Contract:
 *   1. A scoped teacher can open the exam on the first level IN THEIR SCOPE.
 *   2. The chain still binds inside the scope — level 4 stays locked until
 *      level 3's grand quiz is passed.
 *   3. A level outside the scope is 404, not silently allowed. Feeding the
 *      gate every level meant an out-of-scope level got a real state and could
 *      pass, which is an authorisation gap as well as a UX one.
 *   4. List and gate agree: nothing shown as openable is refused by the gate.
 *      This is the invariant that was violated; pinning it is the point.
 *   5. A teacher scoped to a whole vendor still gets the full chain.
 */

let supabaseFrom;
let tableStates;
let inserts;   // [{ table, row }]  — every .insert() call captured for shape assertions
let upserts;   // [{ table, row, opts }]  — every .upsert() call

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null, rangeArgs: null };
  const chain = {};

  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
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
  chain.range = jest.fn((a, b) => { record.rangeArgs = [a, b]; return chain; });
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.insert = jest.fn((rowOrRows) => {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    for (const r of rows) inserts.push({ table: tableName, row: r });
    // Support .insert(...).select().single() chain returning first row with an id
    const returned = { ...(rows[0] || {}) };
    if (returned.id == null) returned.id = state.newId || 'generated-id';
    const insertChain = {
      select: jest.fn(() => insertChain),
      single: jest.fn(async () => ({ data: returned, error: state.insertError || null })),
      maybeSingle: jest.fn(async () => ({ data: returned, error: state.insertError || null })),
      then: (resolve, reject) => Promise.resolve({ data: state.insertError ? null : returned, error: state.insertError || null }).then(resolve, reject),
    };
    return insertChain;
  });
  chain.upsert = jest.fn((row, opts) => {
    upserts.push({ table: tableName, row, opts });
    const upsertChain = {
      select: jest.fn(() => upsertChain),
      single: jest.fn(async () => ({ data: row, error: null })),
      then: (resolve, reject) => Promise.resolve({ data: row, error: null }).then(resolve, reject),
    };
    return upsertChain;
  });
  chain.update = jest.fn(() => ({ eq: jest.fn(() => ({ then: (r) => Promise.resolve({ data: null, error: null }).then(r) })) }));
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

async function invoke({ userId, params = {}, body = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', '/training/module/:id/quiz-attempts');
  if (!stack) throw new Error('Route POST /training/module/:id/quiz-attempts not found');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query: {},
    method: 'POST',
    path: `/training/module/${params.id}/quiz-attempts`,
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

// A canonical 3-question module used by most happy-path tests.
function seedThreeQuestionModule({ moduleId = 42, courseId = 7, levelId = 1, programId = 'prog-1' } = {}) {
  tableStates.training_questions = {
    rows: [
      { id: 101, training_module_id: moduleId, question_text: 'Q1', options: [{ text: 'a' }, { text: 'b' }], correct_option: '1', order_index: 0, is_active: true },
      { id: 102, training_module_id: moduleId, question_text: 'Q2', options: [{ text: 'a' }, { text: 'b' }], correct_option: '2', order_index: 1, is_active: true },
      { id: 103, training_module_id: moduleId, question_text: 'Q3', options: [{ text: 'a' }, { text: 'b' }], correct_option: '1', order_index: 2, is_active: true },
    ],
  };
  tableStates.training_modules = {
    rows: [{ id: moduleId, course_id: courseId, title: 'M', is_active: true }],
  };
  tableStates.training_courses = {
    rows: [{ id: courseId, level_id: levelId, title: 'C' }],
  };
  tableStates.training_levels = {
    rows: [
      // Level 1 has no previous, so it's never "locked" in the state map.
      { id: levelId, name: 'L1', order_index: 0, is_active: true },
    ],
  };
  tableStates.teacher_training_assignments = {
    rows: [{ program_id: programId, user_id: 'user-1', is_active: true }],
  };
  tableStates.training_assessment_attempts = {
    // Empty by default — no in-progress row, no history
    rows: [],
    newId: 'attempt-uuid-1',
  };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [] };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  inserts = [];
  upserts = [];

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
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pg', () => ({ Pool: jest.fn(() => ({ query: jest.fn(), on: jest.fn() })) }), { virtual: true });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());


const NIETE = 'v-niete';

/**
 * @param {number[]|null} levelIds  program scope; null = whole vendor
 * @param {number[]} passedLevels   levels with a passed GRAND attempt
 */
function seed({ levelIds = [3, 4], passedLevels = [] } = {}) {
  tableStates.teacher_training_assignments = { rows: [{ user_id: 'user-1', program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: NIETE, level_ids: levelIds }] };
  tableStates.training_vendors = { rows: [{ id: NIETE, key: 'TALEEMABAD', unlock_logic: 'chain' }] };
  tableStates.training_levels = {
    rows: [
      { id: 1, name: 'Aspiring Teacher',     order_index: 0, vendor_id: NIETE, is_active: true },
      { id: 2, name: 'Emerging Practitioner',order_index: 1, vendor_id: NIETE, is_active: true },
      { id: 3, name: 'Skilled Practitioner', order_index: 2, vendor_id: NIETE, is_active: true },
      { id: 4, name: 'Teacher Leader',       order_index: 3, vendor_id: NIETE, is_active: true },
    ],
  };
  // every level fully complete, so completeness never masks a scope failure
  tableStates.training_courses = { rows: [1, 2, 3, 4].map(l => ({ id: l * 10, level_id: l, is_active: true })) };
  tableStates.training_modules = { rows: [1, 2, 3, 4].map(l => ({ id: l * 100, course_id: l * 10, is_active: true })) };
  tableStates.teacher_training_progress = {
    rows: [1, 2, 3, 4].map(l => ({ user_id: 'user-1', module_id: l * 100, training_modules: { course_id: l * 10, is_active: true } })),
  };
  tableStates.training_assessment_attempts = {
    rows: passedLevels.map(l => ({
      user_id: 'user-1', level_id: l, quiz_kind: 'grand', status: 'passed',
      is_passed: true, cooldown_until: null, completed_at: '2026-07-31T10:00:00Z',
    })),
  };
  tableStates.training_grand_quizzes = { rows: [1, 2, 3, 4].map(l => ({ id: l, level_id: l, quiz_type: 'grand_quiz', is_active: true })) };
  tableStates.training_questions = { rows: [] };
  tableStates.users = { rows: [{ id: 'user-1', phone_number: '923001234567' }] };
}

function route(method, path) {
  const routes = require('../../dashboard/routes/portal.routes');
  for (const layer of routes.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function call(method, path, { params = {}, query = {} } = {}) {
  const stack = route(method, path);
  if (!stack) throw new Error(`${method} ${path} not found`);
  const req = {
    session: { portalUserId: 'user-1', id: 's1' }, params, query, body: {},
    method: method.toUpperCase(), path, ip: '127.0.0.1',
    headers: { host: 'p.example.com' }, get: () => 'p.example.com', protocol: 'https',
  };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const h of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const m = h(req, res, () => { advanced = true; resolve(); });
      if (m && typeof m.then === 'function') m.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

// Any endpoint behind _assertLevelUnlocked exercises the gate; courses is the simplest.
const gate = (levelId) => call('get', '/training/courses', { query: { level_id: String(levelId) } });

describe('bd-2468 — the gate respects program scope', () => {
  it('the reported bug: the first level IN SCOPE is not locked behind an unscoped one', async () => {
    seed({ levelIds: [3, 4] });

    const { statusCode, payload } = await gate(3);

    expect(statusCode).not.toBe(403);
    expect(String(payload && payload.error || '')).not.toMatch(/Level 1/);
  });

  it('does not cite a level the teacher cannot see', async () => {
    seed({ levelIds: [3, 4] });

    const { payload } = await gate(3);

    expect(payload && payload.previous_level_order).toBeUndefined();
  });

  it('the chain still binds INSIDE the scope — level 4 waits for level 3', async () => {
    seed({ levelIds: [3, 4], passedLevels: [] });

    const { statusCode } = await gate(4);

    expect(statusCode).toBe(403);
  });

  it('passing level 3 unlocks level 4', async () => {
    seed({ levelIds: [3, 4], passedLevels: [3] });

    const { statusCode } = await gate(4);

    expect(statusCode).not.toBe(403);
  });

  it('a level outside the scope is 404, not quietly allowed', async () => {
    // Feeding the gate every level gave an out-of-scope level a real state,
    // so it could pass. That is an authorisation gap, not just bad copy.
    seed({ levelIds: [3, 4] });

    const { statusCode } = await gate(1);

    expect(statusCode).toBe(404);
  });

  it('a teacher scoped to the whole vendor still gets the full chain', async () => {
    seed({ levelIds: null, passedLevels: [] });

    expect((await gate(1)).statusCode).not.toBe(403);   // first level open
    expect((await gate(2)).statusCode).toBe(403);       // still chained
  });
});

describe('bd-2468 — list and gate cannot disagree', () => {
  it('every level the list offers as openable is accepted by the gate', async () => {
    // The invariant the bug violated. Worth pinning directly: the two read
    // paths must never diverge again, whatever the scope shape.
    for (const scope of [[3, 4], [4], null]) {
      jest.resetModules();
      seed({ levelIds: scope, passedLevels: [] });

      const list = await call('get', '/training/levels');
      const levels = (list.payload && list.payload.levels) || [];
      expect(levels.length).toBeGreaterThan(0);

      // eslint-disable-next-line no-await-in-loop
      for (const lv of levels.filter(l => l.state !== 'locked')) {
        const g = await gate(lv.id);
        expect({ scope, id: lv.id, status: g.statusCode })
          .toEqual({ scope, id: lv.id, status: g.statusCode === 200 ? 200 : g.statusCode });
        expect(g.statusCode).not.toBe(403);
        expect(g.statusCode).not.toBe(404);
      }
    }
  });
});
