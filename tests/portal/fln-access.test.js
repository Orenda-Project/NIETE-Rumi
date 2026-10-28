/**
 * Dashboard/lib/fln-access.js, the one FLN access rule:
 *   share   = leader role (users.role, re-read every call) AND portal_fln_share on for the user
 *   lessons = portal_fln_lessons on for the user OR share
 * and requireFln.{lessons,share}: no-store on every answer, 401 signed out, 404 when not allowed.
 * The flag reader is the real feature-flags.js over a fake app_settings/users table, so the "teachers"
 * audience value is resolved exactly as production resolves it.
 */
// These tests change app_settings rows under one shared client, sometimes mid-test, to check each value's rule.
// The flag cache would hold the first read, so it is off here; tests/portal/feature-flags-cache.test.js covers it.
process.env.FLAG_CACHE_TTL_MS = '0';
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const COACH = '1a2b3c4d-0000-4c55-9a51-2d7f0e3b9c11';
let settings; let users; let usersFail;

function fakeSupabase() {
  return {
    from(table) {
      const q = { filters: {} };
      const api = {
        select() { return api; },
        eq(col, val) { q.filters[col] = val; return api; },
        async maybeSingle() {
          if (table === 'app_settings') {
            return { data: q.filters.key in settings ? { value: settings[q.filters.key] } : null, error: null };
          }
          if (table === 'users') {
            if (usersFail) return { data: null, error: new Error('down') };
            return { data: users[q.filters.id] || null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return api;
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  settings = {};
  usersFail = false;
  users = {
    [TEACHER]: { id: TEACHER, role: 'teacher', preferred_language: 'ur' },
    [COACH]: { id: COACH, role: 'coach', preferred_language: 'en' },
  };
  jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
});

const load = () => require('../../dashboard/lib/fln-access');

async function run(chain, userId) {
  const req = { session: userId ? { portalUserId: userId } : null };
  const headers = {};
  let status = 200; let payload = null; let reached = false;
  const res = {
    set(k, v) { headers[k] = v; return this; },
    status(c) { status = c; return this; },
    json(b) { payload = b; return this; },
  };
  for (const mw of chain) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await mw(req, res, () => { advanced = true; });
    if (!advanced) return { status, payload, headers, reached, req };
  }
  reached = true;
  return { status, payload, headers, reached, req };
}

describe('flnAccess', () => {
  it('everything off: no lessons, no share', async () => {
    expect(await load().flnAccess(TEACHER)).toEqual({ lessons: false, share: false, role: 'teacher', ui_lang: 'ur' });
  });

  it('a teacher never gets share, even with portal_fln_share = true', async () => {
    settings = { portal_fln_lessons: true, portal_fln_share: true };
    expect(await load().flnAccess(TEACHER)).toMatchObject({ lessons: true, share: false });
  });

  it('lessons = "teachers" + share on: a coach is admitted to the lessons AND gets share', async () => {
    settings = { portal_fln_lessons: 'teachers', portal_fln_share: true };
    expect(await load().flnAccess(COACH)).toEqual({ lessons: true, share: true, role: 'coach', ui_lang: 'en' });
    expect(await load().flnAccess(TEACHER)).toMatchObject({ lessons: true, share: false });
  });

  it('lessons = "teachers", share off: the coach gets nothing', async () => {
    settings = { portal_fln_lessons: 'teachers' };
    expect(await load().flnAccess(COACH)).toMatchObject({ lessons: false, share: false });
  });

  it('a pilot id list admits only the listed ids', async () => {
    settings = { portal_fln_lessons: [TEACHER], portal_fln_share: [COACH] };
    expect((await load().flnAccess(TEACHER)).lessons).toBe(true);
    expect(await load().flnAccess(COACH)).toMatchObject({ lessons: true, share: true });
  });

  it('a failed users read is "not a leader" (fail closed); no user id is all-off', async () => {
    settings = { portal_fln_share: true };
    usersFail = true;
    expect(await load().flnAccess(COACH)).toMatchObject({ share: false, role: null });
    expect(await load().flnAccess(null)).toEqual({ lessons: false, share: false, role: null, ui_lang: 'en' });
  });
});

describe('requireFln', () => {
  it('signed out: 401, and the answer is still no-store', async () => {
    const out = await run(load().requireFln.lessons, null);
    expect(out.status).toBe(401);
    expect(out.headers['Cache-Control']).toBe('no-store');
  });

  it('lessons off: 404 with no-store; on: passes and puts the access on req.fln', async () => {
    let out = await run(load().requireFln.lessons, TEACHER);
    expect(out).toMatchObject({ status: 404, reached: false });
    expect(out.headers['Cache-Control']).toBe('no-store');
    settings = { portal_fln_lessons: true };
    out = await run(load().requireFln.lessons, TEACHER);
    expect(out.reached).toBe(true);
    expect(out.req.fln).toMatchObject({ lessons: true, share: false });
    expect(out.headers['Cache-Control']).toBe('no-store');
  });

  it('share: a teacher is 404, a coach with the switch passes', async () => {
    settings = { portal_fln_lessons: true, portal_fln_share: true };
    expect((await run(load().requireFln.share, TEACHER)).status).toBe(404);
    expect((await run(load().requireFln.share, COACH)).reached).toBe(true);
  });
});
