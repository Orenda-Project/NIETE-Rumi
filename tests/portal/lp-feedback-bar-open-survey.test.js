/**
 * One survey per plan: when the survey bar is on for her (portal_lp_feedback_bar), a grades 1-5 plan opened in the app
 * still tells the bot about the open (the coaching ask and the topic-end nudge ride on it), but says `inApp: true`, so
 * the bot skips the WhatsApp survey for it — she is asked at the end of the plan in the app instead.
 *
 * Bar off, its row missing or its read failing → the call is exactly today's ({ openId } only). bd-96f69c.16 — grades
 * 6-12 plans carry the bar too, so their opens say `inApp: true` the same way; her own plan (no bar) does not.
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
  v2On = true;
  jest.doMock('../../dashboard/lib/teacher-app', () => ({
    ...jest.requireActual('../../dashboard/lib/teacher-app'),
    teacherAppOnFor: jest.fn(async () => v2On),
  }));
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
let v2On;

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

// Sceptic pass: the open claims the survey only where the bar can be drawn — her plan (not its answer key), and only
// with the teacher app v2 on for her (GET /config lpFeedbackBar = teacherV2 && the bar). Else WhatsApp still asks.
describe('the bar on, but no bar can be drawn: WhatsApp still asks', () => {
  test('the teacher app v2 is off for her → { openId } only', async () => {
    barOn = true; v2On = false;
    await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });

  test('the answer key, not the plan → { openId } only', async () => {
    barOn = true;
    await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' }, query: { kind: 'answer_key' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });
});

describe('the bar off: exactly today', () => {
  test.each([['off', false], ['read failed', new Error('flag read failed')]])('%s → { openId } only', async (_n, v) => {
    barOn = v;
    await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });

  test('a grades 6-12 open with the bar off → { openId } only', async () => {
    await invoke('/lp612/file/:render_id', { params: { render_id: 'R1' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });
});

// bd-96f69c.16 — the bar is drawn on grades 6-12 plans too, so the open says the app asks.
describe('the bar on: a grades 6-12 open tells the bot the app asks', () => {
  test('a viewer open: { openId, inApp: true }', async () => {
    barOn = true;
    const res = await invoke('/lp612/file/:render_id', { params: { render_id: 'R1' } });
    expect(res.statusCode).toBe(200);
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1', inApp: true }]);
  });

  test('a hand-off to another app (?open=1): the same', async () => {
    barOn = true;
    await invoke('/lp612/status/:render_id', { params: { render_id: 'R1' }, query: { open: '1' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1', inApp: true }]);
  });

  test('the teacher app v2 off for her → { openId } only', async () => {
    barOn = true; v2On = false;
    await invoke('/lp612/file/:render_id', { params: { render_id: 'R1' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });

  test.each([['her own plan', { changesLeft: 2 }], ['a shelf plan', { shelf: true }]])('%s draws no bar → { openId } only', async (_n, extra) => {
    barOn = true;
    require('../../dashboard/services/lp612.service').requestStatus.mockResolvedValue({
      state: 'ready', url: SIGNED_612, segmentId: 'grade_9_physics.c02.p010', lang: 'en', ...extra,
    });
    await invoke('/lp612/file/:render_id', { params: { render_id: 'R1' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });
});
