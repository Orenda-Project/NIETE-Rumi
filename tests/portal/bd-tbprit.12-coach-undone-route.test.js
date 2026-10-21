'use strict';
/**
 * bd-tbprit.12 — "Move back to To do": POST /coach/disagreements/:id/undone, hers only, behind the same flag.
 * Done is marked with the coach's own id too, so the service can refuse a card that is not hers.
 */
const http = require('http');
const express = require('express');
const { createCoachDisagreementsRouter } = require('../../dashboard/routes/coach-disagreements.routes');

const ID = '7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER = '8e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app(over = {}) {
  const calls = { visited: [], undone: [] };
  const a = express();
  a.use((req, _res, next) => { req.session = { portalUserId: 'me' }; next(); });
  a.use(createCoachDisagreementsRouter({
    isOn: over.isOn || (async (uid) => uid === 'me'),
    list: async () => ({ todo: [], done: [] }),
    card: async () => null,
    ownerOf: async (id) => (id === ID ? 'me' : id === OTHER ? 'someone' : null),
    markVisited: async (id, coachId) => { calls.visited.push([id, coachId]); return true; },
    markUndone: async (id, coachId) => { calls.undone.push([id, coachId]); return over.undoOk !== false; },
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return { srv, calls };
}
const post = (srv, path) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'POST' }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => {
      let body = null; try { body = out ? JSON.parse(out) : null; } catch (_) { body = out; }
      resolve({ status: res.statusCode, body });
    });
  });
  r.on('error', reject);
  r.end();
});

describe('POST /coach/disagreements/:id/undone', () => {
  it('on hers: back to To do', async () => {
    const { srv, calls } = await app();
    expect(await post(srv, `/coach/disagreements/${ID}/undone`)).toMatchObject({ status: 200, body: { success: true, done: false } });
    expect(calls.undone).toEqual([[ID, 'me']]);
  });

  it("someone else's, a bad id, or the flag off: 404 and nothing written", async () => {
    const { srv, calls } = await app();
    expect((await post(srv, `/coach/disagreements/${OTHER}/undone`)).status).toBe(404);
    expect((await post(srv, '/coach/disagreements/bad/undone')).status).toBe(404);
    const off = await app({ isOn: async () => false });
    expect((await post(off.srv, `/coach/disagreements/${ID}/undone`)).status).toBe(404);
    expect([calls.undone, off.calls.undone]).toEqual([[], []]);
  });

  it('a failed write is a 500, never a false "back in To do"', async () => {
    const { srv } = await app({ undoOk: false });
    expect((await post(srv, `/coach/disagreements/${ID}/undone`)).status).toBe(500);
  });

  it('Mark as done passes her own id along', async () => {
    const { srv, calls } = await app();
    expect((await post(srv, `/coach/disagreements/${ID}/visited`)).status).toBe(200);
    expect(calls.visited).toEqual([[ID, 'me']]);
  });
});
