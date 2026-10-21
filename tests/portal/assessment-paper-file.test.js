/**
 * A paper's PDF, served from the portal's own origin, for the teacher app's viewer on Paper ready.
 *
 * Paper ready now shows the paper itself in the app (the lesson plan viewer: pdf.js), instead of only a Download that
 * hands a presigned link to another app. A viewer READS the bytes from the page, and the bucket's CORS refuses the
 * sandbox portal (measured for lesson plans, lib/lesson-plan-file.js), so the bytes come through this route:
 *
 *   GET /api/portal/assessment/paper/:paper_id/file?artifact=paper|answer_key
 *
 * Contract, as the lesson plan file routes:
 *   1. Signed-in only, and the user id comes from the SESSION.
 *   2. The same lookup as /download (the bot mints the link for this teacher's own paper); nothing else decides.
 *   3. Only the storage host is fetched (relayLessonPlanPdf: https, no redirects, no open proxy).
 *   4. Not hers, not made yet, or no answer key is an answer (404 available:false), not a fault; a failed lookup is 502.
 */

const { PassThrough } = require('stream');

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const R2 = `https://${ACCOUNT}.r2.cloudflarestorage.com`;
const BUCKET = 'niete-bucket';
// The shape the bot's S3 client really signs (virtual-hosted: the bucket is a subdomain).
const SIGNED = `https://${BUCKET}.${ACCOUNT}.r2.cloudflarestorage.com/lp-cache/v8/grade_4_english_ch1_seg2/899e05ff4a3d.pdf?X-Amz-Signature=abc`;
const SIGNED_612 = `https://${BUCKET}.${ACCOUNT}.r2.cloudflarestorage.com/lp612/v9.2/en/grade_9_physics.c02.p010.pdf?X-Amz-Signature=def`;

/**
 * The three NIETE environments as Railway configures them (read 3 Oct 2026; same endpoint
 * host everywhere, the bucket differs), and the URL the bot presigns in each — the shape logged
 * as "Presigned: https://<bucket>.<account>.r2.cloudflarestorage.com/…" in Axiom.
 */
const ENVIRONMENTS = [
  ['production', { endpoint: R2, bucket: 'digital-coach-audio' }],
  ['staging', { endpoint: R2, bucket: 'digital-coach-audio' }],
  ['sandbox', { endpoint: R2, bucket: 'rumi-sandbox' }],
];
const signedIn = ({ bucket }, key) => `https://${bucket}.${ACCOUNT}.r2.cloudflarestorage.com/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc`;
const PDF = Buffer.from('%PDF-1.5\n% a lesson plan\n%%EOF\n');

let lessonPdf;
let paperDownload;
let requestStatus;
let fetchMock;
let savedFetch;
let savedEndpoint;
let savedBucket;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if (layer.route.methods[method] && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}

/** A response that is also a real writable stream, so a pipe into it works. */
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

async function invoke(routePath, { userId = 'teacher-1', params = {}, query = {} } = {}) {
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
  requestStatus = jest.fn(async () => ({ state: 'ready', url: SIGNED_612 }));
  paperDownload = jest.fn(async () => ({ url: PAPER, filename: 'Grade 4 Science.pdf' }));

  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    isValidR2Url: jest.fn(() => true), generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(),
  }));
  jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({
    listGrades: jest.fn(), listSubjects: jest.fn(), listChapters: jest.fn(), listLessons: jest.fn(), lessonPdf,
  }));
  jest.doMock('../../dashboard/services/lp612.service', () => ({
    listGrades: jest.fn(), listSubjects: jest.fn(), listChapters: jest.fn(), listLessons: jest.fn(),
    requestLesson: jest.fn(), requestStatus, myLessons: jest.fn(),
  }));
  jest.doMock('../../dashboard/services/assessment.service', () => ({
    options: jest.fn(), listChapters: jest.fn(), create: jest.fn(), status: jest.fn(), download: paperDownload,
    listPapers: jest.fn(), viewPaper: jest.fn(), editVersions: jest.fn(), editQuestions: jest.fn(), editAddKinds: jest.fn(),
    editValidate: jest.fn(), editSave: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = savedFetch;
  if (savedEndpoint === undefined) delete process.env.R2_ENDPOINT; else process.env.R2_ENDPOINT = savedEndpoint;
  if (savedBucket === undefined) delete process.env.R2_BUCKET_NAME; else process.env.R2_BUCKET_NAME = savedBucket;
  jest.restoreAllMocks();
  jest.resetModules();
});


// The link the bot mints for a paper (virtual-hosted, like every presign it signs).
const PAPER = `https://${BUCKET}.${ACCOUNT}.r2.cloudflarestorage.com/assessments/req-9/paper.pdf?X-Amz-Signature=p1`;

describe('GET /assessment/paper/:paper_id/file', () => {
  const ROUTE = '/assessment/paper/:paper_id/file';

  test('is signed-in only: no session, no lookup, no fetch', async () => {
    const res = await invoke(ROUTE, { userId: null, params: { paper_id: 'paper-1' } });
    expect(res.statusCode).toBe(401);
    expect(paperDownload).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('streams the paper through, as a PDF, from the link the bot minted for THIS teacher', async () => {
    const res = await invoke(ROUTE, { params: { paper_id: 'paper-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.bytes().equals(PDF)).toBe(true);
    expect(paperDownload).toHaveBeenCalledWith('paper-1', 'teacher-1', 'paper');
    expect(fetchMock).toHaveBeenCalledWith(PAPER, expect.objectContaining({ redirect: 'manual' }));
  });

  test('the answer key when that is what was opened', async () => {
    await invoke(ROUTE, { params: { paper_id: 'paper-1' }, query: { artifact: 'answer_key' } });
    expect(paperDownload).toHaveBeenCalledWith('paper-1', 'teacher-1', 'answer_key');
  });

  test('not hers, not made yet, or no key: 404 available false, nothing fetched', async () => {
    paperDownload.mockResolvedValue(null);
    const res = await invoke(ROUTE, { params: { paper_id: 'paper-1' } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: true, available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a failed lookup is a 502 the viewer falls back from', async () => {
    paperDownload.mockRejectedValue(new Error('bot down'));
    const res = await invoke(ROUTE, { params: { paper_id: 'paper-1' } });
    expect(res.statusCode).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a link outside the storage host is refused and never fetched', async () => {
    paperDownload.mockResolvedValue({ url: 'https://example.com/paper.pdf' });
    const res = await invoke(ROUTE, { params: { paper_id: 'paper-1' } });
    expect(res.statusCode).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
