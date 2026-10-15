'use strict';
/**
 * v10 coaching test (bd-v0toag.45): "not satisfied" → her coach is asked to visit. Groups C and D only.
 *
 * After a 👎 on "Was this coaching report useful to you?", the C/D report page offers "If you disagree and want
 * a person to observe instead, tap here". /cr/:token/coach lists her school's coaches (leader_schools x
 * users.school_id); she confirms one, or "None of these". Confirming sends that coach the approved template
 * coach_visit_request_v1 and writes ONE coach_visit_requests row per report: a second tap never pings again.
 * Real Express over HTTP with the lookups injected; the default service is tested at the bottom.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
const C1 = '9d1f0a3b-1111-4c2d-8e9f-0a1b2c3d4e5f';
const C2 = '9d1f0a3b-2222-4c2d-8e9f-0a1b2c3d4e5f';
const COACHES = [{ id: C1, name: 'Sana Iqbal' }, { id: C2, name: 'Bilal Ahmed' }];
const VIEW = {
  language: 'en',
  session: { id: S, created_at: '2026-10-19T05:30:00Z', analysis_data: {}, prioritized_action: { action: 'Ask two children by name.' } },
  quizMessage: null, firstName: 'Sadia', trend: [],
};
let emitted;
let asks;

beforeEach(() => {
  jest.resetModules();
  emitted = [];
  asks = [];
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co' };
});
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ group = 'C', coaches = COACHES, outcome = 'sent', view = VIEW } = {}) {
  const a = express();
  a.use(require('../../dashboard/routes/coaching-report.routes').createCoachingReportRouter({
    load: async () => view,
    groupOf: async () => group,
    recordUseful: async () => true,
    coachesFor: async () => coaches,
    requestVisit: async (args) => { asks.push(args); return { status: outcome }; },
  }));
  a.use((_q, res) => res.status(418).send('fell through'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const req = (srv, method, path, form) => new Promise((resolve, reject) => {
  const body = form ? new URLSearchParams(form).toString() : '';
  const r = http.request({
    host: '127.0.0.1', port: srv.address().port, path, method,
    headers: form ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {},
  }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
  });
  r.on('error', reject);
  r.end(body);
});
const tok = () => require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: S, userId: U });
const DISAGREE = 'If you disagree and want a person to observe instead, tap here';

describe('the offer, after a 👎', () => {
  test.each(['no', 'done'])('C and D: after useful=%s the card links to her coach page', async (state) => {
    const t = tok();
    const res = await req(await app({ group: 'D' }), 'GET', `/cr/${t}?useful=${state}`);
    expect(res.body).toContain(DISAGREE);
    expect(res.body).toContain(`href="/cr/${t}/coach"`);
  });

  test('not after a 👍, and not before she answers', async () => {
    const t = tok();
    const srv = await app();
    expect((await req(srv, 'GET', `/cr/${t}?useful=yes`)).body).not.toContain(DISAGREE);
    expect((await req(srv, 'GET', `/cr/${t}`)).body).not.toContain(DISAGREE);
  });

  test.each(['A', 'B', null])('group %s (or switch off): never offered, and the coach page is not there', async (g) => {
    const t = tok();
    const srv = await app({ group: g });
    expect((await req(srv, 'GET', `/cr/${t}?useful=no`)).body).not.toContain(DISAGREE);
    expect((await req(srv, 'GET', `/cr/${t}/coach`)).status).toBe(404);
    expect((await req(srv, 'POST', `/cr/${t}/coach`, { coach: C1 })).status).toBe(404);
    expect(asks).toEqual([]);
  });
});

describe('the coach page', () => {
  test('lists her school\'s coaches and "None of these" as one POST form; logged asked with the group', async () => {
    const t = tok();
    const res = await req(await app(), 'GET', `/cr/${t}/coach`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(`<form method="post" action="/cr/${t}/coach"`);
    expect(res.body).toContain(`value="${C1}"`);
    expect(res.body).toContain('Sana Iqbal');
    expect(res.body).toContain('Bilal Ahmed');
    expect(res.body).toContain('value="none"');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(emitted).toContainEqual({ e: 'coaching.coach_ping.asked', d: { coachingSessionId: S, userId: U, group: 'C', coaches: 2 } });
  });

  test('in Urdu for an Urdu teacher', async () => {
    const res = await req(await app({ view: { ...VIEW, language: 'ur' } }), 'GET', `/cr/${tok()}/coach`);
    expect(res.body).toContain('dir="rtl"');
    expect(res.body).toContain('ان میں سے کوئی نہیں');
  });

  test('a bad link: 404, nothing asked', async () => {
    const res = await req(await app(), 'POST', '/cr/not-a-token/coach', { coach: C1 });
    expect(res.status).toBe(404);
    expect(asks).toEqual([]);
  });
});

describe('her answer', () => {
  test('a coach: asked once with that coach and the group, back to the card (303) saying the coach was asked', async () => {
    const t = tok();
    const srv = await app();
    const res = await req(srv, 'POST', `/cr/${t}/coach`, { coach: C1 });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/cr/${t}?coach=sent`);
    expect(asks).toEqual([{ sessionId: S, userId: U, group: 'C', coachId: C1 }]);
    expect(emitted).toContainEqual({ e: 'coaching.coach_ping.sent', d: { coachingSessionId: S, userId: U, group: 'C' } });
    expect((await req(srv, 'GET', res.headers.location)).body).toContain('We have told your coach. They will try to visit your class when they can.');
    expect(JSON.stringify(emitted)).not.toContain(t);
  });

  test('"None of these": recorded with no coach, nobody pinged', async () => {
    const t = tok();
    const res = await req(await app({ outcome: 'no_coach' }), 'POST', `/cr/${t}/coach`, { coach: 'none' });
    expect(asks).toEqual([{ sessionId: S, userId: U, group: 'C', coachId: null }]);
    expect(res.headers.location).toBe(`/cr/${t}?coach=no_coach`);
    expect(emitted).toContainEqual({ e: 'coaching.coach_ping.no_coach', d: { coachingSessionId: S, userId: U, group: 'C' } });
  });

  test.each([['failed', 'We could not reach your coach just now'], ['already', 'We have told your coach. They will try to visit your class when they can.']])(
    'outcome %s: the card says so', async (outcome, text) => {
      const t = tok();
      const srv = await app({ outcome });
      const res = await req(srv, 'POST', `/cr/${t}/coach`, { coach: C1 });
      expect(res.headers.location).toBe(`/cr/${t}?coach=${outcome}`);
      expect((await req(srv, 'GET', res.headers.location)).body).toContain(text);
    },
  );

  test('nothing chosen: back to the coach page, nobody asked', async () => {
    const t = tok();
    const res = await req(await app(), 'POST', `/cr/${t}/coach`, {});
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/cr/${t}/coach`);
    expect(asks).toEqual([]);
  });
});
