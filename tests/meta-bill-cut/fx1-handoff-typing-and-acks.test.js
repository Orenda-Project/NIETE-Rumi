'use strict';
/**
 * Meta bill cut FX1 (bd-w2daa.22) — the fix round on two things the audit found the cuts made worse.
 *
 * 1. SILENCE AFTER PICKING A LESSON PLAN (NC3 x the typing fix, bd-0wrn4). On a teacher's own
 *    coaching session the "Lesson plan linked" / "No problem…" / "Lesson plan received" line now
 *    rides on the analysis job's Step 2/5 — sent by the sqs-worker, another process. The webhook
 *    request ends having sent nothing, so the typing scope settled with no "typing…": the teacher saw
 *    the automatic 👍 and then silence until Step 2/5 (or the 30 s fallback). Now the deferral shows
 *    "typing…" AT ONCE, before the job is queued (so it cannot land after Step 2/5), and the fallback
 *    fires at 20 s — inside WhatsApp's ~25 s typing lifetime.
 *
 * 4. DISTINCT ACKNOWLEDGEMENTS. Several cuts let the webhook's automatic 👍 stand as the only answer
 *    to a tap, so the tap had no visible answer of its own. A survey thank-you / "Taught it today" /
 *    a typed 👎 reason now get 🙏, the quiz-offer "Not now" gets 👌 — our reaction replaces the
 *    automatic one on that message. A reaction that cannot be sent → the original text.
 *
 * Driven through the REAL /webhook route and the real handlers; only the network is faked (Graph API
 * fetch + axios, Supabase in memory, Redis in memory, the SQS queue).
 */
const http = require('http');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const DEFER_MS = 150;
const PHONE = '923001112233';
const TEACHER = '11111111-1111-4111-8111-111111111111';
const LP = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const QUIZ = '55555555-5555-4555-8555-555555555555';
let lang = 'en';
let queued;          // analysis jobs put on the queue, with the time they were queued
let refuseReactions; // Meta refuses our reactions (the webhook's own included)
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

function seedDb({ voiceDelivered = false, feedbackRow = true, observationType = null } = {}) {
  mockDb = createMemorySupabase({
    users: [{
      id: TEACHER, phone_number: PHONE, first_name: 'Ayesha', preferred_language: lang,
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
    lp_feedback: feedbackRow ? [{ id: 'fb-1', user_id: TEACHER, lesson_plan_id: LP, useful: true }] : [],
    coaching_sessions: [{
      id: SESSION, user_id: TEACHER, status: 'awaiting_lesson_plan', observation_type: observationType,
      users: { preferred_language: lang, phone_number: PHONE, name: 'Ayesha' },
    }],
    quizzes: [{
      id: QUIZ, teacher_id: TEACHER, status: 'offered', language: lang, subject: 'english', topic: 'Myself',
      meta: { source: 'coaching' }, coaching_session_id: SESSION,
    }],
  });
}

function mockBoundaries() {
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => slow(mockDb.from(table), table),
    rpc: (...a) => mockDb.rpc(...a),
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
  // The SQS boundary: the analysis job runs in ANOTHER process (sqs-worker), so a queued job
  // answers nothing inside this request.
  jest.doMock('../../bot/shared/services/queue', () => ({
    queueCoachingJob: jest.fn(async (sessionId, jobType, payload) => {
      queued.push({ t: Date.now() - t0, sessionId, jobType, payload });
      return `sqs-${queued.length}`;
    }),
  }));
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
  lang = 'en';
  queued = [];
  refuseReactions = false;
  seedDb();
  mockBoundaries();
  realFetch = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    if (String(url).includes('graph.facebook.com')) {
      let body = null;
      try { body = JSON.parse((init && init.body) || 'null'); } catch (_) { body = null; }
      recordGraph(body);
      if (refuseReactions && body && body.type === 'reaction') {
        return { ok: false, status: 400, json: async () => ({ error: { message: 'refused' } }), text: async () => '' };
      }
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
  delete process.env.LP_OUTCOME_ACK_FALLBACK_MS;
});


const sinceTap = (g) => g.t;

describe('item 1 — after picking a lesson plan the teacher sees "typing…", not silence', () => {
  test('"No lesson plan" on a teacher session: typing at once, BEFORE the job is queued; no text yet', async () => {
    await post(tap(`lessonplan_no_${SESSION}`), { tailMs: 50 });

    expect(queued.map((q) => q.jobType)).toEqual(['analysis']);
    expect(queued[0].payload.lpOutcomeKey).toBe('lessonPlan_skip');
    expect(messages()).toEqual([]);                 // the outcome rides on Step 2/5 (NC3 kept)
    expect(typings()).toHaveLength(1);
    // Shown at once (not at the 2 s deadline), and before the worker could possibly answer.
    expect(sinceTap(typings()[0])).toBeLessThan(DEFER_MS);
    expect(sinceTap(typings()[0])).toBeLessThanOrEqual(queued[0].t);
  });

  test('the job is slow → the fallback sends the outcome line after the typing, once', async () => {
    process.env.LP_OUTCOME_ACK_FALLBACK_MS = '400';
    await post(tap(`lessonplan_no_${SESSION}`), { tailMs: 700 });

    expect(typings()).toHaveLength(1);
    expect(messages()).toHaveLength(1);
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    expect(messages()[0].body.text.body).toBe(getCoachingMessage('lessonPlan_skip', 'en'));
    expect(messages()[0].t).toBeGreaterThan(typings()[0].t);
  }, 20000);

  test('CONTROL — a coach observation keeps the immediate outcome text (nothing deferred, no forced typing)', async () => {
    seedDb({ observationType: 'leader_observation' });
    await post(tap(`lessonplan_no_${SESSION}`));

    expect(messages()).toHaveLength(1);
    expect(queued[0].payload.lpOutcomeKey).toBeUndefined();
    expect(typings()).toEqual([]);
  });

  test('the fallback default is 20 s — inside WhatsApp\'s ~25 s typing lifetime', () => {
    const Ack = require('../../bot/shared/services/coaching/lp-coaching/lp-outcome-ack.service');
    expect(Ack.DEFAULT_FALLBACK_MS).toBe(20000);
  });
});

const secondReaction = () => reactions()[1];

describe('item 4 — a tap that only needs acknowledging gets its OWN reaction', () => {
  test.each(['en', 'ur'])('[%s] "Taught it today" → 🙏 replaces the automatic 👍; no text, no typing', async (l) => {
    lang = l; seedDb();
    await post(tap(`lp_used_taught_${LP}`));
    expect(mockDb.rows('lp_feedback')[0]).toMatchObject({ used_in_class: 'taught' });
    expect(reactions()).toHaveLength(2);
    expect(secondReaction()).toBe('🙏');
    expect(messages()).toEqual([]);
    expect(typings()).toEqual([]);
  });

  test('survey "👍 Yes, useful" (PDF-only lesson, first tap) → 🙏, no text', async () => {
    seedDb({ feedbackRow: false });
    await post(tap(`lp_feedback_yes_${LP}`));
    expect(mockDb.rows('lp_feedback')).toHaveLength(1);
    expect(secondReaction()).toBe('🙏');
    expect(messages()).toEqual([]);
  });

  test('a repeat 👍 → 🙏, no text', async () => {
    await post(tap(`lp_feedback_yes_${LP}`));
    expect(secondReaction()).toBe('🙏');
    expect(messages()).toEqual([]);
  });

  test('a typed 👎 reason → 🙏 on the reason, no text', async () => {
    const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
    await mockRedis.set(LpFeedback.REDIS_REASON_KEY(TEACHER), { lpFeedbackId: 'fb-1', lessonPlanId: LP }, 600);
    await post(text('the activity was too long'));
    expect(mockDb.rows('lp_feedback')[0]).toMatchObject({ reason_text: 'the activity was too long' });
    expect(secondReaction()).toBe('🙏');
    expect(messages()).toEqual([]);
  });

  test('quiz offer "Not now" → 👌, no text', async () => {
    await post(tap(`tq_no_${QUIZ}`));
    expect(mockDb.rows('quizzes')[0].status).toBe('declined');
    expect(secondReaction()).toBe('👌');
    expect(messages()).toEqual([]);
  });

  test('6-12 "Taught it today" → 🙏, no text', async () => {
    await post(tap('lp612_used_taught_seg-612-1'));
    expect(secondReaction()).toBe('🙏');
    expect(messages()).toEqual([]);
  });

  test('6-12 typed reason → 🙏, no text', async () => {
    const Lp612 = require('../../bot/shared/services/lp612-feedback.service');
    await mockRedis.set(Lp612.REDIS_REASON_KEY(TEACHER), { feedbackId: 'fb-1', segmentId: 'seg-612-1' }, 600);
    await post(text('the reading was too hard'));
    expect(secondReaction()).toBe('🙏');
    expect(messages()).toEqual([]);
  });

  describe('a reaction Meta refuses → the original text, in the teacher\'s language', () => {
    beforeEach(() => { refuseReactions = true; });

    test.each([
      ['en', 'Thank you!'], ['ur', 'شکریہ!'],
    ])('[%s] "Taught it today" → "%s"', async (l, expected) => {
      lang = l; seedDb();
      await post(tap(`lp_used_taught_${LP}`));
      expect(messages().map((m) => m.body.text.body)).toEqual([expected]);
    });

    test('survey 👍 → "Thanks — glad it helped!"', async () => {
      seedDb({ feedbackRow: false });
      await post(tap(`lp_feedback_yes_${LP}`));
      expect(messages().map((m) => m.body.text.body)).toEqual(['Thanks — glad it helped!']);
    });

    test('typed reason → "Got it, thanks — this helps us improve the plans."', async () => {
      const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
      await mockRedis.set(LpFeedback.REDIS_REASON_KEY(TEACHER), { lpFeedbackId: 'fb-1', lessonPlanId: LP }, 600);
      await post(text('too long'));
      expect(messages().map((m) => m.body.text.body)).toEqual(['Got it, thanks — this helps us improve the plans.']);
    });

    test('[ur] 6-12 "Taught it today" → lp612UsedThanks in Urdu', async () => {
      lang = 'ur'; seedDb();
      await post(tap('lp612_used_taught_seg-612-1'));
      const { resolveUx } = require('../../bot/shared/config/ux-strings');
      expect(messages().map((m) => m.body.text.body)).toEqual([resolveUx('lp612UsedThanks', { language: 'ur' })]);
    });

    test('"Not now" → the decline text', async () => {
      await post(tap(`tq_no_${QUIZ}`));
      const { resolveUx } = require('../../bot/shared/config/ux-strings');
      expect(messages().map((m) => m.body.text.body)).toEqual([resolveUx('tqDeclined', { language: 'en' })]);
    });
  });
});
