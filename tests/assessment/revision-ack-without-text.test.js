'use strict';
/**
 * Remaking an assessment paper is acknowledged without a text message.
 *
 * Two paths, one bubble each, both redundant:
 *
 *   - The old rebuild path (versions flag off) rebuilds and SENDS the paper first,
 *     then says "📝 Making your paper again — a few seconds.\n\n{N questions · M
 *     marks}". The paper is already in the chat by then, and its caption already
 *     names its question count and marks. Dropped.
 *   - The versioned path says "📝 Making your new version — a few seconds." before
 *     a build that takes a few seconds and ends in the new version arriving. A 📝
 *     reaction on the completion plus the typing indicator say the same for free.
 *     Without the completion's message id there is nothing to react to, so the
 *     text stays (the signal is never dropped silently).
 *
 * Production, 24-30 Sep 2026: 233 revisions.
 *
 * Real handler, real endpoint, an in-memory PostgREST; only WhatsApp, redis and
 * the queue are stubbed — plus the revision renderer, whose PDF build is the
 * boundary this suite does not cross (the same seam assessment-versions-completion
 * uses).
 */
const http = require('http');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: async (k) => (mockStore.has(k) ? JSON.parse(mockStore.get(k)) : null),
  set: async (k, v) => { mockStore.set(k, JSON.stringify(v)); return true; },
  setNX: async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, JSON.stringify(v)); return true; },
  delete: async (k) => { mockStore.delete(k); return true; },
  checkRateLimit: async () => ({ allowed: true }),
}));
const { makeFakeDb } = require('./helpers/fake-postgrest');
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t), rpc: async () => ({ data: null, error: null }) }));
const mockOrder = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { mockOrder.push(['text', text]); return true; }),
  sendReaction: jest.fn(async (to, id, emoji) => { mockOrder.push(['reaction', id, emoji]); return true; }),
  showTypingIndicator: jest.fn(async (to, id) => { mockOrder.push(['typing', id]); return true; }),
  sendDocumentByLink: jest.fn(async () => true),
  sendFlow: jest.fn(async () => true),
}));

const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const Revision = require('../../bot/shared/services/assessment/assessment-revision.service');
const { handleAssessmentFlowCompletion: complete } = require('../../bot/shared/handlers/flow-response.handler');

const U = 'user-1';
const PHONE = '923000000000';
const TOKEN = `${U}:assessment-review:v2`;
const TREE = { seen: { objective: { MCQs: [
  { question: 'پانی کس حالت میں ہوتا ہے؟', options: ['الف) ٹھوس', 'ب) مائع'], answer: 'ب) مائع', marks: 1 },
  { question: 'Q2', options: ['A) 1', 'B) 2'], answer: 'A) 1', marks: 1 },
] } } };
const USER = { id: U, preferred_language: 'en', phone_number: PHONE };

function db(versions) {
  return makeFakeDb({
    assessment_requests: [{ id: 'r1', user_id: U, grade_code: 'grade_2', subject_code: 'urdu', has_answer_lines: true, output_format: 'pdf' }],
    assessment_papers: [
      { id: 'v1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: TREE, created_at: '2026-09-30T09:00:00.000Z' },
      { id: 'v2', request_id: 'r1', attempt: 1, status: 'ready', edited_from: 'v1', exam_json: TREE, created_at: '2026-09-30T09:05:00.000Z' },
    ],
    users: [{ id: U, preferred_language: 'en' }],
    app_settings: [{ key: 'assessment_versions_enabled', value: versions }, { key: 'assessment_editing_enabled', value: true }],
  });
}

async function openAndRemoveOne() {
  const list = await Endpoint.handleAssessmentGenInit(U, TOKEN);
  const row = list.data.rows.find((r) => /Q2/.test(r['main-content'].title));
  await Endpoint.handleAssessmentGenDataExchange(U, 'LIST', row['on-click-action'].payload, TOKEN);
  await Endpoint.handleAssessmentGenDataExchange(U, 'EDIT_OPTIONS', {
    _action: 'save', remove: true, correct: '0', slot_0: 'A) 1', slot_1: 'B) 2', slot_2: '', slot_3: '', slot_4: '', slot_5: '',
  }, TOKEN);
}

let createSpy;
beforeEach(() => {
  mockStore.clear();
  mockOrder.length = 0;
  jest.clearAllMocks();
  createSpy = jest.spyOn(Revision, 'createVersion').mockImplementation(async () => {
    mockOrder.push(['build']);
    return { status: 'ready', paperId: 'v3', version: 3, parentVersion: 2, questionCount: 1, marks: 1 };
  });
});
afterEach(() => jest.restoreAllMocks());

describe('versioned path — "Making your new version" becomes a reaction', () => {
  beforeEach(() => { mockDb = db(true); });

  test('with the completion\'s message id: 📝 reaction + typing, then the build — no text', async () => {
    await openAndRemoveOne();
    await complete({ flow_token: TOKEN }, PHONE, USER, { messageId: 'wamid.done' });
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(mockOrder).toEqual([['reaction', 'wamid.done', '📝'], ['typing', 'wamid.done'], ['build']]);
  });

  test('without a message id the text is kept', async () => {
    await openAndRemoveOne();
    await complete({ flow_token: TOKEN }, PHONE, USER);
    expect(mockOrder).toEqual([['text', '📝 Making your new version — a few seconds.'], ['build']]);
  });

  test('a refused reaction falls back to the text', async () => {
    const Wa = require('../../bot/shared/services/whatsapp.service');
    Wa.sendReaction.mockImplementationOnce(async () => false);
    await openAndRemoveOne();
    await complete({ flow_token: TOKEN }, PHONE, USER, { messageId: 'wamid.done' });
    expect(mockOrder.filter(([k]) => k === 'text')).toEqual([['text', '📝 Making your new version — a few seconds.']]);
  });

  test('"no changes" keeps its own sentence — it says something the paper does not', async () => {
    jest.spyOn(Revision, 'resendVersion').mockImplementation(async () => { mockOrder.push(['resend']); return { status: 'resent' }; });
    await Endpoint.handleAssessmentGenInit(U, TOKEN);
    await complete({ flow_token: TOKEN }, PHONE, USER, { messageId: 'wamid.done' });
    expect(mockOrder[0][0]).toBe('text');
    expect(mockOrder[0][1]).toMatch(/didn't change anything/);
  });

  test('through the webhook: the nfm_reply\'s own id reaches the handler', async () => {
    await openAndRemoveOne();
    jest.doMock('../../bot/shared/utils/validators', () => ({
      validateWebhookStatus: () => null,
      validateWebhookMessage: (req) => {
        const value = req.body.entry[0].changes[0].value;
        const message = value.messages[0];
        return {
          entry: req.body.entry[0], message, from: message.from, messageBody: '',
          messageType: message.type, messageTimestamp: message.timestamp, phoneNumberId: 'pnid',
        };
      },
      isOurPhoneNumber: () => true, isTestWebhook: () => false, isTestPhoneNumber: () => false, isWithin24Hours: () => true,
    }));
    jest.doMock('../../bot/shared/services/session.service', () => ({
      isProcessed: jest.fn().mockResolvedValue(false), markAsProcessed: jest.fn(), getReactionEmoji: () => '👍',
    }));
    jest.doMock('../../bot/shared/database/bot-helpers', () => ({
      getOrCreateUser: jest.fn().mockResolvedValue(USER), trackChatStart: jest.fn(),
    }));
    jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
      handleResumeButton: jest.fn().mockResolvedValue(false), sweep: jest.fn(),
    }));
    let app;
    let drain;
    jest.isolateModules(() => {
      ({ app } = require('../../bot/whatsapp-bot'));
      drain = require('../../bot/shared/utils/web-drain');
    });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      mockOrder.length = 0;
      const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{ id: 'wamid.flowdone', from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), type: 'interactive',
            interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify({ flow_token: TOKEN }) } } }],
        } }] }] }),
      });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
      const deadline = Date.now() + 5000;
      while (drain.inFlightCount() !== 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    } finally {
      server.close();
    }
    expect(mockOrder).toContainEqual(['reaction', 'wamid.flowdone', '📝']);
    expect(mockOrder.filter(([k, t]) => k === 'text' && /Making your new version/.test(t))).toEqual([]);
  }, 15000);
});

describe('old rebuild path — the after-the-fact "Making your paper again" is dropped', () => {
  beforeEach(() => { mockDb = db(false); });

  test('a successful rebuild sends the paper and no text after it', async () => {
    jest.spyOn(Revision, 'listQuestions').mockResolvedValue({ items: [{ id: 'a' }, { id: 'b' }] });
    jest.spyOn(Revision, 'rerender').mockImplementation(async () => { mockOrder.push(['paper']); return { status: 'ready', questionCount: 2, marks: 2 }; });
    await complete({ flow_token: TOKEN }, PHONE, USER, { messageId: 'wamid.done' });
    expect(mockOrder).toEqual([['paper']]);
  });

  test('a failed rebuild is still apologised for', async () => {
    jest.spyOn(Revision, 'listQuestions').mockResolvedValue({ items: [{ id: 'a' }] });
    jest.spyOn(Revision, 'rerender').mockResolvedValue({ status: 'failed', code: 'RENDER_FAILED' });
    await complete({ flow_token: TOKEN }, PHONE, USER, { messageId: 'wamid.done' });
    expect(mockOrder.filter(([k]) => k === 'text').map(([, t]) => t)).toEqual([
      "Sorry — we couldn't rebuild that paper. Send /assessment to make a new one.",
    ]);
  });
});
