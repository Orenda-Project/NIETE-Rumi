'use strict';
/**
 * bd-tbprit.4 — the WhatsApp /cv/:token link opens the coach's disagreement card in the portal, behind her
 * own login, when coach_disagreement_card AND portal_coach_v2 are on for the coach that request names.
 * Anything else — either flag off, no coach on the request, a failed read — keeps the v1 card exactly.
 *
 *   on   → 303 /portal/login?next=/portal/coach/disagreements/<request id>  (signed in, sign-in sends her on)
 *   off  → 200, the v1 card
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const R = '7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const CARD = {
  teacher: 'Sadia Bibi', school: 'IMSG I-8/1', language: 'en', status: 'sent', reasons: ['score'], noteUrl: null,
  view: { header: { pct: 64, date: '19 Oct 2026' }, sections: [] },
};

beforeEach(() => {
  jest.resetModules();
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co' };
});
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app(portalCardFor) {
  const a = express();
  a.use(require('../../dashboard/routes/coach-card.routes').createCoachCardRouter({
    loadCard: async (id) => (id === R ? CARD : null),
    markVisited: async () => true,
    portalCardFor,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const get = (srv, path) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET' }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
  });
  r.on('error', reject);
  r.end();
});
const tok = () => require('../../dashboard/services/coach-card-token').signCoachCard(R);

describe('GET /cv/:token', () => {
  test('on for her coach: 303 to sign-in, which sends her on to the portal card; private', async () => {
    const asked = [];
    const res = await get(await app(async (id) => { asked.push(id); return true; }), `/cv/${tok()}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/portal/login?next=${encodeURIComponent(`/portal/coach/disagreements/${R}`)}`);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(asked).toEqual([R]);
  });

  test('off: the v1 card, unchanged', async () => {
    const res = await get(await app(async () => false), `/cv/${tok()}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Sadia Bibi');
    expect(res.body).toContain('I have visited');
  });

  test('the check fails: the v1 card', async () => {
    const res = await get(await app(async () => { throw new Error('db down'); }), `/cv/${tok()}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Sadia Bibi');
  });

  test('a bad link is still a 404 and asks nothing', async () => {
    const asked = [];
    const res = await get(await app(async (id) => { asked.push(id); return true; }), '/cv/not-a-token');
    expect(res.status).toBe(404);
    expect(asked).toEqual([]);
  });
});

describe('opensPortalCard — both flags, for the coach on the request', () => {
  const supa = (row, error = null) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }),
  });
  const flags = (on) => async (_s, key, userId) => userId === COACH && on.includes(key);
  const run = (row, on, error) => require('../../dashboard/routes/coach-card.routes')
    .opensPortalCard(supa(row, error), R, flags(on));

  test('both on: true', async () => {
    expect(await run({ coach_user_id: COACH }, ['coach_disagreement_card', 'portal_coach_v2'])).toBe(true);
  });
  test('only the card flag: false (the coach app would send her away)', async () => {
    expect(await run({ coach_user_id: COACH }, ['coach_disagreement_card'])).toBe(false);
  });
  test('only coach v2: false', async () => {
    expect(await run({ coach_user_id: COACH }, ['portal_coach_v2'])).toBe(false);
  });
  test('no coach on the request, no row, or a read error: false', async () => {
    const both = ['coach_disagreement_card', 'portal_coach_v2'];
    expect(await run({ coach_user_id: null }, both)).toBe(false);
    expect(await run(null, both)).toBe(false);
    expect(await run(null, both, { message: 'x' })).toBe(false);
  });
  test('a flag read that throws: false', async () => {
    const boom = async () => { throw new Error('x'); };
    expect(await require('../../dashboard/routes/coach-card.routes')
      .opensPortalCard(supa({ coach_user_id: COACH }), R, boom)).toBe(false);
  });
});
