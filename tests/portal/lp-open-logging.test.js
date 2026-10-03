/**
 * bd-5rz1v.15 — every lesson plan a teacher opens in the portal is recorded, on the server.
 *
 * "Record when a teacher opens a lesson plan… so we can show 1. when they last opened it and
 * 2. when they do coaching, we can show them their recent lesson plans" (operator, 3 Oct 2026).
 *
 * The four places a plan is opened, and what each records (niete_lp_opens, V1.6.1):
 *
 *   GET /curriculum/lp/:lesson_id/file   grades 1-5, the portal's viewer   k5   viewer
 *   GET /curriculum/lp/:lesson_id/pdf    grades 1-5, another app           k5   external
 *   GET /lp612/file/:render_id           grades 6-12, the portal's viewer  g612 viewer
 *   GET /lp612/status/:render_id?open=1  grades 6-12, another app          g612 external
 *
 * A plain /lp612/status is ALSO the poll that waits ~3 minutes for a lesson to be written, so it
 * records nothing unless the client says this call is an open (?open=1).
 *
 * The rules under test:
 *   - who: the SESSION's user id (a UUID), never a phone or a request field;
 *   - only a real open: a viewer open is recorded once the PDF went out, never on 404/409/502;
 *   - fire-and-forget: a failing, throwing or hanging log never changes or delays the open;
 *   - the write is one conditional INSERT carrying the 5-minute de-dupe window.
 *
 * The database is mocked at the pool (the network boundary); the logging module itself is real.
 */

const { PassThrough } = require('stream');

const R2 = 'https://0123abcd.r2.cloudflarestorage.com';
const SIGNED = `${R2}/niete-bucket/lp-cache/v8/grade_4_english_ch1_seg2/899e05ff4a3d.pdf?X-Amz-Signature=abc`;
const SIGNED_612 = `${R2}/niete-bucket/lp612/v9.2/en/grade_9_physics.c02.p010.pdf?X-Amz-Signature=def`;
const PDF = Buffer.from('%PDF-1.5\n% a lesson plan\n%%EOF\n');
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';

let lessonPdf;
let requestStatus;
let fetchMock;
let savedFetch;
let savedEndpoint;
let poolQuery;
let consoleError;

const opensWritten = () => poolQuery.mock.calls.filter(([sql]) => /INSERT INTO niete_lp_opens/.test(sql));

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

async function invoke(routePath, { userId = TEACHER, params = {}, query = {} } = {}) {
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
  process.env.R2_ENDPOINT = R2;
  fetchMock = jest.fn(async () => upstream(PDF, { headers: { 'content-length': String(PDF.length) } }));
  global.fetch = fetchMock;

  lessonPdf = jest.fn(async () => ({ url: SIGNED, asset_kind: 'lesson', version_stamp: 'v8' }));
  requestStatus = jest.fn(async () => ({
    state: 'ready', url: SIGNED_612, segmentId: 'grade_9_physics.c02.p010', lang: 'en',
  }));
  poolQuery = jest.fn(async () => ({ rows: [{ id: 'open-1' }] }));

  jest.doMock('../../dashboard/config/database', () => ({ query: poolQuery }));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    isValidR2Url: jest.fn(() => true), generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(),
  }));
  jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({
    listGrades: jest.fn(), listSubjects: jest.fn(), listChapters: jest.fn(), listLessons: jest.fn(), lessonPdf,
    describePlans: jest.fn(),
  }));
  jest.doMock('../../dashboard/services/lp612.service', () => ({
    listGrades: jest.fn(), listSubjects: jest.fn(), listChapters: jest.fn(), listLessons: jest.fn(),
    requestLesson: jest.fn(), requestStatus, myLessons: jest.fn(),
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
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('grades 1-5 — the portal viewer (GET /curriculum/lp/:lesson_id/file)', () => {
  const ROUTE = '/curriculum/lp/:lesson_id/file';
  const params = { lesson_id: 'grade_4_english_ch1_seg2' };

  test('records the open — her UUID, the lesson, the viewer — once the PDF has gone out', async () => {
    const res = await invoke(ROUTE, { params, query: { kind: 'lesson' } });
    expect(res.statusCode).toBe(200);
    expect(res.bytes().equals(PDF)).toBe(true);
    const writes = opensWritten();
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual([TEACHER, 'k5', 'grade_4_english_ch1_seg2', null, 'viewer', 5]);
  });

  test('the write is ONE conditional insert that skips a repeat inside the window', async () => {
    await invoke(ROUTE, { params });
    const [sql] = opensWritten()[0];
    expect(sql).toMatch(/WHERE NOT EXISTS/);
    expect(sql).toMatch(/opened_at > now\(\) - make_interval\(mins => \$6/);
    expect(sql).toMatch(/lang IS NOT DISTINCT FROM \$4/);
  });

  test('opening the answer key is a use of that lesson', async () => {
    await invoke(ROUTE, { params, query: { kind: 'answer_key' } });
    expect(opensWritten()[0][1].slice(1, 3)).toEqual(['k5', 'grade_4_english_ch1_seg2']);
  });

  test('not published yet (404) records nothing', async () => {
    lessonPdf.mockResolvedValue(null);
    const res = await invoke(ROUTE, { params });
    expect(res.statusCode).toBe(404);
    expect(opensWritten()).toHaveLength(0);
  });

  test('storage refusing the link (502) records nothing — she never saw the plan', async () => {
    fetchMock.mockResolvedValue(upstream('<Error/>', { status: 403, headers: { 'content-type': 'application/xml' } }));
    const res = await invoke(ROUTE, { params });
    expect(res.statusCode).toBe(502);
    expect(opensWritten()).toHaveLength(0);
  });

  test('signed out: 401, and nothing is recorded', async () => {
    const res = await invoke(ROUTE, { userId: null, params });
    expect(res.statusCode).toBe(401);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('a failing log never touches the open, and the failure is logged as an error', async () => {
    poolQuery.mockRejectedValue(new Error('relation "niete_lp_opens" does not exist'));
    const res = await invoke(ROUTE, { params });
    expect(res.statusCode).toBe(200);
    expect(res.bytes().equals(PDF)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/open not logged/i), expect.any(Object));
  });

  test('a log that throws synchronously never touches the open', async () => {
    poolQuery.mockImplementation(() => { throw new Error('pool exhausted'); });
    const res = await invoke(ROUTE, { params });
    expect(res.statusCode).toBe(200);
    expect(res.bytes().equals(PDF)).toBe(true);
  });

  test('a log that hangs never delays the open', async () => {
    poolQuery.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const res = await invoke(ROUTE, { params });
    expect(res.statusCode).toBe(200);
    expect(res.writableFinished).toBe(true);
    expect(Date.now() - started).toBeLessThan(900);
  });
});

describe('grades 1-5 — another app (GET /curriculum/lp/:lesson_id/pdf)', () => {
  const ROUTE = '/curriculum/lp/:lesson_id/pdf';
  const params = { lesson_id: 'grade_4_english_ch1_seg2' };

  test('minting the link records an external open', async () => {
    const res = await invoke(ROUTE, { params });
    expect(res.body).toMatchObject({ success: true, available: true, url: SIGNED });
    expect(opensWritten().map(([, p]) => p)).toEqual([[TEACHER, 'k5', 'grade_4_english_ch1_seg2', null, 'external', 5]]);
  });

  test('nothing to open records nothing', async () => {
    lessonPdf.mockResolvedValue(null);
    const res = await invoke(ROUTE, { params });
    expect(res.body).toMatchObject({ available: false });
    expect(opensWritten()).toHaveLength(0);
  });

  test('a failing log never changes the answer', async () => {
    poolQuery.mockRejectedValue(new Error('boom'));
    const res = await invoke(ROUTE, { params });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ available: true, url: SIGNED });
  });
});

describe('grades 6-12 — the portal viewer (GET /lp612/file/:render_id)', () => {
  const ROUTE = '/lp612/file/:render_id';

  test('records the SEGMENT and its language — a render id is not a stable plan id', async () => {
    const res = await invoke(ROUTE, { params: { render_id: 'R1' } });
    expect(res.statusCode).toBe(200);
    expect(requestStatus).toHaveBeenCalledWith('R1', TEACHER);
    expect(opensWritten().map(([, p]) => p)).toEqual([[TEACHER, 'g612', 'grade_9_physics.c02.p010', 'en', 'viewer', 5]]);
  });

  test('still being written (409) records nothing', async () => {
    requestStatus.mockResolvedValue({ state: 'authoring', segmentId: 'grade_9_physics.c02.p010' });
    const res = await invoke(ROUTE, { params: { render_id: 'R1' } });
    expect(res.statusCode).toBe(409);
    expect(opensWritten()).toHaveLength(0);
  });

  test('not hers (404) records nothing', async () => {
    requestStatus.mockResolvedValue({ notFound: true });
    const res = await invoke(ROUTE, { params: { render_id: 'R1' } });
    expect(res.statusCode).toBe(404);
    expect(opensWritten()).toHaveLength(0);
  });
});

describe('grades 6-12 — the poll, and another app (GET /lp612/status/:render_id)', () => {
  const ROUTE = '/lp612/status/:render_id';

  test('a plain poll records nothing, even when the lesson is ready', async () => {
    const res = await invoke(ROUTE, { params: { render_id: 'R1' } });
    expect(res.body).toMatchObject({ success: true, state: 'ready', url: SIGNED_612 });
    expect(opensWritten()).toHaveLength(0);
  });

  test('?open=1 on a ready lesson records an external open', async () => {
    await invoke(ROUTE, { params: { render_id: 'R1' }, query: { open: '1' } });
    expect(opensWritten().map(([, p]) => p)).toEqual([[TEACHER, 'g612', 'grade_9_physics.c02.p010', 'en', 'external', 5]]);
  });

  test('?open=1 on a lesson still being written records nothing', async () => {
    requestStatus.mockResolvedValue({ state: 'authoring', segmentId: 'grade_9_physics.c02.p010' });
    await invoke(ROUTE, { params: { render_id: 'R1' }, query: { open: '1' } });
    expect(opensWritten()).toHaveLength(0);
  });
});
