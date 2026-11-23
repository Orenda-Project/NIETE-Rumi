/**
 * bd-33wxxi.11 (queue #236, option B) — the principal Home for EVERY principal; observing in the app stays behind
 * portal_principal_app.
 *
 * The operator, 23 Nov: "principals should get the new portal without the HITL because that is not ready yet." Until
 * now one answer (lib/teacher-app.js isPrincipalAppUser: portal_principal_app names her AND users.role principal)
 * opened both the principal Home (the teacher app, her Principal chip, My school card, Analytics → My school, the staff
 * register) and observing in the app (the observe API, the observation reads, observeOnPortal, principalFlowV2). The
 * switch names 3 ids and all 3 are coaches now, so all 552 principals got the old /portal/leader "patch" page.
 *
 * The one answer is split in two:
 *
 *   isPrincipalHomeUser     users.role principal. No switch. → the teacher app + /config principalApp + her school card
 *                           + the staff register + the Home card's principal rungs
 *   isPrincipalObserveUser  portal_principal_app names her AND users.role principal (today's isPrincipalAppUser) →
 *                           the observe API, the coach observation reads, /config principalObserve, observeOnPortal,
 *                           coachObservation and principalFlowV2
 *
 * Coaches and teachers: every answer exactly as before.
 */
process.env.FLAG_CACHE_TTL_MS = '0';

/* ── lib/teacher-app.js, on a fake app_settings + users ────────────────── */

const PRINCIPAL = 'p-1';
const NO_SCHOOL = 'p-2';
const TEACHER = 't-1';
const COACH = 'c-1';

let settings;
let users;
let usersError;

function fakeSupabase() {
  return {
    from(table) {
      let key = null;
      const chain = {
        select: () => chain,
        eq: (_col, val) => { key = val; return chain; },
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === 'users') {
            if (usersError) return { data: null, error: { message: 'users down' } };
            return { data: Object.prototype.hasOwnProperty.call(users, key) ? users[key] : null, error: null };
          }
          if (table === 'app_settings') {
            return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      chain.single = chain.maybeSingle;
      return chain;
    },
    rpc: jest.fn(),
  };
}

describe('lib/teacher-app.js — the Home and the observe answers', () => {
  const lib = () => require('../../dashboard/lib/teacher-app');
  const KEYS = ['portal_teacher_v2', 'portal_teacher_home_card', 'portal_teacher_home_look'];

  beforeEach(() => {
    settings = {};
    users = {
      [PRINCIPAL]: { role: 'principal', school_id: 'school-1' },
      [NO_SCHOOL]: { role: 'principal', school_id: null },
      [TEACHER]: { role: 'teacher', school_id: 'school-1' },
      [COACH]: { role: 'coach', school_id: 'school-1' },
    };
    usersError = false;
  });

  test('isPrincipalHomeUser: every principal, whatever the switch holds', async () => {
    for (const value of [undefined, false, [], [COACH], 'teachers', true, [PRINCIPAL]]) {
      if (value === undefined) delete settings.portal_principal_app; else settings.portal_principal_app = value;
      expect(await lib().isPrincipalHomeUser(fakeSupabase(), PRINCIPAL)).toBe(true);
      expect(await lib().isPrincipalHomeUser(fakeSupabase(), NO_SCHOOL)).toBe(true);
    }
  });

  test('isPrincipalHomeUser: never a teacher, a coach, nobody, or a failed read (strict throws)', async () => {
    settings.portal_principal_app = true;
    expect(await lib().isPrincipalHomeUser(fakeSupabase(), TEACHER)).toBe(false);
    expect(await lib().isPrincipalHomeUser(fakeSupabase(), COACH)).toBe(false);
    expect(await lib().isPrincipalHomeUser(fakeSupabase(), 'nobody')).toBe(false);
    expect(await lib().isPrincipalHomeUser(fakeSupabase(), null)).toBe(false);
    usersError = true;
    expect(await lib().isPrincipalHomeUser(fakeSupabase(), PRINCIPAL)).toBe(false);
    await expect(lib().isPrincipalHomeUser(fakeSupabase(), PRINCIPAL, { strict: true })).rejects.toThrow();
  });

  test('isPrincipalObserveUser: the switch naming her AND role principal (today\'s rule)', async () => {
    expect(await lib().isPrincipalObserveUser(fakeSupabase(), PRINCIPAL)).toBe(false); // no row
    settings.portal_principal_app = [NO_SCHOOL];
    expect(await lib().isPrincipalObserveUser(fakeSupabase(), PRINCIPAL)).toBe(false);
    settings.portal_principal_app = [PRINCIPAL, COACH, TEACHER];
    expect(await lib().isPrincipalObserveUser(fakeSupabase(), PRINCIPAL)).toBe(true);
    expect(await lib().isPrincipalObserveUser(fakeSupabase(), COACH)).toBe(false);
    expect(await lib().isPrincipalObserveUser(fakeSupabase(), TEACHER)).toBe(false);
    settings.portal_principal_app = true;
    expect(await lib().isPrincipalObserveUser(fakeSupabase(), NO_SCHOOL)).toBe(true);
  });

  test('teacherAppOnFor: ON for every principal with no switch; teachers and coaches unchanged', async () => {
    for (const key of KEYS) settings[key] = 'teachers';
    for (const key of KEYS) {
      expect(await lib().teacherAppOnFor(fakeSupabase(), key, PRINCIPAL)).toBe(true);
      expect(await lib().teacherAppOnFor(fakeSupabase(), key, NO_SCHOOL)).toBe(true);
      expect(await lib().teacherAppOnFor(fakeSupabase(), key, TEACHER)).toBe(true);
      expect(await lib().teacherAppOnFor(fakeSupabase(), key, COACH)).toBe(false);
    }
  });
});

/* ── /config, the observe API and the observation reads (portal.routes.js) ─ */

let tableRows;

function makeChain(table) {
  const tests = [];
  const run = () => (tableRows[table] || []).filter((r) => tests.every((t) => t(r)));
  const chain = {
    select: () => chain,
    eq: (c, v) => { tests.push((r) => r[c] === v); return chain; },
    in: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: run()[0] || null, error: null }),
    single: async () => {
      const r = run()[0] || null;
      return { data: r, error: r ? null : { code: 'PGRST116', message: 'no rows' } };
    },
    then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

async function invoke(method, path, { userId, params = {}, body = {}, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; }, set() { return this; } };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const ok = (body = {}) => jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', ...body } });
const setFlag = (key, value) => {
  tableRows.app_settings = tableRows.app_settings.filter((r) => r.key !== key);
  if (value !== undefined) tableRows.app_settings.push({ key, value });
};
const config = async (userId) => (await invoke('get', '/config', { userId })).payload.features;

describe('the portal API: Home for every principal, observing behind portal_principal_app', () => {
  beforeEach(() => {
    jest.resetModules();
    tableRows = {
      app_settings: [],
      users: [
        { id: 'principal-1', role: 'principal', school_id: 's-1' }, // on no switch (every real principal today)
        { id: 'principal-2', role: 'principal', school_id: 's-1' }, // portal_principal_app names her
        { id: 'principal-3', role: 'principal', school_id: null }, // on no switch, no school
        { id: 'coach-1', role: 'coach' },
        { id: 'teacher-1', role: 'teacher', school_id: 's-1' },
      ],
    };
    // Production's switches, 23 Nov.
    for (const key of ['portal_teacher_v2', 'portal_teacher_home_card', 'portal_teacher_home_look']) setFlag(key, 'teachers');
    setFlag('portal_coach_v2', true);
    setFlag('portal_coach_school_card', true);
    setFlag('portal_coach_observation', true);
    setFlag('portal_coach_full_app', ['coach-1', 'principal-1']);
    setFlag('portal_coach_flow_v2', ['coach-1', 'principal-1', 'principal-2']);
    setFlag('portal_principal_app', ['principal-2']);
    const client = {
      presignUpload: ok({ key: 'k', uploadUrl: 'u', contentType: 'audio/webm' }),
      listObservations: ok({ observations: [] }),
    };
    jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
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

  test('/config, a principal on NO switch: the principal Home (teacher app + principalApp), no observing', async () => {
    for (const id of ['principal-1', 'principal-3']) {
      // eslint-disable-next-line no-await-in-loop
      const f = await config(id);
      expect(f.teacherV2).toBe(true);
      expect(f.teacherHomeCard).toBe(true);
      expect(f.teacherHomeLook).toBe(true);
      expect(f.principalApp).toBe(true);
      expect(f.principalObserve).toBe(false);
      expect(f.observeOnPortal).toBe(false);
      expect(f.coachObservation).toBe(false);
      expect(f.principalFlowV2).toBe(false);
    }
  });

  test('/config, a principal the switch names: the Home AND observing, exactly as before', async () => {
    const f = await config('principal-2');
    expect(f.teacherV2).toBe(true);
    expect(f.principalApp).toBe(true);
    expect(f.principalObserve).toBe(true);
    expect(f.observeOnPortal).toBe(true);
    expect(f.coachObservation).toBe(true);
    expect(f.principalFlowV2).toBe(true);
  });

  test('/config, a coach and a teacher: unchanged (never the principal Home, never principalObserve)', async () => {
    const c = await config('coach-1');
    expect(c.teacherV2).toBe(false);
    expect(c.principalApp).toBe(false);
    expect(c.principalObserve).toBe(false);
    expect(c.observeOnPortal).toBe(true);
    expect(c.coachFlowV2).toBe(true);
    const t = await config('teacher-1');
    expect(t.teacherV2).toBe(true);
    expect(t.principalApp).toBe(false);
    expect(t.principalObserve).toBe(false);
  });

  test('the observe API stays 404 for a principal on no switch, 200 for the one it names', async () => {
    const body = { filename: 'a.webm', sizeBytes: 10, kind: 'audio' };
    expect((await invoke('post', '/leader/observe-upload/presign', { userId: 'principal-1', body })).statusCode).toBe(404);
    expect((await invoke('post', '/leader/observe-upload/presign', { userId: 'principal-2', body })).statusCode).toBe(200);
  });

  test('the observation reads (Schedule) stay 404 for a principal on no switch', async () => {
    expect((await invoke('get', '/coach/schedule', { userId: 'principal-1' })).statusCode).toBe(404);
  });
});

/* ── her school card (portal-principal.routes.js) ──────────────────────── */

describe('GET /principal/school/card for a principal on no switch', () => {
  beforeEach(() => {
    jest.resetModules();
    settings = {}; // portal_principal_app absent
    users = { [PRINCIPAL]: { role: 'principal', school_id: 's-1' }, [NO_SCHOOL]: { role: 'principal', school_id: null }, [TEACHER]: { role: 'teacher', school_id: 's-1' } };
    usersError = false;
  });

  async function call(userId) {
    const getPrincipalSchoolCard = jest.fn(async () => ({ school: { emis: '1126', name: 'Sample School', teachers: 7 }, period: { key: 'week' } }));
    const { createPrincipalRouter } = require('../../dashboard/routes/portal-principal.routes');
    const router = createPrincipalRouter({ guards: [], supabase: fakeSupabase(), query: jest.fn(), card: { getPrincipalSchoolCard } });
    const layer = router.stack.find((l) => l.route && l.route.path === '/principal/school/card');
    const req = { session: { portalUserId: userId }, query: {}, params: {}, body: {}, headers: {}, get: () => undefined };
    let statusCode = 200; let payload = null;
    const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; }, set() { return this; } };
    for (const s of layer.route.stack) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await s.handle(req, res, () => { next = true; });
      if (!next) break;
    }
    return { statusCode, payload, getPrincipalSchoolCard };
  }

  test('her school\'s card (200), with no switch', async () => {
    const r = await call(PRINCIPAL);
    expect(r.statusCode).toBe(200);
    expect(r.payload.school.name).toBe('Sample School');
  });

  test('no school on her row: 200 { school: null } (the card says "No school")', async () => {
    const r = await call(NO_SCHOOL);
    expect(r.statusCode).toBe(200);
    expect(r.payload.school).toBeNull();
    expect(r.getPrincipalSchoolCard).not.toHaveBeenCalled();
  });

  test('a teacher: still 404', async () => {
    expect((await call(TEACHER)).statusCode).toBe(404);
  });
});
