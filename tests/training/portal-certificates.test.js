/**
 * The portal's certificate surface — identity here, everything else in the bot.
 *
 * The portal used to read `training_certificates` itself and presign R2 keys
 * itself. Both moved to the bot, because the RENDER has to live there: a
 * `require('pdfkit')` from bot/shared resolves via bot/node_modules and the
 * repo root, never dashboard/node_modules, so a portal-side mint works in a
 * dev tree and fails in production. Once the mint is in the bot, splitting the
 * read from it would mean two places that know what a certificate is.
 *
 * What the portal keeps is the ONE thing it owns: who is asking. Both routes
 * take the userId from `req.session.portalUserId` and pass it down. Neither
 * accepts an id from the URL, the query or the body — so there is no shape of
 * request that reaches someone else's certificate.
 *
 * TWO ROUTES:
 *   GET /training/certificates                  list — never mints
 *   GET /training/certificates/:code/download   fetch-or-mint, then 302 to R2
 *
 * The split is why a mint failure can never take down the list: the list does
 * not mint. A certificate whose PDF will not render still lists, and only its
 * download errors.
 */

let listCertificates;
let getCertificatePdf;

const USER = 'user-uuid-1';
const CODE = 'PFX-20260802-NEW111';

const BOT_LIST = [
  { id: 'cert-new', certificate_code: CODE, level_name: 'Aspiring Teacher', teacher_name: 'Amina Khan', issued_at: '2026-08-02T10:00:00Z', has_pdf: true },
  { id: 'cert-old', certificate_code: 'PFX-L1-20260712-OLD222', level_name: 'Teacher Leader', teacher_name: 'Amina Khan', issued_at: '2026-07-12T09:00:00Z', has_pdf: false },
];

beforeEach(() => {
  jest.resetModules();

  listCertificates = jest.fn().mockResolvedValue(BOT_LIST);
  getCertificatePdf = jest.fn().mockResolvedValue({
    certificate_code: CODE,
    download_url: 'https://r2.example.com/bucket/certs/u/x.pdf?X-Amz-Signature=abc',
    minted: false,
  });
  jest.doMock('../../dashboard/services/certificates.service', () => ({
    listCertificates, getCertificatePdf,
  }));

  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

function findRoute(router, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {}).get && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { userId, params = {}, query = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, path);
  if (!stack) throw new Error(`Route GET ${path} not found on router`);

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, query, body, method: 'GET', path,
    ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  let redirectedTo = null;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
    redirect(a, b) {
      if (typeof a === 'number') { statusCode = a; redirectedTo = b; } else { statusCode = 302; redirectedTo = a; }
      return this;
    },
  };

  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload, redirectedTo };
}

const LIST_PATH = '/training/certificates';
const DL_PATH = '/training/certificates/:code/download';

describe('GET /api/portal/training/certificates — list', () => {
  it('requires portal auth', async () => {
    const { statusCode } = await invoke(LIST_PATH, { userId: null });
    expect(statusCode).toBe(401);
    expect(listCertificates).not.toHaveBeenCalled();
  });

  it('delegates to the bot with the SESSION user id', async () => {
    const { statusCode, payload } = await invoke(LIST_PATH, { userId: USER });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(listCertificates).toHaveBeenCalledWith(USER);
  });

  it('ignores any user id supplied by the request', async () => {
    await invoke(LIST_PATH, { userId: USER, query: { userId: 'attacker' }, body: { userId: 'attacker' } });
    expect(listCertificates).toHaveBeenCalledWith(USER);
  });

  it('holds no certificate logic of its own — rows come back as the bot sent them', async () => {
    const { payload } = await invoke(LIST_PATH, { userId: USER });
    expect(payload.certificates.map((c) => c.certificate_code))
      .toEqual([CODE, 'PFX-L1-20260712-OLD222']);
    expect(payload.certificates[0].level_name).toBe('Aspiring Teacher');
    expect(payload.certificates[1].has_pdf).toBe(false);
  });

  it('gives every certificate a download route, including one with no PDF yet', async () => {
    // The point of fetch-or-mint: "no PDF yet" is no longer a dead end.
    const { payload } = await invoke(LIST_PATH, { userId: USER });
    expect(payload.certificates[0].download_url)
      .toBe(`/api/portal/training/certificates/${CODE}/download`);
    expect(payload.certificates[1].download_url)
      .toBe('/api/portal/training/certificates/PFX-L1-20260712-OLD222/download');
  });

  it('NEVER mints while listing — 40 certificates must not mean 40 renders', async () => {
    await invoke(LIST_PATH, { userId: USER });
    expect(getCertificatePdf).not.toHaveBeenCalled();
  });

  it('returns an empty list rather than an error when the teacher has none', async () => {
    listCertificates.mockResolvedValueOnce([]);
    const { statusCode, payload } = await invoke(LIST_PATH, { userId: USER });
    expect(statusCode).toBe(200);
    expect(payload.certificates).toEqual([]);
  });

  it('surfaces a lookup failure as 500 rather than a plausible empty list', async () => {
    listCertificates.mockRejectedValueOnce(new Error('bot unreachable'));
    const { statusCode, payload } = await invoke(LIST_PATH, { userId: USER });
    expect(statusCode).toBe(500);
    expect(payload.success).toBe(false);
    expect(payload.certificates).toBeUndefined();
  });
});

describe('GET /api/portal/training/certificates/:code/download — fetch or mint', () => {
  it('requires portal auth', async () => {
    const { statusCode } = await invoke(DL_PATH, { userId: null, params: { code: CODE } });
    expect(statusCode).toBe(401);
    expect(getCertificatePdf).not.toHaveBeenCalled();
  });

  it('asks the bot with the SESSION user id and the code from the path', async () => {
    await invoke(DL_PATH, { userId: USER, params: { code: CODE } });
    // bd-2676 added the third argument. Plain (no ?view) stays 'attachment', so
    // every link that existed before this change still SAVES the file.
    expect(getCertificatePdf).toHaveBeenCalledWith(USER, CODE, 'attachment');
  });

  it('asks for an INLINE url when ?view=1 is present (bd-2676)', async () => {
    // The View button. Reported from the app: the certificate downloaded in the
    // background instead of being readable.
    await invoke(DL_PATH, { userId: USER, params: { code: CODE }, query: { view: '1' } });
    expect(getCertificatePdf).toHaveBeenCalledWith(USER, CODE, 'inline');
  });

  it('still enforces the session on the view variant', async () => {
    // A viewable url is the same bearer token as a downloadable one.
    const { statusCode } = await invoke(DL_PATH, {
      userId: null, params: { code: CODE }, query: { view: '1' },
    });
    expect(statusCode).toBe(401);
    expect(getCertificatePdf).not.toHaveBeenCalled();
  });

  it('redirects to the signed R2 url', async () => {
    const { statusCode, redirectedTo } = await invoke(DL_PATH, { userId: USER, params: { code: CODE } });
    expect(statusCode).toBe(302);
    expect(redirectedTo).toContain('X-Amz-Signature');
  });

  it('mints on the first request for a legacy certificate and still redirects', async () => {
    getCertificatePdf.mockResolvedValueOnce({
      certificate_code: 'PFX-L1-20260712-OLD222',
      download_url: 'https://r2.example.com/bucket/certs/u/old.pdf?X-Amz-Signature=zzz',
      minted: true,
    });
    const { statusCode, redirectedTo } = await invoke(DL_PATH, {
      userId: USER, params: { code: 'PFX-L1-20260712-OLD222' },
    });
    expect(statusCode).toBe(302);
    expect(redirectedTo).toContain('old.pdf');
  });

  it('404s for a certificate that is not this teacher\'s', async () => {
    getCertificatePdf.mockResolvedValueOnce({ notFound: true });
    const { statusCode, payload } = await invoke(DL_PATH, { userId: USER, params: { code: 'SOMEONE-ELSES' } });
    expect(statusCode).toBe(404);
    expect(payload.success).toBe(false);
  });

  it('502s when the PDF could not be produced — and says so', async () => {
    getCertificatePdf.mockResolvedValueOnce(null);
    const { statusCode, payload } = await invoke(DL_PATH, { userId: USER, params: { code: CODE } });
    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
  });

  it('400s without a code', async () => {
    const { statusCode } = await invoke(DL_PATH, { userId: USER, params: {} });
    expect(statusCode).toBe(400);
    expect(getCertificatePdf).not.toHaveBeenCalled();
  });

  it('a download failure leaves the LIST working', async () => {
    getCertificatePdf.mockResolvedValueOnce(null);
    await invoke(DL_PATH, { userId: USER, params: { code: CODE } });

    const { statusCode, payload } = await invoke(LIST_PATH, { userId: USER });
    expect(statusCode).toBe(200);
    expect(payload.certificates).toHaveLength(2);
  });
});

describe('the portal route holds no certificate logic', () => {
  const fs = require('fs');
  const path = require('path');

  it('no longer reads training_certificates or builds R2 keys itself', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8',
    );
    // Scoped to the certificate routes: the rest of this very large router
    // legitimately queries plenty of other tables.
    const start = src.indexOf("router.get('/training/certificates'");
    const end = src.indexOf("router.get('/training/levels'");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);

    expect(block).not.toMatch(/from\(['"]training_certificates['"]\)/);
    expect(block).not.toMatch(/pdf_r2_key/);
    expect(block).not.toMatch(/generatePresignedUrl/);
    expect(block).not.toMatch(/R2_BUCKET_NAME|R2_ENDPOINT/);
  });
});
