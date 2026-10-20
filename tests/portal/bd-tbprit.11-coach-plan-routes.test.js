'use strict';
/**
 * bd-tbprit.11 — the coaching box's two routes, hers only, behind the same flag:
 *   POST /coach/disagreements/:id/plan        { found?, mode?, flagged?, addedToVisit?, sent? } → { plan }
 *   POST /coach/disagreements/:id/suggestion  { found: 0-3 } → { suggestion } — null when the AI failed (the template stays)
 */
const http = require('http');
const express = require('express');
const { createCoachDisagreementsRouter } = require('../../dashboard/routes/coach-disagreements.routes');

const ID = '7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER = '8e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const PLAN = { found: 1, mode: 'call', flagged: false, addedToVisit: false, sent: false };
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app(over = {}) {
  const calls = { plan: [], suggestion: [] };
  const a = express();
  a.use((req, _res, next) => { req.session = { portalUserId: 'me' }; next(); });
  a.use(createCoachDisagreementsRouter({
    isOn: over.isOn || (async (uid) => uid === 'me'),
    list: async () => ({ todo: [], done: [] }),
    card: async () => null,
    ownerOf: async () => null,
    markVisited: async () => true,
    markUndone: async () => true,
    savePlan: async (coachId, id, body) => {
      calls.plan.push([coachId, id, body]);
      if (over.planThrows) throw new Error('boom');
      return id === ID ? PLAN : null;
    },
    suggestion: async (coachId, id, found) => {
      calls.suggestion.push([coachId, id, found]);
      if (id === OTHER) return undefined;
      return over.aiFails ? null : { msg: '{name} جی' };
    },
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return { srv, calls };
}
const post = (srv, path, body) => new Promise((resolve, reject) => {
  const data = body == null ? '' : JSON.stringify(body);
  const r = http.request({
    host: '127.0.0.1', port: srv.address().port, path, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => {
      let b = null; try { b = out ? JSON.parse(out) : null; } catch (_) { b = out; }
      resolve({ status: res.statusCode, body: b });
    });
  });
  r.on('error', reject);
  r.end(data);
});

describe('POST /coach/disagreements/:id/plan', () => {
  it('on hers: saved, the plan back', async () => {
    const { srv, calls } = await app();
    expect(await post(srv, `/coach/disagreements/${ID}/plan`, { found: 1, mode: 'call' }))
      .toMatchObject({ status: 200, body: { success: true, plan: PLAN } });
    expect(calls.plan).toEqual([['me', ID, { found: 1, mode: 'call' }]]);
  });

  it("someone else's: 404; a bad id or the flag off: 404 and nothing saved", async () => {
    const { srv, calls } = await app();
    expect((await post(srv, `/coach/disagreements/${OTHER}/plan`, { found: 1 })).status).toBe(404);
    expect((await post(srv, '/coach/disagreements/bad/plan', { found: 1 })).status).toBe(404);
    const off = await app({ isOn: async () => false });
    expect((await post(off.srv, `/coach/disagreements/${ID}/plan`, { found: 1 })).status).toBe(404);
    expect(calls.plan).toHaveLength(1);
    expect(off.calls.plan).toEqual([]);
  });

  it('a failed save is a 500, never a false "saved"', async () => {
    const { srv } = await app({ planThrows: true });
    expect((await post(srv, `/coach/disagreements/${ID}/plan`, { found: 1 })).status).toBe(500);
  });
});

describe('POST /coach/disagreements/:id/suggestion', () => {
  it('on hers: the AI suggestion', async () => {
    const { srv, calls } = await app();
    expect(await post(srv, `/coach/disagreements/${ID}/suggestion`, { found: 2 }))
      .toMatchObject({ status: 200, body: { success: true, suggestion: { msg: '{name} جی' } } });
    expect(calls.suggestion).toEqual([['me', ID, 2]]);
  });

  it('the AI failed: 200 with null, so the page keeps the template', async () => {
    const { srv } = await app({ aiFails: true });
    expect(await post(srv, `/coach/disagreements/${ID}/suggestion`, { found: 0 }))
      .toMatchObject({ status: 200, body: { success: true, suggestion: null } });
  });

  it('found outside 0-3 or not a number: 400, no AI call; someone else\'s: 404', async () => {
    const { srv, calls } = await app();
    expect((await post(srv, `/coach/disagreements/${ID}/suggestion`, { found: 4 })).status).toBe(400);
    expect((await post(srv, `/coach/disagreements/${ID}/suggestion`, { found: '1' })).status).toBe(400);
    expect((await post(srv, `/coach/disagreements/${ID}/suggestion`, {})).status).toBe(400);
    expect(calls.suggestion).toEqual([]);
    expect((await post(srv, `/coach/disagreements/${OTHER}/suggestion`, { found: 1 })).status).toBe(404);
  });
});
