/**
 * bd-fmf24g.30 — POST /api/portal/share/whatsapp: signed out 401; teacher app off 404 with nothing asked of the bot;
 * kind/id validated before the bot is asked; the user is the SESSION's; the bot's REAL answer comes back (sent /
 * unavailable / failed); a bot that cannot be reached is 502 "failed", never "sent".
 */
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
let post; let flagOn;

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  flagOn = true;
  post = jest.fn();
  jest.doMock('axios', () => ({ post }));
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({ PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2', isFlagEnabledForUser: async () => flagOn }));
  process.env.MAIN_BOT_URL = 'http://bot.test'; process.env.INTERNAL_API_KEY = 'k';
});

async function call({ userId = TEACHER, body = { kind: 'paper', id: 'r1' } } = {}) {
  const router = require('../../dashboard/routes/portal-share.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/share/whatsapp' && l.route.methods.post);
  const req = { session: userId ? { portalUserId: userId } : null, body };
  let status = 200; let payload = null;
  const res = { status(c) { status = c; return this; }, json(b) { payload = b; return this; } };
  for (const s of layer.route.stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await s.handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return { status, payload };
}

describe('POST /share/whatsapp', () => {
  it('signed out is 401; the teacher app off is 404 and the bot is not asked', async () => {
    expect((await call({ userId: null })).status).toBe(401);
    flagOn = false;
    expect((await call()).status).toBe(404);
    expect(post).not.toHaveBeenCalled();
  });

  it('a bad kind or id is 400 before the bot is asked', async () => {
    for (const body of [{ kind: 'video', id: 'x' }, { kind: 'paper' }, { kind: 'paper', id: '' }, { kind: 'paper', id: 5 }]) {
      expect((await call({ body })).status).toBe(400);
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('asks the bot for the SESSION user, and returns its real answer', async () => {
    post.mockResolvedValue({ status: 200, data: { success: true, status: 'unavailable', reason: 'not_configured' } });
    const out = await call({ body: { kind: 'lesson', id: 'g612:abc', userId: 'someone-else' } });
    expect(post.mock.calls[0][0]).toBe('http://bot.test/api/internal/share/send');
    expect(post.mock.calls[0][1]).toEqual({ userId: TEACHER, kind: 'lesson', id: 'g612:abc' });
    expect(out.payload).toEqual({ success: true, status: 'unavailable', reason: 'not_configured' });

    post.mockResolvedValue({ status: 200, data: { success: true, status: 'sent', at: '2026-10-10T10:42:00.000Z' } });
    expect((await call()).payload).toEqual({ success: true, status: 'sent', at: '2026-10-10T10:42:00.000Z' });
    post.mockResolvedValue({ status: 200, data: { success: true, status: 'failed', reason: 'refused' } });
    expect((await call()).payload.status).toBe('failed');
  });

  it('not her item is 404; an unreachable or broken bot is 502 failed, never sent', async () => {
    post.mockResolvedValue({ status: 404, data: { success: false, status: 'not_found' } });
    expect((await call()).status).toBe(404);
    post.mockRejectedValue(new Error('ECONNREFUSED'));
    const down = await call();
    expect(down.status).toBe(502);
    expect(down.payload.status).toBe('failed');
    post.mockResolvedValue({ status: 500, data: { success: false } });
    expect((await call()).status).toBe(502);
  });
});
