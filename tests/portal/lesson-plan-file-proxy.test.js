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
 *   4. The bytes are streamed through, as application/pdf, never cached.
 *   5. "Not published yet" / "still being written" are answers (404 / 409), not
 *      faults, so the viewer can say what the old way said.
 */

const { PassThrough } = require('stream');

const R2 = 'https://0123abcd.r2.cloudflarestorage.com';
const SIGNED = `${R2}/niete-bucket/lp-cache/v8/grade_4_english_ch1_seg2/899e05ff4a3d.pdf?X-Amz-Signature=abc`;
const SIGNED_612 = `${R2}/niete-bucket/lp612/v9.2/en/grade_9_physics.c02.p010.pdf?X-Amz-Signature=def`;
const PDF = Buffer.from('%PDF-1.5\n% a lesson plan\n%%EOF\n');

let lessonPdf;
let requestStatus;
let fetchMock;
let savedFetch;
let savedEndpoint;

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
  process.env.R2_ENDPOINT = R2;
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
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('only the lesson plan storage host is ever fetched', () => {
  const isLessonPlanStorageUrl = (url) => require('../../dashboard/lib/lesson-plan-file').isLessonPlanStorageUrl(url);

  test('accepts the configured R2 endpoint and R2 account hosts, over https', () => {
    process.env.R2_ENDPOINT = R2;
    expect(isLessonPlanStorageUrl(SIGNED)).toBe(true);
    expect(isLessonPlanStorageUrl('https://ffee99.r2.cloudflarestorage.com/b/k.pdf?X-Amz-Signature=1')).toBe(true);
  });

  test.each([
    ['plain http', 'http://0123abcd.r2.cloudflarestorage.com/b/k.pdf'],
    ['another host', 'https://example.com/k.pdf'],
    ['a look-alike host', 'https://0123abcd.r2.cloudflarestorage.com.evil.example/k.pdf'],
    ['credentials in the url', 'https://user:pw@0123abcd.r2.cloudflarestorage.com/b/k.pdf'],
    ['the metadata service', 'http://169.254.169.254/latest/meta-data'],
    ['not a url', 'lp-cache/v8/x.pdf'],
    ['nothing', undefined],
  ])('refuses %s', (_label, url) => {
    expect(isLessonPlanStorageUrl(url)).toBe(false);
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
