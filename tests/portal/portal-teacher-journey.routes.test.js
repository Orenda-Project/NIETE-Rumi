'use strict';
/**
 * GET /api/portal/me/journey (dashboard/routes/portal-teacher-journey.routes.js): her own steps, from the activity
 * store only. Signed out 401; portal_teacher_journey off for her 404 with the store not read; on, the stored steps or
 * { ready:false } on a miss. The user is ALWAYS the session's: an id in the query, the params or the body is ignored,
 * and no database read is made (the only read is the switch).
 */
require('../fixtures/portal-auth-live').installLivePortalAccounts();

const ME = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const OTHER = '7a1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c11';
let flagOn; let stored; let storeReads; let dbTouched;

beforeEach(() => {
  jest.resetModules();
  require('../fixtures/portal-auth-live').installLivePortalAccounts();
  flagOn = new Set([ME, OTHER]);
  storeReads = [];
  dbTouched = 0;
  stored = {
    [ME]: { updated_at: '2026-11-19T09:30:00.000Z', slot: 'day', journey: [{ kind: 'taught', at: '2026-11-18T08:00:00.000Z', ref_id: 'f1', meta: { grade: 3 } }] },
    [OTHER]: { updated_at: '2026-11-19T09:30:00.000Z', slot: 'day', journey: [{ kind: 'quiz', at: '2026-11-18T08:00:00.000Z', ref_id: 'secret', meta: {} }] },
  };
  jest.doMock('../../dashboard/config/supabase', () => new Proxy({}, { get: () => { dbTouched += 1; return () => { throw new Error('database touched'); }; } }));
  jest.doMock('../../dashboard/lib/lp-app-switches', () => ({
    isTeacherJourneyOn: async (_sb, userId) => flagOn.has(userId),
  }));
  jest.doMock('../../dashboard/services/teacher-activity-store', () => ({
    readTeacherActivity: async (id) => { storeReads.push(id); return stored[id] || null; },
    readTeamActivity: async () => null,
  }));
});

async function call(path, { userId = ME, query = {}, params = {}, body = {} } = {}) {
  const router = require('../../dashboard/routes/portal-teacher-journey.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.get);
  if (!layer) throw new Error(`no GET ${path}`);
  const req = { session: userId ? { portalUserId: userId } : null, query, params, body };
  let status = 200; let payload;
  const res = { status(c) { status = c; return this; }, json(b) { payload = b; return this; } };
  for (const s of layer.route.stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await s.handle(req, res, () => { next = true; });
    if (!next) break;
  }
  return { status, payload };
}

test('signed out is 401, nothing read', async () => {
  expect((await call('/me/journey', { userId: null })).status).toBe(401);
  expect(storeReads).toEqual([]);
});

test('switch off for her → 404, the store not read', async () => {
  flagOn.delete(ME);
  const out = await call('/me/journey');
  expect(out).toEqual({ status: 404, payload: { success: false, error: 'Not found' } });
  expect(storeReads).toEqual([]);
});

test('on → her stored steps, camelCased, with the updated time', async () => {
  const out = await call('/me/journey');
  expect(out.status).toBe(200);
  expect(out.payload).toEqual({
    success: true, ready: true, updatedAt: '2026-11-19T09:30:00.000Z', slot: 'day',
    steps: [{ kind: 'taught', at: '2026-11-18T08:00:00.000Z', refId: 'f1', meta: { grade: 3 } }],
  });
  expect(dbTouched).toBe(0);
});

test('another teacher\'s id in the query, params or body is ignored: only the session user is read', async () => {
  const out = await call('/me/journey', { query: { user: OTHER, userId: OTHER }, params: { id: OTHER }, body: { userId: OTHER } });
  expect(storeReads).toEqual([ME]);
  expect(JSON.stringify(out.payload)).not.toContain('secret');
});

test('no stored value (missing, expired, Redis down) → ready:false, never an error', async () => {
  delete stored[ME];
  expect(await call('/me/journey')).toEqual({ status: 200, payload: { success: true, ready: false } });
});
