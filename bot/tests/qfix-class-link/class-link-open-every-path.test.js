'use strict';
/**
 * web_quiz.class_link_open{class_link_code, via, dh?}: EXACTLY ONE per open of the standing link, on every path a child
 * reaches /j/<code> by, with a `via`:
 *   ?f=1 / ?from=fwd forward (the card's Forward) -> forward; ?from=push (the reminder) -> reminder; ?from=hub -> hub;
 *   unmarked on a phone that played as a child of the class -> remembered; unmarked on any other phone (a copied link,
 *   the class-week line, a fresh phone with no marker) -> forward;
 *   the teacher card's own visit (?t=) and a link-preview fetch -> nothing.
 * `dh` = the phone's device hash (sha256('wqd|'+ref), 16 hex) whenever the open carries the phone's device ref, absent
 * when it does not; the raw ref is never logged; via and dh land in data_json, never a top-level column. The open
 * rides web_quiz_class_link, not the evening round's switch.
 *
 * The real chain: the portal's /j/<code> page and /api/wq/cl/* forwards (dashboard createWebQuizRouter), the page's own
 * script (public/wq/class-link.js, in a vm) and the bot's real /api/internal/wq/cl/* routes over HTTP.
 * Faked boundaries only: Supabase (in memory), Redis (a Map), the loggers, the event key module.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
  };
});
jest.mock('../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`, dk: () => 'dk', cls: () => 'clshash00000', qk: () => 'qk00000000', envelope: (f) => ({ ev_v: 2, ...f }),
}));

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');

const CLIENT = fs.readFileSync(path.join(__dirname, '../../../dashboard/public/wq/class-link.js'), 'utf8');
const CODE = 'K7Q2MXTRAB';
const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const DEV = 'PlayedInClassDevice_e1'; // a phone that played as Zara (22 characters, a well-formed device ref)
const ON = (k) => ({ key: k, value: true });
const ALL_ON = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];
const dh = (ref) => crypto.createHash('sha256').update(`wqd|${ref}`).digest('hex').slice(0, 16);

function seed(settings = ALL_ON) {
  const db = {
    app_settings: settings,
    users: [{ id: TEACHER, name: 'Rifat Test', school_id: null, preferred_language: 'en' }],
    classes: [{ id: CLASS, school_id: null, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_links: [{ code: CODE, class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: '2099-03-31T18:59:59Z', revoked_at: null }],
    class_teachers: [{ class_id: CLASS, teacher_user_id: TEACHER, is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: ZARA, is_active: true }],
    students: [{ id: ZARA, student_name: 'Zara Test', list_id: null, is_active: true }],
    quiz_sessions: [{ id: 's1', student_id: ZARA, device_ref: DEV, quiz_id: 'qn' }],
    quizzes: [],
    quiz_share_codes: [],
  };
  Object.assign(supabase, makeFake(db));
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  try { require('../../shared/services/quiz/web-quiz-evening-round')._resetCache(); } catch (_) { /* not on this build */ }
}

let botSrv;
let edgeSrv;
const edgeLog = jest.fn();
beforeAll(async () => {
  process.env.WEB_QUIZ_TOKEN_SECRET = 'class-link-open-test-secret';
  const bot = express();
  bot.use(express.json());
  bot.use('/api/internal/wq/cl', require('../../shared/routes/web-quiz-class-link.routes'));
  botSrv = await new Promise((r) => { const s = bot.listen(0, '127.0.0.1', () => r(s)); });
  const { createWebQuizRouter } = require('../../../dashboard/routes/web-quiz.routes');
  const edge = express();
  edge.set('trust proxy', 1);
  edge.use(createWebQuizRouter({ botUrl: `http://127.0.0.1:${botSrv.address().port}`, apiKey: 'test-internal-key', fetchImpl: fetch, canonicalBase: '', logEvent: edgeLog }));
  edgeSrv = await new Promise((r) => { const s = edge.listen(0, '127.0.0.1', () => r(s)); });
});
afterAll(async () => {
  await new Promise((r) => edgeSrv.close(r));
  await new Promise((r) => botSrv.close(r));
});
beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  seed();
});

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: edgeSrv.address().port, method, path: p,
      headers: { host: 'quiz.example.org', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

/**
 * A phone opens <url>: the portal's page, then the page's own script (its arrive goes through the portal's forward to
 * the bot). `stored` = the device ref this phone already keeps (localStorage wq_d), or null for a fresh phone.
 * -> { status, ref (the ref the page used), opens (the class_link_open events logged) }
 */
async function open(url, { stored = null, ua = null } = {}) {
  const page = await req('GET', url, undefined, ua ? { 'user-agent': ua } : {});
  const m = /<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(page.body);
  const store = new Map(stored ? [['wq_d', JSON.stringify(stored)]] : []);
  if (m) {
    let pending = 0;
    let started = false;
    const root = { innerHTML: '', querySelectorAll: () => [] };
    const ctx = {
      document: { getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: m[1] } : null) },
      localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
      location: { href: `https://quiz.example.org${url}` },
      fetch: async (u, opts) => {
        started = true;
        pending += 1;
        try {
          const r = await req(opts.method, u, JSON.parse(opts.body));
          return { ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.body) };
        } finally { pending -= 1; }
      },
      window: { crypto: crypto.webcrypto },
    };
    vm.createContext(ctx);
    vm.runInContext(CLIENT, ctx);
    await new Promise((r) => { const tick = () => (!started || pending ? setTimeout(tick, 5) : setTimeout(r, 30)); tick(); });
  }
  const ref = store.has('wq_d') ? JSON.parse(store.get('wq_d')) : null;
  return { status: page.status, ref, opens: logEvent.mock.calls.filter(([n]) => n === 'web_quiz.class_link_open').map(([, f]) => f) };
}

describe('one class_link_open per open, with its via, on every path to /j/<code>', () => {
  test.each([
    ['the card\'s Forward (?f=1), on a phone that never opened it', `/j/${CODE}?f=1`, null, 'forward'],
    ['a forwarded link marked ?from=fwd', `/j/${CODE}?from=fwd`, null, 'forward'],
    ['the reminder (?from=push), on the phone that played', `/j/${CODE}?from=push`, DEV, 'reminder'],
    ['the hub (?from=hub)', `/j/${CODE}?from=hub`, DEV, 'hub'],
    ['the remembered return: unmarked, on the phone that played', `/j/${CODE}`, DEV, 'remembered'],
    ['a fresh phone with no marker (a copied link, the class-week line): forward', `/j/${CODE}`, null, 'forward'],
  ])('%s -> via %s', async (_, url, stored, via) => {
    const r = await open(url, { stored });
    expect(r.status).toBe(200);
    expect(r.ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    if (stored) expect(r.ref).toBe(stored);
    expect(r.opens).toEqual([{ class_link_code: CODE, via, dh: dh(r.ref) }]);
  });

  test('a phone that played in ANOTHER class only, unmarked: forward (it was shared to this phone)', async () => {
    const r = await open(`/j/${CODE}`, { stored: 'OtherClassPhoneRef_000' });
    expect(r.opens).toEqual([{ class_link_code: CODE, via: 'forward', dh: dh('OtherClassPhoneRef_000') }]);
  });

  test('the teacher card\'s own visit (?t=) is never counted, marked or not', async () => {
    const jt = require('../../shared/services/quiz/web-quiz-class-link').signTeacherPreview(CODE);
    expect((await open(`/j/${CODE}?t=${encodeURIComponent(jt)}`, { stored: DEV })).opens).toEqual([]);
    expect((await open(`/j/${CODE}?f=1&t=${encodeURIComponent(jt)}`)).opens).toEqual([]);
  });

  test('a link-preview fetch (WhatsApp\'s crawler) is never counted', async () => {
    const r = await open(`/j/${CODE}?f=1`, { ua: 'WhatsApp/2.23.20.0 A' });
    expect(r.status).toBe(200);
    expect(r.opens).toEqual([]);
  });
});

describe('dh: the phone\'s hash, only when the open carries its device ref; never the ref', () => {
  test('an arrive with no device ref: the open is counted without dh', async () => {
    const r = await req('POST', '/api/wq/cl/arrive', { code: CODE, via: 'forward' });
    expect(r.status).toBe(200);
    const opens = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.class_link_open').map(([, f]) => f);
    expect(opens).toEqual([{ class_link_code: CODE, via: 'forward' }]);
  });

  test('a malformed device ref is not a known phone: no dh', async () => {
    await req('POST', '/api/wq/cl/arrive', { code: CODE, device_ref: 'short' });
    const opens = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.class_link_open').map(([, f]) => f);
    expect(opens).toEqual([{ class_link_code: CODE, via: 'forward' }]);
  });

  test('the raw device ref is in no logged event, and via / dh are data_json fields, never top-level columns', async () => {
    await open(`/j/${CODE}?from=push`, { stored: DEV });
    await open(`/j/${CODE}`, { stored: DEV });
    const all = JSON.stringify([...logEvent.mock.calls, ...edgeLog.mock.calls]);
    expect(all).not.toContain(DEV);
    const { AXIOM_CORE_FIELDS } = jest.requireActual('../../shared/utils/structured-logger');
    ['class_link_code', 'via', 'dh'].forEach((k) => expect([k, AXIOM_CORE_FIELDS.has(k)]).toEqual([k, false]));
  });
});

test('the open is the standing link\'s telemetry: logged with web_quiz_evening_round OFF', async () => {
  seed(ALL_ON.filter((s) => s.key !== 'web_quiz_evening_round'));
  const a = await open(`/j/${CODE}`, { stored: DEV });
  expect(a.opens).toEqual([{ class_link_code: CODE, via: 'remembered', dh: dh(DEV) }]);
  logEvent.mockClear();
  const b = await open(`/j/${CODE}?f=1`);
  expect(b.opens).toEqual([{ class_link_code: CODE, via: 'forward', dh: dh(b.ref) }]);
});
