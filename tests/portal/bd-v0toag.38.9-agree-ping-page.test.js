'use strict';
/**
 * v10 coaching test (bd-v0toag.38.9): "Do you agree with this report?" on group C and D's report page,
 * replacing the useful question and #2295's one-tap ping.
 *
 * The card asks Yes / No and always offers "Don't agree? Your coach will come and see your class". No, or the
 * link, opens /cr/:token/coach: four reasons to tick, an optional voice note (up to 20 s), and her school's
 * coaches only when it has more than one. Nothing is sent until "Send to my coach". A, B and switch-off: 404.
 * Real Express over HTTP with the lookups injected.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
const C1 = '9d1f0a3b-1111-4c2d-8e9f-0a1b2c3d4e5f';
const C2 = '9d1f0a3b-2222-4c2d-8e9f-0a1b2c3d4e5f';
const ONE = [{ id: C1, name: 'Sana Iqbal' }];
const TWO = [...ONE, { id: C2, name: 'Bilal Ahmed' }];
const VIEW = {
  language: 'en',
  session: { id: S, created_at: '2026-10-19T05:30:00Z', analysis_data: {}, prioritized_action: { action: 'Ask two children by name.' } },
  quizMessage: null, firstName: 'Sadia', trend: [],
};
let emitted;
let asks;
let thumbs;

beforeEach(() => {
  jest.resetModules();
  emitted = []; asks = []; thumbs = [];
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co' };
});
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ group = 'C', coaches = ONE, outcome = 'sent', view = VIEW } = {}) {
  const a = express();
  a.use(require('../../dashboard/routes/coaching-report.routes').createCoachingReportRouter({
    load: async () => view,
    groupOf: async () => group,
    recordUseful: async (x) => { thumbs.push(x); return true; },
    coachesFor: async () => coaches,
    requestVisit: async (args) => { asks.push(args); return { status: outcome }; },
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
const HELP = 'Report not accurate? Your coach will come and see your class';
const NOTE = `data:audio/webm;base64,${Buffer.from('opus-bytes').toString('base64')}`;

describe('the card', () => {
  test('C/D: "What do you think of this report?" Accurate / Not accurate, and the link to her coach, before she answers', async () => {
    const t = tok();
    const res = await req(await app({ group: 'D' }), 'GET', `/cr/${t}`);
    expect(res.body).toContain('What do you think of this report?');
    expect(res.body).toContain('>Accurate<');
    expect(res.body).toContain('>Not accurate<');
    expect(res.body).not.toContain('useful to you');
    expect(res.body).toContain(HELP);
    expect(res.body).toContain(`href="/cr/${t}/coach"`);
  });

  test('C/D: No is stored as don’t agree and opens the reasons; Yes thanks her', async () => {
    const t = tok();
    const srv = await app();
    const no = await req(srv, 'POST', `/cr/${t}/useful`, { useful: 'no' });
    expect(no.status).toBe(303);
    expect(no.headers.location).toBe(`/cr/${t}/coach`);
    const yes = await req(srv, 'POST', `/cr/${t}/useful`, { useful: 'yes' });
    expect(yes.headers.location).toBe(`/cr/${t}?useful=yes`);
    expect(thumbs).toEqual([{ sessionId: S, userId: U, useful: false }, { sessionId: S, userId: U, useful: true }]);
    expect((await req(srv, 'GET', yes.headers.location)).body).toContain('Thank you.');
  });

  test.each(['A', 'B', null])('group %s (or switch off): no link, No asks a line, and the reasons page is not there', async (g) => {
    const t = tok();
    const srv = await app({ group: g });
    expect((await req(srv, 'GET', `/cr/${t}`)).body).not.toContain(HELP);
    expect((await req(srv, 'POST', `/cr/${t}/useful`, { useful: 'no' })).headers.location).toBe(`/cr/${t}?useful=no`);
    expect((await req(srv, 'GET', `/cr/${t}/coach`)).status).toBe(404);
    expect((await req(srv, 'POST', `/cr/${t}/coach`, { reason: 'score' })).status).toBe(404);
    expect(asks).toEqual([]);
  });

  test('once she has sent it, the card says so and does not ask again', async () => {
    const res = await req(await app(), 'GET', `/cr/${tok()}?coach=sent`);
    expect(res.body).toContain('✓ Your coach has been told and will come to see your class.');
    expect(res.body).not.toContain('What do you think of this report?');
  });
});

describe('the reasons page', () => {
  test('four reasons to tick, a voice note up to 20 s, Send to my coach; no coach list for one coach', async () => {
    const t = tok();
    const res = await req(await app(), 'GET', `/cr/${t}/coach`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toContain(`<form method="post" action="/cr/${t}/coach"`);
    expect(res.body).toContain('What wasn’t right? Choose all that apply.');
    for (const v of ['score', 'missed', 'wont_work', 'unclear']) expect(res.body).toContain(`type="checkbox" name="reason" value="${v}"`);
    expect(res.body).toContain('I did this, but the report missed it');
    expect(res.body).toContain('🎙 Record a voice note (optional)');
    expect(res.body).toContain('accept="audio/*"');
    expect(res.body).toContain('data-max-seconds="20"');
    expect(res.body).toContain('Send to my coach');
    // bd-v0toag.80: Cancel submits the form (keeps her ticked reasons) rather than linking back to the card
    expect(res.body).toContain('name="cancel" value="1" formnovalidate>Cancel</button>');
    expect(res.body).not.toContain('name="coach"');
    expect(emitted).toContainEqual({ e: 'coaching.coach_ping.asked', d: { coachingSessionId: S, userId: U, group: 'C', coaches: 1 } });
  });

  test('two coaches: she picks one', async () => {
    const res = await req(await app({ coaches: TWO }), 'GET', `/cr/${tok()}/coach`);
    expect(res.body).toContain(`name="coach" value="${C2}"`);
    expect(res.body).toContain('Bilal Ahmed');
  });

  test('in Urdu for an Urdu teacher', async () => {
    const res = await req(await app({ view: { ...VIEW, language: 'ur' } }), 'GET', `/cr/${tok()}/coach`);
    expect(res.body).toContain('dir="rtl"');
    expect(res.body).toContain('کیا ٹھیک نہیں لگا؟ جو جو درست ہو، چنیں۔');
    expect(res.body).toContain('کوچ کو بھیجیں');
  });
});

describe('Send to my coach', () => {
  test('her reasons (only known ones) and voice note go once to her coach, then back to the card', async () => {
    const t = tok();
    const srv = await app({ group: 'D' });
    const body = new URLSearchParams([['reason', 'score'], ['reason', 'missed'], ['reason', 'bogus'], ['note', NOTE]]).toString();
    const res = await new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: `/cr/${t}/coach`, method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } },
      (x) => { x.resume(); x.on('end', () => resolve(x)); });
      r.end(body);
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/cr/${t}?coach=sent`);
    expect(asks).toHaveLength(1);
    expect(asks[0]).toEqual({ sessionId: S, userId: U, group: 'D', coachId: null, reasons: ['score', 'missed'],
      note: { buffer: Buffer.from('opus-bytes'), type: 'audio/webm' } });
    expect(emitted).toContainEqual({ e: 'coaching.coach_ping.sent', d: { coachingSessionId: S, userId: U, group: 'D', reasons: ['score', 'missed'], note: true } });
    expect(JSON.stringify(emitted)).not.toContain(t);
  });

  test('a note that is not audio is left off; the picked coach is passed on', async () => {
    await req(await app({ coaches: TWO }), 'POST', `/cr/${tok()}/coach`, { reason: 'unclear', coach: C2, note: 'data:text/html;base64,PGI+' });
    expect(asks[0]).toEqual(expect.objectContaining({ coachId: C2, reasons: ['unclear'], note: undefined }));
  });

  test('nothing ticked and no note: back to the reasons page, nobody pinged', async () => {
    const t = tok();
    const res = await req(await app(), 'POST', `/cr/${t}/coach`, { reason: 'bogus' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/cr/${t}/coach`);
    expect(asks).toEqual([]);
  });

  test.each([['failed', 'We could not reach your coach just now'], ['no_coach', 'We could not find a coach for your school']])(
    'outcome %s: the card says so', async (outcome, text) => {
      const t = tok();
      const srv = await app({ outcome });
      const res = await req(srv, 'POST', `/cr/${t}/coach`, { reason: 'score' });
      expect(res.headers.location).toBe(`/cr/${t}?coach=${outcome}`);
      expect((await req(srv, 'GET', res.headers.location)).body).toContain(text);
    },
  );
});
