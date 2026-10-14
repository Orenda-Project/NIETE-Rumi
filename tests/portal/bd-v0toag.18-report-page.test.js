'use strict';
/**
 * v10 coaching test (bd-v0toag.18): GET /cr/:token, group C and D's report page on the portal.
 * One report, read-only, from a link that lasts; an expired link goes to sign-in, never a dead page.
 * Real Express over HTTP; the data loader is injected (the default one is tested at the bottom).
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
let emitted;

const VIEW = {
  language: 'en',
  session: {
    id: S,
    created_at: '2026-10-19T05:30:00Z',
    analysis_data: {
      subject: 'Maths', topic: 'Adding <tens>',
      domains: { lesson_plan_fidelity: { domain_score: 26, domain_max: 40 } },
      report_narrative: { domain_whys: { lesson_plan_fidelity: 'Order kept, game not played.' } },
    },
    prioritized_action: { action: 'Ask two children by name.', thing_to_try: { text: 'In pairs, students solve Q1.', tag: 'C9' } },
    report_pdf_url: 'https://r2.example.com/reports/u/s_report.png',
    voice_debrief_url: 'https://r2.example.com/voice/s.ogg',
  },
  quizMessage: 'Class 2, try this quiz: https://portal.example.pk/q/ABC123',
  firstName: 'Sadia',
  trend: [{ pct: 40 }, { pct: 72 }, { pct: 61 }],
};

beforeEach(() => {
  jest.resetModules();
  emitted = [];
  // CI installs the root and bot packages only; the dashboard's limiter is mocked, as the other portal tests do.
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service',() => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', WHATSAPP_BOT_NUMBER: '+92 322 2482222' };
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date('2026-10-19T08:00:00Z'));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

let loads;
async function app(view = VIEW) {
  loads = [];
  const a = express();
  a.use(require('../../dashboard/routes/coaching-report.routes').createCoachingReportRouter({
    load: async (sessionId, userId) => { loads.push([sessionId, userId]); return typeof view === 'function' ? view() : view; },
  }));
  a.use((_q, res) => res.status(418).send('fell through'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const get = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject);
});
const tok = (s = S, u = U) => require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: s, userId: u });

test('a good link: that report, for that teacher, private and no-store', async () => {
  const res = await get(await app(), `/cr/${tok()}`);
  expect(res.status).toBe(200);
  expect(loads).toEqual([[S, U]]);
  expect(res.headers['cache-control']).toMatch(/no-store/);
  expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  expect(res.headers['referrer-policy']).toBe('no-referrer');
  expect(res.body).toContain('In pairs, students solve Q1.');
  expect(res.body).toContain('Maths');
  expect(res.body).toContain('Adding &lt;tens&gt;');
  expect(res.body).not.toContain('<tens>');
  expect(res.body).toContain('<img src="https://r2.example.com/reports/u/s_report.png"');
  expect(res.body).toContain('<audio controls src="https://r2.example.com/voice/s.ogg"');
  expect(res.body).toContain('19 Oct 2026');
});

test('student quiz: its forwardable message and a WhatsApp share button', async () => {
  const res = await get(await app(), `/cr/${tok()}`);
  expect(res.body).toContain('Class 2, try this quiz');
  expect(res.body).toContain(`https://wa.me/?text=${encodeURIComponent(VIEW.quizMessage)}`);
});

test('plan link opens this environment\'s bot asking for a lesson plan', async () => {
  const res = await get(await app(), `/cr/${tok()}`);
  expect(res.body).toContain(`https://wa.me/923222482222?text=${encodeURIComponent('lesson plan')}`);
});

test('no thing to try: the action is the move; no quiz, voice, image or bot number: those parts are left out', async () => {
  delete process.env.WHATSAPP_BOT_NUMBER; delete process.env.REFERRAL_BOT_NUMBER;
  const view = { language: 'en', session: { ...VIEW.session, prioritized_action: { action: 'Ask two children by name.' }, report_pdf_url: null, voice_debrief_url: null }, quizMessage: null };
  const res = await get(await app(view), `/cr/${tok()}`);
  expect(res.status).toBe(200);
  expect(res.body).toContain('Ask two children by name.');
  expect(res.body).not.toContain('<img');
  expect(res.body).not.toContain('<audio');
  expect(res.body).not.toContain('wa.me');
});

test('a report stored as a PDF is a link, not an image; a non-https url is dropped', async () => {
  const view = { ...VIEW, session: { ...VIEW.session, report_pdf_url: 'https://r2.example.com/r.pdf', voice_debrief_url: 'javascript:alert(1)' } };
  const res = await get(await app(view), `/cr/${tok()}`);
  expect(res.body).toContain('href="https://r2.example.com/r.pdf"');
  expect(res.body).not.toContain('<img');
  expect(res.body).not.toContain('javascript:');
});

test('Urdu teacher: Urdu page, right to left', async () => {
  const res = await get(await app({ ...VIEW, language: 'ur' }), `/cr/${tok()}`);
  expect(res.body).toContain('lang="ur" dir="rtl"');
  expect(res.body).toContain('کل ایک کام آزمائیں');
});

test('expired: 302 to sign-in, nothing loaded', async () => {
  const srv = await app();
  const t = tok();
  jest.setSystemTime(new Date('2027-03-01T00:00:00Z'));
  const res = await get(srv, `/cr/${t}`);
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/portal/login');
  expect(loads).toEqual([]);
  expect(emitted).toEqual([{ e: 'coaching.report_page.open', d: { outcome: 'expired' } }]);
});

test.each([['/cr/not-a-token'], ['/cr/abc.defghijklmnopqrstuvwxyz']])('bad link %s: 404 page, nothing loaded', async (path) => {
  const res = await get(await app(), path);
  expect(res.status).toBe(404);
  expect(res.body).toContain('This link is not complete');
  expect(loads).toEqual([]);
});

test('not her session (loader finds nothing): the same 404 page, no data', async () => {
  const res = await get(await app(null), `/cr/${tok()}`);
  expect(res.status).toBe(404);
  expect(res.body).not.toContain('Maths');
  expect(emitted[0]).toEqual({ e: 'coaching.report_page.open', d: { outcome: 'not_found', sessionId: S, userId: U } });
});

test('a failed read: 503 page, never a stack trace', async () => {
  const res = await get(await app(() => { throw new Error('db down'); }), `/cr/${tok()}`);
  expect(res.status).toBe(503);
  expect(res.body).not.toContain('db down');
});

test('detailed screen: same link + /detail, sections and journey, back to the card', async () => {
  const t = tok();
  const res = await get(await app(), `/cr/${t}/detail`);
  expect(res.status).toBe(200);
  expect(loads).toEqual([[S, U]]);
  expect(res.headers['cache-control']).toMatch(/no-store/);
  expect(res.body).toContain('Lesson Plan Fidelity');
  expect(res.body).toContain('Order kept, game not played.');
  expect(res.body).toContain(`href="/cr/${t}"`);
  expect(emitted).toEqual([{ e: 'coaching.report_page.open', d: { outcome: 'ok', sessionId: S, userId: U, language: 'en', screen: 'detail' } }]);
});

test('the card links to its detailed screen', async () => {
  const t = tok();
  const res = await get(await app(), `/cr/${t}`);
  expect(res.body).toContain(`href="/cr/${t}/detail"`);
  expect(res.body).toContain('Sadia');
});

test('detailed screen with a bad or expired link: same answers as the card', async () => {
  expect((await get(await app(), '/cr/not-a-token/detail')).status).toBe(404);
  const srv = await app();
  const t = tok();
  jest.setSystemTime(new Date('2027-03-01T00:00:00Z'));
  const res = await get(srv, `/cr/${t}/detail`);
  expect(res.status).toBe(302);
  expect(loads).toEqual([]);
});

test('an open is logged with the session and teacher, never the token', async () => {
  const t = tok();
  await get(await app(), `/cr/${t}`);
  expect(emitted).toEqual([{ e: 'coaching.report_page.open', d: { outcome: 'ok', sessionId: S, userId: U, language: 'en', screen: 'card' } }]);
  expect(JSON.stringify(emitted)).not.toContain(t.split('.')[1]);
});

describe('default loader', () => {
  function supa(tables) {
    const calls = [];
    const from = (t) => {
      const filters = [];
      const c = {
        select: () => c, order: () => c, limit: () => c,
        eq: (k, v) => { filters.push([k, v]); return c; },
        maybeSingle: async () => { calls.push([t, filters]); return { data: tables[t] === undefined ? null : tables[t], error: null }; },
        then: (ok, bad) => { calls.push([`${t}[]`, filters]); return Promise.resolve({ data: tables[`${t}[]`] || [], error: null }).then(ok, bad); },
      };
      return c;
    };
    return { from, calls };
  }

  test('reads the session only for its own teacher, her name, language, past scores and the session\'s quiz', async () => {
    const db = supa({
      coaching_sessions: VIEW.session,
      'coaching_sessions[]': [
        { created_at: '2026-10-19T05:30:00Z', analysis_data: { scores: { overall_percentage: 61 } } },
        { created_at: '2026-10-10T05:30:00Z', analysis_data: {} },
        { created_at: '2026-10-01T05:30:00Z', analysis_data: { scores: { overall_percentage: '72.4' } } },
      ],
      users: { preferred_language: 'ur', first_name: 'Sadia' },
      quizzes: { meta: { share_code_id: 'x', student_message: 'hello class' } },
    });
    const { loadReport } = require('../../dashboard/routes/coaching-report.routes');
    const out = await loadReport(db, S, U);
    expect(out).toEqual({
      session: VIEW.session, language: 'ur', quizMessage: 'hello class', firstName: 'Sadia',
      trend: [{ created_at: '2026-10-01T05:30:00Z', pct: 72.4 }, { created_at: '2026-10-19T05:30:00Z', pct: 61 }],
    });
    expect(db.calls[0]).toEqual(['coaching_sessions', [['id', S], ['user_id', U]]]);
    expect(db.calls).toContainEqual(['coaching_sessions[]', [['user_id', U], ['status', 'completed']]]);
    expect(db.calls).toContainEqual(['quizzes', [['coaching_session_id', S]]]);
  });

  test('no session: null; a missing quiz or language is fine', async () => {
    const { loadReport } = require('../../dashboard/routes/coaching-report.routes');
    expect(await loadReport(supa({}), S, U)).toBeNull();
    const out = await loadReport(supa({ coaching_sessions: VIEW.session }), S, U);
    expect(out).toEqual({ session: VIEW.session, language: 'en', quizMessage: null, firstName: null, trend: [] });
  });
});
