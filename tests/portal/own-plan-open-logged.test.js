/**
 * bd-snkn32.51 (queue #134 A) — an own plan opened in the viewer leaves one own_plan.opened row: `whose` 'mine' (her own
 * plan; a count above one per ownId is a re-open) or 'shelf' (another teacher's approved plan from the shelf). #120:
 * shelf reuse was not logged at all. Ids only (the plan id, never the author's). Same harness as lp-open-logging.
 */
const { PassThrough } = require('stream');

const R2 = 'https://0123abcd.r2.cloudflarestorage.com';
const BUCKET = 'niete-bucket';
// bd-5rz1v.22 — the shape the bot really signs: the bucket as a subdomain of the R2 endpoint host.
const SIGNED = `https://${BUCKET}.0123abcd.r2.cloudflarestorage.com/lp-cache/v8/grade_4_english_ch1_seg2/899e05ff4a3d.pdf?X-Amz-Signature=abc`;
const SIGNED_612 = `https://${BUCKET}.0123abcd.r2.cloudflarestorage.com/lp612/v9.2/en/grade_9_physics.c02.p010.pdf?X-Amz-Signature=def`;
const PDF = Buffer.from('%PDF-1.5\n% a lesson plan\n%%EOF\n');
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';

let lessonPdf;
let requestStatus;
let fetchMock;
let savedFetch;
let savedEndpoint;
let savedBucket;
let poolQuery;
let consoleError;
let emitted;

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
  savedBucket = process.env.R2_BUCKET_NAME;
  process.env.R2_ENDPOINT = R2;
  process.env.R2_BUCKET_NAME = BUCKET;
  fetchMock = jest.fn(async () => upstream(PDF, { headers: { 'content-length': String(PDF.length) } }));
  global.fetch = fetchMock;

  lessonPdf = jest.fn(async () => ({ url: SIGNED, asset_kind: 'lesson', version_stamp: 'v8' }));
  requestStatus = jest.fn(async () => ({
    state: 'ready', url: SIGNED_612, segmentId: 'grade_9_physics.c02.p010', lang: 'en',
  }));
  poolQuery = jest.fn(async () => ({ rows: [{ id: 'open-1' }] }));
  emitted = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));

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
  if (savedBucket === undefined) delete process.env.R2_BUCKET_NAME; else process.env.R2_BUCKET_NAME = savedBucket;
  jest.restoreAllMocks();
  jest.resetModules();
});


const ROUTE = '/lp612/file/:render_id';
const opened = () => emitted.filter((x) => x.e === 'app_funnel.action' && x.d.action === 'own_plan.opened').map((x) => x.d);

test('her own plan: whose mine, the plan id and band', async () => {
  requestStatus.mockResolvedValue({ state: 'ready', url: SIGNED_612, segmentId: 'L1', lang: 'en', changesLeft: 2, ownBand: 'k5' });
  const res = await invoke(ROUTE, { params: { render_id: 'own-1' } });
  expect(res.statusCode).toBe(200);
  expect(opened()).toEqual([expect.objectContaining({ userId: TEACHER, whose: 'mine', ownId: 'own-1', band: 'k5', feature: 'lesson_plan' })]);
});

test('a shelf plan opened by another teacher: whose shelf', async () => {
  requestStatus.mockResolvedValue({ state: 'ready', url: SIGNED_612, segmentId: 'seg', lang: 'en', shelf: true });
  await invoke(ROUTE, { params: { render_id: 'own-7' } });
  expect(opened()).toEqual([expect.objectContaining({ whose: 'shelf', ownId: 'own-7', band: null })]);
});

test('a ready-made plan is not an own plan: no row', async () => {
  await invoke(ROUTE, { params: { render_id: 'render-1' } });
  expect(opened()).toEqual([]);
});

test('not ready (409): no row', async () => {
  requestStatus.mockResolvedValue({ state: 'authoring', segmentId: 'L1', changesLeft: 2 });
  await invoke(ROUTE, { params: { render_id: 'own-1' } });
  expect(opened()).toEqual([]);
});
