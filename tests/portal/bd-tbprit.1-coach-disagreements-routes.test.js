'use strict';
/**
 * bd-tbprit.1 — the coach's disagreements API, behind the coach app's own guards and its own flag
 * (coach_disagreement_card, off unless set — week 1 of the v10 test sees nothing new).
 *
 *   GET  /coach/disagreements              { todo, done } for the logged-in coach
 *   GET  /coach/disagreements/:id          { card } — 404 unless it is hers
 *   POST /coach/disagreements/:id/visited  "I have visited" — hers only, one-way
 */
const http = require('http');
const express = require('express');
const { createCoachDisagreementsRouter } = require('../../dashboard/routes/coach-disagreements.routes');

const ID = '7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER = '8e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app(over = {}) {
  const calls = { visited: [], list: [] };
  const a = express();
  a.use((req, _res, next) => { req.session = { portalUserId: over.me === undefined ? 'me' : over.me }; next(); });
  a.use(createCoachDisagreementsRouter({
    guards: over.guards || [(req, res, next) => next()],
    isOn: over.isOn || (async (uid) => uid === 'me'),
    list: async (uid) => { calls.list.push(uid); return { todo: [{ id: ID }], done: [] }; },
    card: async (uid, id) => (uid === 'me' && id === ID ? { id: ID, done: false } : null),
    ownerOf: async (id) => (id === ID ? 'me' : id === OTHER ? 'someone' : null),
    markVisited: async (id) => { calls.visited.push(id); return over.markOk !== false; },
    ...over.opts,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return { srv, calls };
}
const req = (srv, method, path) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => {
      let body = null; try { body = out ? JSON.parse(out) : null; } catch (_) { body = out; } // express's own 404 is HTML
      resolve({ status: res.statusCode, headers: res.headers, body });
    });
  });
  r.on('error', reject);
  r.end();
});

describe('coach disagreements API', () => {
  it('lists the logged-in coach\'s own To do and Done, private and not cached', async () => {
    const { srv, calls } = await app();
    const r = await req(srv, 'GET', '/coach/disagreements');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, todo: [{ id: ID }], done: [] });
    expect(calls.list).toEqual(['me']);
    expect(r.headers['cache-control']).toBe('private, no-store');
  });

  it('flag off for her: every route is a 404, nothing is read or written', async () => {
    const { srv, calls } = await app({ isOn: async () => false });
    expect((await req(srv, 'GET', '/coach/disagreements')).status).toBe(404);
    expect((await req(srv, 'GET', `/coach/disagreements/${ID}`)).status).toBe(404);
    expect((await req(srv, 'POST', `/coach/disagreements/${ID}/visited`)).status).toBe(404);
    expect(calls).toEqual({ visited: [], list: [] });
  });

  it('a flag read that throws is off', async () => {
    const { srv } = await app({ isOn: async () => { throw new Error('db'); } });
    expect((await req(srv, 'GET', '/coach/disagreements')).status).toBe(404);
  });

  it('the coach app guards run first', async () => {
    const { srv, calls } = await app({ guards: [(req, res) => res.status(401).json({ success: false })] });
    expect((await req(srv, 'GET', '/coach/disagreements')).status).toBe(401);
    expect(calls.list).toEqual([]);
  });

  it('her card; someone else\'s or a malformed id is a 404', async () => {
    const { srv } = await app();
    expect(await req(srv, 'GET', `/coach/disagreements/${ID}`)).toMatchObject({ status: 200, body: { success: true, card: { id: ID } } });
    expect((await req(srv, 'GET', `/coach/disagreements/${OTHER}`)).status).toBe(404);
    expect((await req(srv, 'GET', '/coach/disagreements/not-a-uuid')).status).toBe(404);
  });

  it('"I have visited" on hers marks it; on someone else\'s nothing is written', async () => {
    const { srv, calls } = await app();
    expect(await req(srv, 'POST', `/coach/disagreements/${ID}/visited`)).toMatchObject({ status: 200, body: { success: true, done: true } });
    expect((await req(srv, 'POST', `/coach/disagreements/${OTHER}/visited`)).status).toBe(404);
    expect((await req(srv, 'POST', '/coach/disagreements/bad/visited')).status).toBe(404);
    expect(calls.visited).toEqual([ID]);
  });

  it('a failed visited write is a 500, never a false "done"', async () => {
    const { srv } = await app({ markOk: false });
    expect((await req(srv, 'POST', `/coach/disagreements/${ID}/visited`)).status).toBe(500);
  });

  it('there is no route to undo a visit', async () => {
    const { srv } = await app();
    expect((await req(srv, 'DELETE', `/coach/disagreements/${ID}/visited`)).status).toBe(404);
    expect((await req(srv, 'POST', `/coach/disagreements/${ID}/todo`)).status).toBe(404);
  });

  it('a list that throws is a 500 with no detail', async () => {
    const { srv } = await app({ opts: { list: async () => { throw new Error('secret detail'); } } });
    const r = await req(srv, 'GET', '/coach/disagreements');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
});
