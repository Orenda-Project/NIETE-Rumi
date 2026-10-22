/**
 * bd-4joiqz — a LEADER reading a lesson plan is not a teacher's open.
 *
 * "why can't a coach see LPs in their IAB? Shouldnt we make them available?" (operator, 22 Oct 2026). Coaches, and
 * principals who are not on the teacher app, now read the plans teachers get. Their opens must not feed anything that
 * reads an open as "a teacher used this plan":
 *
 *   no niete_lp_opens row     (Recent, Home counts, the quiz offer, the coaching ask, the ready-WhatsApp sweep …)
 *   no "was this useful?"     (the survey request to the bot's internal API)
 *   no teacher named to the   (the bot's K-5 PDF lookup records a lifecycle row and picks the user's A/B group
 *   K-5 PDF lookup             from the user it is given: a leader is not given)
 *
 * and instead emit ONE telemetry event, `lp.leader_open`, ids only. The role is the server's: read from `users`
 * on every open, never from the request. A principal ON the teacher app is a teacher here (unchanged), and a
 * teacher's open is exactly today's.
 *
 * Mocked: the pg pool and supabase (the DB), axios (the bot's HTTP API), global fetch (storage), the telemetry
 * sink. Everything between them — portal.routes, portal-fln.routes, fln-access, feature-flags, leader-role,
 * lp-activity, lp-open-survey.client, the reader — is real.
 */

const { PassThrough } = require('stream');
const http = require('http');
const express = require('express');
const { build, VERSION } = require('./fixtures/fln-corpus.fixture');

const BUCKET = 'niete-bucket';
const SIGNED = `https://${BUCKET}.0123abcd.r2.cloudflarestorage.com/lp-cache/v8/grade_4_english_ch1_seg2/899e05ff4a3d.pdf?X-Amz-Signature=abc`;
const SIGNED_612 = `https://${BUCKET}.0123abcd.r2.cloudflarestorage.com/lp612/v9.2/en/grade_9_physics.c02.p010.pdf?X-Amz-Signature=def`;
const PDF = Buffer.from('%PDF-1.5\n% a lesson plan\n%%EOF\n');

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const COACH = '1a2b3c4d-0b8d-4c55-9a51-2d7f0e3b9c11';
const PRINCIPAL = '2b3c4d5e-0b8d-4c55-9a51-2d7f0e3b9c12';
const AEO = '3c4d5e6f-0b8d-4c55-9a51-2d7f0e3b9c13';
const RENDER = '9d8c7b6a-0b8d-4c55-9a51-2d7f0e3b9c99';
const SEGMENT = 'grade_9_physics.c02.p010';
const K5 = 'grade_4_english_ch1_seg2';

const ENV = { ...process.env };

let axios;
let queries;
let users;
let settings;
let events;
let lessonPdf;
let requestStatus;

function supabaseStub() {
  const lookup = (table, eqs) => {
    if (table === 'app_settings') return eqs.key in settings ? { value: settings[eqs.key] } : null;
    if (table === 'users') return users[eqs.id] || null;
    return null;
  };
  return {
    from(table) {
      const eqs = {};
      const q = {
        select: () => q,
        eq: (c, v) => { eqs[c] = v; return q; },
        in: () => q,
        maybeSingle: async () => ({ data: lookup(table, eqs), error: null }),
        single: async () => ({ data: lookup(table, eqs), error: null }),
      };
      return q;
    },
    rpc: jest.fn(),
  };
}

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...ENV,
    R2_ENDPOINT: 'https://0123abcd.r2.cloudflarestorage.com',
    R2_BUCKET_NAME: BUCKET,
    MAIN_BOT_URL: 'https://bot.example/',
    INTERNAL_API_KEY: 'k-internal',
    WEB_QUIZ_KID_KEY: 'k'.repeat(40),
    FLN_CORPUS_BASE: 'https://cdn.example.test/fln/corpus',
  };
  global.fetch = jest.fn(async () => new Response(PDF, {
    status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) },
  }));

  users = {
    [TEACHER]: { id: TEACHER, role: 'teacher', preferred_language: 'en' },
    [COACH]: { id: COACH, role: 'coach', preferred_language: 'ur' },
    [PRINCIPAL]: { id: PRINCIPAL, role: 'principal', preferred_language: 'en' },
    [AEO]: { id: AEO, role: 'AEO ', preferred_language: 'en' },
  };
  settings = { portal_fln_lessons: true, fln_corpus_version: VERSION };
  queries = [];
  events = [];

  axios = require('axios');
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { success: true, outcome: 'scheduled' } });

  lessonPdf = jest.fn(async () => ({ url: SIGNED, asset_kind: 'lesson', version_stamp: 'v8' }));
  requestStatus = jest.fn(async () => ({ state: 'ready', url: SIGNED_612, segmentId: SEGMENT, lang: 'en' }));

  jest.doMock('../../dashboard/config/database', () => ({
    query: jest.fn(async (sql, params) => { queries.push({ sql, params }); return { rows: [{ id: 'open-1' }] }; }),
  }));
  jest.doMock('../../dashboard/config/supabase', () => supabaseStub());
  jest.doMock('../../dashboard/services/telemetry.service', () => ({
    logEvent: (event, data) => events.push({ event, data }), flush() {}, isEnabled: () => true,
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    isValidR2Url: jest.fn(() => true), generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(),
  }));
  jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({
    listGrades: jest.fn(), listSubjects: jest.fn(), listChapters: jest.fn(), listLessons: jest.fn(),
    lessonPdf, describePlans: jest.fn(),
  }));
  jest.doMock('../../dashboard/services/lp612.service', () => ({
    listGrades: jest.fn(), listSubjects: jest.fn(), listChapters: jest.fn(), listLessons: jest.fn(),
    requestLesson: jest.fn(), requestStatus, myLessons: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ENV };
  jest.restoreAllMocks();
  jest.resetModules();
});

/* ── portal.routes: the K-5 and 6-12 open paths, driven through their real handler stacks ───────────────── */

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
  res.set = (k, v) => { res.headers[String(k).toLowerCase()] = v; return res; };
  return res;
}

async function settle(n = 12) {
  for (let i = 0; i < n; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setImmediate(r));
  }
}

async function invoke(userId, routePath, { params = {}, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', routePath);
  if (!stack) throw new Error(`Route GET ${routePath} not found`);
  const req = {
    session: { portalUserId: userId, id: 'sess-1' },
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
  await settle();
  return res;
}

const openRows = () => queries.filter((q) => /INSERT INTO niete_lp_opens/.test(q.sql));
const surveyCalls = () => axios.post.mock.calls.filter(([url]) => /\/api\/internal\/lp\/open-survey$/.test(url));
const leaderOpens = () => events.filter((e) => e.event === 'lp.leader_open').map((e) => e.data);
const claimOpened = () => queries.filter((q) => /UPDATE niete_lp612_deliveries SET notice_opened_at/.test(q.sql));

const K5_FILE = ['/curriculum/lp/:lesson_id/file', { params: { lesson_id: K5 } }];
const K5_PDF = ['/curriculum/lp/:lesson_id/pdf', { params: { lesson_id: K5 } }];
const G612_FILE = ['/lp612/file/:render_id', { params: { render_id: RENDER } }];
const G612_STATUS = ['/lp612/status/:render_id', { params: { render_id: RENDER }, query: { open: '1' } }];

describe('a leader opening a grades 1-5 plan', () => {
  test.each([
    ['the viewer (/file)', K5_FILE, 'viewer'],
    ['another app (/pdf)', K5_PDF, 'external'],
  ])('%s: no open row, no survey, no teacher named to the PDF lookup — one lp.leader_open', async (_n, [path, opts], source) => {
    const res = await invoke(COACH, path, opts);
    expect(res.statusCode).toBe(200);
    expect(lessonPdf).toHaveBeenCalledTimes(1);
    // Named to nobody: the bot's lp/v8/pdf records no lifecycle row and picks no A/B group without a user.
    expect(lessonPdf).toHaveBeenCalledWith(K5, 'lesson', null);
    expect(openRows()).toHaveLength(0);
    expect(surveyCalls()).toHaveLength(0);
    expect(leaderOpens()).toEqual([{ userId: COACH, role: 'coach', kind: 'k5', ref: K5, source }]);
  });

  test('the answer key is the same: read, never logged as hers', async () => {
    const res = await invoke(AEO, '/curriculum/lp/:lesson_id/file', { params: { lesson_id: K5 }, query: { kind: 'answer_key' } });
    expect(res.statusCode).toBe(200);
    expect(lessonPdf).toHaveBeenCalledWith(K5, 'answer_key', null);
    expect(openRows()).toHaveLength(0);
    expect(leaderOpens()).toEqual([{ userId: AEO, role: 'aeo', kind: 'k5', ref: K5, source: 'viewer' }]);
  });
});

describe('a leader opening a grades 6-12 plan', () => {
  test.each([
    ['the viewer (/lp612/file)', G612_FILE, 'viewer'],
    ['another app (/lp612/status?open=1)', G612_STATUS, 'external'],
  ])('%s: no open row, no survey — one lp.leader_open, and their own request marked opened', async (_n, [path, opts], source) => {
    const res = await invoke(COACH, path, opts);
    expect(res.statusCode).toBe(200);
    // The render is still looked up for the leader's own request (a render nobody asked for is a 404).
    expect(requestStatus).toHaveBeenCalledWith(RENDER, COACH);
    expect(openRows()).toHaveLength(0);
    expect(surveyCalls()).toHaveLength(0);
    expect(leaderOpens()).toEqual([{ userId: COACH, role: 'coach', kind: 'g612', ref: SEGMENT, source }]);
    // With no open row, the ready-WhatsApp sweep would read a plan the leader opened as unopened: the request itself
    // says it was opened instead (the column the sweep already reads).
    expect(claimOpened()).toHaveLength(1);
    expect(claimOpened()[0].params).toEqual([RENDER, COACH]);
  });
});

describe('who counts as a leader is the server\'s call', () => {
  test('a principal NOT on the teacher app is a leader', async () => {
    settings.portal_teacher_v2 = [TEACHER];
    await invoke(PRINCIPAL, ...K5_FILE);
    expect(lessonPdf).toHaveBeenCalledWith(K5, 'lesson', null);
    expect(openRows()).toHaveLength(0);
    expect(leaderOpens()).toEqual([{ userId: PRINCIPAL, role: 'principal', kind: 'k5', ref: K5, source: 'viewer' }]);
  });

  test('a principal ON the teacher app is a teacher here: exactly today', async () => {
    settings.portal_teacher_v2 = [PRINCIPAL];
    await invoke(PRINCIPAL, ...K5_FILE);
    expect(lessonPdf).toHaveBeenCalledWith(K5, 'lesson', PRINCIPAL);
    expect(openRows()).toHaveLength(1);
    expect(surveyCalls()).toHaveLength(1);
    expect(leaderOpens()).toEqual([]);
  });

  test('a role that cannot be read is today\'s path (a teacher), never a lost teacher open', async () => {
    users = {};
    await invoke(TEACHER, ...K5_FILE);
    expect(lessonPdf).toHaveBeenCalledWith(K5, 'lesson', TEACHER);
    expect(openRows()).toHaveLength(1);
    expect(leaderOpens()).toEqual([]);
  });
});

describe('a teacher\'s open is exactly today\'s (golden)', () => {
  test.each([
    ['k5 viewer', K5_FILE, 'k5', K5],
    ['k5 other app', K5_PDF, 'k5', K5],
    ['g612 viewer', G612_FILE, 'g612', SEGMENT],
    ['g612 other app', G612_STATUS, 'g612', SEGMENT],
  ])('%s: one open row, one survey request, no leader event, no claim write', async (_n, [path, opts], kind, ref) => {
    const res = await invoke(TEACHER, path, opts);
    expect(res.statusCode).toBe(200);
    if (kind === 'k5') expect(lessonPdf).toHaveBeenCalledWith(K5, 'lesson', TEACHER);
    expect(openRows()).toHaveLength(1);
    expect(openRows()[0].params.slice(0, 3)).toEqual([TEACHER, kind, ref]);
    expect(surveyCalls()).toHaveLength(1);
    expect(surveyCalls()[0][1]).toEqual({ openId: 'open-1' });
    expect(leaderOpens()).toEqual([]);
    expect(claimOpened()).toHaveLength(0);
  });
});

/* ── portal-fln.routes: the FLN plan page, over real Express + HTTP ──────────────────────────────────────── */

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function flnApp(userId) {
  require('../../dashboard/services/fln-corpus.service').__setForTests(build());
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = { id: 's1', portalUserId: userId }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-fln.routes'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}

const get = (srv, path) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET', agent: false }, (res) => {
    res.on('data', () => {});
    res.on('end', () => setImmediate(() => resolve({ status: res.statusCode })));
  });
  req.on('error', reject);
  req.end();
});

describe('an FLN plan', () => {
  test('a coach opening it: no open row, no survey — one lp.leader_open', async () => {
    settings.portal_fln_share = true;
    const srv = await flnApp(COACH);
    expect((await get(srv, '/api/portal/fln/plan/900003')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(openRows()).toHaveLength(0);
    expect(surveyCalls()).toHaveLength(0);
    expect(leaderOpens()).toEqual([{ userId: COACH, role: 'coach', kind: 'fln', ref: '900003', source: 'viewer' }]);
  });

  test('a teacher opening it: one open row, as today, and no leader event', async () => {
    const srv = await flnApp(TEACHER);
    expect((await get(srv, '/api/portal/fln/plan/900003')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(openRows()).toHaveLength(1);
    expect(openRows()[0].params.slice(0, 3)).toEqual([TEACHER, 'fln', '900003']);
    expect(surveyCalls()).toHaveLength(0);
    expect(leaderOpens()).toEqual([]);
  });
});
