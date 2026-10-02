'use strict';
/**
 * The two observe merges that are wired in the webhook itself, driven through the
 * real /webhook Express route:
 *
 *   - FICO form submitted → "✅ Thank you! Your FICO observation is saved…" and the
 *     "Next step: the debrief … now, or later?" buttons were two messages (422 a
 *     week each). Now one buttons message whose body is both, ack first.
 *   - "Send now" → the coach's tap gets a 📨 reaction instead of the text
 *     "📨 Sending the report to the teacher now…". The reaction needs the tap's own
 *     message id, so this proves the webhook hands it to the service.
 *
 * Only the network boundary is stubbed (WhatsApp, Supabase, redis, the queue).
 */
const http = require('http');
const { makeDb } = require('../quiz/helpers/memory-db');

const COACH_PHONE = '923330000001';
const later = (ms) => new Promise((r) => setTimeout(r, ms));
const COACH = { id: 'coach-1', role: 'coach', phone_number: COACH_PHONE, preferred_language: 'en' };

let mockDb;
let mockWa;
let mockUser;

function body(message) {
  return {
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{
            from: COACH_PHONE,
            timestamp: String(Math.floor(Date.now() / 1000)),
            ...message,
          }],
        },
      }],
    }],
  };
}

function mockBoundaries() {
  jest.doMock('../../bot/shared/utils/validators', () => ({
    validateWebhookStatus: () => null,
    validateWebhookMessage: (req) => {
      const value = req.body.entry[0].changes[0].value;
      const message = value.messages[0];
      return {
        entry: req.body.entry[0], message, from: message.from, messageBody: '',
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
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => mockWa);
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn(async () => mockUser),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
    handleResumeButton: jest.fn().mockResolvedValue(false),
    sweep: jest.fn(),
  }));
  jest.doMock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
    queueObserveTeacherReport: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (...a) => mockDb.from(...a),
    rpc: (...a) => mockDb.rpc(...a),
  }));
}

async function post(message) {
  const { app } = require('../../bot/whatsapp-bot');
  const drain = require('../../bot/shared/utils/web-drain');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(message)),
    });
    expect(res.status).toBe(200);
    await later(20);
    const deadline = Date.now() + 5000;
    while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
    expect(drain.inFlightCount()).toBe(0);
  } finally {
    server.close();
  }
}

beforeEach(() => {
  jest.resetModules();
  mockUser = COACH;
  mockDb = makeDb({ users: [COACH, { ...COACH, id: 'coach-ur', preferred_language: 'ur' }] });
  mockBoundaries();
});

describe('FICO form submitted', () => {
  const submit = (observerId) => post({
    id: 'wamid.submit',
    type: 'interactive',
    interactive: {
      type: 'nfm_reply',
      nfm_reply: {
        name: 'flow', body: 'Sent',
        response_json: JSON.stringify({ observe_action: 'submitted', session_id: 'sess-1', flow_token: `${observerId}:sess-1` }),
      },
    },
  });

  test.each([['coach-1', 'en'], ['coach-ur', 'ur']])('is acknowledged in ONE buttons message (%s, %s)', async (observerId, lang) => {
    const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
    const S = observeStrings(lang);
    await submit(observerId);
    // No standalone "saved" text any more…
    expect(mockWa.sendMessage.mock.calls.map(([, b]) => b)).not.toContain(S.submitted_ack);
    // …it is the first line of the debrief question, in the coach's language.
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [to, payload] = mockWa.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(COACH_PHONE);
    expect(payload.body).toBe(`${S.submitted_ack}\n\n${S.debrief_choice_body}`);
    expect(payload.buttons.map((b) => b.id)).toEqual(['observe_debrief_now_sess-1', 'observe_debrief_later_sess-1']);
  });
});

describe('"Send now" tapped', () => {
  test('the tap itself gets the 📨 reaction; the "sending now" text is gone', async () => {
    const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
    await post({
      id: 'wamid.sendnow',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'observe_send_confirm_sess-1', title: 'Send now' } },
    });
    expect(mockWa.sendReaction).toHaveBeenCalledWith(COACH_PHONE, 'wamid.sendnow', '📨', { soleAck: true });
    expect(mockWa.sendMessage.mock.calls.map(([, b]) => b)).not.toContain(observeStrings('en').send_delivering);
    const Queue = require('../../bot/shared/services/coaching/coaching-job-queue.service');
    expect(Queue.queueObserveTeacherReport).toHaveBeenCalledWith('sess-1', { from: COACH_PHONE, phase: 'deliver' });
  });
});
