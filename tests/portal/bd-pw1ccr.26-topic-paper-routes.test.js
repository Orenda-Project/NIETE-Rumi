/**
 * bd-pw1ccr.26 — the portal card for a held topic-end nudge (WhatsApp window shut, retry booked):
 *
 *   GET  /api/portal/me/topic-paper           → { success, held }  the chapter her held nudge was for, or null
 *   POST /api/portal/me/topic-paper/opened    she tapped the card: her pending WhatsApp retries for it skip
 *
 * Dark (404, nothing asked) unless BOTH the card's own switch (topic_nudge_portal_card_enabled) and the nudge's
 * switch (topic_end_nudge_enabled) are on for her. Group B is checked in the lookup. The teacher is always the
 * session's user.
 */
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const HELD = { topicId: 'b', topicName: 'Plurals', grade: 1, subject: 'english', chapter: 4 };

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(method, path, { userId = TEACHER, query = {}, body = {} } = {}) {
  const router = require('../../dashboard/routes/portal-topic-paper.routes');
  const stack = findRoute(router, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const req = { session: userId ? { portalUserId: userId } : null, query, params: {}, body, method: method.toUpperCase(), path, headers: {}, get: () => undefined };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
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

const ROUTES = [['get', '/me/topic-paper'], ['post', '/me/topic-paper/opened']];

let svc; let store; let flags;
beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  flags = { topic_nudge_portal_card_enabled: true, topic_end_nudge_enabled: true };
  svc = { heldTopicNudge: jest.fn(async () => HELD) };
  store = { skipPendingForTopic: jest.fn(async () => 1) };
  jest.doMock('../../dashboard/services/held-topic-nudge.service', () => svc);
  jest.doMock('../../bot/shared/services/nudges/teacher-nudges.store', () => store);
  jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn() }));
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    isFlagEnabledForUser: jest.fn(async (_s, key) => Boolean(flags[key])),
  }));
});
afterEach(() => { jest.restoreAllMocks(); });

const asked = () => svc.heldTopicNudge.mock.calls.length + store.skipPendingForTopic.mock.calls.length > 0;
const BODY = { body: { topicId: 'b' } };

test.each(ROUTES)('%s %s signed out: 401, nothing asked', async (m, p) => {
  expect((await invoke(m, p, { ...BODY, userId: null })).statusCode).toBe(401);
  expect(asked()).toBe(false);
});

test.each(ROUTES)('%s %s with the card switch off: 404, nothing asked', async (m, p) => {
  flags.topic_nudge_portal_card_enabled = false;
  expect((await invoke(m, p, BODY)).statusCode).toBe(404);
  expect(asked()).toBe(false);
});

test.each(ROUTES)('%s %s with the nudge switched off: 404, nothing asked', async (m, p) => {
  flags.topic_end_nudge_enabled = false;
  expect((await invoke(m, p, BODY)).statusCode).toBe(404);
  expect(asked()).toBe(false);
});

test('GET returns the session teacher\'s held chapter, whatever the request says', async () => {
  const r = await invoke('get', '/me/topic-paper', { query: { userId: 'someone-else' } });
  expect(r).toEqual({ statusCode: 200, payload: { success: true, held: HELD } });
  expect(svc.heldTopicNudge).toHaveBeenCalledWith(expect.any(Function), TEACHER);
});

test('GET with nothing held: held null; a database failure: 502', async () => {
  svc.heldTopicNudge.mockResolvedValueOnce(null);
  expect((await invoke('get', '/me/topic-paper')).payload).toEqual({ success: true, held: null });
  svc.heldTopicNudge.mockRejectedValueOnce(new Error('down'));
  expect((await invoke('get', '/me/topic-paper')).statusCode).toBe(502);
});

test('POST opened skips her pending retries for that topic as card_used', async () => {
  const r = await invoke('post', '/me/topic-paper/opened', { body: { topicId: 'b', userId: 'someone-else' } });
  expect(r).toEqual({ statusCode: 200, payload: { success: true, skipped: 1 } });
  expect(store.skipPendingForTopic).toHaveBeenCalledWith({ userId: TEACHER, kind: 'topic_end_nudge', topicId: 'b', reason: 'card_used' });
});

test('POST opened: no topic is 400; a failure is 502', async () => {
  expect((await invoke('post', '/me/topic-paper/opened', { body: {} })).statusCode).toBe(400);
  expect((await invoke('post', '/me/topic-paper/opened', { body: { topicId: 7 } })).statusCode).toBe(400);
  store.skipPendingForTopic.mockRejectedValueOnce(new Error('down'));
  expect((await invoke('post', '/me/topic-paper/opened', BODY)).statusCode).toBe(502);
});

test('the routes are mounted once', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../dashboard/index.js'), 'utf8');
  expect(src.match(/portal-topic-paper\.routes/g)).toHaveLength(1);
});
