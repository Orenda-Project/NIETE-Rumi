/**
 * The coach app's school and teacher admin saves through the WhatsApp /observe
 * writers and nothing else — the same rule Edit teacher follows
 * (internal-observe-teacher-admin.test.js).
 *
 *   POST /api/internal/observe/school-search      → observe-school-admin searchUniverse
 *   POST /api/internal/observe/school-add         → addSchoolForCoach
 *   POST /api/internal/observe/school-remove      → removeSchoolForCoach
 *   POST /api/internal/observe/teacher-add-check  → observe-teacher-admin planAdd (reads only)
 *   POST /api/internal/observe/teacher-add        → commitAdd (a new teacher, or a move)
 *   POST /api/internal/observe/teacher-remove-many→ commitRemovals (1–30 at one school)
 *
 * The services are NOT mocked — their writes are the behaviour under audit
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

/** A tiny in-memory stand-in for the supabase-js query builder (select/insert/update/delete). */
function fakeSupabase() {
  let seq = 0;
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
          const rows = inserted.map((r) => ({ id: r.id || `new-${name}-${(seq += 1)}`, ...r }));
          t.push(...rows);
          return { data: wantRows ? rows.map((r) => ({ ...r })) : null, error: null };
        }
        const hits = t.filter(match);
        if (op === 'update') {
          hits.forEach((r) => Object.assign(r, patch));
          return { data: wantRows ? hits.map((r) => ({ ...r })) : null, error: null };
        }
        if (op === 'delete') {
          for (const r of hits) t.splice(t.indexOf(r), 1);
          return { data: null, error: null };
        }
        const rows = lim == null ? hits : hits.slice(0, lim);
        return { data: rows.map((r) => ({ ...r })), error: null, count: hits.length };
      };
      const chain = {
        select() { if (op !== 'select') wantRows = true; return chain; },
        eq(c, v) { filters.push(['eq', c, v]); return chain; },
        in(c, v) { filters.push(['in', c, v]); return chain; },
        limit(n) { lim = n; return chain; },
        update(p) { op = 'update'; patch = p; return chain; },
        insert(rows) { op = 'insert'; inserted = Array.isArray(rows) ? rows : [rows]; return chain; },
        delete() { op = 'delete'; return chain; },
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
      { id: 'ls-1', leader_user_id: 'coach-1', school_ext_id: 'niete:110', school_id: 'sch-110', school_name: 'IMSG I-10/1', emis: '110', source: 'niete_ict' },
      { id: 'ls-2', leader_user_id: 'coach-2', school_ext_id: 'niete:110', school_id: 'sch-110', school_name: 'IMSG I-10/1', emis: '110', source: 'niete_ict' },
    ],
    leader_teachers: [],
    schools: [
      { id: 'sch-110', name: 'IMSG I-10/1', emis: '110', is_active: true },
      { id: 'sch-620', name: 'IMSG G-6/2', emis: '620', is_active: true },
      { id: 'sch-721', name: 'IMCG F-7/2', emis: '721', is_active: true },
    ],
    users: [
      { id: 'u-ayesha', phone_number: '923001110001', role: 'teacher', school_id: 'sch-110', name: 'Ayesha Bibi' },
      { id: 'u-bilal', phone_number: '923001110002', role: 'teacher', school_id: 'sch-110', name: 'Bilal Khan' },
      { id: 'u-sana', phone_number: '923001110003', role: 'principal', school_id: 'sch-721', name: 'Sana Riaz' },
      { id: 'u-coach', phone_number: '923001119999', role: 'coach', school_id: null, name: 'A Coach' },
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

const user = (id) => tables.users.find((u) => u.id === id);
const mine = (coach) => tables.leader_schools.filter((r) => r.leader_user_id === coach).map((r) => r.school_ext_id);

describe('POST /api/internal/observe/school-search (searchUniverse)', () => {
  it('finds every school by name or EMIS, and marks the ones already on her list', async () => {
    const { statusCode, payload } = await invoke('/observe/school-search', {
      headers: auth, body: { leaderUserId: 'coach-1', term: 'imsg' },
    });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.schools).toEqual(expect.arrayContaining([
      { schoolExtId: 'niete:110', name: 'IMSG I-10/1', emis: '110', alreadyMine: true },
      { schoolExtId: 'niete:620', name: 'IMSG G-6/2', emis: '620', alreadyMine: false },
    ]));
    expect(payload.schools).toHaveLength(2);

    const byEmis = await invoke('/observe/school-search', { headers: auth, body: { leaderUserId: 'coach-1', term: '721' } });
    expect(byEmis.payload.schools).toEqual([{ schoolExtId: 'niete:721', name: 'IMCG F-7/2', emis: '721', alreadyMine: false }]);
  });

  it('without the shared key: 401', async () => {
    const { statusCode } = await invoke('/observe/school-search', { body: { leaderUserId: 'coach-1', term: 'imsg' } });
    expect(statusCode).toBe(401);
  });

  it('no coach named: 400', async () => {
    const { statusCode } = await invoke('/observe/school-search', { headers: auth, body: { term: 'imsg' } });
    expect(statusCode).toBe(400);
  });
});

describe('POST /api/internal/observe/school-add (addSchoolForCoach)', () => {
  it('adds the school to HER list with its real key, and says so', async () => {
    const { statusCode, payload } = await invoke('/observe/school-add', {
      headers: auth, body: { leaderUserId: 'coach-1', schoolExtId: 'niete:620' },
    });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, schoolName: 'IMSG G-6/2', emis: '620', alreadyMine: false });
    expect(tables.leader_schools).toContainEqual(expect.objectContaining({
      leader_user_id: 'coach-1', school_ext_id: 'niete:620', school_id: 'sch-620', school_name: 'IMSG G-6/2', emis: '620',
    }));
  });

  it('a school already on her list is not added twice', async () => {
    // The service answers alreadyMine only when her old per-teacher rows exist too;
    // otherwise it repairs them. Either way her list must not grow a second row.
    const { statusCode, payload } = await invoke('/observe/school-add', {
      headers: auth, body: { leaderUserId: 'coach-1', schoolExtId: 'niete:110' },
    });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, schoolName: 'IMSG I-10/1' });
    expect(mine('coach-1')).toEqual(['niete:110']);
  });

  it('a school nobody has heard of is a 404 and nothing is written', async () => {
    const { statusCode, payload } = await invoke('/observe/school-add', {
      headers: auth, body: { leaderUserId: 'coach-1', schoolExtId: 'niete:4040' },
    });
    expect(statusCode).toBe(404);
    expect(payload).toMatchObject({ success: false, reason: 'not_found' });
    expect(mine('coach-1')).toEqual(['niete:110']);
    expect(tables.schools).toHaveLength(3);
  });
});

describe('POST /api/internal/observe/school-remove (removeSchoolForCoach)', () => {
  it('takes the school off HER list only; the other coach keeps it and the teachers stay', async () => {
    const { statusCode, payload } = await invoke('/observe/school-remove', {
      headers: auth, body: { leaderUserId: 'coach-1', schoolExtId: 'niete:110' },
    });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, schoolName: 'IMSG I-10/1' });
    expect(mine('coach-1')).toEqual([]);
    expect(mine('coach-2')).toEqual(['niete:110']);
    expect(user('u-ayesha').school_id).toBe('sch-110');
  });

  it('a school that is not hers: 404 not_mine, nothing removed', async () => {
    const { statusCode, payload } = await invoke('/observe/school-remove', {
      headers: auth, body: { leaderUserId: 'coach-1', schoolExtId: 'niete:620' },
    });
    expect(statusCode).toBe(404);
    expect(payload).toMatchObject({ success: false, reason: 'not_mine' });
    expect(tables.leader_schools).toHaveLength(2);
  });
});

describe('POST /api/internal/observe/teacher-add-check (planAdd — reads only)', () => {
  const check = (phone, schoolExtId = 'niete:110') => invoke('/observe/teacher-add-check', {
    headers: auth, body: { leaderUserId: 'coach-1', schoolExtId, phone },
  });

  it('an unknown number is "new" — nothing is written', async () => {
    const { statusCode, payload } = await check('0300 1110 555');
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, outcome: 'new', phone: '923001110555', toSchoolName: 'IMSG I-10/1' });
    expect(tables.users).toHaveLength(4);
    expect(tables.leader_roster_audit).toEqual([]);
  });

  it('a teacher at another school is a MOVE, named with where she is and where she goes', async () => {
    const { payload } = await check('03001110003');
    expect(payload).toEqual({
      success: true, outcome: 'move', phone: '923001110003', name: 'Sana Riaz', isPrincipal: true,
      fromSchoolName: 'IMCG F-7/2', toSchoolName: 'IMSG I-10/1',
    });
    expect(user('u-sana').school_id).toBe('sch-721');
  });

  it('someone already at this school: already_here', async () => {
    const { payload } = await check('923001110001');
    expect(payload).toMatchObject({ success: true, outcome: 'already_here', name: 'Ayesha Bibi' });
  });

  it('refusals: a coach\'s number and a bad number (400), a school not hers (403)', async () => {
    expect(await check('923001119999')).toMatchObject({ statusCode: 400, payload: { success: false, reason: 'is_coach' } });
    expect(await check('12345')).toMatchObject({ statusCode: 400, payload: { success: false, reason: 'invalid_phone' } });
    expect(await check('923001110555', 'niete:620')).toMatchObject({ statusCode: 403, payload: { success: false, reason: 'not_my_school' } });
  });
});

describe('POST /api/internal/observe/teacher-add (commitAdd)', () => {
  const add = (body) => invoke('/observe/teacher-add', { headers: auth, body: { leaderUserId: 'coach-1', schoolExtId: 'niete:110', ...body } });

  it('a new number with a name: a teacher is created at her school and audited', async () => {
    const { statusCode, payload } = await add({ phone: '03001110555', name: 'Nadia Akbar' });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, outcome: 'new', name: 'Nadia Akbar', toSchoolName: 'IMSG I-10/1' });
    expect(tables.users).toContainEqual(expect.objectContaining({
      phone_number: '923001110555', name: 'Nadia Akbar', school_id: 'sch-110', role: 'teacher',
    }));
    expect(tables.leader_roster_audit).toEqual([expect.objectContaining({ action: 'add', to_school_ext_id: 'niete:110' })]);
  });

  it('a new number with no name: 400 name_required, nobody created', async () => {
    const { statusCode, payload } = await add({ phone: '03001110555', name: '  ' });
    expect(statusCode).toBe(400);
    expect(payload).toMatchObject({ success: false, reason: 'name_required' });
    expect(tables.users).toHaveLength(4);
  });

  it('a teacher elsewhere is MOVED here and the move is audited', async () => {
    const { payload } = await add({ phone: '923001110003' });
    expect(payload).toMatchObject({ success: true, outcome: 'move', name: 'Sana Riaz', toSchoolName: 'IMSG I-10/1' });
    expect(user('u-sana').school_id).toBe('sch-110');
    expect(tables.leader_roster_audit).toEqual([expect.objectContaining({
      action: 'move', from_school_ext_id: 'niete:721', to_school_ext_id: 'niete:110',
    })]);
  });

  it('already here: success with nothing written', async () => {
    const { payload } = await add({ phone: '923001110001' });
    expect(payload).toMatchObject({ success: true, outcome: 'already_here' });
    expect(tables.leader_roster_audit).toEqual([]);
  });

  it('a school not hers: 403, nothing written', async () => {
    const { statusCode } = await add({ schoolExtId: 'niete:620', phone: '923001110003' });
    expect(statusCode).toBe(403);
    expect(user('u-sana').school_id).toBe('sch-721');
  });
});

describe('POST /api/internal/observe/teacher-remove-many (commitRemovals)', () => {
  const removeMany = (body) => invoke('/observe/teacher-remove-many', {
    headers: auth, body: { leaderUserId: 'coach-1', schoolExtId: 'niete:110', ...body },
  });

  it('takes everyone ticked off the school, cancels their visits there, keeps the reason in the audit', async () => {
    const { statusCode, payload } = await removeMany({ userIds: ['u-ayesha', 'u-bilal'], reason: 'Transferred' });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({
      success: true, schoolName: 'IMSG I-10/1', visitsCancelled: 1, skipped: 0,
      removed: [{ name: 'Ayesha Bibi' }, { name: 'Bilal Khan' }],
    });
    expect(user('u-ayesha').school_id).toBeNull();
    expect(user('u-bilal').school_id).toBeNull();
    expect(tables.observation_schedules[0].status).toBe('cancelled');
    expect(tables.leader_roster_audit).toHaveLength(2);
    expect(tables.leader_roster_audit[0]).toMatchObject({ action: 'remove', detail: expect.objectContaining({ reason: 'Transferred' }) });
  });

  it('someone not at that school is skipped, not removed', async () => {
    const { payload } = await removeMany({ userIds: ['u-ayesha', 'u-sana'] });
    expect(payload).toMatchObject({ success: true, removed: [{ name: 'Ayesha Bibi' }], skipped: 1 });
    expect(user('u-sana').school_id).toBe('sch-721');
  });

  it('nobody ticked: 400; a school not hers: 403', async () => {
    expect((await removeMany({ userIds: [] })).statusCode).toBe(400);
    expect((await removeMany({ schoolExtId: 'niete:721', userIds: ['u-sana'] })).statusCode).toBe(403);
    expect(user('u-sana').school_id).toBe('sch-721');
  });
});
