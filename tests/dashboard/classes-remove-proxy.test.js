/**
 * bd-ql2j3p — DELETE /api/portal/classes/:classId, the teacher app's "Remove class".
 *
 * Like every class route it PROXIES to the bot (POST /api/internal/classes/remove), which owns the
 * rule for what "remove" means. The teacher id comes from the SESSION, never the URL or the body —
 * a class id in a path is not authorisation.
 *
 * Chain under test: the real router handler → axios (the network boundary, the only mock that
 * matters here).
 */

const { setup, invoke, BOT } = require('./portal-proxy-harness');

let axios;
beforeEach(() => {
  jest.resetModules();
  ({ axios } = setup());
});

afterEach(() => jest.resetModules());

const sentToBot = () => {
  const call = axios.post.mock.calls.find((c) => c[0] === `${BOT}/api/internal/classes/remove`);
  return call && call[1];
};

describe('DELETE /classes/:classId', () => {
  test('asks the bot to remove it for the SESSION teacher and answers how', async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, removed: true, how: 'left' } });
    const { statusCode, payload } = await invoke('delete', '/classes/:classId', {
      params: { classId: 'c1' }, body: { userId: 'someone-else' },
    });

    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, removed: true, how: 'left' });
    expect(sentToBot()).toEqual({ userId: 'teacher-1', classId: 'c1' });
  });

  test('a class she is no longer on is still a success (a second tap, a stale page)', async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, removed: false } });
    const { statusCode, payload } = await invoke('delete', '/classes/:classId', { params: { classId: 'c1' } });

    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, removed: false, how: null });
  });

  test('a bot failure is a 502 the app can say, not a success', async () => {
    axios.post.mockResolvedValueOnce({ status: 502, data: { success: false, error: 'update_failed' } });
    const { statusCode, payload } = await invoke('delete', '/classes/:classId', { params: { classId: 'c1' } });

    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
  });

  test('the bot unreachable is a 502, not a crash', async () => {
    axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { statusCode, payload } = await invoke('delete', '/classes/:classId', { params: { classId: 'c1' } });

    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
  });
});
