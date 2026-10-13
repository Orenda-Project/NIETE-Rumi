'use strict';
/**
 * bd-4r3rei — POST /api/portal/funnel/events: the one small endpoint the app's pages report to.
 * Real Express over HTTP. The telemetry sink is replaced by an array (the boundary); the session is a plain stand-in.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const NOW = Date.parse('2026-10-13T10:00:00Z');
let emitted;
beforeEach(() => {
  jest.resetModules();
  emitted = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key' };
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date(NOW));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

/** `session` = what the cookie would have restored (or null for no session at all). */
async function app({ session = { id: 'sess-1', portalUserId: USER }, limiter } = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { if (session) req.session = { ...session }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({ limiter }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const post = (srv, body, { type = 'text/plain;charset=UTF-8', path = '/api/portal/funnel/events', headers = {} } = {}) => new Promise((resolve, reject) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'POST', headers: { 'Content-Type': type, 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
  });
  req.on('error', reject); req.write(data); req.end();
});
const rows = () => emitted.filter((x) => x.e.startsWith('app_funnel.'));
const batch = (ev, extra = {}) => ({ v: 1, b: 'android-iab', ev, ...extra });
const JID = 'j_0123456789abcdef';

describe('who may report', () => {
  test('no portal session: 401, nothing logged', async () => {
    const res = await post(await app({ session: null }), batch([{ k: 'view', r: '/portal/teacher' }]));
    expect(res.status).toBe(401);
    expect(rows()).toEqual([]);
  });
  test('a session without a portal user: 401', async () => {
    const res = await post(await app({ session: { id: 's' } }), batch([{ k: 'view', r: '/portal/teacher' }]));
    expect(res.status).toBe(401);
    expect(rows()).toEqual([]);
  });
});

describe('what a good batch becomes', () => {
  test('text/plain (the beacon) and application/json (the fetch fallback) both work → 204', async () => {
    const srv = await app();
    expect((await post(srv, batch([{ k: 'view', r: '/portal/teacher' }]))).status).toBe(204);
    expect((await post(srv, batch([{ k: 'view', r: '/portal/teacher' }]), { type: 'application/json' })).status).toBe(204);
    expect(rows()).toHaveLength(2);
  });

  test('view → app_funnel.page_view with user and session-derived fields, a normalised route and its feature', async () => {
    await post(await app(), batch([{ k: 'view', r: '/portal/teacher/lessons?plan=x', pr: '/portal/teacher', age: 1500 }]));
    expect(rows()).toHaveLength(1);
    const { e, d } = rows()[0];
    expect(e).toBe('app_funnel.page_view');
    expect(d).toEqual(expect.objectContaining({
      userId: USER, journeyId: null, route: '/portal/teacher/lessons', prevRoute: '/portal/teacher', feature: 'lesson_plan',
      browser: 'browser', entry: 'session',
    }));
    expect(d.appSessionId).toMatch(/^[0-9a-f]{12}$/);
    expect(d.appSessionId).not.toContain('sess-1');
    expect(Date.parse(d._time)).toBe(NOW - 1500);
  });

  test('leave carries dwell and how she left; resume is its own event', async () => {
    await post(await app(), batch([
      { k: 'leave', r: '/portal/teacher/classes', d: 42000, why: 'hidden' },
      { k: 'resume', r: '/portal/teacher/classes' },
      { k: 'leave', r: '/portal/teacher/classes', d: 9000, why: 'pagehide' },
    ]));
    expect(rows().map((r) => r.e)).toEqual(['app_funnel.page_leave', 'app_funnel.page_resume', 'app_funnel.page_leave']);
    expect(rows()[0].d).toEqual(expect.objectContaining({ dwellMs: 42000, how: 'hidden', route: '/portal/teacher/classes' }));
    expect(rows()[2].d).toEqual(expect.objectContaining({ dwellMs: 9000, how: 'pagehide' }));
  });

  test('events keep the order the page sent them in (ages decide the time, not arrival)', async () => {
    await post(await app(), batch([
      { k: 'view', r: '/portal/teacher', age: 9000 }, { k: 'view', r: '/portal/teacher/lessons', age: 4000 }, { k: 'leave', r: '/portal/teacher/lessons', d: 4000, why: 'hidden', age: 0 },
    ]));
    const ts = rows().map((r) => Date.parse(r.d._time));
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
});

describe('the journey comes from the SESSION, never the body', () => {
  const withJourney = { id: 'sess-2', portalUserId: USER, appJourney: { id: JID, at: NOW - 60 * 1000, feature: 'lesson_plan' } };
  test('a session opened from a link: every event carries its journey, entry app_link', async () => {
    await post(await app({ session: withJourney }), batch([{ k: 'view', r: '/portal/teacher/lessons' }]));
    expect(rows()[0].d).toEqual(expect.objectContaining({ journeyId: JID, entry: 'app_link', linkFeature: 'lesson_plan' }));
  });
  test('a journey older than the link\'s 24 hours is not attributed any more', async () => {
    const old = { ...withJourney, appJourney: { id: JID, at: NOW - 25 * 3600 * 1000, feature: 'menu' } };
    await post(await app({ session: old }), batch([{ k: 'view', r: '/portal/teacher' }]));
    expect(rows()[0].d.journeyId).toBeNull();
    expect(rows()[0].d.entry).toBe('session');
  });
  test('a body that claims another user, another journey or another session changes nothing', async () => {
    await post(await app(), batch([{ k: 'view', r: '/portal/teacher', userId: 'someone-else', journeyId: 'j_ffffffffffffffff', appSessionId: 'x' }],
      { userId: 'someone-else', journeyId: 'j_ffffffffffffffff' }));
    expect(rows()[0].d.userId).toBe(USER);
    expect(rows()[0].d.journeyId).toBeNull();
    expect(rows()[0].d.appSessionId).not.toBe('x');
  });
  test('a link-area session (a template button) is marked as such and has no journey', async () => {
    await post(await app({ session: { id: 's3', portalUserId: USER, portalScope: 'training' } }), batch([{ k: 'view', r: '/portal/training' }]));
    expect(rows()[0].d).toEqual(expect.objectContaining({ entry: 'link:training', journeyId: null }));
  });
});

describe('what is refused or cleaned', () => {
  test('no ids in routes: a uuid, a number, a phone and a query all go', async () => {
    await post(await app(), batch([
      { k: 'view', r: '/portal/teacher/assessment/request/8c1f0e3a-1111-4222-8333-944455556666?x=1' },
      { k: 'view', r: '/portal/coach/visit/12345/record' },
      { k: 'view', r: '/portal/teacher/lessons/923001234567' },
    ]));
    expect(rows().map((r) => r.d.route)).toEqual([
      '/portal/teacher/assessment/request/:id', '/portal/coach/visit/:id/record', '/portal/teacher/lessons/:id',
    ]);
    expect(JSON.stringify(rows())).not.toMatch(/8c1f0e3a|12345|923001234567/);
  });
  test('events that are not portal pages, or have an unknown kind, are dropped; the rest still logs', async () => {
    const res = await post(await app(), batch([
      { k: 'view', r: 'https://evil.example/portal/teacher' }, { k: 'banana', r: '/portal/teacher' }, { k: 'view', r: '/portal/teacher/classes' }, null, 'x', 7,
    ]));
    expect(res.status).toBe(204);
    expect(rows().map((r) => r.d.route)).toEqual(['/portal/teacher/classes']);
  });
  test('absurd numbers and unknown how values are clamped, not logged raw', async () => {
    await post(await app(), { v: 1, b: '<script>', ev: [{ k: 'leave', r: '/portal/teacher', d: 9e12, why: 'because', age: -5 }] });
    const d = rows()[0].d;
    expect(d.browser).toBe('browser');
    expect(d.how).toBe('unknown');
    expect(d.dwellMs).toBeLessThanOrEqual(6 * 3600 * 1000);
    expect(Date.parse(d._time)).toBe(NOW);
  });
  test('at most 25 events per batch', async () => {
    await post(await app(), batch(Array.from({ length: 60 }, () => ({ k: 'view', r: '/portal/teacher' }))));
    expect(rows()).toHaveLength(25);
  });
  test('a body over 8 KB is refused, nothing logged', async () => {
    const res = await post(await app(), 'x'.repeat(9000));
    expect([400, 413]).toContain(res.status);
    expect(rows()).toEqual([]);
  });
  test('not JSON / not an object / empty → 400, nothing logged, never a 500', async () => {
    const srv = await app();
    for (const body of ['not json', '[]', '"s"', '', '{"ev":"nope"}']) {
      const res = await post(srv, body);
      expect(res.status).toBeLessThan(500);
    }
    expect(rows()).toEqual([]);
  });
  test('no free text lands in any logged field', async () => {
    await post(await app(), batch([{ k: 'view', r: '/portal/teacher', note: 'Ayesha Bibi 0300', name: 'Ayesha', q: 'hello' }]));
    const dump = JSON.stringify(rows());
    expect(dump).not.toMatch(/Ayesha|0300|hello/);
  });
});

describe('the browser class is the SERVER\'s call from the user agent (in-app-browser-whatsapp: the page does not decide "in-app")', () => {
  const ANDROID_WA = 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 WA4A/2.24.10.7';
  const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 13; SM-A135F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 SomeOtherApp/1.0';
  const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36';
  const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const IOS_WEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/118.0 Mobile/15E148 Safari/604.1';
  const one = async (headers, b = 'browser') => {
    emitted.length = 0;
    await post(await app(), batch([{ k: 'view', r: '/portal/teacher' }], { b }), { headers });
    return rows()[0].d.browser;
  };
  test.each([
    ['WhatsApp on Android (WA4A token)', { 'User-Agent': ANDROID_WA }, 'whatsapp-iab'],
    ['X-Requested-With com.whatsapp', { 'User-Agent': ANDROID_CHROME, 'X-Requested-With': 'com.whatsapp' }, 'whatsapp-iab'],
    ['another app\'s WebView on Android (wv but not WhatsApp)', { 'User-Agent': ANDROID_WV }, 'webview'],
    ['Chrome on Android', { 'User-Agent': ANDROID_CHROME }, 'browser'],
    ['Safari on iPhone', { 'User-Agent': IOS_SAFARI }, 'browser'],
    ['Chrome on iPhone', { 'User-Agent': IOS_CHROME }, 'browser'],
    ['an iPhone web view (no Safari token)', { 'User-Agent': IOS_WEBVIEW }, 'webview'],
    ['no user agent at all', {}, 'browser'],
  ])('%s → %s', async (_n, headers, want) => expect(await one(headers)).toBe(want));

  test('the page cannot claim to be in-app: "android-iab" from Chrome is just Chrome', async () => {
    expect(await one({ 'User-Agent': ANDROID_CHROME }, 'android-iab')).toBe('browser');
  });
  test('only the app\'s own claim "native" is believed (a label, never a way past anything)', async () => {
    expect(await one({ 'User-Agent': ANDROID_WV }, 'native')).toBe('native');
  });
  test('the user agent itself is never logged', async () => {
    await one({ 'User-Agent': ANDROID_WA });
    expect(JSON.stringify(rows())).not.toMatch(/Mozilla|SM-A135F|WA4A/);
  });
});

describe('abuse limits', () => {
  test('a session sending more requests than its allowance in a minute gets 429, the sink sees only the allowed ones', async () => {
    const srv = await app({ limiter: { windowMs: 60000, maxRequests: 3, maxEvents: 1000 } });
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await post(srv, batch([{ k: 'view', r: '/portal/teacher' }]))).status);
    expect(statuses).toEqual([204, 204, 204, 429, 429]);
    expect(rows()).toHaveLength(3);
  });
  test('a session sending too many events in a minute is cut off on events too', async () => {
    const srv = await app({ limiter: { windowMs: 60000, maxRequests: 100, maxEvents: 4 } });
    await post(srv, batch(Array.from({ length: 3 }, () => ({ k: 'view', r: '/portal/teacher' }))));
    await post(srv, batch(Array.from({ length: 3 }, () => ({ k: 'view', r: '/portal/teacher' }))));
    expect(rows().length).toBeLessThanOrEqual(4);
  });
  test('a sink that throws never changes the answer', async () => {
    jest.resetModules();
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: () => { throw new Error('down'); }, flush() {}, isEnabled: () => true }));
    const res = await post(await app(), batch([{ k: 'view', r: '/portal/teacher' }]));
    expect(res.status).toBe(204);
  });
});

// The template-button link area (dashboard/routes/portal-link.routes.js) is not on every branch yet (sandbox has it,
// staging/main do not as of 13 Oct 2026); the interaction is tested wherever the module exists.
const HAS_LINK_SCOPE = require('fs').existsSync(require('path').join(__dirname, '..', '..', 'dashboard', 'routes', 'portal-link.routes.js'));
(HAS_LINK_SCOPE ? describe : describe.skip)('a link session (a template button\'s area) is part of the journey too', () => {
  test('the link-area scope lets POST /funnel/events through and still refuses everything else outside its area', async () => {
    const { portalLinkScope } = require('../../dashboard/routes/portal-link.routes');
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.session = { id: 'sl', portalUserId: USER, portalScope: 'training' }; next(); });
    a.use('/api/portal', portalLinkScope);
    a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter());
    a.use('/api/portal', (_req, res) => res.status(200).json({ reached: true }));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    expect((await post(srv, batch([{ k: 'view', r: '/portal/training' }]))).status).toBe(204);
    expect(rows()).toHaveLength(1);
    expect((await post(srv, '{}', { path: '/api/portal/classes' })).status).toBe(403);
  });
});
