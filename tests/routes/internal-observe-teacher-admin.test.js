/**
 * bd-o15qnr.11 — the coach app's Edit teacher saves through the WhatsApp
 * /observe teacher admin and nothing else (operator: "The backend of these are
 * already present if you follow what /observe does, so check the moving
 * operation from there").
 *
 *   POST /api/internal/observe/teacher-move    → observe-teacher-admin commitAdd
 *        (a teacher already on record is MOVED to the school; `myschool` refuses
 *        a school the coach does not hold; a 'move' row in leader_roster_audit)
 *   POST /api/internal/observe/teacher-remove  → commitRemovals (school cleared,
 *        her upcoming visits there cancelled, a 'remove' audit row)
 *
 * The service is NOT mocked — its writes are the behaviour under audit
 * (pre-merge Class O). Only the Supabase client underneath is faked, in memory.
 */

let router;
let tables;

function findRoute(r, method, path) {
  for (const layer of r.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { headers = {}, body = {} } = {}) {
  const stack = findRoute(router, 'post', path);
  if (!stack) throw new Error(`route POST ${path} not found`);
  const req = { headers, body, ip: '127.0.0.1', method: 'POST', path };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

/** A tiny in-memory stand-in for the supabase-js query builder. */
function fakeSupabase() {
  return {
    from(name) {
      const t = tables[name] || (tables[name] = []);
      const filters = [];
      let op = 'select';
      let patch = null;
      let inserted = null;
      let wantRows = false;
      let lim = null;
      const match = (row) => filters.every(([kind, c, v]) => (kind === 'eq' ? row[c] === v : v.includes(row[c])));
      const run = () => {
        if (op === 'insert') {
          t.push(...inserted);
          return { data: wantRows ? inserted.map((r) => ({ id: r.id || `new-${t.length}` })) : null, error: null };
        }
        const hits = t.filter(match);
        if (op === 'update') {
          hits.forEach((r) => Object.assign(r, patch));
          return { data: wantRows ? hits.map((r) => ({ ...r })) : null, error: null };
        }
        const rows = lim == null ? hits : hits.slice(0, lim);
        return { data: rows.map((r) => ({ ...r })), error: null };
      };
      const chain = {
        select() { if (op !== 'select') wantRows = true; return chain; },
        eq(c, v) { filters.push(['eq', c, v]); return chain; },
        in(c, v) { filters.push(['in', c, v]); return chain; },
        limit(n) { lim = n; return chain; },
        update(p) { op = 'update'; patch = p; return chain; },
        insert(rows) { op = 'insert'; inserted = Array.isArray(rows) ? rows : [rows]; return chain; },
        then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
      };
      return chain;
    },
  };
}

const KEY = 'shared-secret-key';
const auth = { 'x-api-key': KEY };

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  tables = {
    leader_schools: [
      { leader_user_id: 'coach-1', school_ext_id: 'niete:110' },
      { leader_user_id: 'coach-1', school_ext_id: 'niete:620' },
    ],
    schools: [
      { id: 'sch-110', name: 'IMSG I-10/1', emis: '110' },
      { id: 'sch-620', name: 'IMSG G-6/2', emis: '620' },
      { id: 'sch-999', name: 'Not Hers', emis: '999' },
    ],
    users: [
      { id: 'u-ayesha', phone_number: '923001110001', role: 'teacher', school_id: 'sch-110', name: 'Ayesha Bibi' },
    ],
    leader_roster_audit: [],
    observation_schedules: [
      { id: 'v1', school_ext_id: 'niete:110', teacher_ext_id: '923001110001', status: 'upcoming' },
    ],
  };
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => fakeSupabase());
  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

const ayesha = () => tables.users.find((u) => u.id === 'u-ayesha');

describe('bd-o15qnr.11 — POST /api/internal/observe/teacher-move (commitAdd)', () => {
  it('moves her to another school the coach holds, and writes the move to the roster audit', async () => {
    const { statusCode, payload } = await invoke('/observe/teacher-move', {
      headers: auth, body: { leaderUserId: 'coach-1', teacherPhone: '923001110001', schoolExtId: 'niete:620' },
    });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, outcome: 'move' });
    expect(ayesha().school_id).toBe('sch-620');
    expect(tables.leader_roster_audit).toEqual([expect.objectContaining({
      action: 'move', actor_user_id: 'coach-1', teacher_phone_e164: '923001110001',
      from_school_ext_id: 'niete:110', to_school_ext_id: 'niete:620',
    })]);
  });

  it('a school the coach does not hold is refused (403) and nothing changes', async () => {
    const { statusCode, payload } = await invoke('/observe/teacher-move', {
      headers: auth, body: { leaderUserId: 'coach-1', teacherPhone: '923001110001', schoolExtId: 'niete:999' },
    });
    expect(statusCode).toBe(403);
    expect(payload).toMatchObject({ success: false, reason: 'not_my_school' });
    expect(ayesha().school_id).toBe('sch-110');
    expect(tables.leader_roster_audit).toEqual([]);
  });

  it('a number not on record is a 404 — the edit screen never creates a teacher', async () => {
    const { statusCode } = await invoke('/observe/teacher-move', {
      headers: auth, body: { leaderUserId: 'coach-1', teacherPhone: '923009999999', schoolExtId: 'niete:620' },
    });
    expect(statusCode).toBe(404);
    expect(tables.users).toHaveLength(1);
  });

  it('without the shared key: 401, nothing written', async () => {
    const { statusCode } = await invoke('/observe/teacher-move', {
      body: { leaderUserId: 'coach-1', teacherPhone: '923001110001', schoolExtId: 'niete:620' },
    });
    expect(statusCode).toBe(401);
    expect(ayesha().school_id).toBe('sch-110');
  });
});

describe('bd-o15qnr.11 — POST /api/internal/observe/teacher-remove (commitRemovals)', () => {
  it('takes her off the school, cancels her upcoming visit there, and audits the removal', async () => {
    const { statusCode, payload } = await invoke('/observe/teacher-remove', {
      headers: auth, body: { leaderUserId: 'coach-1', userId: 'u-ayesha', schoolExtId: 'niete:110' },
    });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true });
    expect(ayesha().school_id).toBeNull();
    expect(tables.observation_schedules[0].status).toBe('cancelled');
    expect(tables.leader_roster_audit).toEqual([expect.objectContaining({ action: 'remove', from_school_ext_id: 'niete:110' })]);
  });

  it('a school the coach does not hold is refused (403) and she stays', async () => {
    tables.users[0].school_id = 'sch-999';
    const { statusCode } = await invoke('/observe/teacher-remove', {
      headers: auth, body: { leaderUserId: 'coach-1', userId: 'u-ayesha', schoolExtId: 'niete:999' },
    });
    expect(statusCode).toBe(403);
    expect(ayesha().school_id).toBe('sch-999');
  });
});
