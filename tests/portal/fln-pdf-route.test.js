'use strict';
/**
 * bd-s0ccn5.2.3 — GET /api/portal/fln/plan/:id/pdf: a presigned link to the plan's pre-rendered PDF on the portal's
 * private bucket (fln/pdf/<corpus version>/<id>.pdf). Real Express and the real access gate; the bucket HEAD and
 * the presigner are injected. The route only hands out a link: it records no open and writes no feedback or
 * lesson_plans row, and every answer is no-store.
 */
process.env.FLAG_CACHE_TTL_MS = '0';
const http = require('http');
const express = require('express');
const { build, VERSION } = require('./fixtures/fln-corpus.fixture');

const ENV = { ...process.env };
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const R2 = { R2_BUCKET_NAME: 'portal-test', R2_ENDPOINT: 'https://r2.example.test', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret' };

let settings; let queries; let heads; let presigned; let present;

function supabaseStub() {
  return {
    from(table) {
      const eqs = {};
      const q = {
        select: () => q,
        eq: (c, v) => { eqs[c] = v; return q; },
        maybeSingle: async () => {
          if (table === 'app_settings') return { data: eqs.key in settings ? { value: settings[eqs.key] } : null, error: null };
          if (table === 'users') return { data: eqs.id === TEACHER ? { id: TEACHER, role: 'teacher', preferred_language: 'en' } : null, error: null };
          return { data: null, error: null };
        },
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
  process.env = { ...ENV, ...R2, FLN_CORPUS_BASE: 'https://cdn.example.test/fln/corpus' };
  settings = { portal_fln_lessons: true, fln_corpus_version: VERSION };
  queries = []; heads = []; presigned = [];
  present = new Set([`fln/pdf/${VERSION}/900003.pdf`]);
  global.fetch = jest.fn(async () => { throw new Error('no network in this test'); });
  jest.doMock('../../dashboard/config/supabase', () => supabaseStub());
  jest.doMock('../../dashboard/config/database', () => ({ query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } }));
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ userId = TEACHER, loaded = true } = {}) {
  if (loaded) require('../../dashboard/services/fln-corpus.service').__setForTests(build());
  const sign = require('../../dashboard/services/fln-pdf-sign');
  sign.__setForTests({
    head: async (cfg, key) => { heads.push({ bucket: cfg.bucket, key }); return present.has(key); },
    presign: async (_client, cmd, opts) => { presigned.push({ input: cmd.input, opts }); return `https://signed.example.test/${cmd.input.Key}?x=1`; },
  });
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = userId ? { id: 's1', portalUserId: userId } : {}; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-fln.routes'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}

const get = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path, agent: false }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { data += c; });
    res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch (_) { /* empty */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
  }).on('error', reject);
});

const writes = () => queries.filter((q) => /INSERT|UPDATE|DELETE/i.test(q.sql));

describe('GET /fln/plan/:id/pdf', () => {
  it('200 with a presigned link to fln/pdf/<version>/<id>.pdf, downloaded as an attachment, no-store', async () => {
    const srv = await app();
    const r = await get(srv, '/api/portal/fln/plan/900003/pdf');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json.url).toBe(`https://signed.example.test/fln/pdf/${VERSION}/900003.pdf?x=1`);
    expect(presigned).toHaveLength(1);
    expect(presigned[0].input.Bucket).toBe('portal-test');
    expect(presigned[0].input.ResponseContentDisposition).toMatch(/^attachment; filename="[^"/\\]+\.pdf"$/);
    expect(presigned[0].input.ResponseContentType).toBe('application/pdf');
  });

  it('404 when the PDF was never rendered (HEAD miss) — nothing signed', async () => {
    const srv = await app();
    const r = await get(srv, '/api/portal/fln/plan/900004/pdf');
    expect(r.status).toBe(404);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(heads).toEqual([{ bucket: 'portal-test', key: `fln/pdf/${VERSION}/900004.pdf` }]);
    expect(presigned).toHaveLength(0);
  });

  it('404 for a malformed, unknown or hidden plan, before the bucket is asked', async () => {
    present.add(`fln/pdf/${VERSION}/900007.pdf`);
    const srv = await app(); // 900007 is the fixture's hidden plan
    for (const id of ['abc', '1234567890', '999999', '900007']) {
      const r = await get(srv, `/api/portal/fln/plan/${id}/pdf`);
      expect(r.status).toBe(404);
      expect(r.headers['cache-control']).toBe('no-store');
    }
    expect(heads).toHaveLength(0);
  });

  it('404 when the bucket is not configured', async () => {
    delete process.env.R2_BUCKET_NAME;
    const srv = await app();
    const r = await get(srv, '/api/portal/fln/plan/900003/pdf');
    expect(r.status).toBe(404);
    expect(presigned).toHaveLength(0);
  });

  it('404 (not 500) when the HEAD or the presign throws', async () => {
    const srv = await app();
    require('../../dashboard/services/fln-pdf-sign').__setForTests({ head: async () => { throw new Error('r2 down'); } });
    expect((await get(srv, '/api/portal/fln/plan/900003/pdf')).status).toBe(404);
    require('../../dashboard/services/fln-pdf-sign').__setForTests({ head: async () => true, presign: async () => { throw new Error('x'); } });
    expect((await get(srv, '/api/portal/fln/plan/900003/pdf')).status).toBe(404);
  });

  it('401 signed out, 404 when FLN lessons are off — both no-store', async () => {
    let srv = await app({ userId: null });
    let r = await get(srv, '/api/portal/fln/plan/900003/pdf');
    expect(r.status).toBe(401);
    expect(r.headers['cache-control']).toBe('no-store');
    settings.portal_fln_lessons = false;
    srv = await app();
    r = await get(srv, '/api/portal/fln/plan/900003/pdf');
    expect(r.status).toBe(404);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('503 while the corpus is not ready', async () => {
    const srv = await app({ loaded: false });
    const r = await get(srv, '/api/portal/fln/plan/900003/pdf');
    expect(r.status).toBe(503);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('records no open and writes nothing', async () => {
    const srv = await app();
    await get(srv, '/api/portal/fln/plan/900003/pdf');
    await new Promise((res) => setTimeout(res, 20));
    expect(writes()).toHaveLength(0);
  });
});
