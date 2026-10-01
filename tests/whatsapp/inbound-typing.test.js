'use strict';
/**
 * bd-0wrn4 — "typing…" must not hang on screen after a reply that is only a reaction (or nothing).
 *
 * The webhook sent the typing indicator on every inbound message, right after the 👍 receipt and
 * before any handler ran. WhatsApp clears "typing…" when we send a MESSAGE, or after ~25 s; there is
 * no "stop typing" call. Since the Meta bill cut (1 Oct 2026) many taps are answered by a reaction
 * alone ("Taught it today", "Yes, I'll try!", a survey 👍, a 👎 reason …) or by nothing (a sticker).
 * On every one of those, "typing…" sat in the chat header for ~25 s and then vanished with nothing
 * arriving: the bot looked about to say something and never did.
 *
 * What these pin:
 *   - a reaction-only / silent reply never shows "typing…" (the read receipt still goes, at once);
 *   - a reply that IS a message still gets "typing…" when it is slow, and never AFTER the reply;
 *   - INBOUND_TYPING_DEFER_MS=0 is today's behaviour, for a one-variable rollback.
 *
 * Driven through the REAL /webhook route, the REAL WhatsApp service (with its send pacer) and the
 * real handlers. Only the network is faked: the Graph API (global fetch + the axios stub), Supabase
 * (a stateful in-memory table set, with optional per-query latency) and Redis (in memory).
 */
const http = require('http');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const DEFER_MS = 150;
const PHONE = '923001112233';
const TEACHER = '11111111-1111-4111-8111-111111111111';
const LP = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const later = (ms) => new Promise((r) => setTimeout(r, ms));

let mockDb;
let mockRedis;
let dbLatencyMs;
let tableLatencyMs;  // per-table override, e.g. only the share-code lookup is slow
let graph;           // every Graph POST body, in order, with its time since the webhook POST
let t0;
let realFetch;
let seq = 0;

/** Supabase with a per-query delay — the network boundary is what makes a handler slow. */
function slow(builder, table) {
  const ms = () => (table in tableLatencyMs ? tableLatencyMs[table] : dbLatencyMs);
  return new Proxy(builder, {
    get(target, prop) {
      const v = target[prop];
      if (prop === 'then') {
        return (res, rej) => later(ms()).then(() => target.then(res, rej));
      }
      if (typeof v !== 'function') return v;
      return (...args) => {
        const out = v.apply(target, args);
        if (out === target) return slow(target, table);
        if (out && typeof out.then === 'function' && (prop === 'single' || prop === 'maybeSingle')) {
          return later(ms()).then(() => out);
        }
        return out;
      };
    },
  });
}

function seedDb({ voiceDelivered = false } = {}) {
  mockDb = createMemorySupabase({
    users: [{
      id: TEACHER, phone_number: PHONE, first_name: 'Ayesha', preferred_language: 'en',
      registration_completed: true, role: 'teacher',
    }],
    lesson_plans: [{
      id: LP, user_id: TEACHER, topic: 'Introducing Myself', grade: '1', subject: 'english',
      type: 'lesson_plan',
      content: {
        chapter_number: 1, segment_number: 3, lp_variant: 'niete_v8_segment', grade: 1, subject: 'english',
        trigger_mode: voiceDelivered ? 'after_voice_note' : 'after_pdf_only',
      },
    }],
    // A first 👍 on a voice-note lesson is the one tap that still asks a question.
    lp_feedback: voiceDelivered ? [] : [{ id: 'fb-1', user_id: TEACHER, lesson_plan_id: LP, useful: true }],
    coaching_sessions: [{ id: SESSION, user_id: TEACHER, prioritized_action: { title: 'Wait time' } }],
  });
}

function mockBoundaries() {
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => slow(mockDb.from(table), table),
    rpc: (...a) => mockDb.rpc(...a),
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn(),
  }));
}

function recordGraph(body) {
  graph.push({ t: Date.now() - t0, body });
}

const isTyping = (b) => Boolean(b && b.typing_indicator);
const isRead = (b) => Boolean(b && b.status === 'read' && !b.typing_indicator);
const isReaction = (b) => Boolean(b && b.type === 'reaction');
const isMessage = (b) => Boolean(b && b.to && b.type && b.type !== 'reaction');
const typings = () => graph.filter((g) => isTyping(g.body));
const reads = () => graph.filter((g) => isRead(g.body));
const reactions = () => graph.filter((g) => isReaction(g.body)).map((g) => g.body.reaction.emoji);
const messages = () => graph.filter((g) => isMessage(g.body));

function webhookBody(message) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'pnid', display_phone_number: '923025502255' },
          contacts: [{ wa_id: PHONE, profile: { name: 'Ayesha' } }],
          messages: [{ from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
        },
      }],
    }],
  };
}

const tap = (id) => ({
  id: `wamid.IN_${++seq}`,
  type: 'interactive',
  interactive: { type: 'button_reply', button_reply: { id, title: 'tap' } },
});
const text = (body) => ({ id: `wamid.IN_${++seq}`, type: 'text', text: { body } });

/**
 * POST one inbound message to the real route, wait for the webhook's tracked work to drain, then
 * keep watching for `tailMs` — long enough for a deferred "typing…" to fire if it was going to.
 */
async function post(message, { tailMs = DEFER_MS + 250 } = {}) {
  const { app } = require('../../bot/whatsapp-bot');
  const drain = require('../../bot/shared/utils/web-drain');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  t0 = Date.now();
  try {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(webhookBody(message)),
    });
    expect(res.status).toBe(200);
    await later(20);
    const deadline = Date.now() + 8000;
    while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
    expect(drain.inFlightCount()).toBe(0);
    await later(tailMs);
  } finally {
    server.close();
  }
  return message.id;
}

beforeEach(() => {
  jest.resetModules();
  process.env.INBOUND_TYPING_DEFER_MS = String(DEFER_MS);
  dbLatencyMs = 0;
  tableLatencyMs = {};
  graph = [];
  mockRedis = createMemoryRedis();
  seedDb();
  mockBoundaries();
  realFetch = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    if (String(url).includes('graph.facebook.com')) {
      let body = null;
      try { body = JSON.parse((init && init.body) || 'null'); } catch (_) { body = null; }
      recordGraph(body);
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, messages: [{ id: `wamid.OUT_${graph.length}` }] }),
        text: async () => '',
      };
    }
    return realFetch(url, init);
  });
  // Interactive messages go out through axios (the root suite maps it to a stub).
  const axios = require('axios');
  axios.post.mockImplementation(async (url, body) => {
    if (/\/messages(\?|$)/.test(String(url))) recordGraph(body);
    return { status: 200, data: { messages: [{ id: `wamid.OUT_${graph.length}` }], id: 'media-1' } };
  });
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.INBOUND_TYPING_DEFER_MS;
});

describe('a reply that is only a reaction (or nothing) leaves no "typing…" behind', () => {
  test('"Taught it today" — receipted by the webhook reaction alone — never shows typing', async () => {
    const id = await post(tap(`lp_used_taught_${LP}`));

    expect(mockDb.rows('lp_feedback')[0]).toMatchObject({ used_in_class: 'taught' });
    expect(messages()).toEqual([]);
    expect(reactions()).toHaveLength(1);
    expect(typings()).toEqual([]);
    // The read receipt the typing call used to carry still goes, once, for this message.
    expect(reads().map((g) => g.body.message_id)).toEqual([id]);
  });

  test('"Yes, I\'ll try!" on the commitment card — ✅ on the tap, no text, no typing', async () => {
    await post(tap(`card_yes_${SESSION}`));

    expect(mockDb.rows('coaching_sessions')[0].prioritized_action).toMatchObject({ teacher_response: 'yes' });
    expect(messages()).toEqual([]);
    expect(reactions()).toHaveLength(2);
    expect(reactions()[1]).toBe('✅');
    expect(typings()).toEqual([]);
    expect(reads()).toHaveLength(1);
  });

  test('a sticker (no reply at all) never shows typing', async () => {
    await post({ id: `wamid.IN_${++seq}`, type: 'sticker', sticker: { id: 'st-1', mime_type: 'image/webp' } });

    expect(messages()).toEqual([]);
    expect(typings()).toEqual([]);
    expect(reads()).toHaveLength(1);
  });

  test('a 👎 reason typed into an open survey window — silent receipt — no typing, even when routing is slow', async () => {
    const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
    await mockRedis.set(LpFeedback.REDIS_REASON_KEY(TEACHER), { lpFeedbackId: 'fb-1', lessonPlanId: LP }, 600);
    // The text handler's own routing (the quiz/capstone intercepts, the chat session) is slow, so it
    // reaches the reason check well after the typing deadline — the production shape: the reason is
    // decided ~2.4-3.4 s after the point typing used to show, past the 2 s deadline.
    tableLatencyMs = { training_assessment_attempts: DEFER_MS, chat_sessions: DEFER_MS };

    await post(text('the activity was too long'), { tailMs: DEFER_MS + 300 });

    expect(mockDb.rows('lp_feedback')[0]).toMatchObject({ reason_text: 'the activity was too long' });
    expect(messages()).toEqual([]);
    expect(typings()).toEqual([]);
    expect(reads()).toHaveLength(1);
  }, 20000);
});

describe('a reply that IS a message still gets "typing…" — when it is slow, and never after it', () => {
  test('👍 on a lesson that had a voice note: slow lookups → typing shows, then the usage question', async () => {
    seedDb({ voiceDelivered: true });
    dbLatencyMs = 80; // several queries → the question goes out well after DEFER_MS

    await post(tap(`lp_feedback_yes_${LP}`), { tailMs: DEFER_MS + 300 });

    const question = messages()[0];
    expect(question).toBeDefined();
    expect(typings()).toHaveLength(1);
    expect(typings()[0].t).toBeGreaterThanOrEqual(DEFER_MS);
    expect(typings()[0].t).toBeLessThan(question.t);
  }, 20000);

  test('a fast text reply ("⏸ Pause") arrives with no typing — and typing never follows a reply', async () => {
    await post(tap('training_pause'));

    expect(messages()).toHaveLength(1);
    expect(messages()[0].body.text.body).toMatch(/Paused/);
    expect(typings()).toEqual([]);
    expect(reads()).toHaveLength(1);
  });

  test('the read receipt goes at once — before the handler has replied', async () => {
    dbLatencyMs = 40;
    await post(tap('training_pause'));

    const receipt = reads()[0];
    expect(receipt).toBeDefined();
    expect(receipt.t).toBeLessThan(messages()[0].t);
  }, 20000);
});

describe('work handed off past the end of the webhook keeps its "typing…"', () => {
  test('a QUIZ-code join (run after the webhook returns) still shows typing while the lookup is slow', async () => {
    // The join runs on setImmediate AFTER the handler returned; only its share-code lookup is slow.
    tableLatencyMs = { quiz_share_codes: 500, quiz_share_invites: 500, quiz_invites: 500 };

    await post(text('QUIZ-ABC123'), { tailMs: 900 });

    const reply = messages()[0];
    expect(reply).toBeDefined();                     // the join answered (an unknown code: "expired")
    expect(typings()).toHaveLength(1);
    expect(typings()[0].t).toBeGreaterThanOrEqual(DEFER_MS);
    expect(typings()[0].t).toBeLessThan(reply.t);
  }, 20000);
});

describe('INBOUND_TYPING_DEFER_MS=0 is today\'s behaviour (a one-variable rollback)', () => {
  test('typing (carrying the read receipt) goes at once, before any reply', async () => {
    process.env.INBOUND_TYPING_DEFER_MS = '0';
    const id = await post(tap(`lp_used_taught_${LP}`));

    expect(typings()).toHaveLength(1);
    expect(typings()[0].body).toMatchObject({ status: 'read', message_id: id });
  });
});
