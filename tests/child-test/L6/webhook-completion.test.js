'use strict';
/**
 * Child test check Flow (bd-s1oo0.6) — the completion, through the REAL webhook.
 *
 * When the coach taps Done on the check, WhatsApp delivers an nfm_reply carrying the Flow's flat
 * completion keys and the token. Without a branch of its own it would fall to the loose attendance
 * fallback (the token has colons) and then the generic "Thanks for your response! Type /menu…"
 * catch-all. These tests POST the completion to the real /webhook and check the coach gets the one
 * check line instead — saved, or "didn't save" when a block is missing its coach marks.
 *
 * Real: the webhook, the detector, the completion handler, the check store. Mocked: the DB client
 * (memory), WhatsApp sends, the webhook validators/rate limiter/dedupe (the attendance completion
 * test's boundaries).
 */
const http = require('http');
const path = require('path');
const { makeDb } = require('../../quiz/helpers/memory-db');

process.env.CHILD_TEST_ITEM_BANK_PATH = path.join(__dirname, 'fixtures/item-bank.fixture.json');

const PHONE = '923001234567';
const CATCH_ALL = /Thanks for your response/;
const later = (ms) => new Promise((r) => setTimeout(r, ms));
const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'en', phone_number: PHONE };
const TOKEN = 'coach-1:child-test-check:sess-1';

let mockDb;
let mockWa;

function nfmBody(responseJson) {
  return {
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{
            id: `wamid.${Math.random().toString(36).slice(2)}`,
            from: PHONE,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'interactive',
            interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify(responseJson) } },
          }],
        },
      }],
    }],
  };
}

function mockBoundaries() {
  jest.doMock('../../../bot/shared/utils/validators', () => ({
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
  jest.doMock('../../../bot/shared/services/cache/railway-redis.service', () => ({
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    get: jest.fn().mockResolvedValue(null), set: jest.fn(), delete: jest.fn(), setNX: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../../bot/shared/services/session.service', () => ({
    isProcessed: jest.fn().mockResolvedValue(false),
    markAsProcessed: jest.fn().mockResolvedValue(undefined),
    getReactionEmoji: jest.fn().mockReturnValue('👍'),
  }));
  mockWa = {
    sendReaction: jest.fn().mockResolvedValue(true),
    showTypingIndicator: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendFlow: jest.fn().mockResolvedValue(true),
  };
  jest.doMock('../../../bot/shared/services/whatsapp.service', () => mockWa);
  jest.doMock('../../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn().mockResolvedValue(COACH),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../../../bot/shared/services/conversation-resume.service', () => ({
    handleResumeButton: jest.fn().mockResolvedValue(false),
    sweep: jest.fn(),
  }));
  jest.doMock('../../../bot/shared/config/supabase', () => ({
    from: (...a) => mockDb.from(...a),
    rpc: (...a) => mockDb.rpc(...a),
  }));
}

function seed(checked) {
  return {
    users: [COACH],
    child_test_sessions: [{ id: 'sess-1', coach_user_id: 'coach-1', grade: 3, form: 'A', draw_id: 'draw-1', status: 'in_progress', timings: {} }],
    child_test_draws: [{ id: 'draw-1', roll_number: '14' }],
    child_test_blocks: ['urdu', 'english', 'maths'].map((block, i) => ({
      id: `b${i}`, session_id: 'sess-1', block, ai_marks: {}, ai_status: 'scored',
      coach_marks: {}, checked_at: checked || block !== 'maths' ? '2026-10-02T10:00:00.000Z' : null,
    })),
  };
}

/** POST one completion to the real /webhook and wait until its work has drained. */
async function deliver(responseJson) {
  const { app } = require('../../../bot/whatsapp-bot');
  const drain = require('../../../bot/shared/utils/web-drain');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nfmBody(responseJson)),
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

const sent = () => mockWa.sendMessage.mock.calls.map(([, body]) => String(body));

beforeEach(() => {
  jest.resetModules();
  process.env.CHILD_TEST_ENABLED = 'true';
  mockBoundaries();
});

describe('the check\'s completion on the real webhook', () => {
  test('a finished check: one "saved" line, never the catch-all', async () => {
    mockDb = makeDb(seed(true));
    await deliver({ child_test: 'checked', session_id: 'sess-1', flow_token: TOKEN });
    expect(sent().some((b) => CATCH_ALL.test(b))).toBe(false);
    expect(sent()).toEqual(['✓ Marks for roll 14 saved.']);
  });

  test('only the token arrives (Meta dropped the flat keys): still claimed', async () => {
    mockDb = makeDb(seed(true));
    await deliver({ flow_token: TOKEN });
    expect(sent()).toEqual(['✓ Marks for roll 14 saved.']);
  });

  test('a block without coach marks: the coach is told it did not save', async () => {
    mockDb = makeDb(seed(false));
    await deliver({ child_test: 'checked', session_id: 'sess-1', flow_token: TOKEN });
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatch(/didn't save/);
  });
});
