/**
 * bd-5rz1v.6 — the internal API behind a coach's portal observation. The routes
 * add no logic: each passes the portal's session user and the named fields to
 * portal-observe.service, and maps its status to HTTP the way the teacher's
 * portal coaching routes do (bd-lfzoz).
 */

const SERVICE = '../../bot/shared/services/observe/portal-observe.service';

function invoke(router, path, { body = {}, key = 'secret' } = {}) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
  if (!layer) throw new Error(`no POST ${path}`);
  const handlers = layer.route.stack.map((s) => s.handle);
  const req = { body, headers: key ? { 'x-api-key': key } : {}, path, ip: '127.0.0.1' };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    const run = (i) => {
      if (i >= handlers.length) return resolve({ status: 404, body: null });
      return handlers[i](req, res, () => run(i + 1));
    };
    run(0);
  });
}

describe('bd-5rz1v.6 — /api/internal/coaching/observe/*', () => {
  let router;
  let svc;
  const OLD = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    const ok = (extra = {}) => jest.fn().mockResolvedValue({ status: 'ok', ...extra });
    svc = {
      startPortalObservation: ok({ coachingSessionId: 'cs-1' }),
      teacherRecentPlans: ok({ plans: [] }),
      listPortalObservations: ok({ observations: [] }),
      observationView: ok({ id: 'cs-1', step: 'draft' }),
      getDraft: ok({ sections: [] }),
      saveDraft: ok({ summary: {} }),
      talkGuide: ok({ guide: {} }),
      startTalk: ok(),
      retryTalk: ok(),
      previewReport: ok(),
      sendReport: ok(),
    };
    jest.doMock(SERVICE, () => svc);
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterAll(() => { process.env.INTERNAL_API_KEY = OLD; });

  test('start passes only the named fields', async () => {
    const out = await invoke(router, '/coaching/observe/start', {
      body: { userId: 'c1', teacherExtId: 't1', schoolExtId: 's1', key: 'k', lessonPlanKey: 'lp', photoKeys: ['p'], lessonPlan: { assetId: 'a' }, observerUserId: 'x' },
    });
    expect(out).toMatchObject({ status: 200, body: { success: true, coachingSessionId: 'cs-1' } });
    expect(svc.startPortalObservation).toHaveBeenCalledWith({
      userId: 'c1', teacherExtId: 't1', schoolExtId: 's1', key: 'k', lessonPlanKey: 'lp', photoKeys: ['p'], lessonPlan: { assetId: 'a' },
    });
  });

  test.each([
    ['/coaching/observe/recent-plans', 'teacherRecentPlans', { teacherExtId: 't1', schoolExtId: 's1' }],
    ['/coaching/observe/list', 'listPortalObservations', {}],
    ['/coaching/observe/view', 'observationView', { coachingSessionId: 'cs-1' }],
    ['/coaching/observe/draft', 'getDraft', { coachingSessionId: 'cs-1' }],
    ['/coaching/observe/draft/save', 'saveDraft', { coachingSessionId: 'cs-1', edits: { r_C1: '2' } }],
    ['/coaching/observe/talk/guide', 'talkGuide', { coachingSessionId: 'cs-1' }],
    ['/coaching/observe/talk/start', 'startTalk', { coachingSessionId: 'cs-1', key: 'k' }],
    ['/coaching/observe/talk/retry', 'retryTalk', { coachingSessionId: 'cs-1' }],
    ['/coaching/observe/report/preview', 'previewReport', { coachingSessionId: 'cs-1' }],
    ['/coaching/observe/report/send', 'sendReport', { coachingSessionId: 'cs-1' }],
  ])('%s → %s(userId + its fields)', async (path, fn, fields) => {
    const out = await invoke(router, path, { body: { userId: 'c1', ...fields, extra: 'dropped' } });
    expect(out.status).toBe(200);
    expect(svc[fn]).toHaveBeenCalledWith({ userId: 'c1', ...fields });
  });

  test.each([
    [{ status: 'invalid', reason: 'not_your_teacher' }, 400],
    [{ status: 'not_found' }, 404],
    [{ status: 'not_ready' }, 409],
    [{ status: 'queue_failed', coachingSessionId: 'cs-1' }, 502],
  ])('maps %j to %i', async (result, http) => {
    svc.startPortalObservation.mockResolvedValue(result);
    const out = await invoke(router, '/coaching/observe/start', { body: { userId: 'c1', key: 'k' } });
    expect(out.status).toBe(http);
    expect(out.body.success).toBe(false);
  });

  test('refuses without the shared secret, and without a user', async () => {
    expect((await invoke(router, '/coaching/observe/view', { body: { userId: 'c1' }, key: 'nope' })).status).toBe(401);
    expect((await invoke(router, '/coaching/observe/view', { body: {} })).status).toBe(400);
    expect(svc.observationView).not.toHaveBeenCalled();
  });

  test('a throw is a 500 with no status field', async () => {
    svc.getDraft.mockRejectedValue(new Error('boom'));
    const out = await invoke(router, '/coaching/observe/draft', { body: { userId: 'c1', coachingSessionId: 'cs-1' } });
    expect(out.status).toBe(500);
    expect(out.body.status).toBeUndefined();
  });
});
