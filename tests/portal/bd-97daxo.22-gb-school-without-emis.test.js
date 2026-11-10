'use strict';
/**
 * bd-97daxo.22 (queue #76) — a coach's school that has NO EMIS.
 *
 * Two Gilgit-Baltistan schools came over from main Rumi without an EMIS (MF Community School Hoto, Deosai Community
 * School Dapa Kharmang). The GB migration gave each coach holding a key from the name instead:
 * leader_schools.school_ext_id = 'niete:gb-mf-community-school-hoto-mf-community' (40 characters after the prefix).
 * Walked on staging 10 Nov as the FMO Muzafar Abbas (a82f689a), the coach app then:
 *   · said "0 teachers" for Hoto on My schools and New visit, though 3 teachers and a principal work there — the
 *     coach patch keyed each teacher's school as 'niete:' || schools.emis, which is NULL for that school;
 *   · answered "Could not load" on Hoto's school page — the route refuses any key over 32 characters.
 * Here: the coach patch falls back to the holding's own key, and every school-page key check takes up to 64.
 */

const GB_KEY = 'gb-mf-community-school-hoto-mf-community';      // 40 characters, the migration's key
const TOO_LONG = 'a'.repeat(65);

// ── 1. the coach patch keys an EMIS-less school by the holding ─────────────────
describe('coach patch SQL — a school with no EMIS keeps the key of the coach holding', () => {
  const { PATCH_TEACHERS_SQL, PRINCIPAL_PATCH_SQL } = require('../../dashboard/services/leader-patch.service');

  test('the coach query falls back to leader_schools.school_ext_id when schools.emis is NULL', () => {
    expect(PATCH_TEACHERS_SQL).toMatch(/COALESCE\(\s*'niete:'\s*\|\|\s*sch\.emis\s*,\s*lsch\.school_ext_id\s*\)\s+AS school_ext_id/);
  });

  test('the principal query (no holdings) is unchanged: it has no lsch to read', () => {
    expect(PRINCIPAL_PATCH_SQL).not.toMatch(/lsch\./);
    expect(PRINCIPAL_PATCH_SQL).toMatch(/'niete:'\s*\|\|\s*sch\.emis\s+AS school_ext_id/);
  });
});

// ── 2. with that key, My schools counts the teachers and the school page lists them ──
describe('coach app — the EMIS-less school counts and lists its teachers', () => {
  const SVC = require('../../dashboard/services/coach-v2.service');
  const ME = 'coach-gb';
  const row = (ext, name, role = 'teacher') => ({
    teacher_ext_id: ext, name, phone: ext, school_ext_id: `niete:${GB_KEY}`, role, rumi_user_id: `u-${ext}`,
    coaching_sessions: 0, observations: 0, training_modules: 0, last_analysis_data: null,
    school_name: 'MF Community School Hoto - MF community',
  });
  const PATCH = [row('920000000001', 'Teacher One'), row('920000000002', 'Teacher Two'),
    row('920000000003', 'Teacher Three'), row('920000000004', 'Head Teacher', 'principal')];
  const LEADER_SCHOOLS = [{ school_ext_id: `niete:${GB_KEY}`, school_name: 'MF Community School Hoto - MF community', emis: null }];
  const query = async (sql) => {
    if (/FROM leader_schools lsch/.test(sql)) return { rows: PATCH };
    if (/FROM leader_schools/.test(sql)) return { rows: LEADER_SCHOOLS };
    return { rows: [] };
  };

  test('My schools: 3 teachers at the school (the principal is listed, not counted)', async () => {
    const out = await SVC.getCoachPeople(query, ME, { today: '2026-11-10' });
    expect(out.schools).toHaveLength(1);
    expect(out.schools[0]).toMatchObject({ schoolExtId: `niete:${GB_KEY}`, emis: GB_KEY, teachers: 3 });
  });

  test('the school page (by its key) lists all four people', async () => {
    const out = await SVC.getCoachSchool(query, ME, GB_KEY, { today: '2026-11-10' });
    expect(out).not.toBeNull();
    expect(out.teachers).toHaveLength(4);
  });
});

// ── 3. every school-page key check takes the 40-character key, and still refuses junk ──
function loadPortalRoutes(mocks = {}) {
  jest.resetModules();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: () => ({}), rpc: jest.fn() }));
  jest.doMock('../../dashboard/config/database', () => ({ query: async () => ({ rows: [] }) }));
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  for (const [path, impl] of Object.entries(mocks)) jest.doMock(path, impl);
  return require('../../dashboard/routes/portal.routes');
}

function handlerOf(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      const s = layer.route.stack;
      return s[s.length - 1].handle;
    }
    if (!layer.route && layer.handle && Array.isArray(layer.handle.stack)) {
      try { return handlerOf(layer.handle, method, path); } catch (_) { /* not in this one */ }
    }
  }
  throw new Error(`no ${method} ${path}`);
}

async function runHandler(handler, params, body = {}) {
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; }, set() { return this; } };
  const req = { params, query: {}, body, session: { portalUserId: 'coach-gb' }, portalUser: { role: 'coach', id: 'coach-gb' } };
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
  try { await handler(req, res, () => {}); } finally { quiet.mockRestore(); }
  return { statusCode, payload };
}

describe('GET /coach/school/:emis — the school page', () => {
  const asked = [];
  const routes = () => loadPortalRoutes({
    '../../dashboard/services/coach-v2.service': () => ({
      ...jest.requireActual('../../dashboard/services/coach-v2.service'),
      getCoachSchool: async (_q, _u, emis) => { asked.push(emis); return { school: { emis }, teachers: [] }; },
    }),
  });

  test('the GB key reaches her school list (200), not the 404 of the key check', async () => {
    const out = await runHandler(handlerOf(routes(), 'get', '/coach/school/:emis'), { emis: GB_KEY });
    expect(out.statusCode).toBe(200);
    expect(asked).toContain(GB_KEY);
  });

  test.each([[TOO_LONG], ['9 01'], ['a/b'], ['']])('still refuses %p before any query', async (emis) => {
    asked.length = 0;
    const out = await runHandler(handlerOf(routes(), 'get', '/coach/school/:emis'), { emis });
    expect(out.statusCode).toBe(404);
    expect(asked).toHaveLength(0);
  });
});

describe('the school admin routes (remove, check a teacher) take the GB key', () => {
  test('POST /coach/school/:emis/remove asks the admin service with the GB key', async () => {
    const seen = [];
    const routes = loadPortalRoutes({
      '../../dashboard/services/coach-school-admin.service': () => ({
        ...jest.requireActual('../../dashboard/services/coach-school-admin.service'),
        removeSchool: async (_q, _c, _u, emis) => { seen.push(emis); return { status: 200, data: { success: true } }; },
      }),
    });
    const out = await runHandler(handlerOf(routes, 'post', '/coach/school/:emis/remove'), { emis: GB_KEY });
    expect(out.statusCode).not.toBe(404);
    expect(seen).toEqual([GB_KEY]);
  });
});

describe('the School card routes take the GB key', () => {
  test('GET /coach/school/:emis/card does not refuse the GB key as malformed', async () => {
    const seen = [];
    const routes = loadPortalRoutes({
      '../../dashboard/services/coach-school-card.service': () => ({
        ...jest.requireActual('../../dashboard/services/coach-school-card.service'),
        getSchoolCard: async (_q, _u, emis) => { seen.push(emis); return { school: { emis } }; },
      }),
    });
    const out = await runHandler(handlerOf(routes, 'get', '/coach/school/:emis/card'), { emis: GB_KEY });
    expect(out.statusCode).not.toBe(404);
    expect(seen).toEqual([GB_KEY]);
  });
});

describe('adding the school back (coach-school-admin) accepts the GB key', () => {
  test('addSchool passes niete:<GB key> to the bot', async () => {
    const Admin = require('../../dashboard/services/coach-school-admin.service');
    const calls = [];
    const client = { addSchool: async (a) => { calls.push(a); return { status: 200, data: { success: true } }; } };
    const out = await Admin.addSchool(client, 'coach-gb', `niete:${GB_KEY}`);
    expect(out.status).toBe(200);
    expect(calls).toEqual([{ leaderUserId: 'coach-gb', schoolExtId: `niete:${GB_KEY}` }]);
  });

  test('and still refuses a key over 64 characters', async () => {
    const Admin = require('../../dashboard/services/coach-school-admin.service');
    const out = await Admin.addSchool({ addSchool: jest.fn() }, 'coach-gb', `niete:${TOO_LONG}`);
    expect(out.status).toBe(400);
  });
});

describe('WhatsApp /school card link target (bot coach-school-target) takes the GB key', () => {
  const T = require('../../bot/shared/services/coach-school-target');

  test('a GB school gets its own page, not My schools', () => {
    const t = T.coachSchoolTarget(GB_KEY);
    expect(t).toBe(`coach_school:${GB_KEY}`);
    expect(T.coachSchoolPathFor(t)).toBe(`/portal/coach/school/${GB_KEY}`);
  });

  test('a key over 64 characters is still not a page key', () => {
    expect(T.coachSchoolTarget(TOO_LONG)).toBeNull();
  });
});
