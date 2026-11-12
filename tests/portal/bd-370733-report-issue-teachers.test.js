'use strict';
/**
 * bd-370733 — Report an issue is for teachers and principals too (operator, 12 Nov: "Report an issue on the portal only
 * appearing for Coaches only. Should be for teacher as well.").
 *
 *   POST /report-issue   { kind, message, page? } → { success: true } for ANY signed-in user (teacher, principal, coach),
 *                        behind the portal's one sign-in check only; the same rules and the same table as the coach's
 *                        POST /coach/feedback, which keeps its own coach-app guards.
 *   Both record WHO sent it: the reporter's role, read by the server from users.role (never from the body). No role
 *   recorded counts as a teacher (the app's rule); a role that cannot be read keeps the report without one.
 */
const http = require('http');
const express = require('express');
const { createCoachFeedbackRouter } = require('../../dashboard/routes/coach-feedback.routes');

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app(over = {}) {
  const saved = [];
  const a = express();
  a.use((req, _res, next) => { req.session = { portalUserId: over.me === undefined ? 'me' : over.me }; next(); });
  a.use(createCoachFeedbackRouter({
    guards: over.guards || [(req, res) => res.status(404).json({ success: false, error: 'Not found' })],
    anyoneGuards: over.anyoneGuards || [(req, res, next) => next()],
    roleOf: over.roleOf || (async () => 'teacher'),
    save: async (row) => { saved.push(row); },
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return { srv, saved };
}
const post = (srv, path, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
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

describe('Report an issue — teachers and principals', () => {
  it('a teacher (not on the coach app) reports through /report-issue: stored for her, with her role', async () => {
    const { srv, saved } = await app();
    const r = await post(srv, '/report-issue', { kind: 'numbers', message: '  Attendance shows 0 present ', page: '/portal/teacher/more' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true });
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(saved).toEqual([{ userId: 'me', kind: 'numbers', message: 'Attendance shows 0 present', page: '/portal/teacher/more', role: 'teacher' }]);
    // The coach's own address still answers only behind the coach-app guards.
    expect((await post(srv, '/coach/feedback', { kind: 'idea', message: 'x' })).status).toBe(404);
  });

  it.each([
    ['principal', 'principal'], ['coach', 'coach'], ['Principal', 'principal'], [null, 'teacher'], ['', 'teacher'],
  ])('users.role %p is recorded as %p', async (role, recorded) => {
    const { srv, saved } = await app({ roleOf: async () => role });
    await post(srv, '/report-issue', { kind: 'idea', message: 'x' });
    expect(saved[0].role).toBe(recorded);
  });

  it('the role is the server\'s: a role (or a user) in the body is ignored', async () => {
    const { srv, saved } = await app({ roleOf: async () => 'teacher' });
    await post(srv, '/report-issue', { kind: 'idea', message: 'x', role: 'coach', userId: 'someone-else' });
    expect(saved[0]).toMatchObject({ userId: 'me', role: 'teacher' });
  });

  it('a role that cannot be read keeps the report, without a role', async () => {
    const { srv, saved } = await app({ roleOf: async () => { throw new Error('db blip'); } });
    const r = await post(srv, '/report-issue', { kind: 'broken', message: 'x' });
    expect(r.status).toBe(200);
    expect(saved).toHaveLength(1);
    expect(saved[0].role).toBeNull();
  });

  it('the coach\'s /coach/feedback records her role too', async () => {
    const { srv, saved } = await app({ guards: [(req, res, next) => next()], roleOf: async () => 'coach' });
    await post(srv, '/coach/feedback', { kind: 'broken', message: 'x' });
    expect(saved[0]).toMatchObject({ userId: 'me', role: 'coach' });
  });

  it('the same rules as the coach\'s: bad kind or empty message is a 400; nobody signed in or a refusing guard stores nothing', async () => {
    const { srv, saved } = await app();
    expect((await post(srv, '/report-issue', { kind: 'bug', message: 'x' })).status).toBe(400);
    expect((await post(srv, '/report-issue', { kind: 'idea', message: '   ' })).status).toBe(400);
    const none = await app({ me: null });
    expect((await post(none.srv, '/report-issue', { kind: 'idea', message: 'x' })).status).toBe(404);
    const shut = await app({ anyoneGuards: [(req, res) => res.status(401).json({ success: false })] });
    expect((await post(shut.srv, '/report-issue', { kind: 'idea', message: 'x' })).status).toBe(401);
    expect([...saved, ...none.saved, ...shut.saved]).toEqual([]);
  });
});
