/**
 * bd-t7zk3t.12 (PR-D) — the leader routes on m-app's REAL corpus service (PR-C `dashboard/services/fln-corpus.service.js`)
 * with its own fixture bundle, not a mock of it (RT BLOCK #2953 reason 2: a mock that copied the wrong call shape hid an
 * empty builder). Only the DB boundary (app_settings) and the access middleware are stubbed. The service and fixture are
 * PR-C's files: on a branch without them this suite is skipped and says so; once PR-C lands beside PR-D it runs.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const httpGet = require('./_fln-http-get'); // not global fetch: see the helper

const HAS_CORPUS = fs.existsSync(path.join(__dirname, '../../dashboard/services/fln-corpus.service.js'))
  && fs.existsSync(path.join(__dirname, 'fixtures/fln-corpus.fixture.js'));
const d = HAS_CORPUS ? describe : describe.skip;
if (!HAS_CORPUS) console.log('fln-links-routes.real-corpus: skipped — PR-C fln-corpus.service.js not on this branch');

// app_settings: the FLN lessons switch on (for /fln/title's gate); no corpus-version row (the service's default).
jest.mock('../../dashboard/config/supabase', () => ({
  from: () => {
    let key;
    const q = {
      select: () => q,
      eq: (_c, v) => { key = v; return q; },
      maybeSingle: async () => ({ data: key === 'portal_fln_lessons' ? { value: 'teachers' } : null, error: null }),
    };
    return q;
  },
}));

const pass = (req, res, next) => next();
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const access = { requireFln: { share: [noStore, pass] }, noStore };

let server; let base; let Corpus; let fixture;
beforeAll(() => {
  if (!HAS_CORPUS) return;
  delete process.env.FLN_CORPUS_BASE;
  delete process.env.CONTENT_R2_PUBLIC_URL; // cold = nothing to fetch from: ensure() resolves false
  // eslint-disable-next-line global-require
  Corpus = require('../../dashboard/services/fln-corpus.service');
  // eslint-disable-next-line global-require
  fixture = require('./fixtures/fln-corpus.fixture');
});
beforeEach(async () => {
  if (!HAS_CORPUS) return;
  // eslint-disable-next-line global-require
  const { createFlnLinksRouter } = require('../../dashboard/routes/portal-fln-links.routes');
  const app = express();
  app.use('/api/portal', createFlnLinksRouter({ corpus: Corpus, access, portalOrigin: () => 'https://portal.example.test' }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/portal/fln`;
});
afterEach(() => (server ? new Promise((r) => server.close(r)) : undefined));

async function get(p) {
  const res = await httpGet(base + p);
  return { status: res.status, body: await res.json().catch(() => null), cache: res.headers.get('cache-control') };
}

d('on the real corpus service', () => {
  it('cold (no bundle can load): /links and /title are 503 fln_unavailable, never an empty 200 or a false 404', async () => {
    Corpus.__resetForTests();
    const links = await get('/links?grade=1&subject=rh-en');
    expect([links.status, links.body, links.cache]).toEqual([503, { error: 'fln_unavailable' }, 'no-store']);
    const title = await get('/title/900003');
    expect([title.status, title.body]).toEqual([503, { error: 'fln_unavailable' }]);
  });

  it('loaded: grade 1 Reading Hour English lists the served plans in teaching order, hidden ones never', async () => {
    Corpus.__setForTests(fixture.build());
    const r = await get('/links?grade=1&subject=rh-en');
    expect(r.status).toBe(200);
    const ids = r.body.rows.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([900002, 900003, 900004, 900005, 900006]));
    expect(ids).not.toContain(900007); // shelf: hidden
    expect(r.body.rows.find((x) => x.id === 900003).url).toBe('https://portal.example.test/portal/fln/p/900003');
  });

  it('loaded: grade 8 with no level puts every level\'s screener first', async () => {
    Corpus.__setForTests(fixture.build());
    const r = await get('/links?grade=8&subject=rh-en');
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBeGreaterThan(1);
    expect(r.body.rows[0].id).toBe(900002);
  });

  it('loaded: /title answers a served plan and 404s a hidden one', async () => {
    Corpus.__setForTests(fixture.build());
    const ok = await get('/title/900003');
    expect([ok.status, ok.body]).toEqual([200, { title: 'Sounds of q, x, z', lang: 'en', dir: 'ltr' }]);
    expect((await get('/title/900007')).status).toBe(404);
  });
});
