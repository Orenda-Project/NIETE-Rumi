'use strict';
/**
 * bd-zrdvmi.70 — ICT feedback sheet, Lesson Plan rows 986 (part 2) and 984: "teachers cannot access the lesson plan
 * offline". Since 21 Nov ICT and GB plans come through the app, not as a WhatsApp PDF, and the app's Download /
 * "Open in another app" only OPENED the plan (a bare signed link: the phone shows it, keeps nothing).
 *
 * The fix: a `download` ask, end to end, that signs the plan's link as an ATTACHMENT, so the phone saves the PDF and
 * she can open it with no internet:
 *
 *   portal  GET /curriculum/lp/:id/pdf?download=1        → LpCatalogue.lessonPdf(…, { download: true })
 *           GET /lp612/status/:id?open=1&download=1      → Lp612.requestStatus(id, user, { download: true })
 *   client  lp-catalogue / lp612 put `download: true` in the bot body (only when asked: otherwise the body is today's)
 *   bot     POST /api/internal/lp/v8/pdf  { download }   → Browse.lessonPdfUrl(…, { reader, download })
 *           POST /api/internal/lp612/status { download } → getPresignedUrl(url, 3600, { disposition: 'attachment' })
 *
 * Without `download` every route answers exactly as before.
 */
const { PassThrough } = require('stream');

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.methods[method] && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
}

function makeRes() {
  const res = new PassThrough();
  res.statusCode = 200;
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; res.end(); return res; };
  res.setHeader = () => {};
  return res;
}

async function invoke(router, method, routePath, req) {
  const res = makeRes();
  for (const handler of findRoute(router, method, routePath)) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  await new Promise((r) => setImmediate(r));
  return res;
}

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; jest.restoreAllMocks(); jest.resetModules(); });

describe('portal routes pass the download ask on', () => {
  let lessonPdf;
  let requestStatus;
  beforeEach(() => {
    jest.resetModules();
    lessonPdf = jest.fn(async () => ({ url: 'https://b.r2.cloudflarestorage.com/x.pdf?X-Amz-Signature=a', asset_kind: 'lesson' }));
    requestStatus = jest.fn(async () => ({ state: 'ready', url: 'https://b.r2.cloudflarestorage.com/y.pdf?X-Amz-Signature=b', segmentId: 's', lang: 'en' }));
    jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn(async () => ({ rows: [] })) }));
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
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  const req = (params, query) => ({
    session: { portalUserId: TEACHER, id: 's1' }, params, query, body: {}, method: 'GET', ip: '127.0.0.1', headers: {}, get: () => undefined,
  });
  const routes = () => require('../../dashboard/routes/portal.routes');

  test('grades 1-5: ?download=1 asks the catalogue for a download link', async () => {
    const res = await invoke(routes(), 'get', '/curriculum/lp/:lesson_id/pdf', req({ lesson_id: 'grade_4_english_ch1_seg2' }, { kind: 'lesson', download: '1' }));
    expect(res.body).toMatchObject({ available: true });
    expect(lessonPdf).toHaveBeenCalledWith('grade_4_english_ch1_seg2', 'lesson', TEACHER, { download: true });
  });

  test('grades 1-5: no download, the same call as before', async () => {
    await invoke(routes(), 'get', '/curriculum/lp/:lesson_id/pdf', req({ lesson_id: 'grade_4_english_ch1_seg2' }, { kind: 'lesson' }));
    expect(lessonPdf).toHaveBeenCalledWith('grade_4_english_ch1_seg2', 'lesson', TEACHER);
  });

  test('grades 6-12 (and GB): ?download=1 asks the status for a download link', async () => {
    const res = await invoke(routes(), 'get', '/lp612/status/:render_id', req({ render_id: 'R1' }, { open: '1', download: '1' }));
    expect(res.body).toMatchObject({ state: 'ready' });
    expect(requestStatus).toHaveBeenCalledWith('R1', TEACHER, { download: true });
  });

  test('grades 6-12: the poll (no download) is called exactly as before', async () => {
    await invoke(routes(), 'get', '/lp612/status/:render_id', req({ render_id: 'R1' }, {}));
    expect(requestStatus).toHaveBeenCalledWith('R1', TEACHER);
  });
});

describe('portal clients put download in the bot body only when asked', () => {
  let post;
  beforeEach(() => {
    jest.resetModules();
    process.env.MAIN_BOT_URL = 'http://bot';
    process.env.INTERNAL_API_KEY = 'k';
    post = jest.fn(async () => ({ status: 200, data: { success: true, available: true, state: 'ready', url: 'u' } }));
    // The route tests above replace these two modules; here they are the real ones.
    jest.dontMock('../../dashboard/services/lp-catalogue.service');
    jest.dontMock('../../dashboard/services/lp612.service');
    jest.doMock('axios', () => ({ post }));
  });

  test('lp-catalogue lessonPdf', async () => {
    const Cat = require('../../dashboard/services/lp-catalogue.service');
    await Cat.lessonPdf('L1', 'lesson', TEACHER, { download: true });
    expect(post.mock.calls[0][1]).toEqual({ lessonId: 'L1', assetKind: 'lesson', userId: TEACHER, download: true });
    await Cat.lessonPdf('L1', 'lesson', TEACHER);
    expect(post.mock.calls[1][1]).toEqual({ lessonId: 'L1', assetKind: 'lesson', userId: TEACHER });
  });

  test('lp612 requestStatus', async () => {
    const Lp612 = require('../../dashboard/services/lp612.service');
    await Lp612.requestStatus('R1', TEACHER, { download: true });
    expect(post.mock.calls[0][1]).toEqual({ renderId: 'R1', userId: TEACHER, download: true });
    await Lp612.requestStatus('R1', TEACHER);
    expect(post.mock.calls[1][1]).toEqual({ renderId: 'R1', userId: TEACHER });
  });
});

describe('bot internal routes sign a download as an attachment', () => {
  let getPresignedUrl;
  let lessonPdfUrl;
  beforeEach(() => {
    jest.resetModules();
    getPresignedUrl = jest.fn(async (u) => `${u}?sig`);
    lessonPdfUrl = jest.fn(async () => ({ url: 'u', asset_kind: 'lesson', version_stamp: 'v' }));
    jest.doMock('../../bot/shared/middleware/require-internal-key', () => ({ requireInternalKey: (_q, _s, next) => next() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/config/lp612-flags', () => ({ isGbK5Enabled: () => false }));
    jest.doMock('../../bot/shared/services/lp-v8-browse.service', () => ({ lessonPdfUrl }));
    jest.doMock('../../bot/shared/services/lp-v8-lifecycle.service', () => ({ recordPortalLesson: jest.fn(async () => {}) }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ buildR2PublicUrl: (k) => `https://r2/b/${k}`, getPresignedUrl }));
    jest.doMock('../../bot/shared/services/lp612-browse.service', () => ({
      renderStatus: jest.fn(async () => ({ status: 'ready', r2_key: 'lp612/v9/en/grade_9_physics.c02.p010.pdf', segment_id: 'grade_9_physics.c02.p010', lang: 'en' })),
    }));
    jest.doMock('../../bot/shared/services/lp-own-edit-guard', () => ({ statusFields: () => ({}) }));
  });
  const internal = () => require('../../bot/shared/routes/internal-api.routes');
  const post = (body) => ({ body, params: {}, query: {}, headers: {}, get: () => undefined });

  test('/lp/v8/pdf passes download to the browse service', async () => {
    await invoke(internal(), 'post', '/lp/v8/pdf', post({ lessonId: 'L1', userId: TEACHER, download: true }));
    expect(lessonPdfUrl).toHaveBeenCalledWith('L1', 'lesson', TEACHER, { reader: null, download: true });
  });

  test('/lp/v8/pdf without download: as before', async () => {
    await invoke(internal(), 'post', '/lp/v8/pdf', post({ lessonId: 'L1', userId: TEACHER }));
    expect(lessonPdfUrl).toHaveBeenCalledWith('L1', 'lesson', TEACHER, { reader: null });
  });

  test('/lp612/status with download: an attachment named for the plan', async () => {
    const res = await invoke(internal(), 'post', '/lp612/status', post({ renderId: 'R1', userId: TEACHER, download: true }));
    expect(res.body).toMatchObject({ state: 'ready' });
    expect(getPresignedUrl).toHaveBeenCalledWith(expect.any(String), 3600,
      { disposition: 'attachment', filename: 'grade_9_physics.c02.p010.pdf' });
  });

  test('/lp612/status without download: today\'s bare signing', async () => {
    await invoke(internal(), 'post', '/lp612/status', post({ renderId: 'R1', userId: TEACHER }));
    expect(getPresignedUrl.mock.calls[0]).toHaveLength(1);
  });
});
