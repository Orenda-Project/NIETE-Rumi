'use strict';
/**
 * The same "Make a quiz" block on the teacher's coaching report screen in the portal / app (bd-kcv8s5), behind
 * app_settings quiz_portal_report_block (off by default; missing or unreadable = off).
 *
 *   GET /api/portal/teacher/coaching/:id/quiz-block   the screen asks; the server checks the session is the teacher's, ready and
 *                                                     not a visit, then mints a short-lived report link (<= 24 h)
 *   GET /cq/:token?embed=portal                       the block alone, for a frame on the same origin
 *   GET /cq/:token?from=portal                        the block as a page (mode "page"), with a way back
 *
 * Real modules end to end, as report-page-make.test.js wires them; the portal route is mounted on its own app with a
 * signed-in session.
 */
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';

jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../dashboard/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: jest.fn().mockResolvedValue(false) }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(false),
  introShownCount: jest.fn().mockResolvedValue(5),
  markVideoShown: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Sadia Noor' }),
  botNumber: jest.fn().mockReturnValue('923206281951'),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'),
  downloadFromR2: jest.fn().mockRejectedValue(new Error('absent')),
  getPresignedGetUrl: jest.fn().mockResolvedValue('https://r2.example/signed.pdf'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush() {}, isEnabled: () => true }));
// the portal's teacher-app gate (its own tests cover it) and its pg pool: on, and never reached
jest.mock('../../dashboard/lib/teacher-app', () => ({ teacherAppOnFor: jest.fn(async () => true) }));
jest.mock('../../dashboard/config/database', () => ({ query: jest.fn() }));
jest.mock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });

const http = require('http');
const express = require('express');
const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
const WhatsApp = require('../../bot/shared/services/whatsapp.service');
const Queue = require('../../bot/shared/services/queue');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const { logEvent: botEvent } = require('../../bot/shared/utils/structured-logger');
const { logEvent: portalEvent } = require('../../dashboard/services/telemetry.service');

const SID = 'a1b2c3d4-1111-4111-8111-000000000001';
const UID = 'b0ffe250-0000-4000-8000-0000000000a1';
const OTHER_UID = 'b0ffe250-0000-4000-8000-0000000000a2';
const PHONE = '923330000011';
const QID = 'c0ffe250-0000-4000-8000-0000000000c1';
const ON = { key: 'quiz_offer_closed_window', value: { trace: true, report_page: true } };
const ENV = { ...process.env };
const HELD = { id: QID, coaching_session_id: SID, quiz_source: 'transcript', status: 'skipped', teacher_id: UID, topic: 'Adding tens',
  created_at: '2026-11-25T08:00:00Z', meta: { step: 'skipped', skip_reason: 'window_closed', held_path: 'template' } };
const DIGEST = (subject) => ({
  digest: { topic: 'Adding tens', subject, confidence: 0.9, language_of_instruction: 'en', slos: [{ id: 'S1' }, { id: 'S2' }], key_terms: [] },
  grade: '3', gradeSource: 'profile', lpHint: null, model: 'm', costUsd: 0.01,
});
const QUESTIONS = Array.from({ length: 8 }, (_, i) => ({
  id: `qq-${i}`, quiz_id: QID, sort_order: i, question_text: `Question ${i + 1}: what is ${i + 1} tens?`,
  option_a: `${i + 1}0`, option_b: `${i + 1}`, option_c: `${i + 1}00`, option_d: null, correct_option: 'A', external_id: `tq:${QID}:S1:${i}`,
}));

/** The in-memory tables, with the one-transcript-quiz-per-session unique index (23505) the offer's claim relies on. */
function withQuizIndex(db) {
  const from = db.from;
  return {
    ...db,
    from: (table) => {
      const chain = from(table);
      if (table !== 'quizzes') return chain;
      const insert = chain.insert;
      chain.insert = (r) => {
        const dup = r && r.quiz_source === 'transcript' && db.tables.quizzes
          .some((q) => q.coaching_session_id === r.coaching_session_id && q.quiz_source === 'transcript');
        if (!dup) return insert(r);
        const out = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        const refused = { select: () => refused, single: () => refused, maybeSingle: () => refused, then: (res, rej) => Promise.resolve(out).then(res, rej) };
        return refused;
      };
      return chain;
    },
  };
}

function seed({ settings = [ON], quizzes = [{ ...HELD, meta: { ...HELD.meta } }], language = 'en', questions = [], codes = [] } = {}) {
  mockDb = withQuizIndex(makeDb({
    users: [{ id: UID, name: 'Sadia Noor', phone_number: PHONE, preferred_language: language },
      { id: OTHER_UID, name: 'Other', phone_number: '923330000099', preferred_language: 'en' }],
    app_settings: [...settings, { key: 'web_quiz_enabled', value: true }, { key: 'web_quiz_teachers', value: 'all' }],
    coaching_sessions: [{
      id: SID, user_id: UID, status: 'completed', observation_type: null, transcript_text: 'x'.repeat(2000), transcript_language: 'en',
      analysis_data: { topic: 'Adding tens', subject: 'Maths' }, created_at: '2026-11-25T07:00:00Z',
      users: { id: UID, name: 'Sadia Noor', phone_number: PHONE, preferred_language: language },
    }],
    quizzes,
    quiz_questions: questions,
    quiz_share_codes: codes,
  }));
}

let servers = [];
async function listen(app) {
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  servers.push(srv);
  return srv.address().port;
}

/** The bot's internal route and the portal, wired as on Railway: the portal reaches the bot by MAIN_BOT_URL + key. */
async function start({ botDelayMs = 0 } = {}) {
  require('../../bot/shared/services/quiz/report-page-quiz')._resetCache();
  require('../../bot/shared/services/quiz/closed-window-offer')._resetCache();
  const bot = express();
  if (botDelayMs) bot.use((req, res, next) => setTimeout(next, botDelayMs));
  bot.use('/api/internal/rq', require('../../bot/shared/routes/report-quiz-internal.routes'));
  const botPort = await listen(bot);
  process.env.MAIN_BOT_URL = `http://127.0.0.1:${botPort}`;
  const portal = express();
  // The real portal → bot clients, with a test-machine timeout: a loaded run answers late, not never.
  const { createCoachingReportRouter, createReportQuizClient } = require('../../dashboard/routes/coaching-report.routes');
  portal.use(createCoachingReportRouter({
    reportQuiz: createReportQuizClient({ timeoutMs: 30000 }),
    groupOf: async () => null,
    deliverySwitch: async () => ({ linkTemplate: null, tipWording: false, timeOnPage: false }),
  }));
  const port = await listen(portal);
  const token = (userId = UID) => require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: SID, userId });
  const req = (method, path, { body, json = false } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : (json ? JSON.stringify(body) : new URLSearchParams(body).toString());
    const r = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(data ? { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
  return { token, req };
}


const jobs = (type) => Queue.queueJob.mock.calls.filter((c) => c[1] === type);
const botEvents = (name) => botEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const portalEvents = (name) => portalEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const Token = require('../../bot/shared/services/coaching/report-link-token');
const PORTAL_ON = (mode = 'inline') => ({ key: 'quiz_portal_report_block', value: { mode } });
const FRESH = []; // no quiz row for the session yet

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, TRANSCRIPT_QUIZ_ENABLED: 'true', INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co',
    WHATSAPP_BOT_NUMBER: '923206281951', WEB_QUIZ_BASE_URL: 'https://portal.example', WEB_QUIZ_TOKEN_SECRET: 's'.repeat(40),
    PORTAL_URL: 'https://portal.example' };
  const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
});
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
afterAll(() => { process.env = ENV; });

/** The portal's coaching routes on their own app, signed in as `userId` (null = signed out). */
async function portalApp(userId = UID) {
  const app = express();
  app.use((req, _res, next) => { req.session = userId ? { portalUserId: userId } : {}; next(); });
  app.use('/api/portal', require('../../dashboard/routes/portal-teacher-coaching.routes'));
  const port = await listen(app);
  return (path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      // a route that does not exist answers express's HTML 404: kept as text, so the test fails at once, not at its timeout
      const parse = () => { try { return JSON.parse(b); } catch (_) { return b; } };
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b ? parse() : null }));
    }).on('error', reject);
  });
}
const tokenOf = (url) => String(url).replace(/^\/cq\//, '').replace(/\?.*$/, '');
const nowS = () => Math.floor(Date.now() / 1000);
const expOf = (t) => JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString('utf8')).exp;

describe('the report link can be signed for a shorter time', () => {
  test('ttlS 86400: exp - now <= 86400, and it verifies as the same session and teacher', () => {
    const t = Token.signReportLink({ sessionId: SID, userId: UID }, { ttlS: 86400 });
    expect(expOf(t) - nowS()).toBeLessThanOrEqual(86400);
    expect(expOf(t) - nowS()).toBeGreaterThan(86000);
    expect(Token.verifyReportLink(t)).toEqual({ ok: true, sessionId: SID, userId: UID });
  });
  test('no ttl, or a bad one: today\'s 120 days; never longer than that', () => {
    for (const opts of [undefined, {}, { ttlS: 0 }, { ttlS: -5 }, { ttlS: 'x' }, { ttlS: 10 * Token.TTL_S }]) {
      const t = Token.signReportLink({ sessionId: SID, userId: UID }, opts);
      expect(expOf(t) - nowS()).toBeGreaterThan(Token.TTL_S - 60);
      expect(expOf(t) - nowS()).toBeLessThanOrEqual(Token.TTL_S);
    }
  });
});

describe('the screen asks for the block: GET /api/portal/teacher/coaching/:id/quiz-block', () => {
  let sign;
  beforeEach(() => {
    sign = jest.spyOn(Token, 'signReportLink');
  });
  afterEach(() => { sign.mockRestore(); });

  test('switch row missing → 404 {off:true}, nothing minted', async () => {
    seed({ settings: [ON], quizzes: FRESH });
    const get = await portalApp();
    const r = await get(`/api/portal/teacher/coaching/${SID}/quiz-block`);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, off: true });
    expect(sign).not.toHaveBeenCalled();
  });

  test('the switch read fails → 404 {off:true}, nothing minted (fail closed)', async () => {
    seed({ settings: [ON, PORTAL_ON()], quizzes: FRESH });
    const from = mockDb.from;
    mockDb = { ...mockDb, from: (t) => (t === 'app_settings' ? { select: () => ({ eq: async () => ({ data: null, error: { message: 'boom' } }), in: async () => ({ data: null, error: { message: 'boom' } }) }) } : from(t)) };
    const get = await portalApp();
    const r = await get(`/api/portal/teacher/coaching/${SID}/quiz-block`);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, off: true });
    expect(sign).not.toHaveBeenCalled();
  });

  test('portal switch on but the /cq pages off (report_page) → 404 {off:true}, nothing minted', async () => {
    seed({ settings: [{ key: 'quiz_offer_closed_window', value: { trace: true } }, PORTAL_ON()], quizzes: FRESH });
    const get = await portalApp();
    const r = await get(`/api/portal/teacher/coaching/${SID}/quiz-block`);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, off: true });
    expect(sign).not.toHaveBeenCalled();
  });

  test('the teacher\'s ready session, inline → 200 with /cq/<token>?embed=portal; the token is the teacher\'s and lasts <= 24 h; not cached', async () => {
    seed({ settings: [ON, PORTAL_ON('inline')], quizzes: FRESH });
    const get = await portalApp();
    const r = await get(`/api/portal/teacher/coaching/${SID}/quiz-block`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, mode: 'inline', url: expect.stringMatching(/^\/cq\/[A-Za-z0-9_.-]+\?embed=portal$/) });
    const t = tokenOf(r.body.url);
    expect(Token.verifyReportLink(t)).toEqual({ ok: true, sessionId: SID, userId: UID });
    expect(expOf(t) - nowS()).toBeLessThanOrEqual(86400);
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });

  test('mode page → /cq/<token>?from=portal', async () => {
    seed({ settings: [ON, PORTAL_ON('page')], quizzes: FRESH });
    const get = await portalApp();
    const r = await get(`/api/portal/teacher/coaching/${SID}/quiz-block`);
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('page');
    expect(r.body.url).toMatch(/^\/cq\/[A-Za-z0-9_.-]+\?from=portal$/);
  });

  test('a mode the switch does not know → inline', async () => {
    seed({ settings: [ON, PORTAL_ON('weird')], quizzes: FRESH });
    const get = await portalApp();
    const r = await get(`/api/portal/teacher/coaching/${SID}/quiz-block`);
    expect(r.body.mode).toBe('inline');
  });

  test.each([
    ['another teacher\'s session', (s) => ({ ...s, user_id: OTHER_UID })],
    ['a coach\'s visit', (s) => ({ ...s, observation_type: 'leader_observation' })],
    ['not ready yet', (s) => ({ ...s, status: 'processing' })],
  ])('%s → 404, nothing minted', async (_n, change) => {
    seed({ settings: [ON, PORTAL_ON()], quizzes: FRESH });
    mockDb.tables.coaching_sessions[0] = change(mockDb.tables.coaching_sessions[0]);
    const get = await portalApp();
    const r = await get(`/api/portal/teacher/coaching/${SID}/quiz-block`);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false });
    expect(sign).not.toHaveBeenCalled();
  });

  test('not a session id → 404; signed out → 401', async () => {
    seed({ settings: [ON, PORTAL_ON()], quizzes: FRESH });
    expect((await (await portalApp())('/api/portal/teacher/coaching/nope/quiz-block')).status).toBe(404);
    expect((await (await portalApp(null))(`/api/portal/teacher/coaching/${SID}/quiz-block`)).status).toBe(401);
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('the block in a frame: GET /cq/:token?embed=portal', () => {
  test('framed by our own origin only; the block posts as the portal; links that leave open in the whole window', async () => {
    seed({ settings: [ON, PORTAL_ON()] });
    const { token, req } = await start();
    const t = token();
    const r = await req('GET', `/cq/${t}?embed=portal`);
    expect(r.status).toBe(200);
    const csp = String(r.headers['content-security-policy'] || '');
    expect(csp).toMatch(/frame-ancestors 'self' https:\/\/portal\.example(;|$)/);
    expect(csp).not.toContain('*');
    expect(r.body).toContain('<input type="hidden" name="surface" value="portal">');
    expect(r.body).toContain('<input type="hidden" name="shell" value="embed">');
    expect(r.body).toContain(`<form method="post" action="/cq/${t}/make"`);
    // its height to the screen, addressed to our own origin, never to any
    expect(r.body).toContain("postMessage({type:'rq-height'");
    expect(r.body).toContain('location.origin)');
    expect(r.body).not.toMatch(/postMessage\([^)]*'\*'\)/);
    // the frame page carries no report chrome (no h1 of its own)
    expect(r.body).not.toContain('<h1>');
  });

  test('the ready block in a frame: Send, Try and the PDF leave the frame (target=_top)', async () => {
    seed({ settings: [ON, PORTAL_ON()], quizzes: [{ ...HELD, status: 'sent', language: 'en',
      meta: { step: 'sent', made_via: 'page', student_message: 'Hello class https://portal.example/q/ABC234', share_code: 'ABC234', share_code_id: 'sc-1', pdf_key: 'k.pdf' } }],
    codes: [{ id: 'sc-1', code: 'ABC234', active: true, expires_at: '2099-01-01T00:00:00Z' }], questions: QUESTIONS });
    const { token, req } = await start();
    const t = token();
    const r = await req('GET', `/cq/${t}?embed=portal`);
    expect(r.body).toMatch(/<a class="btn" data-share target="_top" href="https:\/\/wa\.me\//);
    expect(r.body).toContain(`<a class="btn ghost" target="_top" href="/cq/${t}/pdf?surface=portal">`);
  });

  test('/cq without embed is unchanged: no frame header, surface cq', async () => {
    seed({ settings: [ON, PORTAL_ON()] });
    const { token, req } = await start();
    const r = await req('GET', `/cq/${token()}`);
    expect(r.headers['content-security-policy']).toBeUndefined();
    expect(r.body).toContain('<input type="hidden" name="surface" value="cq">');
    expect(r.body).not.toContain('name="shell"');
    expect(r.body).not.toContain('rq-height');
  });

  test('from=portal (mode page): the page, with a link back to the report screen', async () => {
    seed({ settings: [ON, PORTAL_ON('page')] });
    const { token, req } = await start();
    const r = await req('GET', `/cq/${token()}?from=portal`);
    expect(r.status).toBe(200);
    expect(r.body).toContain('<input type="hidden" name="surface" value="portal">');
    expect(r.body).toContain('<input type="hidden" name="shell" value="page">');
    expect(r.body).toContain(`href="/portal/teacher/coaching/report/${SID}"`);
    expect(r.headers['content-security-policy']).toBeUndefined();
  });
});

describe('one quiz per lesson, whichever door', () => {
  test('no quiz yet: the portal block offers "Make a quiz"; the /cq page alone still shows the /quiz door', async () => {
    seed({ settings: [ON, PORTAL_ON()], quizzes: FRESH });
    const { token, req } = await start();
    const t = token();
    const framed = await req('GET', `/cq/${t}?embed=portal`);
    expect(framed.body).toContain(`<form method="post" action="/cq/${t}/make"`);
    const plain = await req('GET', `/cq/${t}`);
    expect(plain.body).not.toContain(`action="/cq/${t}/make"`);
  });

  test('a portal make, then the WhatsApp offer job for the same lesson → one quiz row, one generation', async () => {
    seed({ settings: [ON, PORTAL_ON()], quizzes: FRESH });
    const { token, req } = await start();
    const t = token();
    const tap = await req('POST', `/cq/${t}/make`, { body: { surface: 'portal', shell: 'embed' } });
    expect(tap.status).toBe(303);
    expect(tap.headers.location).toBe(`/cq/${t}?embed=portal`);
    expect(jobs('quiz_offer')).toHaveLength(1);
    expect(jobs('quiz_offer')[0][2]).toEqual(expect.objectContaining({ coachingSessionId: SID, page: true, accepted: true, surface: 'portal' }));
    expect(botEvents('transcript_quiz.page_make_tap')).toEqual([expect.objectContaining({ coachingSessionId: SID, surface: 'portal' })]);

    Digest.run.mockResolvedValue(DIGEST('urdu'));
    const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
    const p = jobs('quiz_offer')[0][2];
    await Offer.processOffer(p.coachingSessionId, p);
    const rows = () => mockDb.tables.quizzes.filter((q) => q.coaching_session_id === SID);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].meta.made_via).toBe('page');
    expect(jobs('quiz_generate')).toHaveLength(1);

    // the report's own WhatsApp offer for the same lesson, window open: no second row, no second generation
    require('../../bot/shared/services/quiz/quiz-delivery.service')._hasOpenMessageWindow.mockResolvedValueOnce(true);
    await Offer.processOffer(SID, { coachingSessionId: SID, phone: PHONE });
    expect(rows()).toHaveLength(1);
    expect(jobs('quiz_generate')).toHaveLength(1);
    expect(WhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  // A /cq token from WhatsApp can post surface=portal itself: with the block's row off, the portal door makes nothing new.
  test.each([
    ['row missing', [ON]],
    ['row off', [ON, { key: 'quiz_portal_report_block', value: { on: false } }]],
  ])('block %s: a make posted as the portal on a lesson with no quiz queues nothing; its poll says none', async (_n, settings) => {
    seed({ settings, quizzes: FRESH });
    const { token, req } = await start();
    const t = token();
    await req('POST', `/cq/${t}/make`, { body: { surface: 'portal', shell: 'embed' } });
    expect(jobs('quiz_offer')).toHaveLength(0);
    expect(JSON.parse((await req('GET', `/cq/${t}/state?surface=portal`)).body)).toEqual({ state: 'none' });
    expect(mockDb.tables.quizzes.filter((q) => q.coaching_session_id === SID)).toHaveLength(0);
  });

  test('the poll asks as the portal: /state?surface=portal names the fresh lesson held; without it, none', async () => {
    seed({ settings: [ON, PORTAL_ON()], quizzes: FRESH });
    const { token, req } = await start();
    const t = token();
    expect(JSON.parse((await req('GET', `/cq/${t}/state?surface=portal`)).body)).toEqual({ state: 'held' });
    expect(JSON.parse((await req('GET', `/cq/${t}/state`)).body)).toEqual({ state: 'none' });
  });

  test('a beacon from the frame is logged with surface portal', async () => {
    seed({ settings: [ON, PORTAL_ON()], quizzes: [{ ...HELD, status: 'sent', language: 'en',
      meta: { step: 'sent', made_via: 'page', student_message: 'Hello', share_code: 'ABC234', share_code_id: 'sc-1' } }] });
    const { token, req } = await start();
    const r = await req('POST', `/cq/${token()}/e`, { body: { ev: 'copy', surface: 'portal' } });
    expect(r.status).toBe(204);
    expect(portalEvents('transcript_quiz.page_copy')).toEqual([expect.objectContaining({ surface: 'portal' })]);
  });
});
