/**
 * Portal Assessment Generator endpoints — browser surface for the UG_EG-backed
 * Assessment Generator (previously WhatsApp-Flow-only).
 *
 *   POST /api/portal/assessment/generate      → { success, jobId }
 *   GET  /api/portal/assessment/status/:jobId  → { success, status, downloadUrl?, filename?, error? }
 *
 * Both require portal auth. A job→{userId,spec,filename} link lives in Redis
 * (~30min TTL) so status can (a) authorize the caller (403 for a different
 * teacher) and (b) name the rendered file.
 *
 * Testing shape mirrors tests/training/portal-training-attempts.test.js: locate
 * the route layer on the mounted portal router and invoke its handler stack
 * (auth middleware → route handler) with a fake req/res. All bot deps are
 * mocked. The endpoints require the bot deps LAZILY inside the handler (not at
 * module top) — html-to-pdf pulls in Playwright and html-to-docx pulls in
 * @turbodocx, neither installed in the OSS root test job — so portal.routes.js
 * stays loadable here.
 */

let redisStore;

// Locate an express route layer by method + path on the router stack.
function findRoute(router, method, routePath) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const methods = layer.route.methods || {};
    if (methods[method] && layer.route.path === routePath) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

// Invoke a handler stack (auth middleware → route handler) with a fake req/res.
async function invoke({ method, routePath, userId, params = {}, query = {}, body = {}, headers = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, routePath);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${routePath} not found on router`);

  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params,
    query,
    body,
    method: method.toUpperCase(),
    path: routePath,
    ip: '127.0.0.1',
    headers: lowerHeaders,
    get: (name) => lowerHeaders[String(name).toLowerCase()],
  };

  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(bodyOut) { payload = bodyOut; return this; },
  };

  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => resolve(), () => resolve());
      } else if (advanced === false) {
        resolve();
      }
    });
  }
  return { statusCode, payload };
}

let submitJobMock;
let pollStatusMock;
let htmlToPdfMock;
let htmlToDocxMock;
let uploadExamBufferMock;
let getPresignedUrlMock;

beforeEach(() => {
  jest.resetModules();
  redisStore = new Map();

  // ── portal.routes top-level deps ────────────────────────────────────────
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) })),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });

  // ── bot deps the assessment endpoints require lazily ────────────────────
  submitJobMock = jest.fn(async () => ({ jobId: 'J1' }));
  pollStatusMock = jest.fn(async () => ({
    status: 'completed',
    data: { exam_paper: '<html><body><h1>Exam</h1></body></html>' },
  }));
  jest.doMock('../../bot/shared/services/assessment-generator-client.service', () => ({
    submitJob: (...a) => submitJobMock(...a),
    pollStatus: (...a) => pollStatusMock(...a),
    isConfigured: jest.fn(() => true),
  }));

  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: jest.fn(async (k) => (redisStore.has(k) ? redisStore.get(k) : null)),
    set: jest.fn(async (k, v) => { redisStore.set(k, v); return true; }),
    delete: jest.fn(async (k) => { redisStore.delete(k); return true; }),
  }));

  htmlToPdfMock = jest.fn(async () => Buffer.from('%PDF-1.4 stub'));
  htmlToDocxMock = jest.fn(async () => Buffer.from('PK\x03\x04 stub'));
  jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: (...a) => htmlToPdfMock(...a) }), { virtual: true });
  jest.doMock('../../bot/shared/utils/html-to-docx', () => ({ htmlToDocx: (...a) => htmlToDocxMock(...a) }), { virtual: true });

  uploadExamBufferMock = jest.fn(async ({ filename }) => `exams/u/J1/${filename}`);
  getPresignedUrlMock = jest.fn(async (url) => `${url}?X-Amz-Signature=stub`);
  jest.doMock('../../bot/shared/storage/r2', () => ({
    uploadExamBuffer: (...a) => uploadExamBufferMock(...a),
    buildR2PublicUrl: (key) => `https://r2.example/bucket/${key}`,
    getPresignedUrl: (...a) => getPresignedUrlMock(...a),
  }), { virtual: true });
});

afterEach(() => jest.resetModules());

const VALID_BODY = {
  generationType: 'exam',
  grade: 4,
  subject: 'Eng',
  pageRanges: '10-15',
  contentSource: 'unseen',
  questionTypes: [{ id: 'MCQs', count: 5, category: 'objective' }],
};

describe('POST /api/portal/assessment/generate', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invoke({ method: 'post', routePath: '/assessment/generate', userId: null, body: VALID_BODY });
    expect(statusCode).toBe(401);
  });

  it('submits the job and returns { jobId }', async () => {
    const { statusCode, payload } = await invoke({
      method: 'post', routePath: '/assessment/generate', userId: 'user-1', body: VALID_BODY,
    });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.jobId).toBe('J1');
    expect(submitJobMock).toHaveBeenCalledTimes(1);
    // spec forwarded to the engine matches the buildRequestBody contract
    const spec = submitJobMock.mock.calls[0][0];
    expect(spec).toMatchObject({
      generationType: 'exam', grade: 4, subject: 'Eng', pageRanges: '10-15',
      contentSource: 'unseen', curriculum: 'ICT',
    });
    expect(spec.questionTypes[0]).toMatchObject({ id: 'MCQs', count: 5, category: 'objective' });
  });

  // UG_EG's /api/v2/generate-exam REQUIRES callback_url even when we retrieve by
  // polling — a submit without it 400s ("callback_url: Field required"), which was
  // the live "Failed to queue assessment" error. The portal must always pass a
  // callback that points at ITS OWN host (never the bot webhook).
  it('always passes a portal-owned callback_url derived from the request host', async () => {
    const { statusCode } = await invoke({
      method: 'post', routePath: '/assessment/generate', userId: 'user-1', body: VALID_BODY,
      headers: { 'x-forwarded-proto': 'https', host: 'portal.example.railway.app' },
    });
    expect(statusCode).toBe(200);
    const opts = submitJobMock.mock.calls[0][1] || {};
    expect(opts.callbackUrl).toBe(
      'https://portal.example.railway.app/api/portal/assessment/callback',
    );
  });

  it('falls back to https + x-forwarded-host when host header is absent', async () => {
    await invoke({
      method: 'post', routePath: '/assessment/generate', userId: 'user-1', body: VALID_BODY,
      headers: { 'x-forwarded-host': 'example.up.railway.app' },
    });
    const opts = submitJobMock.mock.calls[0][1] || {};
    expect(opts.callbackUrl).toBe('https://example.up.railway.app/api/portal/assessment/callback');
  });

  it('stores the Redis job link keyed by jobId with userId + spec + filename', async () => {
    await invoke({ method: 'post', routePath: '/assessment/generate', userId: 'user-1', body: VALID_BODY });
    const link = redisStore.get('portal_assessment_job:J1');
    expect(link).toBeTruthy();
    expect(link.userId).toBe('user-1');
    expect(link.filename).toEqual(expect.stringContaining('Grade4'));
    expect(link.spec).toMatchObject({ subject: 'Eng', grade: 4 });
  });

  it('rejects an invalid grade', async () => {
    const { statusCode } = await invoke({
      method: 'post', routePath: '/assessment/generate', userId: 'user-1',
      body: { ...VALID_BODY, grade: 9 },
    });
    expect(statusCode).toBe(400);
  });

  it('rejects contentSource="both" with a clear message (single-job status contract)', async () => {
    const { statusCode, payload } = await invoke({
      method: 'post', routePath: '/assessment/generate', userId: 'user-1',
      body: { ...VALID_BODY, contentSource: 'both' },
    });
    expect(statusCode).toBe(400);
    expect(String(payload.error)).toMatch(/seen|unseen/i);
    expect(submitJobMock).not.toHaveBeenCalled();
  });

  it('rejects a body with no question types', async () => {
    const { statusCode } = await invoke({
      method: 'post', routePath: '/assessment/generate', userId: 'user-1',
      body: { ...VALID_BODY, questionTypes: [] },
    });
    expect(statusCode).toBe(400);
  });
});

describe('POST /api/portal/assessment/callback', () => {
  // UG_EG POSTs the finished exam here because callback_url is required. The
  // portal retrieves results by polling, so this is a deliberate no-op ack that
  // just 200s (so UG_EG doesn't retry). No auth — UG_EG can't authenticate.
  it('acknowledges any POST with 200 and requires no auth', async () => {
    const { statusCode, payload } = await invoke({
      method: 'post', routePath: '/assessment/callback', userId: null,
      body: { job_id: 'J1', status: 'completed' },
    });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ received: true });
  });
});

describe('GET /api/portal/assessment/status/:jobId', () => {
  async function seedLink(userId = 'user-1', outputFormat = 'pdf') {
    redisStore.set('portal_assessment_job:J1', {
      jobId: 'J1', userId, outputFormat, filename: 'Grade4_Eng_Exam',
      spec: { grade: 4, subject: 'Eng' },
    });
  }

  it('requires portal auth (401 when unauthenticated)', async () => {
    await seedLink();
    const { statusCode } = await invoke({ method: 'get', routePath: '/assessment/status/:jobId', userId: null, params: { jobId: 'J1' } });
    expect(statusCode).toBe(401);
  });

  it('403s when the Redis link belongs to a different user', async () => {
    await seedLink('someone-else');
    const { statusCode } = await invoke({
      method: 'get', routePath: '/assessment/status/:jobId', userId: 'user-1', params: { jobId: 'J1' },
    });
    expect(statusCode).toBe(403);
  });

  it('403s when there is no Redis link for the job', async () => {
    const { statusCode } = await invoke({
      method: 'get', routePath: '/assessment/status/:jobId', userId: 'user-1', params: { jobId: 'nope' },
    });
    expect(statusCode).toBe(403);
  });

  it('renders + uploads + returns a downloadUrl on completed (PDF default)', async () => {
    await seedLink();
    const { statusCode, payload } = await invoke({
      method: 'get', routePath: '/assessment/status/:jobId', userId: 'user-1', params: { jobId: 'J1' },
    });
    expect(statusCode).toBe(200);
    expect(payload.status).toBe('completed');
    expect(htmlToPdfMock).toHaveBeenCalledTimes(1);
    expect(uploadExamBufferMock).toHaveBeenCalledTimes(1);
    expect(payload.downloadUrl).toEqual(expect.stringContaining('X-Amz-Signature'));
    expect(payload.filename).toMatch(/\.pdf$/);
  });

  it('renders DOCX when ?format=docx', async () => {
    await seedLink();
    const { payload } = await invoke({
      method: 'get', routePath: '/assessment/status/:jobId', userId: 'user-1',
      params: { jobId: 'J1' }, query: { format: 'docx' },
    });
    expect(htmlToDocxMock).toHaveBeenCalledTimes(1);
    expect(htmlToPdfMock).not.toHaveBeenCalled();
    expect(payload.filename).toMatch(/\.docx$/);
  });

  it('returns { status: "processing" } while pending (no render)', async () => {
    await seedLink();
    pollStatusMock.mockResolvedValueOnce({ status: 'processing' });
    const { payload } = await invoke({
      method: 'get', routePath: '/assessment/status/:jobId', userId: 'user-1', params: { jobId: 'J1' },
    });
    expect(payload.status).toBe('processing');
    expect(htmlToPdfMock).not.toHaveBeenCalled();
  });

  it('returns { status: "failed", error } when the job failed', async () => {
    await seedLink();
    pollStatusMock.mockResolvedValueOnce({ status: 'failed', error: 'boom' });
    const { payload } = await invoke({
      method: 'get', routePath: '/assessment/status/:jobId', userId: 'user-1', params: { jobId: 'J1' },
    });
    expect(payload.status).toBe('failed');
    expect(payload.error).toBe('boom');
  });
});
