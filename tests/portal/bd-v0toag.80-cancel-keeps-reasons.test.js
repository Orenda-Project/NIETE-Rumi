'use strict';
/**
 * bd-v0toag.80: on the C/D "tell my coach" page, Cancel was a plain link, so the reasons she had ticked were
 * dropped and her 👎 had no reason in coaching_quality_metrics.user_feedback, where A/B's typed reason goes.
 * Cancel now submits the form without validation: her ticked reasons are kept as user_feedback (in English,
 * like the codes the tracker counts), no coach is asked, and she goes back to her card.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
const VIEW = {
  language: 'en',
  session: { id: S, created_at: '2026-10-19T05:30:00Z', analysis_data: {}, prioritized_action: { action: 'Ask two children by name.' } },
  quizMessage: null, firstName: 'Sadia', trend: [],
};
let emitted;
let asks;
let writes;

beforeEach(() => {
  jest.resetModules();
  emitted = []; asks = []; writes = [];
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co' };
});
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ coaches = [{ id: 'c1', name: 'Sana Iqbal' }, { id: 'c2', name: 'Bilal Ahmed' }] } = {}) {
  const a = express();
  a.use(require('../../dashboard/routes/coaching-report.routes').createCoachingReportRouter({
    load: async () => VIEW,
    groupOf: async () => 'D',
    recordUseful: async (x) => { writes.push(x); return true; },
    coachesFor: async () => coaches,
    requestVisit: async (args) => { asks.push(args); return { status: 'sent' }; },
  }));
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

test('Cancel is a submit that skips validation (the coach radio is required when there are two)', async () => {
  const res = await req(await app(), 'GET', `/cr/${tok()}/coach`);
  expect(res.body).toContain('<button class="more" type="submit" name="cancel" value="1" formnovalidate>Cancel</button>');
  expect(res.body).not.toContain('<a class="more"');
});

test('Cancel with reasons ticked: they are kept as her 👎 reason, no coach is asked, back to the card', async () => {
  const t = tok();
  const body = new URLSearchParams([['reason', 'score'], ['reason', 'unclear'], ['cancel', '1']]);
  const res = await req(await app(), 'POST', `/cr/${t}/coach`, body);
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe(`/cr/${t}`);
  expect(asks).toEqual([]);
  expect(writes).toEqual([{ sessionId: S, userId: U, reason: 'My score doesn’t seem right; I didn’t understand what to do' }]);
  expect(emitted).toContainEqual({ e: 'coaching.coach_ping.cancelled', d: { coachingSessionId: S, userId: U, group: 'D', reasons: ['score', 'unclear'] } });
});

test('Cancel with nothing ticked writes nothing and goes back to the card', async () => {
  const t = tok();
  const res = await req(await app(), 'POST', `/cr/${t}/coach`, { cancel: '1' });
  expect(res.headers.location).toBe(`/cr/${t}`);
  expect(asks).toEqual([]);
  expect(writes).toEqual([]);
});

test('Send to my coach is unchanged: the coach is asked, nothing extra is written', async () => {
  const t = tok();
  const res = await req(await app({ coaches: [{ id: 'c1', name: 'Sana Iqbal' }] }), 'POST', `/cr/${t}/coach`, { reason: 'missed' });
  expect(res.headers.location).toBe(`/cr/${t}?coach=sent`);
  expect(asks).toHaveLength(1);
  expect(writes).toEqual([]);
});
