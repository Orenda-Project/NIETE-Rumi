'use strict';
/**
 * v10 coaching test (bd-v0toag.49, part 2): "Do you agree with this report?" on group C and D's
 * report page /cr/:token, the same question, in the same words, that A and B get on WhatsApp, so the four
 * groups compare. Answered with a POST form (a link preview never fires a GET answer), stored in the same
 * coaching_quality_metrics columns (1 = 👍, 0 = 👎, the reason in user_feedback) and logged as
 * coaching.useful.answered with the group. Real Express over HTTP; the writer and group lookup are injected
 * (the default ones are tested at the bottom).
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
let emitted;
let writes;

const VIEW = {
  language: 'en',
  session: { id: S, created_at: '2026-10-19T05:30:00Z', analysis_data: {}, prioritized_action: { action: 'Ask two children by name.' } },
  quizMessage: null,
  firstName: 'Sadia',
  trend: [],
};

beforeEach(() => {
  jest.resetModules();
  emitted = [];
  writes = [];
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co' };
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date('2026-10-19T08:00:00Z'));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ view = VIEW, group = 'C', record = async () => true } = {}) {
  const a = express();
  a.use(require('../../dashboard/routes/coaching-report.routes').createCoachingReportRouter({
    load: async () => (typeof view === 'function' ? view() : view),
    groupOf: async () => group,
    recordUseful: async (args) => { writes.push(args); return record(args); },
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

describe('the card asks', () => {
  test('the WhatsApp question, word for word, as a POST form with the two WhatsApp answers', async () => {
    const t = tok();
    const res = await req(await app(), 'GET', `/cr/${t}`);
    expect(res.body).toContain('What do you think of this report?');
    expect(res.body).toContain(`<form method="post" action="/cr/${t}/useful"`);
    expect(res.body).toContain('name="useful" value="yes"');
    expect(res.body).toContain('>Accurate<');
    expect(res.body).toContain('name="useful" value="no"');
    expect(res.body).toContain('>Not accurate<');
    expect(emitted).toContainEqual({ e: 'coaching.useful.asked', d: { coachingSessionId: S, userId: U, group: 'C', channel: 'page' } });
  });

  test('in Urdu for an Urdu teacher, the same words as WhatsApp', async () => {
    const res = await req(await app({ view: { ...VIEW, language: 'ur' } }), 'GET', `/cr/${tok()}`);
    expect(res.body).toContain('اس رپورٹ کے بارے میں آپ کی کیا رائے ہے؟');
  });

  test('the detail screen does not ask', async () => {
    const res = await req(await app(), 'GET', `/cr/${tok()}/detail`);
    expect(res.body).not.toContain('What do you think of this report?');
    expect(emitted.map((x) => x.e)).not.toContain('coaching.useful.asked');
  });
});

describe('the answer', () => {
  test('👍: stored as 1, logged with the group, back to the card (303) where it says thanks and no longer asks', async () => {
    const srv = await app();
    const t = tok();
    const res = await req(srv, 'POST', `/cr/${t}/useful`, { useful: 'yes' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/cr/${t}?useful=yes`);
    expect(writes).toEqual([{ sessionId: S, userId: U, useful: true }]);
    expect(emitted).toContainEqual({ e: 'coaching.useful.answered', d: { coachingSessionId: S, userId: U, useful: true, group: 'C', channel: 'page' } });
    const card = await req(srv, 'GET', res.headers.location);
    expect(card.body).toContain('Thank you.');
    expect(card.body).not.toContain('What do you think of this report?');
  });

  // C and D's 👎 opens the coach ping instead (bd-v0toag.38.9-agree-ping-page.test.js).
  test('👎 (outside C and D): stored as 0; the card asks what wasn’t right, with a POST form for one line', async () => {
    const srv = await app({ group: 'A' });
    const t = tok();
    const res = await req(srv, 'POST', `/cr/${t}/useful`, { useful: 'no' });
    expect(res.headers.location).toBe(`/cr/${t}?useful=no`);
    expect(writes).toEqual([{ sessionId: S, userId: U, useful: false }]);
    expect(emitted).toContainEqual({ e: 'coaching.useful.answered', d: { coachingSessionId: S, userId: U, useful: false, group: 'A', channel: 'page' } });
    const card = await req(srv, 'GET', res.headers.location);
    expect(card.body).toContain('Thanks for telling us. What wasn’t accurate? (one line is enough)');
    expect(card.body).toContain('name="reason"');
  });

  test('the reason: stored trimmed and capped, never logged, then thanks', async () => {
    const srv = await app();
    const t = tok();
    const res = await req(srv, 'POST', `/cr/${t}/useful`, { reason: `  too long ${'x'.repeat(2000)}` });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/cr/${t}?useful=done`);
    expect(writes).toHaveLength(1);
    expect(writes[0].reason.startsWith('too long')).toBe(true);
    expect(writes[0].reason.length).toBe(1000);
    expect(JSON.stringify(emitted)).not.toContain('too long');
    const card = await req(srv, 'GET', res.headers.location);
    expect(card.body).toContain('Got it, thank you — this makes the next report better.');
  });

  test.each([[{}], [{ useful: 'maybe' }], [{ reason: '   ' }]])('nothing usable %j: nothing stored, back to the card', async (form) => {
    const t = tok();
    const res = await req(await app(), 'POST', `/cr/${t}/useful`, form);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/cr/${t}`);
    expect(writes).toEqual([]);
  });

  test('a bad link: 404, nothing stored; an expired one goes to sign-in', async () => {
    const srv = await app();
    expect((await req(srv, 'POST', '/cr/not-a-token/useful', { useful: 'yes' })).status).toBe(404);
    const t = tok();
    jest.setSystemTime(new Date('2027-03-01T00:00:00Z'));
    const res = await req(srv, 'POST', `/cr/${t}/useful`, { useful: 'yes' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/portal/login');
    expect(writes).toEqual([]);
  });

  test('a failed write: the error page, not a thank-you', async () => {
    const res = await req(await app({ record: async () => false }), 'POST', `/cr/${tok()}/useful`, { useful: 'yes' });
    expect(res.status).toBe(503);
    expect(emitted.map((x) => x.e)).not.toContain('coaching.useful.answered');
  });

  test('a GET on the answer path stores nothing (link previews)', async () => {
    const res = await req(await app(), 'GET', `/cr/${tok()}/useful?useful=yes`);
    expect(writes).toEqual([]);
    expect(res.status).not.toBe(303);
  });
});

describe('default writer and group lookup', () => {
  function supa(tables) {
    const ops = [];
    const from = (t) => {
      const filters = [];
      const c = {
        select: () => c, eq: (k, v) => { filters.push([k, v]); return c; },
        maybeSingle: async () => ({ data: tables[t] === undefined ? null : tables[t], error: null }),
        limit: async () => ({ data: tables[t] === undefined ? [] : [tables[t]], error: null }),
        update: (p) => { ops.push([t, 'update', p, filters]); return c; },
        insert: async (r) => { ops.push([t, 'insert', r]); return { error: null }; },
        then: (ok, bad) => Promise.resolve({ error: null }).then(ok, bad),
      };
      return c;
    };
    return { from, ops };
  }

  test('👍 on a session with no metrics row yet: inserted with 1', async () => {
    const db = supa({ coaching_sessions: { id: S } });
    const { recordUseful: rec } = require('../../dashboard/services/coaching-useful');
    expect(await rec(db, { sessionId: S, userId: U, useful: true })).toBe(true);
    expect(db.ops).toEqual([['coaching_quality_metrics', 'insert', expect.objectContaining({ coaching_session_id: S, user_satisfaction_rating: 1 })]]);
  });

  test('a reason on an existing row: updated, only user_feedback', async () => {
    const db = supa({ coaching_sessions: { id: S }, coaching_quality_metrics: { id: 7 } });
    const { recordUseful: rec } = require('../../dashboard/services/coaching-useful');
    expect(await rec(db, { sessionId: S, userId: U, reason: 'shorter' })).toBe(true);
    expect(db.ops).toEqual([['coaching_quality_metrics', 'update', { user_feedback: 'shorter' }, [['coaching_session_id', S]]]]);
  });

  test('not her session: nothing written', async () => {
    const db = supa({});
    const { recordUseful: rec } = require('../../dashboard/services/coaching-useful');
    expect(await rec(db, { sessionId: S, userId: U, useful: false })).toBe(false);
    expect(db.ops).toEqual([]);
  });

  test('group: only while ab_v10_enabled is on and the school is drawn; anything else null', async () => {
    const { groupOf: g } = require('../../dashboard/services/coaching-useful');
    const on = { app_settings: { value: 'true' }, users: { school_id: 'sch1' }, niete_coaching_ab_assignment: { ab_group: 'C' } };
    expect(await g(supa(on), U)).toBe('C');
    expect(await g(supa({ ...on, app_settings: { value: 'false' } }), U)).toBeNull();
    expect(await g(supa({ ...on, niete_coaching_ab_assignment: null }), U)).toBeNull();
    expect(await g({ from: () => { throw new Error('down'); } }, U)).toBeNull();
  });
});
