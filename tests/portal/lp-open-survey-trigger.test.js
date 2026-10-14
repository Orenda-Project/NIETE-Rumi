/**
 * bd-qvevax.2 — a plan opened in the portal's own viewer asks the bot for the lesson-plan survey.
 *
 * The survey is the bot's (it owns the WhatsApp window, the buttons and lp_feedback); the portal
 * only says "this open happened". After a viewer open was RECORDED (niete_lp_opens row written),
 * the portal POSTs the open's id to the bot's internal API. Nothing else triggers it:
 *
 *   viewer open, recorded          → one call, { openId } only (the bot reads the rest from the row)
 *   external open, recorded        → the same (bd-2wgr3d.22.1: a hand-off is a plan taken)
 *   a repeat inside the 5-min window (nothing inserted) → none
 *   a failed / refused open        → none
 *
 * And it is fire-and-forget: a bot that is down, slow or unconfigured never changes or delays the
 * open, and a failure is said at error level.
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

describe('a viewer open that was recorded asks the bot for the survey', () => {
  test('grades 1-5: one call, to the bot\'s internal API, carrying only the open id', async () => {
    const res = await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(200);
    expect(botCalls()).toHaveLength(1);
    const [url, body, config] = botCalls()[0];
    expect(url).toBe('https://bot.example/api/internal/lp/open-survey');
    expect(body).toEqual({ openId: 'open-1' });
    expect(config.headers['x-api-key']).toBe('k-internal');
  });

  test('grades 6-12: the same', async () => {
    const res = await invoke('/lp612/file/:render_id', { params: { render_id: 'R1' } });
    expect(res.statusCode).toBe(200);
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });
});

// bd-2wgr3d.22.1 — operator 14 Oct: a plan handed from the app to another app is a plan taken.
// A hand-off only ever starts inside the app, so it asks for the survey like a viewer open; the
// bot's once-per-plan guard keeps it to one survey whichever came first.
describe('a hand-off to another app that was recorded asks the bot for the survey too', () => {
  test('grades 1-5: the minted link is an open, one call with only the open id', async () => {
    await invoke('/curriculum/lp/:lesson_id/pdf', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(poolQuery).toHaveBeenCalled();
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });

  test('grades 6-12: a status call marked as an open (?open=1) of a ready lesson', async () => {
    await invoke('/lp612/status/:render_id', { params: { render_id: 'R1' }, query: { open: '1' } });
    expect(botCalls().map(([, b]) => b)).toEqual([{ openId: 'open-1' }]);
  });
});

describe('what does NOT ask for a survey', () => {
  test('the 6-12 poll that waits for a lesson to be written (no ?open=1) is not an open', async () => {
    await invoke('/lp612/status/:render_id', { params: { render_id: 'R1' } });
    expect(botCalls()).toHaveLength(0);
  });

  test('a repeat inside the de-dupe window (nothing was inserted)', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(botCalls()).toHaveLength(0);
  });

  test('an open that failed to record', async () => {
    poolQuery.mockRejectedValue(new Error('boom'));
    const res = await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(200);
    expect(botCalls()).toHaveLength(0);
  });

  test('storage refusing the plan (nothing she read)', async () => {
    global.fetch = jest.fn(async () => new Response('<Error/>', { status: 403, headers: { 'content-type': 'application/xml' } }));
    const res = await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(502);
    expect(botCalls()).toHaveLength(0);
  });
});

describe('fire-and-forget — the bot can never cost her the plan', () => {
  test('a bot that is down: the open still answers 200, and the failure is said at error level', async () => {
    axios.post.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(200);
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/open survey/i), expect.any(Object));
  });

  test('a bot that never answers does not delay the open', async () => {
    axios.post.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const res = await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(900);
  });

  test('a portal with no bot configured still opens the plan', async () => {
    delete process.env.MAIN_BOT_URL;
    const res = await invoke('/curriculum/lp/:lesson_id/file', { params: { lesson_id: 'grade_4_english_ch1_seg2' } });
    expect(res.statusCode).toBe(200);
    expect(botCalls()).toHaveLength(0);
  });
});
