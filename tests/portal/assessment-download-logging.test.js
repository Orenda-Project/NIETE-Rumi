/**
 * bd-ivsjk8.1 — every paper (or answer key) a teacher takes from the portal is recorded, on the server.
 *
 * The "Did your class sit the paper?" test (bd-ivsjk8) asks the school day after a teacher gets a
 * paper, and its deciding measure counts papers that were ready. Neither works while a download
 * leaves no trace, so both routes that hand her a paper now write one assessment_downloads row:
 *
 *   GET /assessment/paper/:paper_id/download   the signed link (another app)    via 'link'
 *   GET /assessment/paper/:paper_id/file       the app's "Paper ready" viewer   via 'viewer'
 *
 * The rules under test:
 *   - who: the SESSION's user id, never a request field;
 *   - only a real download: nothing when the paper is not hers / not ready, or storage refused it;
 *   - fire-and-forget: a failing or throwing log never changes the answer she gets;
 *   - the write is one conditional INSERT carrying the 5-minute de-dupe window.
 *
 * The database is mocked at the pool and the bot lookup at the assessment client; the logging
 * module itself is real.
 */

const { PassThrough } = require('stream');

const R2 = 'https://0123abcd.r2.cloudflarestorage.com';
const BUCKET = 'niete-bucket';
const SIGNED = `https://${BUCKET}.0123abcd.r2.cloudflarestorage.com/assessments/paper-1.pdf?X-Amz-Signature=abc`;
const PDF = Buffer.from('%PDF-1.5\n% a test paper\n%%EOF\n');
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const PAPER = '0b7d6a1e-4c2f-4e8a-9d3b-5a6c7e8f9a01';

let download;
let fetchMock;
let savedFetch;
let savedEndpoint;
let savedBucket;
let poolQuery;
let consoleError;

const downloadsWritten = () => poolQuery.mock.calls.filter(([sql]) => /INSERT INTO assessment_downloads/.test(sql));

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if (layer.route.methods[method] && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}

function makeRes() {
  const res = new PassThrough();
  res.statusCode = 200;
  res.headers = {};
  res.body = null;
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.bytes = () => Buffer.concat(chunks);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; res.end(); return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  return res;
}

async function invoke(routePath, { userId = TEACHER, params = { paper_id: PAPER }, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', routePath);
  if (!stack) throw new Error(`Route GET ${routePath} not found`);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, query, body: {}, method: 'GET', path: routePath, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  const res = makeRes();
  const finished = new Promise((resolve) => { res.on('finish', resolve); res.on('close', resolve); });
  for (const handler of stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  await Promise.race([finished, new Promise((r) => setTimeout(r, 1000))]);
  // Let a fire-and-forget write reach the pool before asserting on it.
  await new Promise((r) => setImmediate(r));
  return res;
}

function upstream(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers: { 'content-type': 'application/pdf', ...headers } });
}

beforeEach(() => {
  jest.resetModules();
  savedFetch = global.fetch;
  savedEndpoint = process.env.R2_ENDPOINT;
  savedBucket = process.env.R2_BUCKET_NAME;
  process.env.R2_ENDPOINT = R2;
  process.env.R2_BUCKET_NAME = BUCKET;
  fetchMock = jest.fn(async () => upstream(PDF, { headers: { 'content-length': String(PDF.length) } }));
  global.fetch = fetchMock;

  download = jest.fn(async () => ({ url: SIGNED, filename: 'G4 Maths ch9 test.pdf' }));
  poolQuery = jest.fn(async () => ({ rows: [{ id: 'dl-1' }] }));

  jest.doMock('../../dashboard/config/database', () => ({ query: poolQuery }));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/assessment.service', () => ({
    options: jest.fn(), listChapters: jest.fn(), download, listPapers: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = savedFetch;
  if (savedEndpoint === undefined) delete process.env.R2_ENDPOINT; else process.env.R2_ENDPOINT = savedEndpoint;
  if (savedBucket === undefined) delete process.env.R2_BUCKET_NAME; else process.env.R2_BUCKET_NAME = savedBucket;
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('the signed link (GET /assessment/paper/:paper_id/download)', () => {
  const ROUTE = '/assessment/paper/:paper_id/download';

  test('records the download — her UUID, the paper, the artifact, the link — and still returns the URL', async () => {
    const res = await invoke(ROUTE);
    expect(res.body).toEqual(expect.objectContaining({ success: true, available: true, url: SIGNED }));
    const writes = downloadsWritten();
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual([TEACHER, PAPER, 'paper', 'link', 5]);
  });

  test('the answer key is recorded as the answer key', async () => {
    await invoke(ROUTE, { query: { artifact: 'answer_key' } });
    expect(downloadsWritten()[0][1].slice(2, 4)).toEqual(['answer_key', 'link']);
  });

  test('the write is ONE conditional insert that skips a repeat inside the window', async () => {
    await invoke(ROUTE);
    const [sql] = downloadsWritten()[0];
    expect(sql).toMatch(/WHERE NOT EXISTS/);
    expect(sql).toMatch(/created_at > now\(\) - make_interval\(mins => \$5/);
  });

  test('not hers / not ready (available: false) records nothing', async () => {
    download.mockResolvedValue(null);
    const res = await invoke(ROUTE);
    expect(res.body).toEqual({ success: true, available: false });
    expect(downloadsWritten()).toHaveLength(0);
  });

  test('a failing log still returns the signed URL, and the failure is logged as an error', async () => {
    poolQuery.mockRejectedValue(new Error('relation "assessment_downloads" does not exist'));
    const res = await invoke(ROUTE);
    expect(res.body).toEqual(expect.objectContaining({ available: true, url: SIGNED }));
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/download not logged/i), expect.any(Object));
  });

  test('a log that throws synchronously still returns the signed URL', async () => {
    poolQuery.mockImplementation(() => { throw new Error('pool exhausted'); });
    const res = await invoke(ROUTE);
    expect(res.body).toEqual(expect.objectContaining({ available: true, url: SIGNED }));
  });
});

describe('the app viewer (GET /assessment/paper/:paper_id/file)', () => {
  const ROUTE = '/assessment/paper/:paper_id/file';

  test('records the download once the PDF has gone out whole', async () => {
    const res = await invoke(ROUTE);
    expect(res.statusCode).toBe(200);
    expect(res.bytes().equals(PDF)).toBe(true);
    const writes = downloadsWritten();
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual([TEACHER, PAPER, 'paper', 'viewer', 5]);
  });

  test('not hers / not ready (404) records nothing', async () => {
    download.mockResolvedValue(null);
    const res = await invoke(ROUTE);
    expect(res.statusCode).toBe(404);
    expect(downloadsWritten()).toHaveLength(0);
  });

  test('storage refusing the link (502) records nothing — she never got the paper', async () => {
    fetchMock.mockResolvedValue(upstream('<Error/>', { status: 403, headers: { 'content-type': 'application/xml' } }));
    const res = await invoke(ROUTE);
    expect(res.statusCode).toBe(502);
    expect(downloadsWritten()).toHaveLength(0);
  });

  test('a failing log never touches the paper', async () => {
    poolQuery.mockRejectedValue(new Error('relation "assessment_downloads" does not exist'));
    const res = await invoke(ROUTE);
    expect(res.statusCode).toBe(200);
    expect(res.bytes().equals(PDF)).toBe(true);
  });
});

describe('signed out', () => {
  test('both routes answer 401 and record nothing', async () => {
    for (const route of ['/assessment/paper/:paper_id/download', '/assessment/paper/:paper_id/file']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await invoke(route, { userId: null });
      expect(res.statusCode).toBe(401);
    }
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

describe('recordDownload — the service on its own', () => {
  const ok = { userId: TEACHER, paperId: PAPER, artifact: 'paper', via: 'link' };
  let Downloads;
  beforeEach(() => { Downloads = jest.requireActual('../../dashboard/services/assessment-downloads.service'); });

  test.each([
    ['a phone instead of a UUID', { userId: '923001234567' }],
    ['a paper id that is not a UUID', { paperId: 'paper-1' }],
    ['an unknown artifact', { artifact: 'marking_scheme' }],
    ['an unknown way it went out', { via: 'email' }],
  ])('%s records nothing and asks the database nothing', async (_label, bad) => {
    const query = jest.fn();
    await expect(Downloads.recordDownload(query, { ...ok, ...bad })).resolves.toEqual({ recorded: false, reason: 'invalid' });
    expect(query).not.toHaveBeenCalled();
  });

  test('no input at all is invalid, not a crash', async () => {
    await expect(Downloads.recordDownload(jest.fn(), undefined)).resolves.toEqual({ recorded: false, reason: 'invalid' });
  });

  test('a stored download returns its id and what was stored', async () => {
    const query = jest.fn(async () => ({ rows: [{ id: 'dl-9' }] }));
    await expect(Downloads.recordDownload(query, ok)).resolves.toEqual({ recorded: true, id: 'dl-9', download: ok });
  });

  test('a repeat inside the window (no row back) is not recorded', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    await expect(Downloads.recordDownload(query, ok)).resolves.toEqual({ recorded: false });
  });

  test('logDownload resolves a failure as reason "error" and names the paper in the error log', async () => {
    const query = jest.fn(async () => { throw new Error('boom'); });
    await expect(Downloads.logDownload(query, ok)).resolves.toEqual({ recorded: false, reason: 'error' });
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/download not logged/i),
      { paperId: PAPER, artifact: 'paper', via: 'link', error: 'boom' });
  });
});
