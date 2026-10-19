/**
 * The leader routes of Reading Hour + Numeracy (contracts/api.md v2):
 *   GET /api/portal/fln/links      the link builder's rows (leaders with the share switch only)
 *   GET /api/portal/fln/title/:id  the signed-out banner's title (no sign-in; title, lang, dir only)
 *
 * Driven through a real Express app on a real port, so the routing, the middleware order and the headers are the
 * shipped ones. Mocked: only the corpus service (injected) and `dashboard/lib/fln-access`.
 *
 * fln-access is m-app's file (PR-C) and is not on this branch, so it is replaced by a FAITHFUL STUB with the same
 * shape and the same middleware order as NIETE-Rumi c4a2c874f: requireFln.{lessons,share} = [noStore,
 * requirePortalAuth, gate] where gate answers 404 when the access answer says no. Only flnAccess() is a jest.fn.
 */
const http = require('http');
const express = require('express');
const httpGet = require('./_fln-http-get'); // not global fetch: see the helper

const LEADER = 'user-leader-1';
const TEACHER = 'user-teacher-1';

const mockAccess = jest.fn();
// The DB boundary for the two FLN switches (app_settings), read by /fln/title's "is FLN on for anyone" check.
let mockSettings = {};
let mockSettingsError = false;
// users rows, for the REAL fln-access gate (PR-C) behind the default export (the PR-E mount describe).
const mockUsers = {};
jest.mock('../../dashboard/config/supabase', () => ({
  from: (table) => {
    let key;
    const q = {
      select: () => q,
      eq: (_c, v) => { key = v; return q; },
      maybeSingle: async () => {
        if (table === 'users') return { data: mockUsers[key] || null, error: null };
        if (mockSettingsError) return { data: null, error: { message: 'down' } };
        return { data: key in mockSettings ? { value: mockSettings[key] } : null, error: null };
      },
    };
    return q;
  },
}));
// fln-access is m-app's (PR-C). The suite INJECTS the stub (see _fln-access-stub.js); the virtual module mock is only
// for a branch where the real file does not exist yet (the router file requires it at load).
const HAS_ACCESS = require('fs').existsSync(require('path').join(__dirname, '../../dashboard/lib/fln-access.js'));
if (!HAS_ACCESS) {
  jest.mock('../../dashboard/lib/fln-access', () => require('./_fln-access-stub')((...a) => mockAccess(...a)), { virtual: true });
}
const accessStub = require('./_fln-access-stub')((...a) => mockAccess(...a));

function row(id, extra = {}) {
  return { id, title: `Plan ${id}`, lang: 'en', dir: 'ltr', minutes: 30, chips: {}, opened: false, ...extra };
}

/**
 * A catalogue body as the real corpus answers it (fln-corpus.service catalogue): grade 1–5 → that grade's level and
 * rows, whatever `level` says; any other grade → no rows (the routes never ask for one — FLN is Grades 1–5).
 */
function catalogueFor(grade, subject) {
  const lv = grade === 1 ? 1 : grade >= 2 && grade <= 3 ? 2 : grade >= 4 && grade <= 5 ? 3 : null;
  const levels = [
    { level: 1, label_en: 'Level 1', label_ur: 'سطح ۱', grades: [1], count: 4, screener_id: 900 },
    { level: 2, label_en: 'Level 2', label_ur: 'سطح ۲', grades: [2, 3], count: 3, screener_id: 901 },
    { level: 3, label_en: 'Level 3', label_ur: 'سطح ۳', grades: [4, 5], count: 2, screener_id: 902 },
  ];
  const plans = {
    1: [
      row(800, { chips: { guide: true }, pos: 0, count: 4 }),
      row(900, { chips: { screener: true, sounds: 5 }, pos: 1, count: 4, used_by: 1 }),
      row(101, { title: 'Sounds of c and k', chips: { sounds: 7 }, pos: 2, count: 4, used_by: 5 }),
      row(102, { title: 'The cat story', chips: { narration: true }, pos: 3, count: 4, used_by: 40 }),
      row(103, { title: 'More practice', chips: { additional: true, textbook: true }, pos: 4, count: 4, used_by: 12 }),
    ],
    2: [
      row(901, { chips: { screener: true }, pos: 1, count: 3 }),
      row(201, { title: 'Blends', chips: { sounds: 3 }, pos: 2, count: 3 }),
      row(202, { title: 'Short story', pos: 3, count: 3 }),
    ],
    3: [
      row(902, { chips: { screener: true }, pos: 1, count: 2 }),
      row(301, { title: 'Fluency', pos: 2, count: 2 }),
    ],
  };
  if (!lv) return { subject: { key: subject, lang: 'en', dir: 'ltr' }, grade, level: null, levels, strands: [] };
  return {
    subject: { key: subject, lang: 'en', dir: 'ltr' },
    grade,
    level: lv,
    levels,
    strands: [{ strand: 'daily', chapters: [{ chapter_no: 1, title_en: `Chapter L${lv}`, title_ur: `باب ${lv}`, plans: plans[lv] }] }],
  };
}

let corpus;
let server;
let base;

function startApp() {
  jest.isolateModules(() => {
    const { createFlnLinksRouter } = require('../../dashboard/routes/portal-fln-links.routes');
    const app = express();
    app.use((req, _res, next) => {
      const uid = req.headers['x-test-user'];
      req.session = uid ? { portalUserId: uid } : {};
      next();
    });
    app.use('/api/portal', createFlnLinksRouter({ corpus, access: accessStub, portalOrigin: () => 'https://portal.example.test' }));
    server = http.createServer(app);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}/api/portal/fln`;
    resolve();
  }));
}

async function get(path, user) {
  const res = await httpGet(base + path, { headers: user ? { 'x-test-user': user } : {} });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body, cache: res.headers.get('cache-control') };
}

beforeEach(async () => {
  mockAccess.mockReset();
  mockAccess.mockImplementation(async (uid) => (uid === LEADER
    ? { lessons: true, share: true, role: 'coach', ui_lang: 'ur' }
    : { lessons: true, share: false, role: 'teacher', ui_lang: 'en' }));
  corpus = {
    // The real service's shape (PR-C fln-corpus.service): ensure() loads lazily; catalogue({grade, subject, level}).
    ensure: jest.fn(async () => true),
    catalogue: jest.fn(({ grade, subject }) => catalogueFor(grade, subject)),
    isHidden: jest.fn(async (id) => String(id) === '555'),
    plan: jest.fn(async (id) => (String(id) === '101' ? { id: 101, title: 'Sounds of c and k', lang: 'en', dir: 'ltr', slo: ['secret goal'] } : null)),
    placementOf: jest.fn(async () => []),
  };
  await startApp();
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

describe('GET /fln/me is not this router\'s (m-app, PR-C)', () => {
  it('answers 404 here', async () => {
    expect((await get('/me', LEADER)).status).toBe(404);
  });
});

describe('GET /fln/links', () => {
  it('a teacher (share off) gets 404 and the corpus is never read', async () => {
    const r = await get('/links?grade=1&subject=rh-en', TEACHER);
    expect(r.status).toBe(404);
    expect(r.cache).toBe('no-store');
    expect(corpus.catalogue).not.toHaveBeenCalled();
  });
  it('signed out is 401 with no-store', async () => {
    const r = await get('/links?grade=1&subject=rh-en');
    expect(r.status).toBe(401);
    expect(r.cache).toBe('no-store');
  });
  it('a leader gets the grade-1 rows in teaching order with the absolute link and placement fields', async () => {
    const r = await get('/links?grade=1&subject=rh-en', LEADER);
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    expect(r.body.rows.map((x) => x.id)).toEqual([800, 900, 101, 102, 103]);
    const first = r.body.rows[2];
    expect(first).toMatchObject({
      id: 101,
      title: 'Sounds of c and k',
      url: 'https://portal.example.test/portal/fln/p/101',
      level: 1,
      grades: [1],
      chapter_title_en: 'Chapter L1',
      chapter_title_ur: 'باب 1',
      pos: 2,
      count: 4,
      used_by: 5,
    });
    expect(corpus.catalogue).toHaveBeenCalledWith({ grade: 1, subject: 'rh-en' });
  });
  it('the link carries no identity: no phone, no user id, no token, no query string', async () => {
    const r = await get('/links?grade=1&subject=rh-en', LEADER);
    for (const x of r.body.rows) {
      expect(x.url).toMatch(/^https:\/\/portal\.example\.test\/portal\/fln\/p\/\d+$/);
      expect(x.url).not.toContain(LEADER);
    }
  });
  it('FLN is Grades 1–5 (bd-elc1qz): grade 6–12 is 400 bad_request, with or without a level, and the corpus is not read', async () => {
    for (const path of ['/links?grade=7&subject=rh-en', '/links?grade=6&subject=num', '/links?grade=12&subject=rh-ur', '/links?grade=8&subject=num&level=2']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await get(path, LEADER);
      expect([path, r.status, r.body]).toEqual([path, 400, { error: 'bad_request' }]);
      expect(r.cache).toBe('no-store');
    }
    expect(corpus.catalogue).not.toHaveBeenCalled();
  });
  it('level is still accepted (old links) but the grade decides: grade 4 + level=1 → the grade-4 rows, and level never reaches the corpus', async () => {
    const r = await get('/links?grade=4&subject=num&level=1', LEADER);
    expect(r.status).toBe(200);
    expect(r.body.rows.map((x) => x.id)).toEqual([902, 301]);
    expect(corpus.catalogue.mock.calls.map((c) => c[0])).toEqual([{ grade: 4, subject: 'num' }]);
  });
  it('q filters case-insensitively on the title', async () => {
    const r = await get('/links?grade=1&subject=rh-en&q=CAT', LEADER);
    expect(r.body.rows.map((x) => x.id)).toEqual([102]);
  });
  it('has= filters by chips (all named chips must hold); screeners never count as "has sounds"', async () => {
    expect((await get('/links?grade=1&subject=rh-en&has=sounds', LEADER)).body.rows.map((x) => x.id)).toEqual([101]);
    expect((await get('/links?grade=1&subject=rh-en&has=narration', LEADER)).body.rows.map((x) => x.id)).toEqual([102]);
    expect((await get('/links?grade=1&subject=rh-en&has=additional,textbook', LEADER)).body.rows.map((x) => x.id)).toEqual([103]);
    expect((await get('/links?grade=1&subject=rh-en&has=screener', LEADER)).body.rows.map((x) => x.id)).toEqual([900]);
  });
  it('sort=used orders by used_by (desc) after the pinned guide/screener, when the search box is empty', async () => {
    const r = await get('/links?grade=1&subject=rh-en&sort=used', LEADER);
    expect(r.body.rows.map((x) => x.id)).toEqual([800, 900, 102, 103, 101]);
  });
  it('sort=used falls back to teaching order when q is set or no row has used_by', async () => {
    // "Sounds of c and k" (used 5) and "The cat story" (used 40) both hold an "s": teaching order, not 40-before-5.
    expect((await get('/links?grade=1&subject=rh-en&sort=used&q=s', LEADER)).body.rows.map((x) => x.id)).toEqual([101, 102]);
    expect((await get('/links?grade=3&subject=rh-en&level=2&sort=used', LEADER)).body.rows.map((x) => x.id)).toEqual([901, 201, 202]);
  });
  it('malformed params are 400 bad_request (no-store) and the corpus is not read', async () => {
    const bad = [
      '/links?subject=rh-en',
      '/links?grade=0&subject=rh-en',
      '/links?grade=13&subject=rh-en',
      '/links?grade=1.5&subject=rh-en',
      '/links?grade=1&subject=maths',
      '/links?grade=1',
      '/links?grade=1&subject=rh-en&level=4',
      '/links?grade=1&subject=rh-en&level=x',
      '/links?grade=1&subject=rh-en&has=sounds,colour',
      '/links?grade=1&subject=rh-en&sort=newest',
      `/links?grade=1&subject=rh-en&q=${'a'.repeat(101)}`,
      '/links?grade=1&grade=2&subject=rh-en',
    ];
    for (const path of bad) {
      // eslint-disable-next-line no-await-in-loop
      const r = await get(path, LEADER);
      expect([path, r.status, r.body]).toEqual([path, 400, { error: 'bad_request' }]);
      expect(r.cache).toBe('no-store');
    }
    expect(corpus.catalogue).not.toHaveBeenCalled();
  });
  it('a corpus that throws or is not loaded is 503 fln_unavailable, no-store', async () => {
    corpus.catalogue.mockImplementationOnce(() => { throw new Error('not loaded'); });
    let r = await get('/links?grade=1&subject=rh-en', LEADER);
    expect([r.status, r.body, r.cache]).toEqual([503, { error: 'fln_unavailable' }, 'no-store']);
    corpus.catalogue.mockResolvedValueOnce(null);
    r = await get('/links?grade=1&subject=rh-en', LEADER);
    expect([r.status, r.body]).toEqual([503, { error: 'fln_unavailable' }]);
    corpus.ensure.mockResolvedValueOnce(false); // a cold process whose bundle cannot load
    r = await get('/links?grade=1&subject=rh-en', LEADER);
    expect([r.status, r.body]).toEqual([503, { error: 'fln_unavailable' }]);
  });
});

describe('GET /fln/title/:id', () => {
  beforeEach(() => { mockSettings = { portal_fln_lessons: 'teachers' }; mockSettingsError = false; });

  // RT BLOCK #2953: with both switches off (the default on every tier) the route is 404 like every FLN route.
  it('both switches missing → 404 no-store, the corpus is never read', async () => {
    mockSettings = {};
    const r = await get('/title/101');
    expect([r.status, r.body, r.cache]).toEqual([404, { error: 'not_found' }, 'no-store']);
    expect(corpus.isHidden).not.toHaveBeenCalled();
    expect(corpus.plan).not.toHaveBeenCalled();
  });
  it('malformed or empty switch values are OFF (fail closed); a failed read is OFF', async () => {
    for (const v of [false, 'false', 1, 'yes', {}, [], [''], null]) {
      mockSettings = { portal_fln_lessons: v, portal_fln_share: v };
      // eslint-disable-next-line no-await-in-loop
      expect([JSON.stringify(v), (await get('/title/101')).status]).toEqual([JSON.stringify(v), 404]);
    }
    mockSettings = { portal_fln_lessons: true };
    mockSettingsError = true;
    expect((await get('/title/101')).status).toBe(404);
  });
  it('ON for someone opens it: true, "true", "teachers" (also as JSON text), or a non-empty id list on either switch', async () => {
    for (const s of [{ portal_fln_lessons: true }, { portal_fln_lessons: '"true"' }, { portal_fln_lessons: '"teachers"' }, { portal_fln_share: ['u-coach'] }, { portal_fln_lessons: '["u-1"]' }]) {
      mockSettings = s;
      // eslint-disable-next-line no-await-in-loop
      expect([JSON.stringify(s), (await get('/title/101')).status]).toEqual([JSON.stringify(s), 200]);
    }
  });
  it('answers ONLY title, lang and dir — signed out', async () => {
    const r = await get('/title/101');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ title: 'Sounds of c and k', lang: 'en', dir: 'ltr' });
    expect(r.cache).toBe('no-store');
    expect(mockAccess).not.toHaveBeenCalled();
  });
  it('a hidden id is 404 and its plan is never read', async () => {
    const r = await get('/title/555');
    expect([r.status, r.cache]).toEqual([404, 'no-store']);
    expect(corpus.plan).not.toHaveBeenCalled();
  });
  it('an unknown id is 404; a non-digit id is 404 before the corpus is touched', async () => {
    expect((await get('/title/777')).status).toBe(404);
    corpus.isHidden.mockClear();
    for (const id of ['abc', '12a', '-1', '1e3', '1234567890123']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await get(`/title/${id}`);
      expect([id, r.status, r.cache]).toEqual([id, 404, 'no-store']);
    }
    expect(corpus.isHidden).not.toHaveBeenCalled();
  });
  it('a corpus that throws is 503, no-store', async () => {
    corpus.isHidden.mockRejectedValueOnce(new Error('not loaded'));
    const r = await get('/title/101');
    expect([r.status, r.body, r.cache]).toEqual([503, { error: 'fln_unavailable' }, 'no-store']);
  });
});

describe('module shape', () => {
  it('exports a mountable router with the factory on it (router.use(require(...)) works)', () => {
    jest.isolateModules(() => {
      const mod = require('../../dashboard/routes/portal-fln-links.routes');
      expect(typeof mod).toBe('function');
      expect(typeof mod.use).toBe('function');
      expect(typeof mod.createFlnLinksRouter).toBe('function');
    });
  });
});

describe('PR-E mount: /fln/teachers and /fln/send are reachable wherever the links router is mounted', () => {
  // The DEFAULT export, mounted the way production mounts it (router.use at /api/portal), with no deps injected.
  let mounted; let mountedBase;
  beforeEach(async () => {
    // With PR-C's real fln-access behind the default export, the gate reads users.role + the share switch.
    mockUsers[LEADER] = { id: LEADER, role: 'coach', preferred_language: 'en' };
    mockUsers[TEACHER] = { id: TEACHER, role: 'teacher', preferred_language: 'en' };
    mockSettings = { portal_fln_lessons: 'teachers', portal_fln_share: [LEADER, TEACHER] };
    jest.isolateModules(() => {
      const links = require('../../dashboard/routes/portal-fln-links.routes');
      const app = express();
      app.use((req, _res, next) => {
        const uid = req.headers['x-test-user'];
        req.session = uid ? { portalUserId: uid } : {};
        next();
      });
      app.use('/api/portal', links);
      mounted = http.createServer(app);
    });
    await new Promise((resolve) => mounted.listen(0, '127.0.0.1', resolve));
    mountedBase = `http://127.0.0.1:${mounted.address().port}/api/portal/fln`;
  });
  afterEach(() => new Promise((resolve) => mounted.close(resolve)));

  async function call(method, p, user, body) {
    const headers = { ...(user ? { 'x-test-user': user } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
    const res = await fetch(mountedBase + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let b = null;
    try { b = await res.json(); } catch (_) { b = null; }
    return { status: res.status, body: b, cache: res.headers.get('cache-control') };
  }

  it('POST /api/portal/fln/send with no session answers 401, not 404', async () => {
    const r = await call('POST', '/send', null, { plan: 101, teachers: ['aaaaaaaaaaaaaaaa'] });
    expect([r.status, r.cache]).toEqual([401, 'no-store']);
  });
  it('GET /api/portal/fln/teachers with no session answers 401', async () => {
    expect((await call('GET', '/teachers')).status).toBe(401);
  });
  it('a teacher without the share switch gets 404 from both (the same gate as /fln/links)', async () => {
    expect((await call('GET', '/teachers', TEACHER)).status).toBe(404);
    expect((await call('POST', '/send', TEACHER, { plan: 101, teachers: ['aaaaaaaaaaaaaaaa'] })).status).toBe(404);
  });
  it('a leader reaches the send route itself: a malformed body is its 400', async () => {
    const r = await call('POST', '/send', LEADER, { plan: 'x', teachers: [] });
    expect([r.status, r.body]).toEqual([400, { error: 'bad_request' }]);
  });
});
