'use strict';
/**
 * Meta bill cut FX7 (bd-w2daa.31) — fix round 5, found by e2e run 5 (run_20261002T1732Z), TRIAGE #46.
 *
 * THE CLASS. A tap whose whole answer is a free reaction must never put "typing…" in the chat header.
 * Until now each reaction-only handler settled the inbound typing scope itself — by its reaction, or
 * by its own nothingComing() — and only AFTER its lookups and writes. When those ran past the 2 s
 * deadline, "typing…" went up first and lingered ~25 s over nothing (sandbox 2 Oct 18:03:56Z, the
 * coaching survey "Yes, useful": `inbound_typing.done typing:shown lingered:true`). Fifth instance of
 * one class (#24, #36, #39, #41, #46); every earlier round patched one handler.
 *
 * THE FIX. A registry at the webhook door (bot/shared/services/reaction-only-taps.js): the tap ids
 * whose answer is ONLY a reaction (text only as the no-wamid / refused fallback) settle the scope the
 * moment the webhook knows the id, before any handler runs. Taps that SOMETIMES answer with a message
 * stay out, and settle at their own branch point, moved before the slow work (as FX6 did for 👎).
 *
 * Driven through the REAL /webhook and handlers with the REAL 2 s deadline; one table's writes take
 * 3 s. Only the network is faked: Graph fetch/axios, Supabase (in memory), Redis, the SQS queue.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');
const { FakePairStore } = require('../whatsapp/helpers/fake-pair-store');

const DEADLINE_MS = 2000;          // the production default (INBOUND_TYPING_DEFER_MS)
const SLOW_WRITE_MS = 3000;        // past the deadline, as on sandbox
const PHONE = '923001112277';
const TEACHER = '11111111-1111-4111-8111-111111111177';
const LP = '33333333-3333-4333-8333-333333333377';
const SESSION = '44444444-4444-4444-8444-444444444477';
const QUIZ = '55555555-5555-4555-8555-555555555577';
const SEGMENT = 'g7_science_ch2_seg3';
const later = (ms) => new Promise((r) => setTimeout(r, ms));

let mockDb;
let mockRedis;
let mockPairs;
let slowWrites;      // { table: ms } — insert/update/upsert on that table take this long
let graph;
let t0;
let realFetch;
let refuseReactions;
let seq = 0;

const WRITE_OPS = new Set(['insert', 'update', 'upsert']);

/** Delay a builder chain's resolution when it carries a write to a slow table. */
function slowChain(builder, ms) {
  return new Proxy(builder, {
    get(target, prop) {
      const v = target[prop];
      if (prop === 'then') return (res, rej) => later(ms).then(() => target.then(res, rej));
      if (typeof v !== 'function') return v;
      return (...args) => {
        const out = v.apply(target, args);
        if (out === target) return slowChain(target, ms);
        if (out && typeof out.then === 'function') return later(ms).then(() => out);
        return out;
      };
    },
  });
}

function tableBuilder(table) {
  const builder = mockDb.from(table);
  const ms = slowWrites[table];
  if (!ms) return builder;
  return new Proxy(builder, {
    get(target, prop) {
      const v = target[prop];
      if (WRITE_OPS.has(prop) && typeof v === 'function') {
        return (...args) => {
          const out = v.apply(target, args);
          return slowChain(out === undefined ? target : out, ms);
        };
      }
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

function seedDb({ status = 'completed', triggerMode = 'after_pdf_only', withFeedbackRow = false } = {}) {
  mockDb = createMemorySupabase({
    users: [{
      id: TEACHER, phone_number: PHONE, first_name: 'Ayesha', preferred_language: 'en',
      registration_completed: true, role: 'teacher',
    }],
    lesson_plans: [{
      id: LP, user_id: TEACHER, topic: 'Introducing Myself', grade: '1', subject: 'english', type: 'lesson_plan',
      content: { chapter_number: 1, segment_number: 3, lp_variant: 'niete_v8_segment', grade: 1, subject: 'english', trigger_mode: triggerMode },
    }],
    lp_feedback: withFeedbackRow
      ? [{ id: 'fb-1', user_id: TEACHER, lesson_plan_id: LP, useful: true, lp612_segment_id: SEGMENT }]
      : [],
    coaching_sessions: [{
      id: SESSION, user_id: TEACHER, status, observation_type: null,
      conversation_state: { current_state: 'AWAITING_CLASSROOM_PHOTO', classroom_photos: ['https://r2/p1.jpg'] },
      classroom_photos: ['https://r2/p1.jpg'],
      users: { preferred_language: 'en', phone_number: PHONE, name: 'Ayesha' },
    }],
    coaching_quality_metrics: [{ id: 'cqm-1', coaching_session_id: SESSION }],
    quizzes: [{
      id: QUIZ, teacher_id: TEACHER, status: 'offered', language: 'en', subject: 'english', topic: 'Myself',
      meta: { source: 'coaching' }, coaching_session_id: SESSION,
    }],
  });
}

function mockBoundaries() {
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => tableBuilder(table),
    rpc: (...a) => mockDb.rpc(...a),
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
  jest.doMock('../../bot/shared/services/queue', () => ({
    queueCoachingJob: jest.fn(async () => 'sqs-1'),
    queueJob: jest.fn(async () => 'sqs-1'),
  }));
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn(),
  }));
}

const recordGraph = (body) => graph.push({ t: Date.now() - t0, body });
const isTyping = (b) => Boolean(b && b.typing_indicator);
const isReaction = (b) => Boolean(b && b.type === 'reaction');
const isMessage = (b) => Boolean(b && b.to && b.type && b.type !== 'reaction');
const typings = () => graph.filter((g) => isTyping(g.body));
const reactions = () => graph.filter((g) => isReaction(g.body)).map((g) => g.body.reaction.emoji);
const messages = () => graph.filter((g) => isMessage(g.body));
const texts = () => messages().map((m) => m.body.text && m.body.text.body);

function logged(name) {
  const { logToFile } = require('../../bot/shared/utils/logger');
  return logToFile.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
}
const lastTypingReport = () => { const r = logged('inbound_typing.done'); return r.length ? r[r.length - 1] : null; };

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
  id: `wamid.FX7_${++seq}`, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'tap' } },
});

async function post(message, { tailMs = 300 } = {}) {
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
    const deadline = Date.now() + 20000;
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
  process.env.INBOUND_TYPING_DEFER_MS = String(DEADLINE_MS);
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';   // triggerEarly runs (it only queues)
  slowWrites = {};
  graph = [];
  refuseReactions = false;
  mockRedis = createMemoryRedis();
  delete mockRedis.del;   // the real railway-redis has delete() only
  mockRedis.setexWithCeiling = jest.fn(async (k, ttl, v) => mockRedis.set(k, v, ttl));
  mockPairs = new FakePairStore();
  mockRedis.evalScript = (...a) => mockPairs.evalScript(...a);
  seedDb();
  mockBoundaries();
  realFetch = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    if (String(url).includes('graph.facebook.com')) {
      let body = null;
      try { body = JSON.parse((init && init.body) || 'null'); } catch (_) { body = null; }
      recordGraph(body);
      if (refuseReactions && body && body.type === 'reaction') {
        return { ok: false, status: 400, json: async () => ({ error: { message: 'refused', code: 100 } }), text: async () => '' };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, messages: [{ id: `wamid.OUT_${graph.length}` }] }),
        text: async () => '',
      };
    }
    return realFetch(url, init);
  });
  const axios = require('axios');
  axios.post.mockImplementation(async (url, body) => {
    if (/\/messages(\?|$)/.test(String(url))) recordGraph(body);
    return { status: 200, data: { messages: [{ id: `wamid.OUT_${graph.length}` }], id: 'media-1' } };
  });
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.INBOUND_TYPING_DEFER_MS;
  delete process.env.TRANSCRIPT_QUIZ_ENABLED;
});

const noTypingOverAReaction = (emoji) => {
  expect(reactions()[reactions().length - 1]).toBe(emoji);
  expect(messages()).toEqual([]);
  expect(typings()).toEqual([]);
  expect(lastTypingReport()).toMatchObject({ typing: 'skipped', lingered: false });
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX7-1 — registry taps: a 3 s write never shows "typing…" before the reaction', () => {
  test('coaching survey "Yes, useful" (coaching_fb_yes_) → 🙏 only; the door fired and logged', async () => {
    slowWrites = { coaching_quality_metrics: SLOW_WRITE_MS };
    await post(tap(`coaching_fb_yes_${SESSION}`));
    expect(mockDb.rows('coaching_quality_metrics')[0]).toMatchObject({ user_satisfaction_rating: 1 });
    noTypingOverAReaction('🙏');
    const door = logged('inbound_typing.reaction_only_tap');
    expect(door).toHaveLength(1);
    expect(door[0]).toMatchObject({ name: 'coaching_survey_yes' });
    expect(typeof door[0].msSinceInbound).toBe('number');
    expect(lastTypingReport()).toMatchObject({ silentReason: 'reaction_only_tap:coaching_survey_yes' });
  }, 30000);

  test('coaching survey "Yes" with the reaction refused → its thank-you text, still no "typing…"', async () => {
    refuseReactions = true;
    slowWrites = { coaching_quality_metrics: SLOW_WRITE_MS };
    await post(tap(`coaching_fb_yes_${SESSION}`));
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    expect(texts()).toEqual([resolveUx('coachingSurveyThanks', { language: 'en' })]);
    expect(typings()).toEqual([]);
  }, 30000);

  test.each([['yes', '✅'], ['later', '👌'], ['no', '🙏']])(
    'commit card card_%s_ → %s only', async (answer, emoji) => {
      slowWrites = { coaching_sessions: SLOW_WRITE_MS };
      await post(tap(`card_${answer}_${SESSION}`));
      expect(mockDb.rows('coaching_sessions')[0].prioritized_action).toMatchObject({ teacher_response: answer });
      noTypingOverAReaction(emoji);
      expect(logged('inbound_typing.reaction_only_tap')[0]).toMatchObject({ name: 'commit_card' });
    }, 30000,
  );

  test('K-5 "Taught it today" (lp_used_taught_) → 🙏 only', async () => {
    seedDb({ withFeedbackRow: true });
    slowWrites = { lp_feedback: SLOW_WRITE_MS };
    await post(tap(`lp_used_taught_${LP}`));
    expect(mockDb.rows('lp_feedback')[0]).toMatchObject({ used_in_class: 'taught' });
    noTypingOverAReaction('🙏');
    expect(logged('inbound_typing.reaction_only_tap')[0]).toMatchObject({ name: 'lp_usage' });
  }, 30000);

  test('6-12 "Planning to" (lp612_used_planned_) → 🙏 only', async () => {
    seedDb({ withFeedbackRow: true });
    slowWrites = { lp_feedback: SLOW_WRITE_MS };
    await post(tap(`lp612_used_planned_${SEGMENT}`));
    expect(mockDb.rows('lp_feedback')[0]).toMatchObject({ used_in_class: 'planned' });
    noTypingOverAReaction('🙏');
    expect(logged('inbound_typing.reaction_only_tap')[0]).toMatchObject({ name: 'lp612_usage' });
  }, 30000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX7-2 — taps that SOMETIMES message settle at their own branch point, before the slow work', () => {
  test('LP survey 👍 with no voice note (lp_feedback_yes_) → 🙏 only', async () => {
    slowWrites = { lp_feedback: SLOW_WRITE_MS };
    await post(tap(`lp_feedback_yes_${LP}`));
    expect(mockDb.rows('lp_feedback')).toHaveLength(1);
    noTypingOverAReaction('🙏');
    expect(lastTypingReport()).toMatchObject({ silentReason: 'lp_feedback_yes_no_voice_note' });
  }, 30000);

  test('transcript quiz "Not now" (tq_no_) → 👌 only', async () => {
    slowWrites = { quizzes: SLOW_WRITE_MS };
    await post(tap(`tq_no_${QUIZ}`));
    expect(mockDb.rows('quizzes')[0].status).toBe('declined');
    noTypingOverAReaction('👌');
  }, 30000);

  test('photo "Add another" (photo_more_) on the photo step → 📸 only', async () => {
    seedDb({ status: 'awaiting_classroom_photo' });
    slowWrites = { coaching_sessions: SLOW_WRITE_MS };
    await post(tap(`photo_more_${SESSION}`));
    noTypingOverAReaction('📸');
  }, 30000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX7-3 — CONTROLS: a tap that answers with a message still shows "typing…" at the deadline', () => {
  test('coaching survey "Not really" (coaching_fb_no_, not in the registry) → typing at 2 s, then the ask', async () => {
    slowWrites = { coaching_quality_metrics: SLOW_WRITE_MS };
    await post(tap(`coaching_fb_no_${SESSION}`));
    expect(typings()).toHaveLength(1);
    expect(typings()[0].t).toBeGreaterThanOrEqual(DEADLINE_MS - 50);
    expect(messages()).toHaveLength(1);
    expect(typings()[0].t).toBeLessThan(messages()[0].t);
    expect(logged('inbound_typing.reaction_only_tap')).toEqual([]);
    expect(lastTypingReport()).toMatchObject({ typing: 'shown', lingered: false });
  }, 30000);

  test('LP survey 👍 after a voice note → typing at 2 s, then the usage question (a message)', async () => {
    seedDb({ triggerMode: 'after_voice_note' });
    slowWrites = { lp_feedback: SLOW_WRITE_MS };
    await post(tap(`lp_feedback_yes_${LP}`));
    expect(typings()).toHaveLength(1);
    expect(messages()).toHaveLength(1);
    expect(typings()[0].t).toBeLessThan(messages()[0].t);
    expect(lastTypingReport()).toMatchObject({ typing: 'shown', lingered: false });
  }, 30000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX7-4 — every registry pattern matches the id its sender emits (an unmatched pattern fails silently)', () => {
  const ROOT = path.resolve(__dirname, '../../bot/shared/services');
  // [registry name, sender file, the id template's prefix as written there, a sample tail]
  const SENDERS = [
    ['coaching_survey_yes', 'coaching/coaching-feedback.service.js', 'coaching_fb_yes_', SESSION],
    ['commit_card', 'coaching/report-generator.service.js', 'card_yes_', SESSION],
    ['commit_card', 'coaching/report-generator.service.js', 'card_later_', SESSION],
    ['commit_card', 'coaching/report-generator.service.js', 'card_no_', SESSION],
    ['lp_usage', 'lp-feedback.service.js', 'lp_used_taught_', LP],
    ['lp_usage', 'lp-feedback.service.js', 'lp_used_planned_', LP],
    ['lp_usage', 'lp-feedback.service.js', 'lp_used_not_yet_', LP],
    ['lp612_usage', 'lp612-feedback.service.js', 'lp612_used_taught_', SEGMENT],
    ['lp612_usage', 'lp612-feedback.service.js', 'lp612_used_planned_', SEGMENT],
    ['lp612_usage', 'lp612-feedback.service.js', 'lp612_used_not_yet_', SEGMENT],
  ];

  test.each(SENDERS)('%s ← %s emits `%s${…}`', (name, file, prefix, tail) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(src).toContain(`\`${prefix}\${`);   // the send site still emits this template
    const Registry = require('../../bot/shared/services/reaction-only-taps');
    const hit = Registry.match(`${prefix}${tail}`);
    expect(hit && hit.name).toBe(name);
  });

  test('every registry entry is exercised by a sender row above', () => {
    const Registry = require('../../bot/shared/services/reaction-only-taps');
    const covered = new Set(SENDERS.map((s) => s[0]));
    expect(Registry.TAPS.map((t) => t.name).sort()).toEqual([...covered].sort());
  });

  test('each pattern accepts only what its handler accepts (no settle on an id the handler rejects)', () => {
    const Registry = require('../../bot/shared/services/reaction-only-taps');
    const CardResponse = require('../../bot/shared/services/coaching/coaching-card/card-response.service');
    expect(Registry.match(`card_maybe_${SESSION}`)).toBeNull();
    expect(CardResponse.BUTTON_RX.test(`card_maybe_${SESSION}`)).toBe(false);
    expect(Registry.match('card_yes_not-a-uuid')).toBeNull();
    expect(Registry.match(`coaching_fb_no_${SESSION}`)).toBeNull();     // asks for a reason
    expect(Registry.match(`lp_feedback_yes_${LP}`)).toBeNull();         // may ask the usage question
    expect(Registry.match(`lp612_fb_yes_en_${SEGMENT}`)).toBeNull();    // asks the usage question
    expect(Registry.match(`tq_no_${QUIZ}`)).toBeNull();                 // an expired offer says so
    expect(Registry.match(`photo_more_${SESSION}`)).toBeNull();         // closed / at the cap says so
    expect(Registry.match('')).toBeNull();
    expect(Registry.match(undefined)).toBeNull();
  });
});
