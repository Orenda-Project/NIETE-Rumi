/**
 * The leader routes with the REAL `dashboard/lib/fln-access.js` middleware order
 * ([noStore, requirePortalAuth, gate]); only the DB boundary (dashboard/config/supabase) and the switch reader
 * (dashboard/lib/feature-flags) are mocked. fln-access is m-app's file (PR-C): on a branch without it this suite is
 * skipped and says so; once PR-C lands beside PR-D it runs.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const httpGet = require('./_fln-http-get'); // not global fetch: see the helper

const HAS_ACCESS = fs.existsSync(path.join(__dirname, '../../dashboard/lib/fln-access.js'));
const d = HAS_ACCESS ? describe : describe.skip;

const mockUsers = {
  'u-coach': { id: 'u-coach', role: 'coach', preferred_language: 'ur' },
  'u-teacher': { id: 'u-teacher', role: 'teacher', preferred_language: 'en' },
};
let mockFlags;

jest.mock('../../dashboard/config/supabase', () => ({
  from: () => {
    let id;
    const q = {
      select: () => q,
      eq: (_c, v) => { id = v; return q; },
      maybeSingle: async () => ({ data: mockUsers[id] || null, error: null }),
    };
    return q;
  },
}));
jest.mock('../../dashboard/lib/feature-flags', () => ({
  isFlagEnabledForUser: async (_sb, key, uid) => {
    const v = mockFlags[key];
    return v === true || (Array.isArray(v) && v.includes(uid));
  },
}));

let server; let base;
beforeEach(async () => {
  mockFlags = { portal_fln_lessons: 'teachers', portal_fln_share: ['u-coach', 'u-teacher'] };
  if (!HAS_ACCESS) return;
  const { createFlnLinksRouter } = require('../../dashboard/routes/portal-fln-links.routes');
  const corpus = {
    ensure: async () => true,
    catalogue: () => ({ grade: 1, level: 1, levels: [{ level: 1, grades: [1], count: 1 }], strands: [{ strand: 'daily', chapters: [{ chapter_no: 1, plans: [{ id: 5, title: 'A', chips: {} }] }] }] }),
    isHidden: async () => false,
    plan: async () => ({ title: 'A', lang: 'en', dir: 'ltr' }),
  };
  const app = express();
  app.use((req, _res, next) => { req.session = req.headers['x-test-user'] ? { portalUserId: req.headers['x-test-user'] } : {}; next(); });
  app.use('/api/portal', createFlnLinksRouter({ corpus, portalOrigin: () => 'https://portal.example.test' }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/portal/fln`;
});
afterEach(() => (server ? new Promise((r) => server.close(r)) : undefined));

async function get(p, user) {
  const res = await httpGet(base + p, { headers: user ? { 'x-test-user': user } : {} });
  return { status: res.status, body: await res.json().catch(() => null), cache: res.headers.get('cache-control') };
}

d('with the real fln-access', () => {
  it('a coach with share on reaches /links', async () => {
    const r = await get('/links?grade=1&subject=rh-en', 'u-coach');
    expect([r.status, r.cache, r.body.rows[0].url]).toEqual([200, 'no-store', 'https://portal.example.test/portal/fln/p/5']);
  });
  it('a teacher on the share list is still not a leader: 404 on /links', async () => {
    const r = await get('/links?grade=1&subject=rh-en', 'u-teacher');
    expect([r.status, r.cache]).toEqual([404, 'no-store']);
  });
  it('signed out: 401 no-store on /links', async () => {
    for (const p of ['/links?grade=1&subject=rh-en']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await get(p);
      expect([p, r.status, r.cache]).toEqual([p, 401, 'no-store']);
    }
  });
});

if (!HAS_ACCESS) {
  it('fln-access.js (PR-C) is absent on this branch — the real-middleware suite is skipped', () => {
    expect(HAS_ACCESS).toBe(false);
  });
}
