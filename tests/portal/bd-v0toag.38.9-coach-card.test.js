'use strict';
/**
 * v10 coaching test (bd-v0toag.38.9): the coach card, the link in the coach's WhatsApp ping.
 *
 *   GET  /cv/:token          her name, school, score and section scores, her reasons, and her voice note on a
 *                            short-lived link. Private, no-store; a bad link is a 404 with no data.
 *   POST /cv/:token/visited  "I have visited": the request reads visited and her voice note is deleted.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const R = '7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const CARD = {
  teacher: 'Sadia Bibi', school: 'IMSG I-8/1', language: 'en', status: 'sent', reasons: ['score', 'wont_work'],
  noteUrl: 'https://r2.example/coach-visit-notes/x.webm?sig=1',
  view: { header: { pct: 64, date: '19 Oct 2026' }, sections: [{ name: 'Lesson Plan Fidelity', score: 23, max: 40, pct: 58 }] },
};
let visited;

beforeEach(() => {
  jest.resetModules();
  visited = [];
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co' };
});
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ card = CARD } = {}) {
  const a = express();
  a.use(require('../../dashboard/routes/coach-card.routes').createCoachCardRouter({
    loadCard: async (id) => (id === R ? card : null),
    markVisited: async (id) => { visited.push(id); return true; },
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const req = (srv, method, path) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
  });
  r.on('error', reject);
  r.end();
});
const tok = () => require('../../dashboard/services/coach-card-token').signCoachCard(R);

test('the card: her score, section scores, reasons and voice note; private', async () => {
  const res = await req(await app(), 'GET', `/cv/${tok()}`);
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('private, no-store');
  for (const s of ['Sadia Bibi', 'IMSG I-8/1', '64%', 'Lesson Plan Fidelity', '23/40', 'My score doesn’t seem right',
    'This won’t work in my class', `<audio controls src="${CARD.noteUrl}"`, 'I have visited']) expect(res.body).toContain(s);
});

test('no voice note: no player', async () => {
  const res = await req(await app({ card: { ...CARD, noteUrl: null } }), 'GET', `/cv/${tok()}`);
  expect(res.body).not.toContain('<audio');
});

test('I have visited: marked, back to the card, which then says so', async () => {
  const t = tok();
  const srv = await app();
  const res = await req(srv, 'POST', `/cv/${t}/visited`);
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe(`/cv/${t}`);
  expect(visited).toEqual([R]);
  const after = await req(await app({ card: { ...CARD, status: 'visited', noteUrl: null } }), 'GET', `/cv/${t}`);
  expect(after.body).toContain('Visit done');
  expect(after.body).not.toContain('I have visited');
});

test('a bad link, or a report link: 404, nothing marked', async () => {
  const srv = await app();
  expect((await req(srv, 'GET', '/cv/not-a-token')).status).toBe(404);
  const report = require('../../bot/shared/services/coaching/report-link-token')
    .signReportLink({ sessionId: R, userId: R });
  expect((await req(srv, 'POST', `/cv/${report}/visited`)).status).toBe(404);
  expect(visited).toEqual([]);
});
