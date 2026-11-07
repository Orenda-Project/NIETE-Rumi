'use strict';
/**
 * bd-rj6w0n.14.2 — the ICT-or-GB choice on the teacher app's Lesson Plans page (the in-app browser page
 * she already opens), never a WhatsApp question: every WhatsApp message costs money.
 *
 *   GET  /api/portal/teacher/region   -> { success, region, ask, sectors, schools }
 *        ask is true only when no signal names her region (users.source, users.region, her school);
 *        sectors = the registry's ICT regions, schools = the active GB schools, both only when ask.
 *   POST /api/portal/teacher/region   { region: 'ict', sector } | { region: 'gb', schoolId? } -> { success, region, saved }
 *        stores users.region spelt as the region registry (region_features.display_name, bd-97daxo.2) does:
 *        her ICT sector, or the GB region. Only while it is unknown, and a GB school only when
 *        users.school_id is empty. Asked once: a known region is never overwritten.
 *
 * Dark (404, nothing read) unless LP_GB_K5_ENABLED is 'true'. The teacher is always the session's user.
 */

const { installLivePortalAccounts } = require('../fixtures/portal-auth-live');

const TEACHER = 'user-teacher-1';

const REGISTRY = [
  { region: 'b.k', organization: 'niete', display_name: 'B.K', sort_order: 1, is_active: true },
  { region: 'sihala', organization: 'niete', display_name: 'Sihala', sort_order: 2, is_active: true },
  { region: 'tarnol', organization: 'niete', display_name: 'Tarnol', sort_order: 6, is_active: true },
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 1, is_active: true },
  { region: 'niete', organization: null, display_name: null, sort_order: null, is_active: true },
];

/** A tiny in-memory Supabase: region_features, users and schools; select/eq/in/maybeSingle/order/update. */
function fakeSupabase(world) {
  const writes = [];
  const reads = [];
  const from = (table) => {
    reads.push(table);
    const q = { filters: [], patch: null };
    const rows = () => (world[table] || []).filter((r) => q.filters.every(([c, v]) => (typeof v === 'function' ? v(r[c]) : r[c] === v)));
    q.select = () => (table === 'region_features' ? Promise.resolve({ data: REGISTRY, error: null }) : q);
    q.in = (c, vs) => { q.filters.push([c, (v) => vs.includes(v)]); return q; };
    q.order = () => Promise.resolve({ data: rows().slice().sort((a, b) => a.name.localeCompare(b.name)), error: null });
    q.update = (patch) => { q.patch = patch; return q; };
    q.eq = (c, v) => {
      q.filters.push([c, v]);
      if (q.patch) {
        writes.push({ table, id: v, patch: q.patch });
        rows().forEach((r) => Object.assign(r, q.patch));
        return Promise.resolve({ error: null });
      }
      return q;
    };
    q.maybeSingle = () => Promise.resolve({ data: rows()[0] || null, error: null });
    return q;
  };
  return { from, writes, reads };
}

const GB_SCHOOLS = [
  { id: 's-gb-2', name: 'GBPS Zeta', region: 'Gilgit-Baltistan', is_active: true, is_probable_test: false },
  { id: 's-gb-1', name: 'GBPS Alpha', region: 'Gilgit-Baltistan', is_active: true, is_probable_test: false },
  { id: 's-gb-old', name: 'GBPS Closed', region: 'Gilgit-Baltistan', is_active: false, is_probable_test: false },
  { id: 's-gb-test', name: 'GBPS Test', region: 'Gilgit-Baltistan', is_active: true, is_probable_test: true },
  { id: 's-ict', name: 'IMS Sihala', region: 'Sihala', is_active: true, is_probable_test: false },
  { id: 's-odd', name: 'School Elsewhere', region: 'GB', is_active: true, is_probable_test: false },
];

const world = (user) => ({ users: [{ id: TEACHER, region: null, source: 'direct', school_id: null, ...user }], schools: GB_SCHOOLS.map((s) => ({ ...s })) });
const S = () => require('../../dashboard/services/teacher-region.service');

const SECTORS = ['B.K', 'Sihala', 'Tarnol'];

beforeEach(() => { jest.resetModules(); delete process.env.LP_GB_K5_ENABLED; });

/* ── the service ───────────────────────────────────────────────────────── */

describe('regionState', () => {
  test('unknown: ask, with the registry ICT sectors and the active non-test GB schools by name', async () => {
    const st = await S().regionState(fakeSupabase(world({})), TEACHER);
    expect(st).toEqual({
      region: 'unknown', ask: true, sectors: SECTORS,
      schools: [{ id: 's-gb-1', name: 'GBPS Alpha' }, { id: 's-gb-2', name: 'GBPS Zeta' }],
    });
  });

  test("a value the registry does not hold ('GB', 'ICT') is not a region: she is asked", async () => {
    expect((await S().regionState(fakeSupabase(world({ region: 'GB' })), TEACHER)).ask).toBe(true);
    expect((await S().regionState(fakeSupabase(world({ region: 'ICT' })), TEACHER)).ask).toBe(true);
  });

  test.each([
    ['users.source main_rumi_gb', { source: 'main_rumi_gb' }, 'gb'],
    ['users.region GB (the roster seed)', { region: 'Gilgit-Baltistan' }, 'gb'],
    ['users.region a sector', { region: 'Sihala' }, 'ict'],
    ['her school is GB', { school_id: 's-gb-1' }, 'gb'],
    ['her school is ICT', { school_id: 's-ict' }, 'ict'],
  ])('%s: known, never asked, no school list read', async (_n, user, region) => {
    const sb = fakeSupabase(world(user));
    const st = await S().regionState(sb, TEACHER);
    expect(st).toEqual({ region, ask: false, sectors: [], schools: [] });
  });

  test('no user row: unknown is not asked (nothing to save it on)', async () => {
    const st = await S().regionState(fakeSupabase({ users: [], schools: [] }), TEACHER);
    expect(st.ask).toBe(false);
  });
});

describe('saveChoice', () => {
  test('ict: users.region = her sector as the registry spells it, nothing else', async () => {
    const sb = fakeSupabase(world({}));
    expect(await S().saveChoice(sb, TEACHER, { region: 'ict', sector: 'Sihala' })).toEqual({ status: 200, body: { success: true, region: 'ict', saved: true } });
    expect(sb.writes).toEqual([{ table: 'users', id: TEACHER, patch: { region: 'Sihala' } }]);
  });

  test.each([[{ region: 'ict' }], [{ region: 'ict', sector: 'ICT' }], [{ region: 'ict', sector: 'Gilgit-Baltistan' }], [{ region: 'ict', sector: 'sihala ' }]])(
    'ict without a registry sector %j: 400, nothing written', async (body) => {
      const sb = fakeSupabase(world({}));
      expect((await S().saveChoice(sb, TEACHER, body)).status).toBe(400);
      expect(sb.writes).toEqual([]);
    });

  test('gb with a GB school: region and school in one write', async () => {
    const sb = fakeSupabase(world({}));
    expect((await S().saveChoice(sb, TEACHER, { region: 'gb', schoolId: 's-gb-1' })).body).toEqual({ success: true, region: 'gb', saved: true });
    expect(sb.writes).toEqual([{ table: 'users', id: TEACHER, patch: { region: 'Gilgit-Baltistan', school_id: 's-gb-1' } }]);
  });

  test('gb, school not listed (no schoolId): the region alone', async () => {
    const sb = fakeSupabase(world({}));
    await S().saveChoice(sb, TEACHER, { region: 'gb' });
    expect(sb.writes).toEqual([{ table: 'users', id: TEACHER, patch: { region: 'Gilgit-Baltistan' } }]);
  });

  test.each([
    ['an ICT school', 's-ict'], ['a school outside the registry', 's-odd'], ['an inactive school', 's-gb-old'], ['a test school', 's-gb-test'], ['no such school', 's-none'],
  ])('gb with %s: 400, nothing written', async (_n, schoolId) => {
    const sb = fakeSupabase(world({}));
    expect((await S().saveChoice(sb, TEACHER, { region: 'gb', schoolId })).status).toBe(400);
    expect(sb.writes).toEqual([]);
  });

  test.each([[{}], [{ region: 'punjab' }], [{ region: 'ict', sector: 'Sihala', schoolId: 's-gb-1' }], [{ region: 'gb', sector: 'Sihala' }], [null]])('bad body %j: 400, nothing written', async (body) => {
    const sb = fakeSupabase(world({}));
    expect((await S().saveChoice(sb, TEACHER, body)).status).toBe(400);
    expect(sb.writes).toEqual([]);
  });

  test('asked once: a known region is never overwritten (a second tab, a stale page)', async () => {
    const sb = fakeSupabase(world({ region: 'Sihala' }));
    expect((await S().saveChoice(sb, TEACHER, { region: 'gb', schoolId: 's-gb-1' })).body).toEqual({ success: true, region: 'ict', saved: false });
    expect(sb.writes).toEqual([]);
  });

  test('a school she already has is never replaced', async () => {
    const sb = fakeSupabase(world({ school_id: 's-unknown-region' }));
    sb.from('schools'); // keep the fake honest: her school has no region row
    await S().saveChoice(sb, TEACHER, { region: 'gb', schoolId: 's-gb-1' });
    expect(sb.writes).toEqual([{ table: 'users', id: TEACHER, patch: { region: 'Gilgit-Baltistan' } }]);
  });
});

/* ── the routes ────────────────────────────────────────────────────────── */

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}

async function invoke(method, { userId = TEACHER, body = {} } = {}) {
  const router = require('../../dashboard/routes/portal-teacher-region.routes');
  const stack = findRoute(router, method, '/teacher/region');
  if (!stack) throw new Error(`Route ${method} /teacher/region not found`);
  const req = { session: userId ? { portalUserId: userId } : null, query: {}, body, params: {}, method, path: '/teacher/region', headers: {}, get: () => undefined };
  let statusCode = 200; let payload = null;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
    end() { return this; },
    sendStatus(c) { statusCode = c; return this; },
  };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (advanced === false) resolve();
    });
  }
  return { statusCode, payload };
}

describe('routes', () => {
  let sb;
  beforeEach(() => {
    sb = fakeSupabase(world({}));
    jest.doMock('../../dashboard/config/supabase', () => sb);
    installLivePortalAccounts();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.dontMock('../../dashboard/config/supabase');
    jest.dontMock('../../dashboard/lib/portal-auth');
    console.error.mockRestore();
    console.log.mockRestore();
  });

  test.each([['get'], ['post']])('%s signed out: 401, nothing read', async (m) => {
    process.env.LP_GB_K5_ENABLED = 'true';
    expect((await invoke(m, { userId: null })).statusCode).toBe(401);
    expect(sb.reads).toEqual([]);
  });

  test.each([['get'], ['post']])('%s with LP_GB_K5_ENABLED off: 404, nothing read or written', async (m) => {
    expect((await invoke(m, { body: { region: 'gb' } })).statusCode).toBe(404);
    expect(sb.reads).toEqual([]);
    process.env.LP_GB_K5_ENABLED = 'false';
    expect((await invoke(m, { body: { region: 'gb' } })).statusCode).toBe(404);
  });

  test('GET: her state, for the session user', async () => {
    process.env.LP_GB_K5_ENABLED = 'true';
    const { statusCode, payload } = await invoke('get');
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, region: 'unknown', ask: true, sectors: SECTORS });
    expect(payload.schools).toHaveLength(2);
  });

  test('POST: saves, then GET no longer asks', async () => {
    process.env.LP_GB_K5_ENABLED = 'true';
    const post = await invoke('post', { body: { region: 'gb', schoolId: 's-gb-2' } });
    expect(post).toEqual({ statusCode: 200, payload: { success: true, region: 'gb', saved: true } });
    expect((await invoke('get')).payload).toEqual({ success: true, region: 'gb', ask: false, sectors: [], schools: [] });
  });

  test('POST bad body: 400', async () => {
    process.env.LP_GB_K5_ENABLED = 'true';
    expect((await invoke('post', { body: { region: 'x' } })).statusCode).toBe(400);
  });

  test('a failed read: 502 on GET, never a throw', async () => {
    process.env.LP_GB_K5_ENABLED = 'true';
    sb.from = () => { throw new Error('db down'); };
    expect((await invoke('get')).statusCode).toBe(502);
    expect((await invoke('post', { body: { region: 'ict', sector: 'Sihala' } })).statusCode).toBe(502);
  });

  test('mounted at /api/portal by dashboard/index.js', () => {
    const src = require('fs').readFileSync(require.resolve('../../dashboard/index.js'), 'utf8');
    expect(src).toMatch(/app\.use\('\/api\/portal'[^\n]*require\('\.\/routes\/portal-teacher-region\.routes'\)\)/);
  });
});
