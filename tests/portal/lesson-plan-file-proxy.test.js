/**
 * bd-5rz1v.10 — the lesson plan PDF, served from the portal's own origin.
 *
 * The portal now shows lesson plans in its own viewer (pdf.js) instead of
 * handing a presigned R2 link to another app. A viewer has to READ the bytes
 * from the page, and a cross-origin read needs the bucket's CORS to name the
 * page's origin. Measured 2026-10-03 against the production bucket: it allows
 * the production portal, https://localhost and the staging portal, and REFUSES
 * the sandbox portal (403 on preflight). Bucket CORS is not ours to change from
 * here, and a new portal host must not silently break lesson plans, so the
 * bytes come through these two routes instead:
 *
 *   GET /api/portal/curriculum/lp/:lesson_id/file?kind=lesson|answer_key   grades 1-5
 *   GET /api/portal/lp612/file/:render_id                                    grades 6-12
 *
 * Contract:
 *   1. Signed-in only (requirePortalAuth), and the user id comes from the
 *      SESSION — same as the routes that mint the links.
 *   2. Same lookup as today's open: the bot mints the link, the portal holds no
 *      lesson-plan rules.
 *   3. Only the lesson plan storage host is fetched (no open proxy), over https,
 *      without following redirects.
 *      bd-5rz1v.22: "the storage host" is DERIVED from R2_ENDPOINT + R2_BUCKET_NAME, and it has
 *      two legitimate forms — the bucket as a subdomain of the endpoint host (virtual-hosted, what
 *      the bot's S3 client actually signs: measured in Axiom on 3 Oct 2026, every presign on
 *      production, staging and sandbox is https://<bucket>.<account>.r2.cloudflarestorage.com/…)
 *      and the bucket as the first path segment of the endpoint host (path-style). The first
 *      version accepted only a single label before r2.cloudflarestorage.com, so it refused every
 *      lesson plan the bot signs (502 on sandbox), and accepted ANY R2 account's host.
 *   4. The bytes are streamed through, as application/pdf, never cached.
 *   5. "Not published yet" / "still being written" are answers (404 / 409), not
 *      faults, so the viewer can say what the old way said.
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

describe('only the lesson plan storage host is ever fetched', () => {
  const isLessonPlanStorageUrl = (url) => require('../../dashboard/lib/lesson-plan-file').isLessonPlanStorageUrl(url);

  test.each(ENVIRONMENTS)('%s: accepts the URL the bot actually presigns (bucket as a subdomain)', (_env, cfg) => {
    process.env.R2_ENDPOINT = cfg.endpoint;
    process.env.R2_BUCKET_NAME = cfg.bucket;
    expect(isLessonPlanStorageUrl(signedIn(cfg, 'lp-cache/v8/grade_4_english_ch1_seg2/899e05ff4a3d.pdf'))).toBe(true);
    expect(isLessonPlanStorageUrl(signedIn(cfg, 'lp612/v9.9/en/grade_9_biology.c04.p056-056.pdf'))).toBe(true);
  });

  test.each(ENVIRONMENTS)('%s: accepts the same object path-style (bucket as the first path segment)', (_env, cfg) => {
    process.env.R2_ENDPOINT = cfg.endpoint;
    process.env.R2_BUCKET_NAME = cfg.bucket;
    expect(isLessonPlanStorageUrl(`${cfg.endpoint}/${cfg.bucket}/lp-cache/v8/x.pdf?X-Amz-Signature=1`)).toBe(true);
  });

  test('the host is read from the environment, not a list: an endpoint with a trailing slash or upper case still matches', () => {
    process.env.R2_ENDPOINT = `https://${ACCOUNT.toUpperCase()}.R2.cloudflarestorage.com/`;
    process.env.R2_BUCKET_NAME = 'rumi-sandbox';
    expect(isLessonPlanStorageUrl(signedIn({ bucket: 'rumi-sandbox' }, 'k.pdf'))).toBe(true);
  });

  test.each([
    ['plain http', `http://${BUCKET}.${ACCOUNT}.r2.cloudflarestorage.com/k.pdf`],
    ['another host', 'https://example.com/k.pdf'],
    ['a look-alike host', `https://${BUCKET}.${ACCOUNT}.r2.cloudflarestorage.com.evil.example/k.pdf`],
    ['a look-alike endpoint host', `https://${ACCOUNT}.r2.cloudflarestorage.com.evil.example/${BUCKET}/k.pdf`],
    ['credentials in the url', `https://user:pw@${BUCKET}.${ACCOUNT}.r2.cloudflarestorage.com/k.pdf`],
    ['another bucket on the same account', `https://other-bucket.${ACCOUNT}.r2.cloudflarestorage.com/k.pdf`],
    ['a bucket name used as a prefix', `https://${BUCKET}-evil.${ACCOUNT}.r2.cloudflarestorage.com/k.pdf`],
    ['the bucket nested one label deeper', `https://x.${BUCKET}.${ACCOUNT}.r2.cloudflarestorage.com/k.pdf`],
    ['another R2 account', 'https://ffee99.r2.cloudflarestorage.com/b/k.pdf'],
    ['our bucket name on another R2 account', `https://${BUCKET}.ffee99.r2.cloudflarestorage.com/k.pdf`],
    ['path-style, another bucket', `${R2}/other-bucket/k.pdf`],
    ['path-style, a bucket name used as a prefix', `${R2}/${BUCKET}-evil/k.pdf`],
    ['path-style, the bare endpoint', `${R2}/k.pdf`],
    ['the metadata service', 'http://169.254.169.254/latest/meta-data'],
    ['not a url', 'lp-cache/v8/x.pdf'],
    ['nothing', undefined],
  ])('refuses %s', (_label, url) => {
    expect(isLessonPlanStorageUrl(url)).toBe(false);
  });

  test('nothing is accepted when the storage endpoint is not configured', () => {
    delete process.env.R2_ENDPOINT;
    expect(isLessonPlanStorageUrl(SIGNED)).toBe(false);
    expect(isLessonPlanStorageUrl(`${R2}/${BUCKET}/k.pdf`)).toBe(false);
  });

  test('nothing is accepted when the bucket is not configured', () => {
    delete process.env.R2_BUCKET_NAME;
    expect(isLessonPlanStorageUrl(SIGNED)).toBe(false);
    expect(isLessonPlanStorageUrl(`${R2}/${BUCKET}/k.pdf`)).toBe(false);
    expect(isLessonPlanStorageUrl(`${R2}/k.pdf`)).toBe(false);
  });
});

describe('each environment\'s real presigned link streams through both routes (bd-5rz1v.22)', () => {
  test.each(ENVIRONMENTS)('%s: grades 1-5 and 6-12 both answer 200 application/pdf', async (_env, cfg) => {
    process.env.R2_ENDPOINT = cfg.endpoint;
    process.env.R2_BUCKET_NAME = cfg.bucket;
    const k5 = signedIn(cfg, 'lp-cache/v8/grade_4_english_ch1_seg2/899e05ff4a3d.pdf');
    const g612 = signedIn(cfg, 'lp612/v9.9/en/grade_9_biology.c04.p056-056.pdf');
    lessonPdf.mockResolvedValue({ url: k5, asset_kind: 'lesson', version_stamp: 'v8' });
    requestStatus.mockResolvedValue({ state: 'ready', url: g612 });

    const a = await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-type']).toBe('application/pdf');
    expect(a.bytes().equals(PDF)).toBe(true);

    const b = await invoke('/lp612/file/:render_id', { params: { render_id: 'R1' } });
    expect(b.statusCode).toBe(200);
    expect(b.headers['content-type']).toBe('application/pdf');

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([k5, g612]);
  });

  test('a link to another bucket on the same account is refused by the route and never fetched', async () => {
    lessonPdf.mockResolvedValue({ url: `https://other-bucket.${ACCOUNT}.r2.cloudflarestorage.com/k.pdf?X-Amz-Signature=1` });
    const res = await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /curriculum/lp/:lesson_id/file — grades 1-5', () => {
  const ROUTE = '/curriculum/lp/:lesson_id/file';

  test('is signed-in only: no session, no lookup, no fetch', async () => {
    const res = await invoke(ROUTE, { userId: null, params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(401);
    expect(lessonPdf).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('streams the PDF through, as a PDF, from the link the bot minted for THIS teacher', async () => {
    const res = await invoke(ROUTE, { params: { lesson_id: 'grade_4_english_ch1_seg2' }, query: { kind: 'lesson' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers['content-length']).toBe(String(PDF.length));
    expect(res.bytes().equals(PDF)).toBe(true);
    expect(lessonPdf).toHaveBeenCalledWith('grade_4_english_ch1_seg2', 'lesson', 'teacher-1');
    expect(fetchMock).toHaveBeenCalledWith(SIGNED, expect.objectContaining({ redirect: 'manual' }));
  });

  test('asks for the answer key when that is what was opened', async () => {
    await invoke(ROUTE, { params: { lesson_id: 'grade_4_english_ch1_seg2' }, query: { kind: 'answer_key' } });
    expect(lessonPdf).toHaveBeenCalledWith('grade_4_english_ch1_seg2', 'answer_key', 'teacher-1');
  });

  test('not published yet is a 404 answer, not a fault, and nothing is fetched', async () => {
    lessonPdf.mockResolvedValue(null);
    const res = await invoke(ROUTE, { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a link on any other host is refused and never fetched', async () => {
    lessonPdf.mockResolvedValue({ url: 'https://example.com/elsewhere.pdf' });
    const res = await invoke(ROUTE, { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('storage refusing the link is a 502, not a broken PDF', async () => {
    fetchMock.mockResolvedValue(upstream('<Error>SignatureDoesNotMatch</Error>', { status: 403, headers: { 'content-type': 'application/xml' } }));
    const res = await invoke(ROUTE, { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(502);
    expect(res.headers['content-type']).toBeUndefined();
  });

  test('a file far larger than any lesson plan is refused', async () => {
    fetchMock.mockResolvedValue(upstream(PDF, { headers: { 'content-length': String(500 * 1024 * 1024) } }));
    const res = await invoke(ROUTE, { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(413);
  });

  test('the catalogue being down is a 502 the viewer can fall back from', async () => {
    lessonPdf.mockRejectedValue(new Error('bot unreachable'));
    const res = await invoke(ROUTE, { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /lp612/file/:render_id — grades 6-12', () => {
  const ROUTE = '/lp612/file/:render_id';

  test('is signed-in only', async () => {
    const res = await invoke(ROUTE, { userId: null, params: { render_id: 'R1' } });
    expect(res.statusCode).toBe(401);
    expect(requestStatus).not.toHaveBeenCalled();
  });

  test('a ready lesson streams through, checked against THIS teacher', async () => {
    const res = await invoke(ROUTE, { params: { render_id: 'R1' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.bytes().equals(PDF)).toBe(true);
    expect(requestStatus).toHaveBeenCalledWith('R1', 'teacher-1');
    expect(fetchMock).toHaveBeenCalledWith(SIGNED_612, expect.objectContaining({ redirect: 'manual' }));
  });

  test('still being written is a 409 answer', async () => {
    requestStatus.mockResolvedValue({ state: 'authoring' });
    const res = await invoke(ROUTE, { params: { render_id: 'R1' } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ state: 'authoring' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('somebody else\'s (or no such) request is a 404', async () => {
    requestStatus.mockResolvedValue({ notFound: true });
    const res = await invoke(ROUTE, { params: { render_id: 'R9' } });
    expect(res.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
