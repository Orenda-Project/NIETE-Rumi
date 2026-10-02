/**
 * bd-5rz1v — the internal API carries a library lesson-plan pick, and serves
 * her recent plans. The routes add no logic; this pins the contract the portal
 * client depends on (same shape as bd-lfzoz-internal-coaching-routes.test.js).
 */

const SERVICE = '../../bot/shared/services/coaching/portal-coaching.service';

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

describe('bd-5rz1v — /api/internal/coaching/* (library plans)', () => {
  let router;
  let svc;
  const OLD = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    svc = {
      presignUpload: jest.fn(),
      startPortalSession: jest.fn().mockResolvedValue({ status: 'ok', coachingSessionId: 'cs-1' }),
      submitReflection: jest.fn(),
      recentLessonPlans: jest.fn().mockResolvedValue({ status: 'ok', plans: [{ assetId: 'a1' }] }),
    };
    jest.doMock(SERVICE, () => svc);
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterAll(() => { process.env.INTERNAL_API_KEY = OLD; });

  test('start passes a library lesson-plan pick through untouched', async () => {
    const out = await invoke(router, '/coaching/start', {
      body: { userId: 'u1', key: 'k', photoKeys: [], lessonPlan: { lessonId: 'g4-sst-ch3-seg2' } },
    });
    expect(out.status).toBe(200);
    expect(svc.startPortalSession).toHaveBeenCalledWith({
      userId: 'u1', key: 'k', lessonPlanKey: undefined, photoKeys: [], lessonPlan: { lessonId: 'g4-sst-ch3-seg2' },
    });
  });

  test('a plan that is not written yet is a 400 the portal can explain', async () => {
    svc.startPortalSession.mockResolvedValue({ status: 'invalid', reason: 'plan_not_ready' });
    const out = await invoke(router, '/coaching/start', { body: { userId: 'u1', key: 'k', lessonPlan: { segmentId: 's', lang: 'en' } } });
    expect(out).toMatchObject({ status: 400, body: { success: false, reason: 'plan_not_ready' } });
  });

  test('recent-plans returns her recent plans', async () => {
    const out = await invoke(router, '/coaching/recent-plans', { body: { userId: 'u1' } });
    expect(out).toMatchObject({ status: 200, body: { success: true, plans: [{ assetId: 'a1' }] } });
    expect(svc.recentLessonPlans).toHaveBeenCalledWith({ userId: 'u1' });
  });

  test('recent-plans refuses a caller without the shared secret', async () => {
    const out = await invoke(router, '/coaching/recent-plans', { body: { userId: 'u1' }, key: 'nope' });
    expect(out.status).toBe(401);
    expect(svc.recentLessonPlans).not.toHaveBeenCalled();
  });
});
