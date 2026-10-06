/**
 * bd-o15qnr.13 — the portal's Edit teacher saves through main's /observe edit
 * path, ported to sandbox.
 *
 * On main the writes live inline in observe-visit-flow.handler.js
 * (teacher_edit_name_commit / _level_commit / _role_commit / _phone_check /
 * _phone_commit). teacher-edit-commit.service.js carries those same writes as
 * functions, with the same authorisation (_editPerson: the person must be in
 * the coach's OWN patch at that school), the same verdicts (the ported
 * teacher-edit.service planners and classifyTarget) and the same audit actions.
 *
 * Real: the ported planners, patch-resolver's listPatchViaSupabase, the route.
 * Faked: the Supabase client (in memory). Stubbed: applyBandSelection — the
 * level WRITER has its own suite; what is under audit here is that the commit
 * asks it for exactly the planned bands, and refuses before asking when the
 * planner says no (pre-merge Class O: the seam is the arguments).
 */

let tables;
let applyBandSelection;

function fakeSupabase() {
  return {
    from(name) {
      const t = tables[name] || (tables[name] = []);
      const filters = [];
      let op = 'select';
      let patch = null;
      let inserted = null;
      let headCount = false;
      let single = false;
      const match = (row) => filters.every(([kind, c, v]) => (kind === 'eq' ? row[c] === v : v.includes(row[c])));
      const run = () => {
        if (op === 'insert') { t.push(...inserted); return { data: null, error: null }; }
        const hits = t.filter(match);
        if (op === 'update') { hits.forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
        if (headCount) return { data: null, count: hits.length, error: null };
        if (single) return { data: hits[0] ? { ...hits[0] } : null, error: null };
        return { data: hits.map((r) => ({ ...r })), error: null };
      };
      const chain = {
        select(_cols, opts) { if (opts && opts.head) headCount = true; return chain; },
        eq(c, v) { filters.push(['eq', c, v]); return chain; },
        in(c, v) { filters.push(['in', c, v]); return chain; },
        limit() { return chain; },
        maybeSingle() { single = true; return chain; },
        update(p) { op = 'update'; patch = p; return chain; },
        insert(rows) { op = 'insert'; inserted = Array.isArray(rows) ? rows : [rows]; return chain; },
        then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
      };
      return chain;
    },
  };
}

const HOUR = 3600000;
const ME = 'coach-1';
const SCHOOL = 'niete:110';

beforeEach(() => {
  jest.resetModules();
  tables = {
    leader_schools: [{ leader_user_id: ME, school_ext_id: SCHOOL, school_id: 'sch-110' }],
    schools: [
      { id: 'sch-110', name: 'IMSG I-10/1', emis: '110' },
      { id: 'sch-999', name: 'Not Hers', emis: '999' },
    ],
    users: [
      { id: 'u-ayesha', phone_number: '923001110001', name: 'Ayesha Bibi', role: 'teacher', school_id: 'sch-110', training_bands: ['PRIMARY'], training_bands_updated_at: null },
      { id: 'u-other', phone_number: '923001110009', name: 'Other School', role: 'teacher', school_id: 'sch-999', training_bands: ['HIGH'], training_bands_updated_at: null },
      { id: 'u-shell', phone_number: '923002220002', name: 'Shell Account', role: 'teacher', school_id: null },
      { id: 'u-real', phone_number: '923003330003', name: 'Real Teacher', role: 'teacher', school_id: null },
    ],
    training_certificates: [{ id: 'c1', user_id: 'u-real' }],
    training_assessment_attempts: [],
    teacher_training_progress: [],
    coaching_sessions: [],
    observation_schedules: [{ id: 'v1', teacher_ext_id: '923001110001', status: 'upcoming' }],
    leader_roster_audit: [],
  };
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => fakeSupabase());
  applyBandSelection = jest.fn().mockResolvedValue({ ok: true, programs: [] });
  jest.doMock('../../bot/shared/services/training/band-selection.service', () => ({ applyBandSelection }));
});

afterEach(() => jest.resetModules());

const svc = () => require('../../bot/shared/services/observe/teacher-edit-commit.service');
const user = (id) => tables.users.find((u) => u.id === id);
const audit = () => tables.leader_roster_audit;
const base = { actorLeaderUserId: ME, schoolExtId: SCHOOL, userId: 'u-ayesha' };

describe('authorisation — _editPerson: only a person in HER patch, at THAT school', () => {
  test('a teacher at a school the coach does not hold is refused, and nothing is written', async () => {
    const out = await svc().editName({ actorLeaderUserId: ME, schoolExtId: 'niete:999', userId: 'u-other', name: 'X' });
    expect(out).toEqual({ ok: false, reason: 'not_found' });
    expect(user('u-other').name).toBe('Other School');
    expect(audit()).toEqual([]);
  });

  test('her own school, but a person who is not on it, is refused', async () => {
    const out = await svc().editRole({ ...base, userId: 'u-other', role: 'principal' });
    expect(out).toEqual({ ok: false, reason: 'not_found' });
    expect(user('u-other').role).toBe('teacher');
  });
});

describe('name — teacher_edit_name_commit', () => {
  test('saves users.name (cleaned by planNameEdit) and audits edit_name', async () => {
    const out = await svc().editName({ ...base, name: '  ayesha   KHAN ' });
    expect(out).toMatchObject({ ok: true, outcome: 'saved', name: 'Ayesha Khan' });
    expect(user('u-ayesha').name).toBe('Ayesha Khan');
    expect(audit()).toEqual([expect.objectContaining({ action: 'edit_name', actor_user_id: ME, detail: expect.objectContaining({ to: 'Ayesha Khan', via: 'portal_coach_v2' }) })]);
  });

  test('an empty name is refused', async () => {
    expect(await svc().editName({ ...base, name: '   ' })).toEqual({ ok: false, reason: 'name_required' });
  });
});

describe('teaching level — teacher_edit_level_commit (multi-select; written by applyBandSelection)', () => {
  test('saves the planned bands, in canonical order, through applyBandSelection', async () => {
    const out = await svc().editLevel({ ...base, bands: ['high', 'Middle'] });
    expect(out).toMatchObject({ ok: true, outcome: 'saved', bands: ['MIDDLE', 'HIGH'] });
    expect(applyBandSelection).toHaveBeenCalledWith('u-ayesha', ['MIDDLE', 'HIGH']);
    expect(audit()).toEqual([expect.objectContaining({ action: 'edit_level', detail: expect.objectContaining({ to: ['MIDDLE', 'HIGH'] }) })]);
  });

  test('early years is not a level: it is dropped, never written', async () => {
    await svc().editLevel({ ...base, bands: ['EARLY_YEARS', 'PRIMARY', 'HIGH'] });
    expect(applyBandSelection).toHaveBeenCalledWith('u-ayesha', ['PRIMARY', 'HIGH']);
  });

  test('changed in the last 48 hours: refused with the hours left, and the writer is never asked', async () => {
    user('u-ayesha').training_bands_updated_at = new Date(Date.now() - 2 * HOUR).toISOString();
    const out = await svc().editLevel({ ...base, bands: ['HIGH'] });
    expect(out).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(out.hoursRemaining).toBeGreaterThan(40);
    expect(applyBandSelection).not.toHaveBeenCalled();
  });

  test('the same bands she already has: unchanged, no write', async () => {
    const out = await svc().editLevel({ ...base, bands: ['PRIMARY'] });
    expect(out).toMatchObject({ ok: true, outcome: 'unchanged' });
    expect(applyBandSelection).not.toHaveBeenCalled();
  });

  test('no band at all is refused', async () => {
    expect(await svc().editLevel({ ...base, bands: [] })).toMatchObject({ ok: false, reason: 'empty_selection' });
  });
});

describe('role — teacher_edit_role_commit', () => {
  test('Teacher → Principal is written and audited with from/to', async () => {
    const out = await svc().editRole({ ...base, role: 'principal' });
    expect(out).toMatchObject({ ok: true, outcome: 'saved', role: 'principal' });
    expect(user('u-ayesha').role).toBe('principal');
    expect(audit()).toEqual([expect.objectContaining({ action: 'edit_role', detail: expect.objectContaining({ from: 'teacher', to: 'principal' }) })]);
  });

  test('any role other than teacher or principal is refused', async () => {
    expect(await svc().editRole({ ...base, role: 'coach' })).toEqual({ ok: false, reason: 'invalid_role' });
    expect(user('u-ayesha').role).toBe('teacher');
  });
});

describe('phone — teacher_edit_phone_check (reads only)', () => {
  test('a free number: free, nothing written', async () => {
    const out = await svc().checkPhone({ ...base, phone: '0300 4445556' });
    expect(out).toMatchObject({ ok: true, outcome: 'free', phone: '923004445556' });
    expect(user('u-ayesha').phone_number).toBe('923001110001');
  });

  test('a number on an account with nothing irreplaceable: shell — it will be folded in', async () => {
    expect(await svc().checkPhone({ ...base, phone: '923002220002' })).toMatchObject({ ok: true, outcome: 'shell' });
  });

  test("a number on a real teacher's record is REFUSED, the reason given, and the attempt audited", async () => {
    const out = await svc().checkPhone({ ...base, phone: '923003330003' });
    expect(out).toMatchObject({ ok: false, reason: 'taken' });
    // main's copy, unchanged: says nothing about WHY, so it never reveals the number reaches someone else
    expect(out.heading).toMatch(/please wait while we fix your data/i);
    expect(out.message).toMatch(/check back later/i);
    expect(audit()).toEqual([expect.objectContaining({ action: 'edit_phone_escalated' })]);
  });

  test('03xx, +92 and 92 as typed: one stored E.164 number (bd-o15qnr.14 — display is 03xx, storage is not)', async () => {
    for (const typed of ['0300 4445556', '+92 300 4445556', '923004445556']) {
      expect(await svc().checkPhone({ ...base, phone: typed })).toMatchObject({ ok: true, outcome: 'free', phone: '923004445556' });
    }
  });

  test('not a Pakistani mobile: invalid_phone (the fail-closed normaliser)', async () => {
    expect(await svc().checkPhone({ ...base, phone: '12345' })).toEqual({ ok: false, reason: 'invalid_phone' });
  });

  test('her own number: unchanged', async () => {
    expect(await svc().checkPhone({ ...base, phone: '03001110001' })).toMatchObject({ ok: true, outcome: 'unchanged' });
  });
});

describe('phone — teacher_edit_phone_commit', () => {
  test('a free number: her phone moves, and her booked visit follows it', async () => {
    const out = await svc().commitPhone({ ...base, phone: '03004445556' });
    expect(out).toMatchObject({ ok: true, outcome: 'moved', phone: '923004445556', case: 'free' });
    expect(user('u-ayesha').phone_number).toBe('923004445556');
    expect(tables.observation_schedules[0].teacher_ext_id).toBe('923004445556');
    expect(audit()).toEqual([expect.objectContaining({ action: 'edit_phone', detail: expect.objectContaining({ from_phone: '923001110001', to_phone: '923004445556', case: 'free' }) })]);
  });

  test('a shell number: the shell is retired (soft) first, then she takes the number', async () => {
    const out = await svc().commitPhone({ ...base, phone: '923002220002' });
    expect(out).toMatchObject({ ok: true, outcome: 'moved', case: 'shell' });
    expect(user('u-shell').phone_number).toBe('merged:u-shell');
    expect(user('u-shell').deleted_reason).toBe('phone_change_merge');
    expect(user('u-ayesha').phone_number).toBe('923002220002');
  });

  test('RE-CLASSIFIED at commit: a taken number is refused even if the check said otherwise', async () => {
    const out = await svc().commitPhone({ ...base, phone: '923003330003' });
    expect(out).toMatchObject({ ok: false, reason: 'taken' });
    expect(user('u-ayesha').phone_number).toBe('923001110001');
    expect(user('u-real').phone_number).toBe('923003330003');
  });
});

describe('POST /api/internal/observe/teacher-edit', () => {
  let router;
  const KEY = 'shared-secret-key';

  function findRoute(r, path) {
    for (const layer of r.stack) {
      if (layer.route && layer.route.methods.post && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
    }
    return null;
  }
  async function invoke(body, headers = { 'x-api-key': KEY }) {
    const stack = findRoute(router, '/observe/teacher-edit');
    if (!stack) throw new Error('route POST /observe/teacher-edit not found');
    const req = { headers, body, ip: '127.0.0.1', method: 'POST', path: '/observe/teacher-edit' };
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

  beforeEach(() => {
    process.env.INTERNAL_API_KEY = KEY;
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterEach(() => { delete process.env.INTERNAL_API_KEY; });

  test('without the shared key: 401, nothing written', async () => {
    const { statusCode } = await invoke({ leaderUserId: ME, schoolExtId: SCHOOL, userId: 'u-ayesha', edit: 'name', value: 'X' }, {});
    expect(statusCode).toBe(401);
    expect(user('u-ayesha').name).toBe('Ayesha Bibi');
  });

  test('saves through the service and answers 200', async () => {
    const { statusCode, payload } = await invoke({ leaderUserId: ME, schoolExtId: SCHOOL, userId: 'u-ayesha', edit: 'role', value: 'principal' });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, outcome: 'saved' });
  });

  test('outside her patch: 404; a taken number: 409 with the reason; an unknown edit: 400', async () => {
    expect((await invoke({ leaderUserId: ME, schoolExtId: 'niete:999', userId: 'u-other', edit: 'name', value: 'X' })).statusCode).toBe(404);
    const taken = await invoke({ leaderUserId: ME, schoolExtId: SCHOOL, userId: 'u-ayesha', edit: 'phone_check', value: '923003330003' });
    expect(taken.statusCode).toBe(409);
    expect(taken.payload).toMatchObject({ success: false, reason: 'taken' });
    expect((await invoke({ leaderUserId: ME, schoolExtId: SCHOOL, userId: 'u-ayesha', edit: 'school', value: 'x' })).statusCode).toBe(400);
  });
});
