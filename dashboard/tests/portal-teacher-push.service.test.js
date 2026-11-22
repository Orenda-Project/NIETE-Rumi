'use strict';
/**
 * The teacher's evening reminder at the edge (routes/portal-teacher-push.routes.js; switch portal_push_remind AND
 * web_quiz_push_remind, decided by the BOT): no session → 401 and the bot is never asked; the bot's 404 → 404; the
 * teacher is ALWAYS the session's user (a user_id in the body is ignored). Invented values.
 */
const http = require('http');
const express = require('express');
const { createPortalTeacherPushRouter } = require('../routes/portal-teacher-push.routes');

const SESSION_USER = '11111111-2222-4333-8444-555555555555';
const OTHER_USER = '99999999-8888-4777-8666-555555555555';
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } };

function start({ bot = () => ({ status: 404, body: { off: true } }), session = { portalUserId: SESSION_USER }, botUrl = 'http://bot.test', apiKey = 'k' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const r = bot(url, init);
    if (r.throw) throw new Error('down');
    return { status: r.status, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(r.body || {}) };
  };
  const app = express();
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/api/portal', createPortalTeacherPushRouter({ botUrl, apiKey, fetchImpl, logEvent: () => {} }));
  app.use((req, res) => res.status(404).send('portal'));
  const server = http.createServer(app);
  return new Promise((r) => server.listen(0, () => r({ server, calls, base: `http://127.0.0.1:${server.address().port}` })));
}
const post = (base, op, body) => fetch(`${base}/api/portal/push/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let s;
afterEach(() => new Promise((r) => (s ? s.server.close(() => { s = null; r(); }) : r())));

describe('portal teacher push routes', () => {
  test('no session: 401 on every route, and the bot is never asked', async () => {
    s = await start({ session: null, bot: () => ({ status: 200, body: { remind: true, test: true, portal: true } }) });
    expect((await fetch(`${s.base}/api/portal/push/state`)).status).toBe(401);
    for (const op of ['subscribe', 'unsubscribe', 'test']) expect((await post(s.base, op, { sub: SUB, endpoint: SUB.endpoint })).status).toBe(401);
    expect(s.calls).toHaveLength(0);
  });

  test('a session without a portal user is no session', async () => {
    s = await start({ session: {} });
    expect((await fetch(`${s.base}/api/portal/push/state`)).status).toBe(401);
  });

  test('the bot says off (404): every route 404, state included', async () => {
    s = await start();
    const st = await fetch(`${s.base}/api/portal/push/state`);
    expect(st.status).toBe(404);
    expect(await st.json()).toEqual({ success: false, off: true });
    for (const op of ['subscribe', 'unsubscribe', 'test']) {
      const r = await post(s.base, op, { sub: SUB, endpoint: SUB.endpoint });
      expect([op, r.status]).toEqual([op, 404]);
    }
    expect(s.calls.map((c) => c.url)).toEqual([
      'http://bot.test/api/internal/wqpush/state',
      'http://bot.test/api/internal/wqpush/portal/subscribe',
      'http://bot.test/api/internal/wqpush/portal/unsubscribe',
      'http://bot.test/api/internal/wqpush/portal/test',
    ]);
  });

  test('state: portal only when the bot says portal:true; the remind-only answer is off for the teacher', async () => {
    s = await start({ bot: () => ({ status: 200, body: { remind: true, test: true, portal: true } }) });
    expect(await (await fetch(`${s.base}/api/portal/push/state`)).json()).toEqual({ portal: true, test: true });
    s.server.close();
    s = await start({ bot: () => ({ status: 200, body: { remind: true, test: true, portal: false } }) });
    const r = await fetch(`${s.base}/api/portal/push/state`);
    expect(r.status).toBe(404);
  });

  test('subscribe: user_id is the session user, never the body; sub and lang pass through', async () => {
    s = await start({ bot: () => ({ status: 200, body: { ok: 1 } }) });
    const r = await post(s.base, 'subscribe', { sub: SUB, lang: 'ur', user_id: OTHER_USER, via: 'family_phone', code: 'ABC123' });
    expect([r.status, await r.json()]).toEqual([200, { ok: 1 }]);
    expect(s.calls[0].url).toBe('http://bot.test/api/internal/wqpush/portal/subscribe');
    expect(s.calls[0].body).toEqual({ sub: SUB, lang: 'ur', user_id: SESSION_USER });
    expect(s.calls[0].init.headers['x-api-key']).toBe('k');
  });

  test('unsubscribe and test: the endpoint and the session user only', async () => {
    s = await start({ bot: (url) => ({ status: 200, body: url.endsWith('/test') ? { ok: 1, sent: 1, status: 201 } : { ok: 1 } }) });
    expect(await (await post(s.base, 'unsubscribe', { endpoint: SUB.endpoint, user_id: OTHER_USER })).json()).toEqual({ ok: 1 });
    expect(await (await post(s.base, 'test', { endpoint: SUB.endpoint, user_id: OTHER_USER })).json()).toEqual({ ok: 1, sent: 1, status: 201 });
    expect(s.calls.map((c) => c.body)).toEqual([
      { endpoint: SUB.endpoint, user_id: SESSION_USER },
      { endpoint: SUB.endpoint, user_id: SESSION_USER },
    ]);
  });

  test('the bot unreachable: 503; no bot configured: 404', async () => {
    s = await start({ bot: () => ({ throw: true }) });
    expect((await fetch(`${s.base}/api/portal/push/state`)).status).toBe(503);
    s.server.close();
    s = await start({ botUrl: '' });
    expect((await fetch(`${s.base}/api/portal/push/state`)).status).toBe(404);
    expect(s.calls).toHaveLength(0);
  });

  test('the module mounts as a plain router (index.js beside the other portal teacher routers)', () => {
    const router = require('../routes/portal-teacher-push.routes');
    expect(typeof router).toBe('function');
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
    expect(src.split("require('./routes/portal-teacher-push.routes')").length).toBe(2);
  });
});
