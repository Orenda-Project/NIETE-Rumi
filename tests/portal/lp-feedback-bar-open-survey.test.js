/**
 * One survey per plan: when the survey bar is on for her (portal_lp_feedback_bar), a grades 1-5 plan opened in the app
 * still tells the bot about the open (the coaching ask and the topic-end nudge ride on it), but says `inApp: true`, so
 * the bot skips the WhatsApp survey for it — she is asked at the end of the plan in the app instead.
 *
 * Bar off, its row missing or its read failing → the call is exactly today's ({ openId } only). Grades 6-12 opens are
 * untouched in this release (the bar is shown on grades 1-5 plans only).
 */

const { PassThrough } = require('stream');

const BUCKET = 'niete-bucket';
const SIGNED = `https://${BUCKET}.0123abcd.r2.cloudflarestorage.com/lp-cache/v8/grade_4_english_ch1_seg2/899e05ff4a3d.pdf?X-Amz-Signature=abc`;
const SIGNED_612 = `https://${BUCKET}.0123abcd.r2.cloudflarestorage.com/lp612/v9.2/en/grade_9_physics.c02.p010.pdf?X-Amz-Signature=def`;
const PDF = Buffer.from('%PDF-1.5\n% a lesson plan\n%%EOF\n');
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';

let axios;
let poolQuery;
let consoleError;
let savedEnv;
let savedFetch;

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
  res.on('data', () => {});
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; res.end(); return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  return res;
}

async function invoke(routePath, { params = {}, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', routePath);
  if (!stack) throw new Error(`Route GET ${routePath} not found`);
  const req = {
    session: { portalUserId: TEACHER, id: 'sess-1' },
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
  // let the fire-and-forget write, then the fire-and-forget bot call, run
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setImmediate(r));
  }
  return res;
}

const botCalls = () => axios.post.mock.calls.filter(([url]) => /\/api\/internal\/lp\/open-survey$/.test(url));

beforeEach(() => {
  jest.resetModules();
  savedEnv = { ...process.env };
  savedFetch = global.fetch;
  process.env.R2_ENDPOINT = 'https://0123abcd.r2.cloudflarestorage.com';
  process.env.R2_BUCKET_NAME = BUCKET;
  process.env.MAIN_BOT_URL = 'https://bot.example/';
  process.env.INTERNAL_API_KEY = 'k-internal';
  global.fetch = jest.fn(async () => new Response(PDF, {
    status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) },
  }));

  axios = require('axios');
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { success: true, outcome: 'scheduled' } });
  poolQuery = jest.fn(async () => ({ rows: [{ id: 'open-1' }] }));

  jest.doMock('../../dashboard/config/database', () => ({ query: poolQuery }));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    isValidR2Url: jest.fn(() => true), generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(),
  }));
  jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({
    listGrades: jest.fn(), listSubjects: jest.fn(), listChapters: jest.fn(), listLessons: jest.fn(),
    lessonPdf: jest.fn(async () => ({ url: SIGNED, asset_kind: 'lesson', version_stamp: 'v8' })),
    describePlans: jest.fn(),
  }));
  jest.doMock('../../dashboard/services/lp612.service', () => ({
    listGrades: jest.fn(), listSubjects: jest.fn(), listChapters: jest.fn(), listLessons: jest.fn(),
    requestLesson: jest.fn(),
    requestStatus: jest.fn(async () => ({ state: 'ready', url: SIGNED_612, segmentId: 'grade_9_physics.c02.p010', lang: 'en' })),
    myLessons: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  barOn = false;
  jest.doMock('../../dashboard/lib/lp-app-switches', () => ({
    ...jest.requireActual('../../dashboard/lib/lp-app-switches'),
    isLpFeedbackBarOn: jest.fn(async () => {
      if (barOn instanceof Error) throw barOn;
      return barOn === true;
    }),
  }));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = savedFetch;
  process.env = savedEnv;
  jest.restoreAllMocks();
  jest.resetModules();
});

let barOn;

describe('the bar on: a grades 1-5 open tells the bot the app asks', () => {
  test('a viewer open: { openId, inApp: true }', async () => {
    barOn = true;
    const res = await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(200);
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1', inApp: true }]);
  });

  test('a hand-off to another app: the same', async () => {
    barOn = true;
    await invoke('/curriculum/lp/:lesson_id/pdf', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1', inApp: true }]);
  });
});

describe('the bar off: exactly today', () => {
  test.each([['off', false], ['read failed', new Error('flag read failed')]])('%s → { openId } only', async (_n, v) => {
    barOn = v;
    await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });

  test('grades 6-12 opens are untouched even with the bar on', async () => {
    barOn = true;
    await invoke('/lp612/file/:render_id', { params: { render_id: 'R1' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });
});
