'use strict';
/**
 * Pre-merge class A: every new interactive id the teacher /quiz menu emits
 * (tqh_make, tqh_reports, tqh_class; tqr_<quizId>, tqr_page_<n>) reaches its
 * handler through the REAL POST /webhook dispatcher. `tqh_`/`tqr_` do not start
 * with `tq_`, so without their own branches each tap fell into the generic
 * "Thanks for your response!" else.
 *
 * Only the edges are mocked: supabase, whatsapp.service, the user lookup, the
 * webhook dedupe, ingress/resume (answer "not mine"), and the drain tracker.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-secret-for-teacher-report';
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';
process.env.QUIZ_MENU_HANDSET_ROUTING = 'off';
process.env.QUIZ_MENU_LESSON_ROWS = 'off';

const { fakeDb } = require('./fake-db');

const TEACHER = { id: 'teacher-1', phone_number: '923000000001', preferred_language: 'en', role: 'teacher' };
const FROM = TEACHER.phone_number;
const THANKS = 'Thanks for your response!';

async function bootApp() {
  jest.resetModules();
  const sent = [];
  const works = [];
  const quizzes = Array.from({ length: 11 }, (_, i) => ({
    id: `q${i + 1}`, teacher_id: TEACHER.id, topic: `Topic ${i + 1}`, subject: 'Science', grade: '5', language: 'en',
    quiz_source: 'transcript', status: 'sent', list_id: null, meta: {}, created_at: `2026-10-${String(i + 1).padStart(2, '0')}T08:00:00Z`,
  }));
  const store = fakeDb({
    app_settings: [{ key: 'teacher_report_teachers', value: 'all' }],
    users: [TEACHER],
    quizzes,
    quiz_share_codes: [],
    quiz_sessions: [],
    student_lists: [],
    students: [],
    coaching_sessions: [{
      id: 'cs-1', user_id: TEACHER.id, observation_type: null, status: 'completed', created_at: '2026-10-01T09:00:00Z',
      transcript_text: 'x'.repeat(5000), analysis_data: { topic: 'Fractions', subject: 'Maths' },
    }],
  });

  jest.doMock('../../../shared/config/supabase', () => store);
  jest.doMock('../../../shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => { const p = Promise.resolve(w); works.push(p); return p; },
    installWebDrain: () => {},
    inFlightCount: () => 0,
    waitForIdle: async () => true,
  }));
  jest.doMock('../../../shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', to, text }); return true; }),
    sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', to, p }); return true; }),
    sendInteractiveMessage: jest.fn(async (to, p) => { sent.push({ kind: 'list', to, p }); return true; }),
    sendFlow: jest.fn(async (to, f) => { sent.push({ kind: 'flow', to, f }); return true; }),
    sendTemplate: jest.fn(async () => true),
    sendImageFromBuffer: jest.fn(async () => true),
    sendReaction: jest.fn(async () => true),
    showTypingIndicator: jest.fn(async () => true),
    startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
    downloadMedia: jest.fn(async () => Buffer.from('x')),
    markAsRead: jest.fn(async () => true),
  }));
  jest.doMock('../../../shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn(async () => TEACHER),
    trackChatStart: jest.fn(async () => true),
  }));
  jest.doMock('../../../shared/services/session.service', () => ({
    isProcessed: jest.fn(async () => false),
    markAsProcessed: jest.fn(async () => true),
    getReactionEmoji: jest.fn(() => '👍'),
  }));
  jest.doMock('../../../shared/services/student-ingress', () => ({
    attach: jest.fn(async () => false),
    route: jest.fn(async () => false),
  }));
  jest.doMock('../../../shared/services/conversation-resume.service', () => ({
    handleResumeButton: jest.fn(async () => false),
  }));

  process.env.TRANSCRIPT_QUIZ_FLOW_ID = 'flow-123';
  const { app } = require('../../../whatsapp-bot');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;

  async function post(interactive) {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{
        id: '1234567890',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550000000', phone_number_id: '111111111' },
            messages: [{
              from: FROM,
              id: `wamid.${Math.random().toString(36).slice(2)}`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'interactive',
              interactive,
            }],
          },
        }],
      }],
    };
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    // The route acks first and works after: wait for the work it registered, then for the
    // reply itself (bounded), never a fixed tick — under a loaded machine one tick is not enough.
    await Promise.allSettled(works);
    const deadline = Date.now() + 10000;
    while (!sent.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      await Promise.allSettled(works);
    }
  }

  return {
    sent,
    tap: (id) => post({ type: 'button_reply', button_reply: { id, title: 'tap' } }),
    pick: (id) => post({ type: 'list_reply', list_reply: { id, title: 'row' } }),
    close: () => new Promise((r) => server.close(r)),
  };
}

const notThanks = (sent) => expect(sent.some((s) => s.kind === 'text' && String(s.text).startsWith(THANKS))).toBe(false);

describe('the home\'s reply buttons reach their handlers through the real webhook', () => {
  test('tqh_make → the /quiz Flow', async () => {
    const app = await bootApp();
    try {
      await app.tap('tqh_make');
      notThanks(app.sent);
      expect(app.sent.map((s) => s.kind)).toEqual(['flow']);
    } finally { await app.close(); }
  });

  test('tqh_reports → the reports list (tqr_ rows)', async () => {
    const app = await bootApp();
    try {
      await app.tap('tqh_reports');
      notThanks(app.sent);
      const list = app.sent.find((s) => s.kind === 'list');
      expect(list.p.action.sections[0].rows[0].id).toBe('tqr_q11');
    } finally { await app.close(); }
  });

  test('tqh_class → the all-classes report link', async () => {
    const app = await bootApp();
    try {
      await app.tap('tqh_class');
      notThanks(app.sent);
      expect(app.sent.find((s) => s.kind === 'text').text).toMatch(/https:\/\/portal\.example\/[tr]\//);
    } finally { await app.close(); }
  });
});

describe('the reports list\'s rows reach their handler through the real webhook', () => {
  test('tqr_<quizId> → that quiz\'s report link', async () => {
    const app = await bootApp();
    try {
      await app.pick('tqr_q3');
      const text = app.sent.find((s) => s.kind === 'text').text;
      expect(text).toMatch(/Topic 3/);
      expect(text).toMatch(/https:\/\/portal\.example\/[tr]\//);
    } finally { await app.close(); }
  });

  test('tqr_page_2 → the second page', async () => {
    const app = await bootApp();
    try {
      await app.pick('tqr_page_2');
      const rows = app.sent.find((s) => s.kind === 'list').p.action.sections[0].rows;
      expect(rows.map((r) => r.id)).toEqual(['tqr_q2', 'tqr_q1']);
    } finally { await app.close(); }
  });
});
