'use strict';
/**
 * The teacher app's class link card at the edge (routes/portal-teacher-class-link.routes.js; switches
 * web_quiz_class_link and web_quiz_evening_round, decided by the BOT): no session -> 401 and the bot is never asked;
 * the bot's 404 (off) -> 404 {off:true}; the teacher is ALWAYS the session's user (a teacher/user_id in the query or
 * body is ignored), so teacher A is shown only what the bot lists for A. Invented values.
 */
const http = require('http');
const express = require('express');
// Required in each test (not at load), so a missing module fails every test on its own line.
const createPortalTeacherClassLinkRouter = (o) => require('../routes/portal-teacher-class-link.routes').createPortalTeacherClassLinkRouter(o);

const A = '11111111-2222-4333-8444-555555555555';
const B = '99999999-8888-4777-8666-555555555555';
const C1 = 'c1a55000-0000-4000-8000-0000000000c1';
const LIST_A = {
  classes: [{ classId: C1, grade: 3, section: 'A', url: 'https://quiz.example.org/j/K7QM2XR9TB', sendHref: 'https://wa.me/?text=https%3A%2F%2Fquiz.example.org%2Fj%2FK7QM2XR9TB%3Ff%3D1', sent: false, round: null }],
  reportHref: null,
};

function start({ bot = () => ({ status: 404, body: { error: 'not_found' } }), session = { portalUserId: A }, botUrl = 'http://bot.test', apiKey = 'k' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const r = bot(url, init && init.body ? JSON.parse(init.body) : null);
    if (r.throw) throw new Error('down');
    return { status: r.status, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(r.body || {}) };
  };
  const app = express();
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/api/portal', createPortalTeacherClassLinkRouter({ botUrl, apiKey, fetchImpl, logEvent: () => {} }));
  app.use((req, res) => res.status(404).send('portal'));
  const server = http.createServer(app);
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, calls, base: `http://127.0.0.1:${server.address().port}` })));
}
const tap = (base, body) => fetch(`${base}/api/portal/class-link/tap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let s;
afterEach(() => new Promise((r) => (s ? s.server.close(() => { s = null; r(); }) : r())));

describe('portal teacher class link routes', () => {
  test('no session: 401 on both routes, and the bot is never asked', async () => {
    s = await start({ session: null, bot: () => ({ status: 200, body: LIST_A }) });
    expect((await fetch(`${s.base}/api/portal/class-link`)).status).toBe(401);
    expect((await tap(s.base, { classId: C1, how: 'forward' })).status).toBe(401);
    expect(s.calls).toHaveLength(0);
  });

  test('a session without a portal user is no session', async () => {
    s = await start({ session: {} });
    expect((await fetch(`${s.base}/api/portal/class-link`)).status).toBe(401);
  });

  test('the bot says off (404): 404 {success:false, off:true} on both routes', async () => {
    s = await start();
    const r = await fetch(`${s.base}/api/portal/class-link`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ success: false, off: true });
    expect((await tap(s.base, { classId: C1, how: 'forward' })).status).toBe(404);
    expect(s.calls.map((c) => c.url)).toEqual([
      'http://bot.test/api/internal/wq/cl/app',
      'http://bot.test/api/internal/wq/cl/app/tap',
    ]);
  });

  test('teacher A sees only what the bot lists for A: the session user is the teacher, never the query or body', async () => {
    s = await start({ bot: (url, body) => ({ status: 200, body: body && body.teacher === A ? LIST_A : { classes: [{ classId: 'B-class' }], reportHref: null } }) });
    const r = await fetch(`${s.base}/api/portal/class-link?teacher=${B}&user_id=${B}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual(LIST_A);
    expect(s.calls[0].body).toEqual({ teacher: A });
    expect(s.calls[0].init.method).toBe('POST');
    expect(s.calls[0].init.headers['x-api-key']).toBe('k');
  });

  test('an empty list passes through as empty (nothing drawn)', async () => {
    s = await start({ bot: () => ({ status: 200, body: { classes: [], reportHref: null } }) });
    expect(await (await fetch(`${s.base}/api/portal/class-link`)).json()).toEqual({ classes: [], reportHref: null });
  });

  test('tap: {classId, how} relayed as {teacher: session user, class_id, how}; a teacher in the body is dropped', async () => {
    s = await start({ bot: () => ({ status: 200, body: { ok: true, href: LIST_A.classes[0].sendHref } }) });
    const r = await tap(s.base, { classId: C1, how: 'copy', teacher: B, user_id: B });
    expect([r.status, await r.json()]).toEqual([200, { ok: true, href: LIST_A.classes[0].sendHref }]);
    expect(s.calls[0].url).toBe('http://bot.test/api/internal/wq/cl/app/tap');
    expect(s.calls[0].body).toEqual({ teacher: A, class_id: C1, how: 'copy' });
  });

  test('tap: a class that is not an id, or an unknown how, is 400 and never reaches the bot', async () => {
    s = await start({ bot: () => ({ status: 200, body: { ok: true } }) });
    expect((await tap(s.base, { classId: 'not-a-class', how: 'forward' })).status).toBe(400);
    expect((await tap(s.base, { classId: C1, how: 'sms' })).status).toBe(400);
    expect(s.calls).toHaveLength(0);
  });

  test('the bot unreachable: 503; no bot configured: 404 and no call', async () => {
    s = await start({ bot: () => ({ throw: true }) });
    expect((await fetch(`${s.base}/api/portal/class-link`)).status).toBe(503);
    s.server.close();
    s = await start({ botUrl: '' });
    expect((await fetch(`${s.base}/api/portal/class-link`)).status).toBe(404);
    expect(s.calls).toHaveLength(0);
  });

  test('the module mounts as a plain router, once, beside the other portal teacher routers in index.js', () => {
    const router = require('../routes/portal-teacher-class-link.routes');
    expect(typeof router).toBe('function');
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
    const line = "app.use('/api/portal', cors(portalCorsOptions), portalAuthLimiter, portalDataLimiter, require('./routes/portal-teacher-class-link.routes'));";
    expect(src.split(line).length).toBe(2);
  });
});
