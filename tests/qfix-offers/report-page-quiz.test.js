'use strict';
/**
 * "Make a quiz" on the coaching report page (/cr) for a teacher whose window was closed (report-page-quiz.js, switch
 * quiz_offer_closed_window.report_page, off by default).
 *
 *   page  the card carries a "Make a quiz" wa.me link whose prefill ends in CR-<8 hex>, only while the switch is on
 *         AND the session's quiz offer was held for a closed window. Off, or any other row: today's bytes.
 *   bot   that prefill, sent by the session's own teacher, reaches handleReportQuizTap as tqr_<session> through the
 *         real /webhook. Someone else's code, or none of theirs: the /quiz door, never another teacher's quiz.
 * Only the network boundary is stubbed (Supabase as an in-memory table set, WhatsApp, redis).
 */
const http = require('http');
const express = require('express');
const { makeDb } = require('../quiz/helpers/memory-db');

const PHONE = '923330000011';
const OTHER = '923330000099';
const SID = 'a1b2c3d4-1111-4111-8111-000000000001';
const UID = 'b0ffe250-0000-4000-8000-0000000000a1';
const TEACHER = { id: UID, role: 'teacher', phone_number: PHONE, preferred_language: 'en' };
const STRANGER = { id: 'b0ffe250-0000-4000-8000-0000000000a2', role: 'teacher', phone_number: OTHER, preferred_language: 'en' };
const HELD = { id: 'q-1', coaching_session_id: SID, quiz_source: 'transcript', status: 'skipped', teacher_id: UID,
  meta: { step: 'skipped', skip_reason: 'window_closed', held_path: 'none' } };
const ON = { key: 'quiz_offer_closed_window', value: { trace: true, report_page: true } };
const later = (ms) => new Promise((r) => setTimeout(r, ms));
const ENV = { ...process.env };
afterAll(() => { process.env = ENV; });

describe('the bot: a report-page prefill through the real /webhook', () => {
  // The first test loads the whole bot (whatsapp-bot.js); under a parallel suite that alone can pass 30 s.
  jest.setTimeout(180000);
  let mockDb;
  let mockWa;
  let mockTap;

  function body(text) {
    return {
      entry: [{
        id: 'waba',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'pnid' },
            messages: [{ from: mockFrom, timestamp: String(Math.floor(Date.now() / 1000)), id: `wamid.${Math.random()}`, type: 'text', text: { body: text } }],
          },
        }],
      }],
    };
  }
  let mockFrom = PHONE;

  function mockBoundaries(user) {
    jest.doMock('../../bot/shared/utils/validators', () => ({
      validateWebhookStatus: () => null,
      validateWebhookMessage: (req) => {
        const value = req.body.entry[0].changes[0].value;
        const message = value.messages[0];
        return {
          entry: req.body.entry[0], message, from: message.from, messageBody: message.text.body,
          messageType: message.type, messageTimestamp: message.timestamp,
          phoneNumberId: value.metadata.phone_number_id,
        };
      },
      isOurPhoneNumber: () => true,
      isTestWebhook: () => false,
      isTestPhoneNumber: () => false,
      isWithin24Hours: () => true,
    }));
    const store = new Map();
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
      set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
      setexWithCeiling: jest.fn(async (k, _t, v) => { store.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
      delete: jest.fn(async (k) => { store.delete(k); return true; }),
      setNX: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/services/session.service', () => ({
      isProcessed: jest.fn().mockResolvedValue(false),
      markAsProcessed: jest.fn().mockResolvedValue(undefined),
      getReactionEmoji: jest.fn().mockReturnValue('👍'),
    }));
    mockWa = {
      sendReaction: jest.fn().mockResolvedValue(true),
      showTypingIndicator: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue(true),
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
      sendVideoByLink: jest.fn().mockResolvedValue(true),
    };
    jest.doMock('../../bot/shared/services/whatsapp.service', () => mockWa);
    jest.doMock('../../bot/shared/database/bot-helpers', () => ({
      getOrCreateUser: jest.fn(async () => user),
      trackChatStart: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
      handleResumeButton: jest.fn().mockResolvedValue(false),
      sweep: jest.fn(),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (...a) => mockDb.from(...a),
      rpc: (...a) => mockDb.rpc(...a),
    }));
    // The tap handler (owner check, then the quiz) is tested for real in closed-window-offer.test.js; here only the
    // route to it, with the session the code resolved to.
    // Each test's own mock, captured here: a slow request from an earlier test can never land in this one's.
    mockTap = jest.fn().mockResolvedValue(true);
    const mockThisTap = mockTap;
    jest.doMock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => ({
      ...jest.requireActual('../../bot/shared/services/quiz/transcript-quiz-offer.service'),
      handleReportQuizTap: (...a) => mockThisTap(...a),
      languageByPhone: async () => 'en',
    }));
  }

  async function send(text) {
    const { app } = require('../../bot/whatsapp-bot');
    const drain = require('../../bot/shared/utils/web-drain');
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(text)),
      });
      expect(res.status).toBe(200);
      await later(20);
      const deadline = Date.now() + 60000;
      while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
    } finally {
      server.close();
    }
  }

  function setup({ settings = [ON], user = TEACHER, from = PHONE, sessions } = {}) {
    jest.resetModules();
    mockFrom = from;
    mockDb = makeDb({
      users: [TEACHER, STRANGER],
      app_settings: settings,
      coaching_sessions: sessions || [{ id: SID, user_id: UID }, { id: 'ffff0000-1111-4111-8111-000000000002', user_id: UID }],
      quizzes: [{ ...HELD }],
    });
    mockBoundaries(user);
  }

  test('the teacher\'s prefill (English) → handleReportQuizTap(tqr_<their session>, from), nothing else answers', async () => {
    setup();
    await send('Make a quiz for my class · CR-a1b2c3d4');
    expect(mockTap).toHaveBeenCalledTimes(1);
    expect(mockTap).toHaveBeenCalledWith(`tqr_${SID}`, PHONE);
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });

  test('the Urdu prefill, code inside a direction isolate, reaches the same tap', async () => {
    setup();
    await send('میری کلاس کے لیے کوئز بنائیں · ⁦CR-A1B2C3D4⁩');
    expect(mockTap).toHaveBeenCalledWith(`tqr_${SID}`, PHONE);
  });

  test('another number sending a teacher\'s code is never matched to that teacher\'s session: the /quiz door instead', async () => {
    setup({ user: STRANGER, from: OTHER });
    await send('Make a quiz for my class · CR-a1b2c3d4');
    expect(mockTap).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(mockWa.sendMessage.mock.calls[0][1])).toMatch(/\/quiz/);
  });

  test('switch off: the code is not ours, the text handler runs as before', async () => {
    setup({ settings: [] });
    await send('Make a quiz for my class · CR-a1b2c3d4');
    expect(mockTap).not.toHaveBeenCalled();
  });
});

describe('the page: /cr carries "Make a quiz" only for a held offer with the switch on', () => {
  const S = SID;
  const U = UID;
  const VIEW = {
    language: 'en',
    session: {
      id: S, created_at: '2026-10-19T05:30:00Z',
      analysis_data: { subject: 'Maths', topic: 'Adding tens' },
      prioritized_action: { thing_to_try: { text: 'In pairs, students solve Q1.' } },
    },
    firstName: 'Sadia', trend: [],
  };
  let mockPortalDb;
  let servers = [];
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function page({ settings = [ON], quizzes = [{ ...HELD }], language = 'en' } = {}) {
    jest.resetModules();
    process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', WHATSAPP_BOT_NUMBER: '+92 320 6281951' };
    mockPortalDb = makeDb({ app_settings: settings, quizzes });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (...a) => mockPortalDb.from(...a) }));
    const a = express();
    a.use(require('../../dashboard/routes/coaching-report.routes').createCoachingReportRouter({
      load: async () => ({ ...VIEW, language }),
      groupOf: async () => null,
      deliverySwitch: async () => ({ linkTemplate: null, tipWording: false, timeOnPage: false }),
    }));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    const token = require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: S, userId: U });
    return new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: `/cr/${token}` }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      }).on('error', reject);
    });
  }

  test('held + on → a "Make a quiz" link to the bot with the prefill and the session\'s code', async () => {
    const r = await page();
    expect(r.status).toBe(200);
    const hrefs = [...r.body.replace(/&amp;/g, '&').matchAll(/href="https:\/\/wa\.me\/923206281951\?text=([^"]+)"/g)]
      .map((m) => decodeURIComponent(m[1]));
    expect(hrefs).toContain('Make a quiz for my class · CR-a1b2c3d4');
    expect(r.body).toContain('>Make a quiz</a>');
    // 48 px touch target on the new button only (the page's shared a.btn is 44 px in English)
    expect(r.body).toMatch(/\.qz a\.btn\{[^}]*min-height:48px/);
    expect(r.body).toMatch(/<section class="qz">/);
  });

  test('Urdu teacher → the Urdu block and prefill', async () => {
    const r = await page({ language: 'ur' });
    expect(r.body).toContain('کوئز بنائیں');
    const hrefs = [...r.body.replace(/&amp;/g, '&').matchAll(/href="https:\/\/wa\.me\/923206281951\?text=([^"]+)"/g)]
      .map((m) => decodeURIComponent(m[1]));
    expect(hrefs).toContain('میری کلاس کے لیے کوئز بنائیں · \u2066CR-a1b2c3d4\u2069');
  });

  test.each([
    ['switch off (no row)', { settings: [] }],
    ['switch row without report_page', { settings: [{ key: 'quiz_offer_closed_window', value: { trace: true } }] }],
    ['no quiz row', { quizzes: [] }],
    ['the quiz went on (generating)', { quizzes: [{ ...HELD, status: 'generating' }] }],
    ['skipped for another reason', { quizzes: [{ ...HELD, meta: { skip_reason: 'too_short' } }] }],
  ])('%s → no block', async (_name, opts) => {
    const r = await page(opts);
    expect(r.status).toBe(200);
    expect(r.body).not.toMatch(/CR-a1b2c3d4/);
    expect(r.body).not.toContain('Make a quiz');
  });
});

describe('the quiz-only page: /cq/:token for a teacher outside the new report', () => {
  const VIEW = {
    language: 'en',
    session: { id: SID, created_at: '2026-10-19T05:30:00Z', analysis_data: { subject: 'Maths', topic: 'Adding tens', scores: { overall_percentage: 71 } },
      prioritized_action: { thing_to_try: { text: 'In pairs, students solve Q1.' } } },
    firstName: 'Sadia', trend: [],
  };
  let mockPortalDb;
  let servers = [];
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function get({ settings = [ON], quizzes = [{ ...HELD }], view = VIEW, token } = {}) {
    jest.resetModules();
    process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', WHATSAPP_BOT_NUMBER: '923206281951' };
    mockPortalDb = makeDb({ app_settings: settings, quizzes });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (...a) => mockPortalDb.from(...a) }));
    const a = express();
    a.use(require('../../dashboard/routes/coaching-report.routes').createCoachingReportRouter({
      load: async () => view, groupOf: async () => null,
      deliverySwitch: async () => ({ linkTemplate: null, tipWording: false, timeOnPage: false }),
    }));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    const t = token || require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: SID, userId: UID });
    return new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: `/cq/${t}` }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      }).on('error', reject);
    });
  }

  test('held + on → the lesson and "Make a quiz", nothing of the report (no score, no thing to try)', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toContain('Adding tens');
    expect(r.body).toContain('>Make a quiz</a>');
    expect(r.body.replace(/&amp;/g, '&')).toMatch(/wa\.me\/923206281951\?text=[^"]*CR-a1b2c3d4/);
    expect(r.body).not.toContain('71%');
    expect(r.body).not.toContain('In pairs, students solve Q1.');
  });

  test('the quiz is made → the message to send to the class', async () => {
    const r = await get({ view: { ...VIEW, quizMessage: 'Class 4 quiz: https://q.example/abc' } });
    expect(r.body).toContain('Class 4 quiz: https://q.example/abc');
    expect(r.body).toContain('Send it to your class on WhatsApp');
    expect(r.body).not.toContain('>Make a quiz</a>');
  });

  test('neither held nor made → the /quiz door, with a way to WhatsApp', async () => {
    const r = await get({ quizzes: [] });
    expect(r.status).toBe(200);
    expect(r.body).toContain('/quiz');
    expect(r.body).not.toContain('>Make a quiz</a>');
    expect(r.body.replace(/&amp;/g, '&')).toContain('href="https://wa.me/923206281951?text=%2Fquiz"');
  });

  test('neither, in Urdu: one noun on the page (کوئز), never the Latin "quiz" in Urdu prose', async () => {
    const r = await get({ quizzes: [], view: { ...VIEW, language: 'ur' } });
    const prose = r.body.replace(/<[^>]+>/g, ' ').replace(/\/quiz/g, '');
    expect(prose).toContain('کوئز');
    expect(prose).not.toMatch(/\bquiz\b/i);
  });

  test('switch off → 404 (link not complete); a bad token → 404', async () => {
    expect((await get({ settings: [] })).status).toBe(404);
    expect((await get({ token: 'not-a-token' })).status).toBe(404);
  });
});
