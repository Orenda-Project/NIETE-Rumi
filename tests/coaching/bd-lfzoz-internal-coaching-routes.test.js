/**
 * bd-lfzoz — the bot's internal API for portal-uploaded recordings.
 *
 * The routes add no logic (portal-coaching.service holds it, and is tested in
 * bd-lfzoz-portal-coaching.test.js). What is pinned here is the CONTRACT the
 * portal depends on: the shared secret is required, the service's result
 * statuses map to the HTTP codes the portal client branches on, and a throw
 * fails CLOSED — a 5xx with no `status`, so it can never read as accepted.
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

describe('bd-lfzoz — /api/internal/coaching/*', () => {
  let router;
  let svc;
  const OLD = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    svc = {
      presignUpload: jest.fn().mockResolvedValue({ status: 'ok', uploadUrl: 'u', key: 'k' }),
      startPortalSession: jest.fn().mockResolvedValue({ status: 'ok', coachingSessionId: 'cs-1' }),
      submitReflection: jest.fn().mockResolvedValue({ status: 'ok', done: true, acknowledgement: 'Thanks' }),
    };
    jest.doMock(SERVICE, () => svc);
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterAll(() => { process.env.INTERNAL_API_KEY = OLD; });

  test.each([
    '/coaching/presign-upload', '/coaching/start', '/coaching/reflection',
  ])('%s refuses a caller without the shared secret', async (path) => {
    const out = await invoke(router, path, { body: { userId: 'u' }, key: 'wrong' });
    expect(out.status).toBe(401);
    expect(svc.presignUpload).not.toHaveBeenCalled();
    expect(svc.startPortalSession).not.toHaveBeenCalled();
    expect(svc.submitReflection).not.toHaveBeenCalled();
  });

  test('refuses a request with no userId', async () => {
    const out = await invoke(router, '/coaching/start', { body: { key: 'k' } });
    expect(out.status).toBe(400);
    expect(svc.startPortalSession).not.toHaveBeenCalled();
  });

  test('presign passes the portal\'s userId and the file through', async () => {
    const out = await invoke(router, '/coaching/presign-upload',
      { body: { userId: 'u1', filename: 'a.pdf', sizeBytes: 10, kind: 'lesson_plan' } });
    expect(out).toMatchObject({ status: 200, body: { success: true, status: 'ok', uploadUrl: 'u' } });
    expect(svc.presignUpload).toHaveBeenCalledWith({ userId: 'u1', filename: 'a.pdf', sizeBytes: 10, kind: 'lesson_plan' });
  });

  test('start returns the new session id', async () => {
    const out = await invoke(router, '/coaching/start',
      { body: { userId: 'u1', key: 'k', lessonPlanKey: 'lp', photoKeys: ['p1', 'p2'] } });
    expect(out).toMatchObject({ status: 200, body: { status: 'ok', coachingSessionId: 'cs-1' } });
    expect(svc.startPortalSession).toHaveBeenCalledWith(
      { userId: 'u1', key: 'k', lessonPlanKey: 'lp', photoKeys: ['p1', 'p2'] });
  });

  test('reflection returns the acknowledgement synchronously', async () => {
    const out = await invoke(router, '/coaching/reflection',
      { body: { userId: 'u1', coachingSessionId: 'cs-1', answer: 'x' } });
    expect(out).toMatchObject({ status: 200, body: { done: true, acknowledgement: 'Thanks' } });
    expect(svc.submitReflection).toHaveBeenCalledWith({ userId: 'u1', coachingSessionId: 'cs-1', answer: 'x' });
  });

  test.each([
    ['invalid', 400], ['not_found', 404], ['not_ready', 409], ['in_progress', 409], ['queue_failed', 502],
  ])('service status %s → HTTP %i', async (status, http) => {
    svc.startPortalSession.mockResolvedValue({ status });
    const out = await invoke(router, '/coaching/start', { body: { userId: 'u1', key: 'k' } });
    expect(out.status).toBe(http);
    expect(out.body.success).toBe(false);
  });

  test('a throw fails CLOSED: 500 and no status field', async () => {
    svc.submitReflection.mockRejectedValue(new Error('boom'));
    const out = await invoke(router, '/coaching/reflection',
      { body: { userId: 'u1', coachingSessionId: 'cs-1', answer: 'x' } });
    expect(out.status).toBe(500);
    expect(out.body).not.toHaveProperty('status');
    expect(out.body.success).toBe(false);
  });
});
