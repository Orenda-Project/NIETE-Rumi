'use strict';
/**
 * Meta bill cut FX6 (bd-w2daa.28) — fix round 4, found by e2e run 4 (run_20261002T1440Z), TRIAGE 38–41.
 *
 * 1. COMMIT CARD (#38): "Maybe later" and "Not for me" got the same ✅ as "Yes, I'll try!" — a tick
 *    that reads "agreed" to a teacher who declined. Each answer now has its own reaction (Yes ✅,
 *    Later 👌, No 🙏); the text, per answer, only when the reaction cannot go. "Later" schedules
 *    nothing (only teacher_response === 'yes' is ever read back), so its text promises nothing the
 *    reaction loses.
 * 2. A REACTION-ONLY REASON TURN (#39): the typing hold for an open 👎-reason window checked the two
 *    LP-survey windows but not the coaching-report survey's, so a typed coaching reason showed
 *    "typing…" at the 2 s deadline and then got only 🙏 (sandbox 15:08:03Z, 15:11:48Z). The
 *    coaching window is now held too, and the reason handler settles the turn ("nothing coming")
 *    the moment it knows its answer is the reaction.
 * 3. QUIET-HOUR DOOR (#41): doorDeciding() sat just before detectIntent, which the text handler
 *    reached more than 5 s in on sandbox (15:37:55Z turn: the intent call itself took 847 ms; the
 *    quiet-hour nothingComing() found the scope, so doorDeciding() did too — after the 3 s hold
 *    had already shown "typing…"). The text handler now declares the door as it starts, and
 *    doorDeciding() logs `inbound_typing.door_deciding` (ms since the inbound, scope state).
 * 4. THE COACHING REASON WINDOW NEVER CLOSED (#40, bd-foiys): coaching-feedback called
 *    redisService.del(), which railway-redis does not have (only delete()); the TypeError was
 *    swallowed, so for 10 minutes every text was stored as a 👎 reason — a pasted lesson plan
 *    included. The memory Redis fixture has both names, which hid it: these tests use one that
 *    has only the real service's delete().
 *
 * Driven through the REAL /webhook and handlers; only the network is faked (as FX4).
 */
const http = require('http');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');
const { FakePairStore } = require('../whatsapp/helpers/fake-pair-store');

const DEFER_MS = 150;
const PHONE = '923001112268';
const TEACHER = '11111111-1111-4111-8111-111111111168';
const LP = '33333333-3333-4333-8333-333333333368';
const SESSION = '44444444-4444-4444-8444-444444444468';
const QUIZ = '55555555-5555-4555-8555-555555555568';
let lang = 'en';
let queued;
let refuseReactions;
const later = (ms) => new Promise((r) => setTimeout(r, ms));

let mockDb;
let mockRedis;
let mockPairs;
let dbLatencyMs;
let graph;
let t0;
let realFetch;
let seq = 0;

function slow(builder) {
  return new Proxy(builder, {
    get(target, prop) {
      const v = target[prop];
      if (prop === 'then') return (res, rej) => later(dbLatencyMs).then(() => target.then(res, rej));
      if (typeof v !== 'function') return v;
      return (...args) => {
        const out = v.apply(target, args);
        if (out === target) return slow(target);
        if (out && typeof out.then === 'function' && (prop === 'single' || prop === 'maybeSingle')) {
          return later(dbLatencyMs).then(() => out);
        }
        return out;
      };
    },
  });
}

/** The memory DB has no upsert; the app-redirect notice clock needs one. */
function withUpsert(table, builder) {
  builder.upsert = (row) => {
    const rows = mockDb.rows(table);
    const hit = rows.find((r) => r.user_id === row.user_id && r.feature === row.feature);
    if (hit) Object.assign(hit, row); else rows.push({ ...row });
    return Promise.resolve({ data: null, error: null });
  };
  return builder;
}

function seedDb({ observationType = null, status = 'awaiting_lesson_plan', quietSince = null } = {}) {
  mockDb = createMemorySupabase({
    users: [{
      id: TEACHER, phone_number: PHONE, first_name: 'Ayesha', preferred_language: lang,
      registration_completed: true, role: 'teacher',
    }],
    lesson_plans: [{
      id: LP, user_id: TEACHER, topic: 'Introducing Myself', grade: '1', subject: 'english', type: 'lesson_plan',
      content: { chapter_number: 1, segment_number: 3, lp_variant: 'niete_v8_segment', grade: 1, subject: 'english' },
    }],
    coaching_sessions: [{
      id: SESSION, user_id: TEACHER, status, observation_type: observationType,
      users: { preferred_language: lang, phone_number: PHONE, name: 'Ayesha' },
    }],
    coaching_quality_metrics: [],
    quizzes: [{
      id: QUIZ, teacher_id: TEACHER, status: 'offered', language: 'en', subject: 'english', topic: 'Myself',
      meta: { source: 'coaching' }, coaching_session_id: SESSION,
    }],
    app_settings: quietSince ? [{ key: 'app_redirect_lesson_plan', value: true }] : [],
    user_feature_first_use: quietSince
      ? [{ user_id: TEACHER, feature: 'app_redirect_notice', video_shown_at: new Date(quietSince).toISOString(), intro_shown_count: 1 }]
      : [],
  });
}

function mockBoundaries() {
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => slow(withUpsert(table, mockDb.from(table))),
    rpc: (...a) => mockDb.rpc(...a),
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
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
  id: `wamid.FX6_${++seq}`, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'tap' } },
});
const row = (id) => ({
  id: `wamid.FX6_${++seq}`, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'row' } },
});
const text = (body) => ({ id: `wamid.FX6_${++seq}`, type: 'text', text: { body } });

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
    const deadline = Date.now() + 15000;
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
  graph = [];
  mockRedis = createMemoryRedis();
  // The real railway-redis service has delete(), not del() (#40): the fixture's extra alias hid the bug.
  delete mockRedis.del;
  // The pacer's per-phone schedule lives in the same Redis (railway-redis evalScript).
  mockPairs = new FakePairStore();
  mockRedis.evalScript = (...a) => mockPairs.evalScript(...a);
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
        return { ok: false, status: 400, json: async () => ({ error: { message: 'refused', code: refuseReactions } }), text: async () => '' };
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
  if (process.env.FX6_DEBUG) {
    try {
      const { logToFile } = require('../../bot/shared/utils/logger');
      require('fs').appendFileSync(process.env.FX6_DEBUG, logToFile.mock.calls.map((c) => `${c[0]} ${JSON.stringify(c[1] || '').slice(0, 160)}`).join('\n') + `\n${JSON.stringify(graph.map((g) => [g.t, g.body && (g.body.type || (g.body.typing_indicator ? 'typing' : g.body.status))]))}\n-----\n`);
    } catch (_) { /* debug only */ }
  }
  global.fetch = realFetch;
  delete process.env.INBOUND_TYPING_DEFER_MS;
  delete process.env.INBOUND_TYPING_QUIET_HOLD_MS;
});

const reasonKey = () => require('../../bot/shared/services/coaching/coaching-feedback.service').REDIS_REASON_KEY(TEACHER);
const openCoachingReasonWindow = () => mockRedis.set(reasonKey(), { coachingSessionId: SESSION, promptedAt: Date.now() }, 600);

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX6-1 — the commit card: each answer has its own reaction (#38)', () => {
  test.each([
    ['yes', '✅'], ['later', '👌'], ['no', '🙏'],
  ])('card_%s → %s on the tap, recorded, no text', async (answer, emoji) => {
    seedDb({ status: 'completed' });
    await post(tap(`card_${answer}_${SESSION}`));
    expect(mockDb.rows('coaching_sessions')[0].prioritized_action).toMatchObject({ teacher_response: answer });
    expect(reactions()[reactions().length - 1]).toBe(emoji);
    expect(messages()).toEqual([]);
  }, 20000);

  test('the three answers never share a reaction', () => {
    const { ACK_REACTION } = require('../../bot/shared/services/coaching/coaching-card/card-response.service');
    expect(new Set(Object.values(ACK_REACTION)).size).toBe(3);
  });

  describe('the reaction is refused → that answer\'s own text, in the teacher\'s language', () => {
    beforeEach(() => { refuseReactions = 100; });
    test.each([
      ['en', 'yes', 'coachingCardAckYes'], ['en', 'later', 'coachingCardAckLater'], ['en', 'no', 'coachingCardAckNo'],
      ['ur', 'later', 'coachingCardAckLater'], ['ur', 'no', 'coachingCardAckNo'],
    ])('[%s] card_%s → %s', async (l, answer, key) => {
      lang = l; seedDb({ status: 'completed' });
      await post(tap(`card_${answer}_${SESSION}`));
      const { resolveUx } = require('../../bot/shared/config/ux-strings');
      expect(texts()).toEqual([resolveUx(key, { language: l })]);
    }, 20000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX6-2 — a typed coaching-survey reason is answered by 🙏 alone: no "typing…" first (#39)', () => {
  // Each Supabase round trip costs 40 ms and the deadline is 500 ms: the text handler starts before the
  // deadline (~250 ms) and the 🙏 lands after it (~850 ms) — the order of sandbox's turns, where
  // "typing…" went up at 2,000 ms before the 🙏.
  beforeEach(() => { dbLatencyMs = 40; process.env.INBOUND_TYPING_DEFER_MS = '500'; });

  test('slow request, window open → 🙏, no typing, no text; settled as nothing coming', async () => {
    seedDb({ status: 'completed' });
    await openCoachingReasonWindow();
    await post(text('the report was too long'));
    expect(mockDb.rows('coaching_quality_metrics')[0]).toMatchObject({ user_feedback: 'the report was too long' });
    expect(reactions()[reactions().length - 1]).toBe('🙏');
    expect(messages()).toEqual([]);
    expect(typings()).toEqual([]);
    expect(lastTypingReport()).toMatchObject({ typing: 'skipped', lingered: false });
  }, 20000);

  test('reaction refused → the thank-you text, still with no "typing…" before it', async () => {
    refuseReactions = 100;
    seedDb({ status: 'completed' });
    await openCoachingReasonWindow();
    await post(text('too long'));
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    expect(texts()).toEqual([resolveUx('coachingSurveyReasonThanks', { language: 'en' })]);
    expect(typings()).toEqual([]);
  }, 20000);

  test('CONTROL — no window open: a slow ordinary reply still gets "typing…" at the deadline', async () => {
    seedDb({ status: 'completed' });
    const O = require('../../bot/shared/services/openai.service');
    jest.spyOn(O, 'detectIntent').mockImplementation(async () => ({ type: 'general' }));
    if (typeof O.generateResponse === 'function') {
      jest.spyOn(O, 'generateResponse').mockImplementation(async () => { await later(400); return 'Here are some ideas.'; });
    }
    await post(text('how do I calm a noisy class after break'), { tailMs: 300 });
    expect(typings().length).toBeGreaterThanOrEqual(1);
  }, 30000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX6-3 — quiet hour: the door is declared as the text handler starts, and logged (#41)', () => {
  function slowIntent(ms, type = 'lesson_plan') {
    const O = require('../../bot/shared/services/openai.service');
    jest.spyOn(O, 'detectIntent').mockImplementation(async () => { await later(ms); return { type }; });
  }

  test('a slow road TO the intent door (past deadline + hold) → still no "typing…", no message', async () => {
    // Deadline 150 ms + hold 200 ms = 350 ms; 40 ms per DB round trip puts the intent door well past it,
    // as sandbox's turn reached it > 5 s in against 2 s + 3 s.
    process.env.INBOUND_TYPING_QUIET_HOLD_MS = '200';
    dbLatencyMs = 40;
    seedDb({ status: 'completed', quietSince: Date.now() - 10 * 60 * 1000 });
    require('../../bot/shared/services/inbound-typing').expectSilence(PHONE, Date.now() + 50 * 60 * 1000);
    slowIntent(50);
    await post(text('please make me a lesson plan for grade 4 maths fractions'), { tailMs: 300 });
    expect(logged('📵 App redirect: inside the quiet hour, no reply')).toHaveLength(1);
    expect(messages()).toEqual([]);
    expect(typings()).toEqual([]);
    expect(lastTypingReport()).toMatchObject({ typing: 'skipped', lingered: false, silentReason: 'app_redirect_quiet_hour' });
  }, 30000);

  test('doorDeciding() writes inbound_typing.door_deciding: where, ms since the inbound, scope state', async () => {
    seedDb({ status: 'completed', quietSince: Date.now() - 10 * 60 * 1000 });
    require('../../bot/shared/services/inbound-typing').expectSilence(PHONE, Date.now() + 50 * 60 * 1000);
    slowIntent(20);
    await post(text('please make me a lesson plan for grade 4 maths fractions'), { tailMs: 100 });
    const lines = logged('inbound_typing.door_deciding');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toMatchObject({ where: 'text_handler', scope: 'pending' });
    expect(typeof lines[0].msSinceInbound).toBe('number');
    expect(lines[0]).toHaveProperty('quietHeld');
  }, 30000);

  test('CONTROL — same slow road, the classifier says general chat → typing shows once the door decides', async () => {
    process.env.INBOUND_TYPING_QUIET_HOLD_MS = '200';
    dbLatencyMs = 40;
    seedDb({ status: 'completed', quietSince: Date.now() - 10 * 60 * 1000 });
    require('../../bot/shared/services/inbound-typing').expectSilence(PHONE, Date.now() + 50 * 60 * 1000);
    slowIntent(50, 'general');
    const O = require('../../bot/shared/services/openai.service');
    if (typeof O.generateResponse === 'function') {
      jest.spyOn(O, 'generateResponse').mockImplementation(async () => { await later(400); return 'Here are some ideas.'; });
    }
    await post(text('how do I calm a noisy class after break'), { tailMs: 300 });
    expect(typings().length).toBeGreaterThanOrEqual(1);
  }, 30000);

  test('CONTROL — outside a quiet hour the early door changes nothing: a slow reply shows typing at the deadline', async () => {
    dbLatencyMs = 40;
    seedDb({ status: 'completed' });
    slowIntent(50, 'general');
    const O = require('../../bot/shared/services/openai.service');
    if (typeof O.generateResponse === 'function') {
      jest.spyOn(O, 'generateResponse').mockImplementation(async () => { await later(400); return 'Here are some ideas.'; });
    }
    await post(text('how do I calm a noisy class after break'), { tailMs: 300 });
    expect(typings().length).toBeGreaterThanOrEqual(1);
    expect(typings()[0].t).toBeLessThan(messages()[0].t);
    expect(lastTypingReport()).toMatchObject({ typing: 'shown', quietHeld: false, lingered: false });
    expect(logged('inbound_typing.door_deciding')).toEqual([]);   // logged only inside a quiet hour
  }, 30000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX6-4 — the coaching reason window closes after one reason (#40, bd-foiys)', () => {
  test('the reason is taken once; the window key is gone', async () => {
    seedDb({ status: 'completed' });
    await openCoachingReasonWindow();
    await post(text('the report was too long'));
    expect(await mockRedis.get(reasonKey())).toBeNull();
    expect(mockRedis.delete).toHaveBeenCalledWith(reasonKey());
  }, 20000);

  test('a pasted lesson plan right after the reason is NOT stored as a second reason', async () => {
    seedDb({ status: 'completed' });
    await openCoachingReasonWindow();
    await post(text('the report was too long'));
    await post(text('Lesson: Introducing myself. Objective: students say their name. Activity: pair talk.'), { tailMs: 50 });
    const rows = mockDb.rows('coaching_quality_metrics');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_feedback).toBe('the report was too long');
  }, 20000);
});
