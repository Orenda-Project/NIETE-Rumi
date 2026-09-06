'use strict';
/**
 * Every webhook Meta delivers MUST be answered. Measured on staging
 * (2026-09-06): a child's join-Flow reply got NO HTTP response at all — the
 * request was still open after 180 s, while the bot had created her session
 * one second in and sent her three messages. The join text path answered in
 * 2.4 s; the Flow-reply path answered never.
 *
 * The cause is a bare `return` inside the webhook route handler: the branch
 * finishes its work and leaves the route without calling res.send(), so the
 * socket stays open until the client gives up. Meta re-delivers a webhook it
 * was not acked for, and nothing on this path is idempotent — startSession
 * INSERTs a quiz_sessions row unconditionally — so a retry is a duplicate
 * child in the teacher's report, a duplicate "Here we go", a duplicate
 * question 1.
 *
 * These tests drive the REAL Express route and assert on the RESPONSE, which
 * is the only thing Meta ever sees. A source-level assertion could not have
 * caught this: every branch reads correctly, it is the absence of a call that
 * is the bug.
 */
const http = require('http');

const PHONE = '923001234567';
const SHARE_CODE_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '22222222-2222-4222-8222-222222222222';

function nfmBody(flowToken, payload) {
  const responseJson = JSON.stringify({ flow_token: flowToken, ...payload });
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
            interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: responseJson } },
          }],
        },
      }],
    }],
  };
}

/** Wait until `predicate()` is true, or fail after `timeoutMs`. */
async function waitFor(predicate, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * POST and WAIT FOR THE RESPONSE, with a deadline. The sibling router test
 * fires and forgets, which is exactly why it stayed green through this bug.
 *
 * `keepAlive` leaves the server up: once the ack comes back FIRST (which is
 * the whole point of the fix), the handler is still running, and closing the
 * socket underneath it would race the assertion that it ran at all.
 */
async function postAndAwaitAck(app, body, timeoutMs = 5000) {
  const server = http.createServer(app);
  let closed = false;
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    if (err.name === 'AbortError') return { status: null, text: `NO RESPONSE within ${timeoutMs}ms` };
    throw err;
  } finally {
    clearTimeout(timer);
    if (!closed) { closed = true; setTimeout(() => server.close(), 1000).unref?.(); }
  }
}

function mockEverythingBefore() {
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
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
  }));
  jest.doMock('../../bot/shared/services/session.service', () => ({
    isProcessed: jest.fn().mockResolvedValue(false),
    markAsProcessed: jest.fn().mockResolvedValue(undefined),
    getReactionEmoji: jest.fn().mockReturnValue('👍'),
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendReaction: jest.fn().mockResolvedValue(true),
    showTypingIndicator: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn().mockResolvedValue({ id: 'u-1', phone_number: PHONE, preferred_language: 'en' }),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
    handleResumeButton: jest.fn().mockResolvedValue(false),
    sweep: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { fromMock } = require('./helpers/supabase-chain');
    return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
  });
}

describe('webhook → the response Meta actually receives', () => {
  beforeEach(() => jest.resetModules());

  test('a child\'s join-Flow reply is acked, not left hanging', async () => {
    mockEverythingBefore();
    // The join succeeded — this is the path that measured 180 s with no reply.
    jest.doMock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
      handleJoinFlowReply: jest.fn().mockResolvedValue(true),
      parseShareCode: jest.fn().mockReturnValue(null),
      beginFromCodeLocked: jest.fn().mockResolvedValue(true),
      consumeJoinReply: jest.fn().mockResolvedValue(false),
      handleShareButton: jest.fn().mockResolvedValue(false),
    }));
    const { app } = require('../../bot/whatsapp-bot');
    const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');

    const res = await postAndAwaitAck(app, nfmBody(`vqjoin:${SHARE_CODE_ID}`, {
      student_name: 'QA Child', student_class: 'Class 6',
    }));

    // The ack comes back straight away — that is the fix.
    expect(res.status).toBe(200);
    // And the work still happens, after the ack, not instead of it.
    await waitFor(() => Share.handleJoinFlowReply.mock.calls.length > 0, 'handleJoinFlowReply');
  });

  test('a picture-Flow answer is acked, not left hanging', async () => {
    mockEverythingBefore();
    jest.doMock('../../bot/shared/services/quiz/video-quiz.service', () => ({
      handleAnswer: jest.fn().mockResolvedValue(true),
      handleOfferButton: jest.fn().mockResolvedValue(false),
      getActiveState: jest.fn().mockResolvedValue(null),
    }));
    const { app } = require('../../bot/whatsapp-bot');
    const VideoQuiz = require('../../bot/shared/services/quiz/video-quiz.service');

    const res = await postAndAwaitAck(app, nfmBody(`vq:sess-1:${QUESTION_ID}`, { screen_0_Choose_0: '2' }));

    expect(res.status).toBe(200);
    await waitFor(() => VideoQuiz.handleAnswer.mock.calls.length > 0, 'handleAnswer');
    expect(VideoQuiz.handleAnswer).toHaveBeenCalledWith(PHONE, `vq_${QUESTION_ID}_2`);
  });
});
