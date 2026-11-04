'use strict';
/**
 * bd-whlsm0 — a coach reports an issue from the portal's More page (operator, 30 Oct: "add a form they can fill on the
 * issues ... collect that feedback").
 *
 *   POST /coach/feedback  { kind, message, page? } → { success: true }; stored for the logged-in coach (the SESSION
 *                         user, never an id in the body). kind ∈ broken | numbers | idea | other; message 1–2000
 *                         characters after trimming; page kept only when it is a portal address.
 */
const http = require('http');
const express = require('express');
const { createCoachFeedbackRouter, KINDS, MAX_MESSAGE } = require('../../dashboard/routes/coach-feedback.routes');

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app(over = {}) {
  const saved = [];
  const a = express();
  a.use((req, _res, next) => { req.session = { portalUserId: over.me === undefined ? 'me' : over.me }; next(); });
  a.use(createCoachFeedbackRouter({
    guards: over.guards || [(req, res, next) => next()],
    save: over.save || (async (row) => { saved.push(row); }),
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return { srv, saved };
}
const post = (srv, path, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? '' : JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => {
      let parsed = null; try { parsed = out ? JSON.parse(out) : null; } catch (_) { parsed = out; }
      resolve({ status: res.statusCode, headers: res.headers, body: parsed });
    });
  });
  r.on('error', reject);
  r.end(data);
});

describe('coach Report an issue', () => {
  it('stores the logged-in coach\'s report (trimmed), private and not cached', async () => {
    const { srv, saved } = await app();
    const r = await post(srv, '/coach/feedback', { kind: 'numbers', message: '  8/21 does not match my visits  ', page: '/portal/coach/teacher/923000000001?period=month' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true });
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(saved).toEqual([{ userId: 'me', kind: 'numbers', message: '8/21 does not match my visits', page: '/portal/coach/teacher/923000000001?period=month' }]);
  });

  it('the coach is the session user, never an id in the body', async () => {
    const { srv, saved } = await app();
    await post(srv, '/coach/feedback', { kind: 'idea', message: 'Hi', userId: 'someone-else', user_id: 'someone-else' });
    expect(saved).toHaveLength(1);
    expect(saved[0].userId).toBe('me');
  });

  it('the four kinds only', async () => {
    expect(KINDS).toEqual(['broken', 'numbers', 'idea', 'other']);
    const { srv, saved } = await app();
    for (const kind of [undefined, '', 'bug', 'BROKEN', 3]) {
      const r = await post(srv, '/coach/feedback', { kind, message: 'x' });
      expect(r.status).toBe(400);
    }
    expect(saved).toEqual([]);
  });

  it('a message is needed, and not more than the limit', async () => {
    const { srv, saved } = await app();
    for (const message of [undefined, '', '   ', 42, 'x'.repeat(MAX_MESSAGE + 1)]) {
      const r = await post(srv, '/coach/feedback', { kind: 'other', message });
      expect(r.status).toBe(400);
      expect(r.body.success).toBe(false);
    }
    expect(saved).toEqual([]);
    const ok = await post(srv, '/coach/feedback', { kind: 'other', message: 'x'.repeat(MAX_MESSAGE) });
    expect(ok.status).toBe(200);
  });

  it('a page that is not a portal address is not kept', async () => {
    const { srv, saved } = await app();
    await post(srv, '/coach/feedback', { kind: 'broken', message: 'a', page: 'https://evil.example/x' });
    await post(srv, '/coach/feedback', { kind: 'broken', message: 'b', page: `/portal/${'y'.repeat(300)}` });
    await post(srv, '/coach/feedback', { kind: 'broken', message: 'c' });
    expect(saved.map((s) => s.page)).toEqual([null, null, null]);
  });

  it('no coach in the session, or a guard that refuses: nothing is stored', async () => {
    const none = await app({ me: null });
    expect((await post(none.srv, '/coach/feedback', { kind: 'idea', message: 'x' })).status).toBe(404);
    expect(none.saved).toEqual([]);
    const shut = await app({ guards: [(req, res) => res.status(404).json({ success: false })] });
    expect((await post(shut.srv, '/coach/feedback', { kind: 'idea', message: 'x' })).status).toBe(404);
    expect(shut.saved).toEqual([]);
  });

  it('a failed save says so, and is not a success', async () => {
    const { srv } = await app({ save: async () => { throw new Error('db down'); } });
    const r = await post(srv, '/coach/feedback', { kind: 'idea', message: 'x' });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, error: 'Something went wrong' });
  });
});
