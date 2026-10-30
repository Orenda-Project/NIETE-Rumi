/**
 * bd-te5lae — a written capstone submit finishes inside its time budget, and a teacher
 * who is no longer listening never gets a silent attempt.
 *
 * The submit marks every answer with the bot's grader: one LLM call per answer, in
 * sequence, so a paper takes tens of seconds. The portal's timeout middleware gave this
 * path the 30 s default. At 30 s it answered 503 and the socket closed, but the handler
 * kept marking, could still insert the attempt, and then wrote its own response onto a
 * finished one. ERR_HTTP_HEADERS_SENT thrown again from the outer catch is an unhandled
 * rejection under express 4, and that ends the portal process.
 *
 * The route tests before this called the handler directly with nothing in front of it,
 * so the budget was never part of what they tested. The last block here mounts the real
 * timeout middleware in front of the real router, over real HTTP.
 *
 * Mocked: the database (dashboard/config/supabase), the HTTP hop to the bot (axios) and
 * telemetry. The route and the training client are the real code.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

const http = require('http');

const ANSWER = 'In my class I group the children by reading level and give each group a text it can read. '.repeat(6);
const UID = 'user-1';
const LEVEL = 18;
const SUBMIT = '/training/level/:id/capstone/attempts';
const NOTHING_RECORDED = /nothing has been recorded/i;

let tableStates;
let inserted;
let scoreCalls;
let grade;
let logEvent;

/** A supabase chain: every filter is a no-op (each table holds only this test's rows). */
function makeChain(table) {
  const state = tableStates[table] || {};
  const rows = () => state.rows || [];
  const result = (many) => (state.error
    ? { data: null, error: state.error }
    : { data: many ? rows() : (rows()[0] || null), error: null });
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'order', 'limit']) chain[m] = () => chain;
  chain.insert = () => { inserted.push(table); return chain; };
  chain.maybeSingle = async () => result(false);
  chain.single = async () => result(false);
  chain.then = (ok, ko) => Promise.resolve(result(true)).then(ok, ko);
  return chain;
}

function seed(nQuestions = 3) {
  tableStates = {
    training_grand_quizzes: { rows: [{ id: 30, level_id: LEVEL, quiz_type: 'capstone' }] },
    training_questions: {
      rows: Array.from({ length: nQuestions }, (_, i) => ({ id: 900 + i, question_text: `Q${i + 1}`, order_index: i })),
    },
    teacher_training_assignments: { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] },
    training_assessment_attempts: { rows: [{ id: 'attempt-1' }] },
    training_assessment_answers: { rows: [] },
  };
}

const paper = () => tableStates.training_questions.rows.map((q) => ({ question_id: q.id, answer_text: ANSWER }));

/* ── the bot, as the portal reaches it: POST /api/internal/training/<path> ─────────── */

const marks = () => Promise.resolve({ data: { success: true, score: 4, feedback: 'Specific.' } });

/** A grader that takes `ms`, cut short by the client's own timeout exactly as axios would. */
const slowGrader = (ms) => (_body, config) => new Promise((resolve, reject) => {
  if (config.timeout > 0 && config.timeout < ms) {
    setTimeout(() => reject(Object.assign(new Error(`timeout of ${config.timeout}ms exceeded`), { code: 'ECONNABORTED' })), config.timeout);
  } else {
    setTimeout(() => resolve({ data: { success: true, score: 4, feedback: 'Specific.' } }), ms);
  }
});

/** The connection dropped under the request: no HTTP answer at all. */
const connectionReset = () => Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

/** The bot answered, and the answer is a failure. */
const botSays500 = () => Promise.reject(Object.assign(new Error('Request failed with status code 500'), {
  response: { status: 500, data: { success: false, error: 'Marking failed' } },
}));

function bot(url, body, config = {}) {
  const path = String(url).split('/api/internal/training/')[1];
  if (path === 'exam-gate-by-level') return Promise.resolve({ data: { success: true, ok: true, pass_pct: 70 } });
  if (path === 'certify-level') return Promise.resolve({ data: { success: true, issued: false } });
  if (path === 'capstone-score') {
    scoreCalls.push({ question: body.question && body.question.question_text, timeout: config.timeout, at: Date.now() });
    return grade(body, config, scoreCalls.length);
  }
  return Promise.reject(new Error(`unexpected bot call: ${path}`));
}

beforeEach(() => {
  jest.resetModules();
  process.env.MAIN_BOT_URL = 'https://bot.example.test';
  process.env.INTERNAL_API_KEY = 'test-key';
  inserted = [];
  scoreCalls = [];
  grade = marks;
  seed();

  jest.doMock('axios', () => ({ post: jest.fn(bot), get: jest.fn() }), { virtual: true });
  logEvent = jest.fn();
  jest.doMock('../../dashboard/services/telemetry.service', () => ({
    ...jest.requireActual('../../dashboard/services/telemetry.service'),
    logEvent,
  }));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn((t) => makeChain(t)), rpc: jest.fn() }));

  // As on the portal service: the bot's own I/O modules cannot be loaded there.
  jest.doMock('../../bot/shared/config/supabase', () => { throw new Error("Cannot find module 'dotenv'"); });
  jest.doMock('../../bot/shared/services/llm-client', () => { throw new Error("Cannot find module 'pino'"); });
  jest.doMock('../../bot/shared/utils/structured-logger', () => { throw new Error("Cannot find module 'pino'"); });

  // portal.routes' other imports, stubbed as the other portal suites stub them.
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_r, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.MAIN_BOT_URL;
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

/** The submit route's own handler (the last in its stack; the first is the auth check). */
function submitHandler() {
  const router = require('../../dashboard/routes/portal.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === SUBMIT && l.route.methods.post);
  const stack = layer.route.stack.map((s) => s.handle);
  return stack[stack.length - 1];
}

function makeReq() {
  return {
    session: { portalUserId: UID, id: 's1' },
    params: { id: String(LEVEL) },
    query: {},
    body: { answers: paper() },
    method: 'POST',
    path: `/training/level/${LEVEL}/capstone/attempts`,
    headers: {},
    get: () => undefined,
    socket: { destroyed: false },
  };
}

/** Behaves like express's response where it matters: a second write throws. */
function makeRes() {
  return {
    headersSent: false,
    statusCode: 200,
    body: undefined,
    writes: 0,
    answeredAt: null,
    status(c) { this.statusCode = c; return this; },
    json(b) {
      if (this.headersSent) {
        throw Object.assign(new Error('Cannot set headers after they are sent to the client'), { code: 'ERR_HTTP_HEADERS_SENT' });
      }
      this.body = b;
      this.headersSent = true;
      this.writes += 1;
      this.answeredAt = Date.now();
      return this;
    },
  };
}

/** Run the handler; `settled` says whether its promise rejected (express 4 would crash on that). */
function run(handler, req = makeReq(), res = makeRes()) {
  const settled = Promise.resolve(handler(req, res)).then(() => ({ threw: null }), (e) => ({ threw: e }));
  return { req, res, settled };
}

const eventsNamed = (name) => logEvent.mock.calls.filter(([e]) => e === name).map(([, data]) => data);

describe('the route budget (dashboard/middleware/timeout.js)', () => {
  it('gives the capstone submit at least 120 s, and more than the marking deadline plus the writes', () => {
    const { getTimeoutForRoute, CAPSTONE_MARKING_DEADLINE_MS } = require('../../dashboard/middleware/timeout');
    const budget = getTimeoutForRoute('/api/portal/training/level/21/capstone/attempts');

    expect(Number.isFinite(CAPSTONE_MARKING_DEADLINE_MS)).toBe(true);
    expect(budget).toBeGreaterThanOrEqual(120_000);
    // After marking: two inserts and the certificate call (the client's 10 s lookup budget).
    expect(budget - CAPSTONE_MARKING_DEADLINE_MS).toBeGreaterThanOrEqual(20_000);
  });

  it('matches the path the app-level middleware sees, and nothing broader', () => {
    const { getTimeoutForRoute, DEFAULT_TIMEOUT } = require('../../dashboard/middleware/timeout');

    expect(getTimeoutForRoute('/api/portal/training/level/7/capstone/attempts/')).toBeGreaterThanOrEqual(120_000);
    expect(getTimeoutForRoute('/api/portal/training/level/7/capstone/questions')).toBe(DEFAULT_TIMEOUT);
    expect(getTimeoutForRoute('/api/portal/training/level/7/grand-quiz/attempts')).toBe(DEFAULT_TIMEOUT);
    expect(getTimeoutForRoute('/api/portal/training/level/7/capstone/attempts/extra')).toBe(DEFAULT_TIMEOUT);
  });
});

describe('marking has a total deadline inside that budget', () => {
  it('a grader slower than the deadline ends in 503 "nothing recorded", with nothing inserted, before the budget', async () => {
    const { CAPSTONE_MARKING_DEADLINE_MS } = require('../../dashboard/middleware/timeout');
    const handler = submitHandler();
    jest.useFakeTimers();
    const t0 = Date.now();
    grade = slowGrader(40_000); // 3 answers x 40 s = 120 s of marking

    const { res, settled } = run(handler);
    await jest.advanceTimersByTimeAsync(200_000);
    const { threw } = await settled;

    expect(threw).toBeNull();
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(NOTHING_RECORDED);
    expect(inserted).toEqual([]);
    // Each answer's own timeout is capped by what is left of the deadline, never 0 (= no timeout).
    for (const c of scoreCalls) {
      expect(c.timeout).toBeGreaterThan(0);
      expect(c.timeout).toBeLessThanOrEqual(60_000);
      expect(c.at - t0 + c.timeout).toBeLessThanOrEqual(CAPSTONE_MARKING_DEADLINE_MS);
    }
    expect(res.answeredAt - t0).toBeLessThanOrEqual(CAPSTONE_MARKING_DEADLINE_MS);
  });

  it('a paper marked inside the deadline is recorded as before', async () => {
    const handler = submitHandler();
    jest.useFakeTimers();
    grade = slowGrader(20_000); // 3 x 20 s = 60 s, inside the deadline

    const { res, settled } = run(handler);
    await jest.advanceTimersByTimeAsync(200_000);
    const { threw } = await settled;

    expect(threw).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(inserted).toEqual(['training_assessment_attempts', 'training_assessment_answers']);
  });
});

describe('a teacher who is no longer listening never gets a silent attempt', () => {
  it('the response was already sent (the timeout middleware answered) → nothing inserted, nothing thrown', async () => {
    const handler = submitHandler();
    const res = makeRes();
    grade = (body, config, n) => {
      if (n === 3) res.headersSent = true; // the middleware's 503 went out during the last answer
      return marks();
    };

    const { settled } = run(handler, makeReq(), res);
    const { threw } = await settled;

    expect(threw).toBeNull();
    expect(inserted).toEqual([]);
    expect(res.writes).toBe(0);
  });

  it('the connection is gone → nothing inserted, nothing thrown', async () => {
    const handler = submitHandler();
    const req = makeReq();
    grade = (body, config, n) => {
      if (n === 3) req.socket.destroyed = true;
      return marks();
    };

    const { res, settled } = run(handler, req);
    const { threw } = await settled;

    expect(threw).toBeNull();
    expect(inserted).toEqual([]);
    expect(res.writes).toBe(0);
    expect(eventsNamed('training_capstone_not_recorded')).toEqual([
      expect.objectContaining({ reason: 'client_gone', user_uuid: UID, level_row_id: LEVEL }),
    ]);
  });

  it('marking fails after the response was sent → the 503 is not written twice, nothing thrown', async () => {
    const handler = submitHandler();
    const res = makeRes();
    res.headersSent = true;
    grade = botSays500;

    const { settled } = run(handler, makeReq(), res);
    const { threw } = await settled;

    expect(threw).toBeNull();
    expect(inserted).toEqual([]);
    expect(res.writes).toBe(0);
  });

  it('an unexpected error after the response was sent → the outer catch does not throw', async () => {
    const handler = submitHandler();
    const req = makeReq();
    const res = makeRes();
    res.headersSent = true;
    tableStates.training_questions = { error: new Error('connection terminated') };

    const { settled } = run(handler, req, res);
    const { threw } = await settled;

    expect(threw).toBeNull();
    expect(res.writes).toBe(0);
  });
});

describe('telemetry goes through the portal sink, never the bot logger the portal cannot load', () => {
  it('a recorded paper emits training_capstone_completed', async () => {
    const handler = submitHandler();
    const { res, settled } = run(handler);
    await settled;

    expect(res.statusCode).toBe(200);
    expect(eventsNamed('training_capstone_completed')).toEqual([
      expect.objectContaining({ user_uuid: UID, level_row_id: LEVEL, attempt_uuid: 'attempt-1', surface: 'portal' }),
    ]);
  });

  it('a paper the bot could not mark emits training_capstone_mark_failed: ids, counts and a reason, never the answers', async () => {
    const handler = submitHandler();
    grade = (body, config, n) => (n === 2 ? botSays500() : marks());

    const { res, settled } = run(handler);
    await settled;

    expect(res.statusCode).toBe(503);
    const [ev, ...more] = eventsNamed('training_capstone_mark_failed');
    expect(more).toEqual([]);
    expect(ev).toEqual(expect.objectContaining({
      user_uuid: UID, level_row_id: LEVEL, answers_total: 3, answers_marked: 1, reason: 'marking_error', http_status: 500, surface: 'portal',
    }));
    const flat = JSON.stringify(ev);
    expect(flat).not.toContain(ANSWER.slice(0, 40));
    expect(flat).not.toContain('Q2');
  });

  it('a paper that ran out of time says so in the reason', async () => {
    const handler = submitHandler();
    jest.useFakeTimers();
    grade = slowGrader(40_000);

    const { settled } = run(handler);
    await jest.advanceTimersByTimeAsync(200_000);
    await settled;

    expect(eventsNamed('training_capstone_mark_failed')).toEqual([expect.objectContaining({ reason: 'deadline' })]);
  });
});

describe('a dropped connection to the bot is retried once — marking writes nothing on the bot', () => {
  it('one ECONNRESET, then a mark → the paper is recorded', async () => {
    const handler = submitHandler();
    let dropped = false;
    grade = (body, config) => {
      if (body.question.question_text === 'Q2' && !dropped) { dropped = true; return connectionReset(); }
      return marks();
    };

    const { res, settled } = run(handler);
    await settled;

    expect(res.statusCode).toBe(200);
    expect(scoreCalls.map((c) => c.question)).toEqual(['Q1', 'Q2', 'Q2', 'Q3']);
    expect(inserted).toEqual(['training_assessment_attempts', 'training_assessment_answers']);
  });

  it('a second ECONNRESET on the same answer → 503, nothing recorded', async () => {
    const handler = submitHandler();
    grade = (body) => (body.question.question_text === 'Q2' ? connectionReset() : marks());

    const { res, settled } = run(handler);
    await settled;

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(NOTHING_RECORDED);
    expect(scoreCalls.map((c) => c.question)).toEqual(['Q1', 'Q2', 'Q2']);
    expect(inserted).toEqual([]);
  });

  it('an HTTP failure with a body is the bot\'s answer, not a dropped connection: no retry', async () => {
    const handler = submitHandler();
    grade = (body) => (body.question.question_text === 'Q2' ? botSays500() : marks());

    const { res, settled } = run(handler);
    await settled;

    expect(res.statusCode).toBe(503);
    expect(scoreCalls.map((c) => c.question)).toEqual(['Q1', 'Q2']);
  });
});

/**
 * The whole chain, as dashboard/index.js wires it: the real timeout middleware at the
 * app level, then the real portal router under /api/portal, over a real socket. Time is
 * fake (the middleware's timer, the grader's latency and the deadline), the I/O is real.
 */
describe('end to end: the real timeout middleware in front of the real route', () => {
  async function post(app, path, body) {
    const realSetTimeout = global.setTimeout;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      let done = null;
      const req = http.request({
        host: '127.0.0.1', port: srv.address().port, method: 'POST', path, headers: { 'content-type': 'application/json' },
      }, (resp) => {
        let raw = '';
        resp.on('data', (d) => { raw += d; });
        resp.on('end', () => { done = { status: resp.statusCode, body: raw ? JSON.parse(raw) : null }; });
      });
      req.on('error', (e) => { done = { error: e.code || e.message }; });
      req.end(JSON.stringify(body));
      // Advance fake time in small steps and let the real socket breathe between them.
      for (let i = 0; i < 600 && !done; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await jest.advanceTimersByTimeAsync(500);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => realSetTimeout(r, 1));
      }
      return done;
    } finally {
      jest.useRealTimers();
      await new Promise((r) => srv.close(r));
    }
  }

  function appWithTheRealChain() {
    const express = require('express');
    const { timeoutMiddleware } = require('../../dashboard/middleware/timeout');
    const portalRoutes = require('../../dashboard/routes/portal.routes');
    const app = express();
    app.use(express.json());
    app.use(timeoutMiddleware);
    app.use((req, _res, next) => { req.session = { portalUserId: UID, id: 's1' }; next(); });
    app.use('/api/portal', portalRoutes);
    return app;
  }

  it('a ten-answer paper that takes 35 s to mark is recorded and answered 200, not cut off at 30 s', async () => {
    seed(10);
    grade = slowGrader(3_500);
    const app = appWithTheRealChain();

    const out = await post(app, `/api/portal/training/level/${LEVEL}/capstone/attempts`, { answers: paper() });

    expect(out).toEqual({ status: 200, body: expect.objectContaining({ success: true }) });
    expect(inserted).toEqual(['training_assessment_attempts', 'training_assessment_answers']);
  });

  it('a grader too slow for the deadline gets the route\'s own 503 "nothing recorded", not the middleware\'s', async () => {
    grade = slowGrader(40_000);
    const app = appWithTheRealChain();

    const out = await post(app, `/api/portal/training/level/${LEVEL}/capstone/attempts`, { answers: paper() });

    expect(out.status).toBe(503);
    expect(out.body.error).toMatch(NOTHING_RECORDED);
    expect(inserted).toEqual([]);
  });
});
