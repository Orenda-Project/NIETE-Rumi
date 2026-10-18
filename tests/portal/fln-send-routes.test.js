'use strict';
/**
 * PR-E (m-links) — GET /api/portal/fln/teachers and POST /api/portal/fln/send.
 *
 * Real Express over HTTP and the real chain: portal route → real getPatchTeachers (leader-patch.service, the scope
 * the portal's My Patch uses) → real keyed ids → HTTP to an in-process BOT app running the real
 * internal-fln-send route + fln-send.service + token module. Mocked at the boundaries only: the pg `query` (rows
 * shaped like the patch SQL's output), the corpus (m-app's fln-corpus.service, not on this branch), WhatsAppService
 * and the window check (the Graph API / DB), supabase (users lookup + event insert).
 *
 * `dashboard/lib/fln-access.js` (m-app, commit c4a2c874f) is NOT on this branch, so `requireFln` is a FAITHFUL STUB
 * of that file: share = [noStore, requirePortalAuth (401), gate('share') (404 when false, else req.fln = access)].
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const KEY = 'test-internal-key';
const LEADER = '99999999-9999-4999-8999-999999999999';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const OUT = '44444444-4444-4444-8444-444444444444';
const PHONES = { [T1]: '920000000001', [T2]: '920000000002', [OUT]: '920000000004' };

let access; let WA; let inserted; let servers = []; let sql; let corpus; let botCalls;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: KEY, SUPABASE_URL: 'https://envone.supabase.co', PORTAL_URL: 'https://portal.example.test' };
  access = { lessons: true, share: true, role: 'coach', ui_lang: 'en' };
  inserted = []; sql = []; botCalls = 0;
  corpus = {
    ensure: jest.fn(async () => true), // the real service's shape (PR-C): lazy load first
    isHidden: jest.fn(async (id) => String(id) === '999'),
    plan: jest.fn(async (id) => (String(id) === '404404' ? null : { id: Number(id), title: 'Sounds of c/k', lang: 'en' })),
  };
  WA = { sendCtaUrl: jest.fn(async () => true), sendTemplate: jest.fn(async () => true) };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => WA);
  jest.doMock('../../bot/shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: jest.fn(async () => false) }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => ({
      insert: async (row) => { inserted.push({ table, row }); return { error: null }; },
      select: () => ({ in: async (_c, ids) => ({ data: ids.map((id) => ({ id, phone_number: PHONES[id], preferred_language: 'en', deleted_at: null })), error: null }) }),
    }),
  }));
});
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
afterAll(() => { process.env = ENV; });

// The faithful stub of dashboard/lib/fln-access.js @ c4a2c874f.
function flnAccessStub() {
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const requirePortalAuth = (req, res, next) => {
    if (!req.session || !req.session.portalUserId) return res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
    return next();
  };
  const gate = (what) => (req, res, next) => {
    if (!access[what]) return res.status(404).json({ error: 'not_found' });
    req.fln = access; return next();
  };
  return { requireFln: Object.freeze({ lessons: [noStore, requirePortalAuth, gate('lessons')], share: [noStore, requirePortalAuth, gate('share')] }) };
}

// The patch SQL's columns for one person (leader-patch.service PATCH_SELECT).
const row = (id, name, extra = {}) => ({
  teacher_ext_id: PHONES[id], name, phone: PHONES[id], school_ext_id: 'niete:501', role: 'teacher',
  rumi_user_id: id, school_name: 'Model School 501', ...extra,
});
const PATCH = [
  row(T1, 'Teacher One'), row(T2, 'Teacher Two'),
  row(LEADER, 'The Leader', { role: 'teacher' }), // the leader in their own school list: never a recipient
  { ...row('x', 'Not On Rumi'), rumi_user_id: null }, // off Rumi: nobody to message
  row('55555555-5555-4555-8555-555555555555', 'A Principal', { role: 'principal' }),
];
const query = async (text, params) => { sql.push({ text, params }); return { rows: PATCH }; };

async function listen(a) {
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv); return srv;
}
async function bot() {
  const a = express(); a.use(express.json());
  a.use('/api/internal', require('../../bot/shared/routes/internal-fln-send.routes'));
  return listen(a);
}
async function portal({ signedIn = true, botSrv = null } = {}) {
  const b = botSrv || await bot();
  const a = express();
  a.use((req, _res, next) => { req.session = signedIn ? { portalUserId: LEADER } : {}; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-fln-send.routes').createFlnSendRouter({
    requireFln: flnAccessStub().requireFln, query, corpus,
    botUrl: `http://127.0.0.1:${b.address().port}`,
    httpPost: async (url, body, opts) => { botCalls += 1; return require('../../tests/routes/_http-post')(url, body, opts); },
  }));
  return listen(a);
}
const req = (srv, method, path, body) => new Promise((resolve, reject) => {
  const data = body == null ? '' : JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b ? JSON.parse(b) : null }));
  });
  r.on('error', reject); r.end(data);
});
const keyOf = (id) => require('../../bot/shared/services/fln-keys').teacherKey(id);

describe('GET /fln/teachers', () => {
  test('the leader\'s own scope via getPatchTeachers(role): keyed ids, names, school — no phone, no uuid', async () => {
    const res = await req(await portal(), 'GET', '/api/portal/fln/teachers');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ teachers: [
      { key: keyOf(T1), name: 'Teacher One', school: 'Model School 501' },
      { key: keyOf(T2), name: 'Teacher Two', school: 'Model School 501' },
    ] });
    expect(sql[0].params).toEqual([LEADER]);
    expect(sql[0].text).toMatch(/leader_schools/); // coach → the leader_schools patch (patchSqlFor)
    const raw = JSON.stringify(res.body);
    for (const bad of [T1, T2, PHONES[T1], PHONES[T2]]) expect(raw).not.toContain(bad);
  });

  test('a principal\'s scope is the principal\'s own school (PRINCIPAL_PATCH_SQL)', async () => {
    access.role = 'principal';
    await req(await portal(), 'GET', '/api/portal/fln/teachers');
    expect(sql[0].text).toMatch(/me\.role = 'principal'/);
  });

  test('?q= filters by name, case-insensitive', async () => {
    const res = await req(await portal(), 'GET', '/api/portal/fln/teachers?q=two');
    expect(res.body.teachers.map((t) => t.name)).toEqual(['Teacher Two']);
  });

  test('404 for a non-leader (share off), 401 signed out — both no-store', async () => {
    access = { lessons: true, share: false, role: 'teacher', ui_lang: 'en' };
    const r404 = await req(await portal(), 'GET', '/api/portal/fln/teachers');
    expect(r404.status).toBe(404);
    expect(r404.headers['cache-control']).toBe('no-store');
    const r401 = await req(await portal({ signedIn: false }), 'GET', '/api/portal/fln/teachers');
    expect(r401.status).toBe(401);
    expect(r401.headers['cache-control']).toBe('no-store');
    expect(sql).toHaveLength(0);
  });
});

describe('POST /fln/send', () => {
  test('happy path: one bot message per recipient, each with its own token; {queued, failed}; no-store', async () => {
    const res = await req(await portal(), 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [keyOf(T1), keyOf(T2)] });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ queued: 2, failed: [] });
    expect(botCalls).toBe(1);
    expect(WA.sendTemplate).toHaveBeenCalledTimes(2);
    const link = require('../../bot/shared/services/app-login-link');
    expect(WA.sendTemplate.mock.calls.map((c) => [c[0], link.verifyAppLink(c[3][1].parameters[0].text).u]))
      .toEqual([[PHONES[T1], T1], [PHONES[T2], T2]]);
    expect(inserted.map((i) => i.row.kind)).toEqual(['send', 'send']);
  });

  test('a key outside the leader\'s scope → 403, nothing sent, no token minted', async () => {
    const link = require('../../bot/shared/services/app-login-link');
    const spy = jest.spyOn(link, 'signAppLink');
    const res = await req(await portal(), 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [keyOf(T1), keyOf(OUT)] });
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(botCalls).toBe(0);
    expect(WA.sendTemplate).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  test('the leader\'s own key and a principal are not sendable (403)', async () => {
    for (const k of [keyOf(LEADER), keyOf('55555555-5555-4555-8555-555555555555')]) {
      const res = await req(await portal(), 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [k] });
      expect(res.status).toBe(403);
    }
    expect(botCalls).toBe(0);
  });

  test('more than 30 keys → 400; a malformed body → 400', async () => {
    const many = Array.from({ length: 31 }, (_, i) => i.toString(16).padStart(16, '0'));
    const srv = await portal();
    expect((await req(srv, 'POST', '/api/portal/fln/send', { plan: 11156, teachers: many })).status).toBe(400);
    expect((await req(srv, 'POST', '/api/portal/fln/send', { plan: 'abc', teachers: [keyOf(T1)] })).status).toBe(400);
    expect((await req(srv, 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [] })).status).toBe(400);
    expect((await req(srv, 'POST', '/api/portal/fln/send', { plan: 11156, teachers: ['zz'] })).status).toBe(400);
    expect(botCalls).toBe(0);
  });

  test('a hidden or unknown plan → 404, nothing sent', async () => {
    const srv = await portal();
    const hidden = await req(srv, 'POST', '/api/portal/fln/send', { plan: 999, teachers: [keyOf(T1)] });
    expect(hidden.status).toBe(404);
    expect(hidden.headers['cache-control']).toBe('no-store');
    expect((await req(srv, 'POST', '/api/portal/fln/send', { plan: 404404, teachers: [keyOf(T1)] })).status).toBe(404);
    expect(botCalls).toBe(0);
  });

  test('404 for a non-leader', async () => {
    access = { lessons: true, share: false, role: 'teacher', ui_lang: 'en' };
    const res = await req(await portal(), 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [keyOf(T1)] });
    expect(res.status).toBe(404);
    expect(botCalls).toBe(0);
  });

  test('30 recipients per leader per hour: the 31st → 429 rate_limited; after the hour it opens again', async () => {
    let t = Date.parse('2026-10-18T10:00:00Z');
    const b = await bot();
    const a = express();
    a.use((rq, _res, next) => { rq.session = { portalUserId: LEADER }; next(); });
    a.use('/api/portal', require('../../dashboard/routes/portal-fln-send.routes').createFlnSendRouter({
      requireFln: flnAccessStub().requireFln, query, corpus, now: () => t,
      botUrl: `http://127.0.0.1:${b.address().port}`,
      httpPost: async (url, body, opts) => { botCalls += 1; return require('../../tests/routes/_http-post')(url, body, opts); },
    }));
    const srv = await listen(a);
    for (let i = 0; i < 15; i += 1) {
      expect((await req(srv, 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [keyOf(T1), keyOf(T2)] })).status).toBe(200);
    }
    const over = await req(srv, 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [keyOf(T1)] });
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: 'rate_limited' });
    expect(over.headers['cache-control']).toBe('no-store');
    expect(botCalls).toBe(15);
    t += 60 * 60 * 1000 + 1;
    expect((await req(srv, 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [keyOf(T1)] })).status).toBe(200);
  });

  test('the bot unreachable → 503 fln_unavailable, and the recipients do not count against the hour', async () => {
    const b = await bot();
    const a = express();
    a.use((rq, _res, next) => { rq.session = { portalUserId: LEADER }; next(); });
    let down = true;
    a.use('/api/portal', require('../../dashboard/routes/portal-fln-send.routes').createFlnSendRouter({
      requireFln: flnAccessStub().requireFln, query, corpus, botUrl: `http://127.0.0.1:${b.address().port}`,
      limiter: require('../../dashboard/routes/portal-fln-send.routes').createRecipientLimiter({ max: 2 }),
      httpPost: async (url, body, opts) => { if (down) throw new Error('ECONNREFUSED'); return require('../../tests/routes/_http-post')(url, body, opts); },
    }));
    const srv = await listen(a);
    const res = await req(srv, 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [keyOf(T1), keyOf(T2)] });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'fln_unavailable' });
    down = false;
    expect((await req(srv, 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [keyOf(T1), keyOf(T2)] })).status).toBe(200);
  });

  test('a repeated key is sent once', async () => {
    const res = await req(await portal(), 'POST', '/api/portal/fln/send', { plan: 11156, teachers: [keyOf(T1), keyOf(T1)] });
    expect(res.status).toBe(200);
    expect(WA.sendTemplate).toHaveBeenCalledTimes(1);
  });
});

test('the default requireFln comes from dashboard/lib/fln-access.js (virtual stub here: the file lands with PR-C)', async () => {
  jest.doMock('../../dashboard/lib/fln-access', () => flnAccessStub(), { virtual: true });
  const b = await bot();
  const a = express();
  a.use((rq, _res, next) => { rq.session = { portalUserId: LEADER }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-fln-send.routes').createFlnSendRouter({ query, corpus, botUrl: `http://127.0.0.1:${b.address().port}`, httpPost: require('../../tests/routes/_http-post') }));
  access.share = false;
  const res = await req(await listen(a), 'GET', '/api/portal/fln/teachers');
  expect(res.status).toBe(404);
});

// RT BLOCK #2956: m-app's real corpus service is lazy — until it has loaded, isHidden() says every id is hidden. The
// send must load it first (unloadable → 503), or every send after a restart / on a second replica is a false 404.
// Runs on PR-C's real service + fixture; skipped (and says so) on a branch without them.
const fsx = require('fs');
const pathx = require('path');
const HAS_CORPUS = fsx.existsSync(pathx.join(__dirname, '../../dashboard/services/fln-corpus.service.js'))
  && fsx.existsSync(pathx.join(__dirname, 'fixtures/fln-corpus.fixture.js'));
if (!HAS_CORPUS) console.log('fln-send-routes real corpus: skipped — PR-C fln-corpus.service.js not on this branch');
(HAS_CORPUS ? describe : describe.skip)('POST /fln/send on the REAL corpus service', () => {
  let Real;
  beforeEach(() => {
    delete process.env.FLN_CORPUS_BASE;
    delete process.env.CONTENT_R2_PUBLIC_URL; // nothing to load from: a cold ensure() resolves false
    jest.doMock('../../dashboard/config/supabase', () => ({
      from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }; return q; },
    }));
    Real = require('../../dashboard/services/fln-corpus.service');
    corpus = Real;
  });

  test('cold: 503 fln_unavailable and the bot is never called (not a false 404)', async () => {
    Real.__resetForTests();
    const res = await req(await portal(), 'POST', '/api/portal/fln/send', { plan: 900003, teachers: [keyOf(T1)] });
    expect([res.status, res.body]).toEqual([503, { error: 'fln_unavailable' }]);
    expect(botCalls).toBe(0);
  });

  test('loaded: a served plan sends; a hidden one is 404', async () => {
    Real.__setForTests(require('./fixtures/fln-corpus.fixture').build());
    const ok = await req(await portal(), 'POST', '/api/portal/fln/send', { plan: 900003, teachers: [keyOf(T1)] });
    expect(ok.status).toBe(200);
    expect(botCalls).toBe(1);
    const hidden = await req(await portal(), 'POST', '/api/portal/fln/send', { plan: 900007, teachers: [keyOf(T1)] });
    expect(hidden.status).toBe(404);
  });
});
