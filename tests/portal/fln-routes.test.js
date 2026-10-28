'use strict';
/**
 * Dashboard/routes/portal-fln.routes.js over real Express + HTTP (SPEC v2 §3, §5, §7).
 * Mocked: supabase (app_settings + users), the pg pool (dashboard/config/database), global fetch. Everything else —
 * fln-access, feature-flags, leader-role, lp-activity, the corpus service, app-funnel's actionLogger — is real.
 */
// These tests change app_settings rows under one shared client, sometimes mid-test, to check each value's rule.
// The flag cache would hold the first read, so it is off here; tests/portal/feature-flags-cache.test.js covers it.
process.env.FLAG_CACHE_TTL_MS = '0';
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { build, VERSION } = require('./fixtures/fln-corpus.fixture');

const ENV = { ...process.env };
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const COACH = '1a2b3c4d-0b8d-4c55-9a51-2d7f0e3b9c11';
const KEY = 'k'.repeat(40);

let settings; let users; let queries; let queryImpl; let funnel;

function supabaseStub() {
  const lookup = (table, eqs) => {
    if (table === 'app_settings') return eqs.key in settings ? { value: settings[eqs.key] } : null;
    if (table === 'users') return users[eqs.id] || null;
    return null;
  };
  return {
    from(table) {
      const eqs = {};
      const q = {
        select: () => q,
        eq: (c, v) => { eqs[c] = v; return q; },
        maybeSingle: async () => ({ data: lookup(table, eqs), error: null }),
      };
      return q;
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  process.env = { ...ENV, WEB_QUIZ_KID_KEY: KEY, FLN_CORPUS_BASE: 'https://cdn.example.test/fln/corpus' };
  settings = { portal_fln_lessons: true, fln_corpus_version: VERSION };
  users = { [TEACHER]: { id: TEACHER, role: 'teacher', preferred_language: 'en' }, [COACH]: { id: COACH, role: 'coach', preferred_language: 'ur' } };
  queries = [];
  queryImpl = async (sql) => (/FROM niete_lp_opens/i.test(sql) && /SELECT DISTINCT/i.test(sql) ? { rows: [{ plan_ref: '900004' }] } : { rows: [{ id: 1 }] });
  funnel = [];
  global.fetch = jest.fn(async () => { throw new Error('no network in this test'); });
  jest.doMock('../../dashboard/config/supabase', () => supabaseStub());
  jest.doMock('../../dashboard/config/database', () => ({ query: (sql, params) => { queries.push({ sql, params }); return queryImpl(sql, params); } }));
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => funnel.push({ e, d }), flush() {}, isEnabled: () => true }));
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

const corpus = () => require('../../dashboard/services/fln-corpus.service');

async function app({ userId = TEACHER, loaded = true, scope = null } = {}) {
  if (loaded) corpus().__setForTests(build());
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = userId ? { id: 's1', portalUserId: userId, ...(scope ? { portalScope: scope } : {}) } : {}; next(); });
  a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').actionLogger);
  const fln = require('../../dashboard/routes/portal-fln.routes');
  a.use('/api/portal', fln);
  // the SPA catch-all of dashboard/index.js, as a plain middleware (the root express here is v5: no '*' path)
  a.use((req, res) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return res.status(404).end();
    if (fln.flnPreview.wants(req)) return fln.flnPreview.send(req, res);
    return res.type('html').send('<!doctype html><div id="root"></div>');
  });
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}

const call = (srv, method, path, { body, ua } = {}) => new Promise((resolve, reject) => {
  const headers = { 'Content-Type': 'application/json' };
  if (ua) headers['User-Agent'] = ua;
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method, agent: false, headers }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { data += c; });
    res.on('end', () => setImmediate(() => {
      let json = null;
      try { json = JSON.parse(data); } catch (_) { /* html or empty */ }
      resolve({ status: res.statusCode, headers: res.headers, json, text: data });
    }));
  });
  req.on('error', reject);
  req.end(body === undefined ? undefined : JSON.stringify(body));
});

const opensWritten = () => queries.filter((q) => /INSERT INTO niete_lp_opens/.test(q.sql));
const flush = () => new Promise((r) => setTimeout(r, 20));

describe('access', () => {
  it('404 on every gated route when lessons are off — with no-store', async () => {
    settings.portal_fln_lessons = false;
    const srv = await app();
    for (const [m, p, body] of [['GET', '/api/portal/fln/catalogue?grade=1&subject=rh-en'], ['GET', '/api/portal/fln/plan/900003'], ['POST', '/api/portal/fln/events', []]]) {
      const r = await call(srv, m, p, { body });
      expect(r.status).toBe(404);
      expect(r.headers['cache-control']).toBe('no-store');
    }
    await flush();
    expect(opensWritten()).toHaveLength(0);
  });

  it('401 signed out — with no-store, /me included', async () => {
    const srv = await app({ userId: null });
    for (const p of ['/api/portal/fln/me', '/api/portal/fln/catalogue?grade=1&subject=rh-en', '/api/portal/fln/plan/900003']) {
      const r = await call(srv, 'GET', p);
      expect(r.status).toBe(401);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('/me answers flnAccess, no-store', async () => {
    const srv = await app();
    const r = await call(srv, 'GET', '/api/portal/fln/me');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json).toEqual({ lessons: true, share: false, role: 'teacher', ui_lang: 'en' });
  });

  it('a coach with portal_fln_lessons="teachers" and share on → 200 on catalogue and plan', async () => {
    settings.portal_fln_lessons = 'teachers';
    settings.portal_fln_share = true;
    const srv = await app({ userId: COACH });
    expect((await call(srv, 'GET', '/api/portal/fln/catalogue?grade=1&subject=rh-en')).status).toBe(200);
    expect((await call(srv, 'GET', '/api/portal/fln/plan/900003')).status).toBe(200);
    // and the same coach without share is shut out by "teachers"
    settings.portal_fln_share = false;
    expect((await call(srv, 'GET', '/api/portal/fln/plan/900003')).status).toBe(404);
  });
});

describe('structure (red team): every route is no-store first, authenticated, and gated', () => {
  it('walks router.stack', () => {
    const access = require('../../dashboard/lib/fln-access');
    const router = require('../../dashboard/routes/portal-fln.routes');
    const routes = router.stack.filter((l) => l.route);
    const list = routes.map((l) => `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path}`).sort();
    expect(list).toEqual(['GET /fln/catalogue', 'GET /fln/me', 'GET /fln/plan/:id', 'POST /fln/events'].sort());
    for (const l of routes) {
      const fns = l.route.stack.map((s) => s.handle);
      expect([l.route.path, fns[0]]).toEqual([l.route.path, access.noStore]);
      expect(fns).toContain(access.requirePortalAuth);
      const gated = fns.some((f) => f.name === 'requireFlnAccess');
      expect([l.route.path, gated]).toEqual([l.route.path, l.route.path !== '/fln/me']);
    }
    // PR-D (m-links) adds ONE router.use(require('./portal-fln-links.routes')) line; its own test walks that router.
  });
});

describe('GET /fln/catalogue', () => {
  it('400 for a bad grade / subject / level, no-store', async () => {
    const srv = await app();
    for (const q of ['grade=0&subject=rh-en', 'grade=13&subject=rh-en', 'grade=x&subject=rh-en', 'grade=1&subject=art', 'grade=1', 'grade=1&subject=rh-en&level=4', 'grade=1&subject=rh-en&level=a']) {
      const r = await call(srv, 'GET', `/api/portal/fln/catalogue?${q}`);
      expect([q, r.status]).toEqual([q, 400]);
      expect(r.json).toEqual({ error: 'bad_request' });
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('503 fln_unavailable when the corpus is not loaded, no-store', async () => {
    delete settings.fln_corpus_version;
    const srv = await app({ loaded: false });
    const r = await call(srv, 'GET', '/api/portal/fln/catalogue?grade=1&subject=rh-en');
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: 'fln_unavailable' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('marks opened from ONE niete_lp_opens read (kind fln, this user)', async () => {
    const srv = await app();
    const r = await call(srv, 'GET', '/api/portal/fln/catalogue?grade=1&subject=rh-en');
    expect(r.status).toBe(200);
    const reads = queries.filter((q) => /FROM niete_lp_opens/i.test(q.sql) && !/INSERT/.test(q.sql));
    expect(reads).toHaveLength(1);
    expect(reads[0].sql).toMatch(/plan_kind = 'fln'/);
    expect(reads[0].params).toEqual([TEACHER]);
    const rows = r.json.strands[0].chapters.flatMap((c) => c.plans);
    expect(rows.find((x) => x.id === 900004).opened).toBe(true);
    expect(rows.find((x) => x.id === 900003).opened).toBe(false);
    expect(rows.find((x) => x.id === 900007)).toBeUndefined();
  });

  it('a failed opened-read is "nothing opened", never a 5xx', async () => {
    queryImpl = async () => { throw new Error('db down'); };
    const srv = await app();
    const r = await call(srv, 'GET', '/api/portal/fln/catalogue?grade=1&subject=rh-en');
    expect(r.status).toBe(200);
    expect(r.json.strands[0].chapters.flatMap((c) => c.plans).every((x) => x.opened === false)).toBe(true);
  });

  it('FLN is Grades 1–5 (bd-elc1qz): grade 6–12 is 400 bad_request, with or without a level, and the corpus is not read', async () => {
    const srv = await app();
    const spy = jest.spyOn(corpus(), 'catalogue');
    for (const q of ['grade=6&subject=rh-en', 'grade=8&subject=rh-en', 'grade=12&subject=num', 'grade=8&subject=rh-en&level=3', 'grade=7&subject=rh-ur&level=1']) {
      const r = await call(srv, 'GET', `/api/portal/fln/catalogue?${q}`);
      expect([q, r.status, r.json]).toEqual([q, 400, { error: 'bad_request' }]);
      expect(r.headers['cache-control']).toBe('no-store');
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('grade 5 with level=3 (the list\'s "Other levels" chip) → 200, the grade-5 rows; level is validated, never passed on', async () => {
    const srv = await app();
    const spy = jest.spyOn(corpus(), 'catalogue');
    const r = await call(srv, 'GET', '/api/portal/fln/catalogue?grade=5&subject=rh-en&level=3');
    expect(r.status).toBe(200);
    expect(r.json.level).toBe(3);
    expect(r.json.strands[0].chapters[0].plans.map((x) => x.id)).toEqual([900009]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ grade: 5, subject: 'rh-en' });
    expect(spy.mock.calls[0][0]).not.toHaveProperty('level');
    spy.mockRestore();
  });
});

describe('GET /fln/plan/:id', () => {
  it('serves {plan, placement} with no share key, logs ONE open of kind fln with the plan lang', async () => {
    const srv = await app();
    const r = await call(srv, 'GET', '/api/portal/fln/plan/900010');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(Object.keys(r.json).sort()).toEqual(['placement', 'plan']);
    expect(r.json.plan.id).toBe(900010);
    expect(JSON.stringify(r.json)).not.toMatch(/"share"/);
    expect(r.json.placement).toEqual([{ subject: 'rh-ur', level: 1, grades: [1], grade: 1, strand: 'daily', chapter_title_en: 'Letters', chapter_title_ur: 'حروف', pos: 1, count: 1, label: null }]);
    await flush();
    const opens = opensWritten();
    expect(opens).toHaveLength(1);
    expect(opens[0].params.slice(0, 5)).toEqual([TEACHER, 'fln', '900010', 'ur', 'viewer']);
  });

  it('404 for hidden, unknown and malformed ids — and NO open logged', async () => {
    const srv = await app();
    for (const id of ['900007', '123456', 'abc', '1234567890', '12.5']) {
      const r = await call(srv, 'GET', `/api/portal/fln/plan/${id}`);
      expect([id, r.status]).toEqual([id, 404]);
      expect(r.headers['cache-control']).toBe('no-store');
    }
    await flush();
    expect(opensWritten()).toHaveLength(0);
  });

  it('503 when not loaded, and no open', async () => {
    delete settings.fln_corpus_version;
    const srv = await app({ loaded: false });
    const r = await call(srv, 'GET', '/api/portal/fln/plan/900003');
    expect(r.status).toBe(503);
    expect(r.headers['cache-control']).toBe('no-store');
    await flush();
    expect(opensWritten()).toHaveLength(0);
  });

  it('the open is logged once per GET (two GETs = two calls, the writer dedupes)', async () => {
    const srv = await app();
    await call(srv, 'GET', '/api/portal/fln/plan/900003');
    await call(srv, 'GET', '/api/portal/fln/plan/900003');
    await flush();
    expect(opensWritten()).toHaveLength(2);
    expect(opensWritten()[0].params[3]).toBe('en');
  });

  it('the app funnel logs lesson_plan.opened with lane fln (SPEC §6 row 15)', async () => {
    const srv = await app();
    await call(srv, 'GET', '/api/portal/fln/plan/900003');
    await flush();
    const acts = funnel.filter((x) => x.e === 'app_funnel.action').map((x) => x.d);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ action: 'lesson_plan.opened', feature: 'lesson_plan', lane: 'fln', status: 200 });
  });
});

describe('POST /fln/events', () => {
  const tk = (id) => crypto.createHmac('sha256', KEY).update(`t|${id}`).digest('hex').slice(0, 16);
  const UA_IAB = 'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 WhatsApp/2.24.1';
  const inserts = () => queries.filter((q) => /INSERT INTO niete_fln_events/.test(q.sql));

  it('share/link_copy/open_link → ONE multi-row insert, keyed user, ua class, 204; invalid entries and `send` dropped', async () => {
    const srv = await app();
    const r = await call(srv, 'POST', '/api/portal/fln/events', {
      ua: UA_IAB,
      body: [
        { kind: 'audio_play', plan: 900003, clip: 'zz', ms: 420, result: 'ok-mirror' },
        { kind: 'share', plan: '900004' },
        { kind: 'link_copy', plan: 900003, result: 'ok' },
        { kind: 'open_link', plan: 900003, result: 'send' },
        { kind: 'send', plan: 900003 },
        { kind: 'nope', plan: 900003 },
        { kind: 'audio_error', plan: 'x1' },
        null,
      ],
    });
    expect(r.status).toBe(204);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(inserts()).toHaveLength(1);
    const { sql, params } = inserts()[0];
    expect(sql).toMatch(/\(user_key, kind, plan_ref, clip, ms, result, ua_class\)/);
    expect(params).toEqual([
      tk(TEACHER), 'share', '900004', null, null, null, 'iab-android',
      tk(TEACHER), 'link_copy', '900003', null, null, 'ok', 'iab-android',
      tk(TEACHER), 'open_link', '900003', null, null, 'send', 'iab-android',
    ]);
    expect(params).not.toContain(TEACHER);
  });

  it('audio_play / audio_error are LOGGED as structured events, never inserted', async () => {
    const srv = await app();
    const r = await call(srv, 'POST', '/api/portal/fln/events', {
      ua: UA_IAB,
      body: [
        { kind: 'audio_play', plan: 900003, clip: 'zz', ms: 420, result: 'ok-mirror' },
        { kind: 'audio_error', plan: 900003, clip: 'zz', ms: 1500, result: 'error-429' },
      ],
    });
    expect(r.status).toBe(204);
    expect(inserts()).toHaveLength(0);
    const ev = funnel.filter((x) => /^fln\.audio\./.test(x.e));
    expect(ev).toEqual([
      { e: 'fln.audio.play', d: { tk: tk(TEACHER), plan: '900003', clip: 'zz', ms: 420, result: 'ok-mirror', ua_class: 'iab-android' } },
      { e: 'fln.audio.error', d: { tk: tk(TEACHER), plan: '900003', clip: 'zz', ms: 1500, result: 'error-429', ua_class: 'iab-android' } },
    ]);
    expect(JSON.stringify(ev)).not.toContain(TEACHER);
  });

  it('the keyed id is the one bot/shared web-quiz-kid.tk computes (same key, same domain)', () => {
    const kid = require('../../bot/shared/services/quiz/web-quiz-kid');
    const fln = require('../../dashboard/routes/portal-fln.routes');
    expect(fln.userKeyOf(TEACHER)).toBe(kid.tk(TEACHER));
    expect(fln.userKeyOf(TEACHER)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('400 for a non-array or more than 50', async () => {
    const srv = await app();
    expect((await call(srv, 'POST', '/api/portal/fln/events', { body: { kind: 'share' } })).status).toBe(400);
    const r = await call(srv, 'POST', '/api/portal/fln/events', { body: Array.from({ length: 51 }, () => ({ kind: 'share', plan: 900003 })) });
    expect(r.status).toBe(400);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(inserts()).toHaveLength(0);
  });

  it('nothing valid → 204 and no insert; a DB failure is still 204 and logs no id', async () => {
    const srv = await app();
    expect((await call(srv, 'POST', '/api/portal/fln/events', { body: [{ kind: 'send', plan: 1 }] })).status).toBe(204);
    expect(inserts()).toHaveLength(0);
    queryImpl = async () => { throw new Error('relation "niete_fln_events" does not exist'); };
    expect((await call(srv, 'POST', '/api/portal/fln/events', { body: [{ kind: 'share', plan: 900003 }] })).status).toBe(204);
    const logged = JSON.stringify(console.error.mock.calls);
    expect(logged).not.toContain(TEACHER);
  });

  it('ua classes', () => {
    const { uaClass } = require('../../dashboard/routes/portal-fln.routes');
    expect(uaClass(UA_IAB)).toBe('iab-android');
    expect(uaClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.1')).toBe('iab-ios');
    expect(uaClass('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')).toBe('chrome');
    expect(uaClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('safari');
    expect(uaClass('curl/8')).toBe('other');
    expect(uaClass(undefined)).toBe('other');
  });
});

describe('link preview /portal/fln/p/:id', () => {
  const WA = 'WhatsApp/2.24.1 A';

  it('a preview UA gets og tags (escaped), no-store, and NO open', async () => {
    const srv = await app();
    const r = await call(srv, 'GET', '/portal/fln/p/900003', { ua: WA });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.text).toContain('<meta property="og:title" content="Reading Hour · English · Level 1 — Sounds of q, x, z">');
    expect(r.text).toContain('og:description" content="Learners hear and say the sounds');
    expect(r.text).toMatch(/og:image" content="http:\/\/127\.0\.0\.1:\d+\/favicon\.png"/);
    await flush();
    expect(opensWritten()).toHaveLength(0);
  });

  it('an Urdu plan gets the Urdu kicker, escaped values', async () => {
    const srv = await app();
    const r = await call(srv, 'GET', '/portal/fln/p/900010', { ua: 'facebookexternalhit/1.1' });
    expect(r.text).toContain('og:title" content="ریڈنگ آور — اردو — سطح ۱ — حروف کی مشق ۲ اور 3"');
    expect(r.text).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(r.text).not.toContain('<b>&</b>');
  });

  it('a person, a hidden id or an unloaded corpus falls through to the SPA', async () => {
    const srv = await app();
    expect((await call(srv, 'GET', '/portal/fln/p/900003', { ua: 'Mozilla/5.0 (Linux; Android 13) Chrome/129.0' })).text).toContain('id="root"');
    expect((await call(srv, 'GET', '/portal/fln/p/900007', { ua: WA })).text).toContain('id="root"');
    corpus().__resetForTests();
    expect((await call(srv, 'GET', '/portal/fln/p/900003', { ua: WA })).text).toContain('id="root"');
  });

  it('a teacher in WhatsApp\'s in-app browser (UA carries "WhatsApp/") gets the APP, not the preview stub', async () => {
    const srv = await app();
    const iab = [
      'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 WhatsApp/2.24.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.1',
    ];
    for (const ua of iab) expect((await call(srv, 'GET', '/portal/fln/p/900003', { ua })).text).toContain('id="root"');
    for (const ua of ['WhatsApp/2.24.1 A', 'WhatsApp/2.23.20.0', 'facebookexternalhit/1.1']) {
      expect((await call(srv, 'GET', '/portal/fln/p/900003', { ua })).text).toContain('og:title');
    }
  });

  it('a 160-code-point cap on the description', () => {
    const fln = require('../../dashboard/routes/portal-fln.routes');
    const long = 'ب'.repeat(300);
    const out = fln.clipCodePoints(long, 160);
    expect([...out].length).toBeLessThanOrEqual(160);
  });
});

describe('lp-activity writer admits fln (SPEC §5)', () => {
  // cleanOpen is module-private; recordOpen runs it and hands the cleaned open to the query, so this executes it.
  const cleaned = async (open) => {
    const { recordOpen } = require('../../dashboard/services/lp-activity.service');
    const seen = [];
    const out = await recordOpen(async (sql, params) => { seen.push(params); return { rows: [{ id: 7 }] }; }, open);
    return { out, params: seen[0] || null };
  };
  it('cleanOpen keeps kind fln and its lang; k5 and g612 unchanged', async () => {
    const fln = await cleaned({ userId: TEACHER, kind: 'fln', ref: '900010', lang: 'ur', source: 'viewer' });
    expect(fln.out.open).toEqual({ userId: TEACHER, kind: 'fln', ref: '900010', lang: 'ur', source: 'viewer' });
    expect(fln.params.slice(0, 5)).toEqual([TEACHER, 'fln', '900010', 'ur', 'viewer']);
    expect((await cleaned({ userId: TEACHER, kind: 'k5', ref: 'L1', lang: 'ur', source: 'viewer' })).out.open.lang).toBe(null);
    expect((await cleaned({ userId: TEACHER, kind: 'g612', ref: 'S1', lang: 'ur', source: 'viewer' })).out.open.lang).toBe('ur');
    expect((await cleaned({ userId: TEACHER, kind: 'fln', ref: '1', lang: 'fr', source: 'viewer' })).out.open.lang).toBe(null);
  });
});

describe('the mount in dashboard/index.js', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', 'index.js'), 'utf8');
  it('the router is mounted after training-library, and the preview sits in the SPA catch-all after the /api/ exclusion', () => {
    const tl = src.indexOf("require('./routes/training-library.routes'));");
    const mount = src.indexOf("app.use('/api/portal', cors(portalCorsOptions), portalAuthLimiter, portalDataLimiter, require('./routes/portal-fln.routes'));");
    expect(tl).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(tl);
    const excl = src.indexOf("const isExcludedPath = req.path.startsWith('/api/')");
    const prev = src.indexOf("if (require('./routes/portal-fln.routes').flnPreview.wants(req)) return require('./routes/portal-fln.routes').flnPreview.send(req, res);");
    expect(excl).toBeGreaterThan(-1);
    expect(prev).toBeGreaterThan(excl);
    expect(prev - excl).toBeLessThan(200);
  });
});
