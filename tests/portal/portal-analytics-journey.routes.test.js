'use strict';
/**
 * The team view in Analytics (dashboard/routes/portal-analytics-journey.routes.js), mounted inside portal.routes.js
 * behind the analytics-account guard:
 *   GET /analytics/journey                 Primary teachers of the account's organization: reached / stopped per rung
 *   GET /analytics/journey/teachers?step=  the teachers who stopped at a rung, oldest last step first
 *   GET /analytics/journey/teacher/:id     one teacher's journey, read-only — only inside the account's scope
 * Not an analytics account (a teacher, a coach) → 403. portal_teacher_journey off for the account → 404. A teacher
 * outside the account's organization → 404. Reads the store only, never the database.
 */
require('../fixtures/portal-auth-live').installLivePortalAccounts();

const VIEWER = 'aaaaaaaa-0000-4000-8000-000000000001';
const GB_VIEWER = 'aaaaaaaa-0000-4000-8000-000000000002';
const TEACHER = 'bbbbbbbb-0000-4000-8000-000000000001';
const T1 = 'cccccccc-0000-4000-8000-000000000001';
const T2 = 'cccccccc-0000-4000-8000-000000000002';
const GB_T = 'cccccccc-0000-4000-8000-000000000003';

let flagOn; let team; let stored; let reads; let dbTouched;

const who = (org, region, furthest, lastAt) => ({
  org, region, band: 'k5', name: 'Test Teacherwala', school: 'Test School', furthest, last_kind: furthest === 'none' ? null : furthest, last_at: lastAt,
});

beforeEach(() => {
  jest.resetModules();
  require('../fixtures/portal-auth-live').installLivePortalAccounts();
  flagOn = new Set([VIEWER, GB_VIEWER, TEACHER]);
  reads = [];
  dbTouched = 0;
  team = {
    updated_at: '2026-11-19T09:30:00.000Z', window_days: 30, steps: {},
    teachers: {
      [T1]: who('niete', 'Sihala', 'quiz', '2026-11-12T08:00:00.000Z'),
      [T2]: who('niete', 'B.K', 'quiz', '2026-11-02T08:00:00.000Z'),
      [GB_T]: who('moawin', 'Gilgit-Baltistan', 'taught', '2026-11-05T08:00:00.000Z'),
    },
  };
  stored = { [T1]: { updated_at: team.updated_at, slot: 'day', journey: [{ kind: 'quiz', at: '2026-11-12T08:00:00.000Z', ref_id: 'q1', meta: {} }] } };
  jest.doMock('../../dashboard/lib/lp-app-switches', () => ({ isTeacherJourneyOn: async (_sb, id) => flagOn.has(id) }));
  jest.doMock('../../dashboard/services/teacher-activity-store', () => ({
    readTeacherActivity: async (id) => { reads.push(['teacher', id]); return stored[id] || null; },
    readTeamActivity: async () => { reads.push(['team']); return team; },
  }));
});

function router() {
  const { makeRequireAnalyticsViewer } = require('../../dashboard/lib/analytics-viewer');
  const { requirePortalAuth } = require('../../dashboard/lib/portal-auth');
  const requireAnalyticsViewer = makeRequireAnalyticsViewer({
    getViewerIds: async () => [VIEWER, GB_VIEWER],
    getViewerOrganizations: async () => ({ [GB_VIEWER]: 'moawin' }),
  });
  const analyticsScope = async (req) => (req.analyticsOrganization === 'moawin'
    ? { organization: 'moawin', regions: ['Gilgit-Baltistan'], keepsUnplaced: false }
    : { organization: 'niete', regions: ['B.K', 'Sihala'], keepsUnplaced: true });
  const supabase = new Proxy({}, { get: () => { dbTouched += 1; throw new Error('database touched'); } });
  return require('../../dashboard/routes/portal-analytics-journey.routes')
    .createAnalyticsJourneyRouter({ supabase, requirePortalAuth, requireAnalyticsViewer, analyticsScope });
}

async function call(path, { userId = VIEWER, query = {}, params = {} } = {}) {
  const r = router();
  const layer = r.stack.find((l) => l.route && l.route.path === path && l.route.methods.get);
  if (!layer) throw new Error(`no GET ${path}`);
  const req = { session: userId ? { portalUserId: userId } : null, query, params };
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

afterEach(() => expect(dbTouched).toBe(0));

describe('guards', () => {
  test.each(['/analytics/journey', '/analytics/journey/teachers', '/analytics/journey/teacher/:id'])('%s: a teacher account → 403, nothing read', async (path) => {
    const out = await call(path, { userId: TEACHER, query: { step: 'quiz' }, params: { id: T1 } });
    expect(out.status).toBe(403);
    expect(reads).toEqual([]);
  });
  test('signed out → 401', async () => {
    expect((await call('/analytics/journey', { userId: null })).status).toBe(401);
  });
  test('switch off for the account → 404, nothing read', async () => {
    flagOn.delete(VIEWER);
    expect((await call('/analytics/journey')).status).toBe(404);
    expect(reads).toEqual([]);
  });
});

describe('GET /analytics/journey', () => {
  test('counts of its own organization, Primary, with the updated time', async () => {
    const out = await call('/analytics/journey');
    expect(out.status).toBe(200);
    expect(out.payload).toMatchObject({ success: true, ready: true, updatedAt: team.updated_at, windowDays: 30, tracked: 2 });
    expect(out.payload.steps.find((s) => s.step === 'quiz')).toEqual({ step: 'quiz', reached: 2, stopped: 2 });
  });
  test('another organization sees only its own teachers', async () => {
    const out = await call('/analytics/journey', { userId: GB_VIEWER });
    expect(out.payload.tracked).toBe(1);
  });
  test('?region= narrows; a region outside the view → 400', async () => {
    expect((await call('/analytics/journey', { query: { region: 'Sihala' } })).payload.tracked).toBe(1);
    expect((await call('/analytics/journey', { query: { region: 'Gilgit-Baltistan' } })).status).toBe(400);
  });
  test('nothing stored → ready:false', async () => {
    team = null;
    expect((await call('/analytics/journey')).payload).toEqual({ success: true, ready: false });
  });
});

describe('GET /analytics/journey/teachers', () => {
  test('the teachers who stopped at a rung, oldest last step first', async () => {
    const out = await call('/analytics/journey/teachers', { query: { step: 'quiz' } });
    expect(out.payload.teachers.map((t) => t.id)).toEqual([T2, T1]);
  });
  test('an unknown rung → 400', async () => {
    expect((await call('/analytics/journey/teachers', { query: { step: 'tip' } })).status).toBe(400);
  });
});

describe('GET /analytics/journey/teacher/:id', () => {
  test('a teacher in scope → her steps, read-only data', async () => {
    const out = await call('/analytics/journey/teacher/:id', { params: { id: T1 } });
    expect(out.payload).toMatchObject({ success: true, ready: true, name: 'Test Teacherwala', school: 'Test School' });
    expect(out.payload.steps).toEqual([{ kind: 'quiz', at: '2026-11-12T08:00:00.000Z', refId: 'q1', meta: {} }]);
  });
  test('a teacher of another organization → 404, her key not read', async () => {
    const out = await call('/analytics/journey/teacher/:id', { params: { id: GB_T } });
    expect(out.status).toBe(404);
    expect(reads).toEqual([['team']]);
  });
  test('an id not on the roster → 404', async () => {
    expect((await call('/analytics/journey/teacher/:id', { params: { id: TEACHER } })).status).toBe(404);
  });
  test('in scope but her key is gone → ready:false', async () => {
    const out = await call('/analytics/journey/teacher/:id', { params: { id: T2 } });
    expect(out.payload).toMatchObject({ success: true, ready: false });
  });
});
