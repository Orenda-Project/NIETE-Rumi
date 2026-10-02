'use strict';
/**
 * Meta bill cut FX4 (bd-w2daa.26) — fix round 3, found by the live e2e run with a teacher account
 * (run_20261001T1750Z) and the A3 recapture. TRIAGE items 31, 32, 34, 35, 36.
 *
 * 1. THE LESSON-PLAN DOORS FX1 MISSED (#31). On the recent-LP "Yes" confirm the tap reached the
 *    deferral 2.24 s in (user lookup, language, status, the linker's writes — sandbox, 1 Oct
 *    18:23:20.567Z → 22.811Z), so the 2 s deadline had already shown "typing…" and answerLater()
 *    returned false: the log said typing:false, lingered:true. Now, for an LP-outcome tap
 *    (lpconfirm_yes_, lp_none_, lessonplan_no_), the webhook reads the session's kind alongside the
 *    user lookup and puts "typing…" up as soon as it knows it is a teacher's own session, and
 *    answerLater() counts typing that is already up as handed off. A PASTED plan had no hand-off at all (its request sends nothing and the job's
 *    Step 2/5 answers it), and an uploaded one gets typing as its handler starts.
 * 2. THE COACHING-REPORT SURVEY'S THANK-YOUS (#32): "Thanks — glad it was useful." and the reason
 *    thank-you become a 🙏 reaction; the text only when the reaction cannot go.
 * 3. A SOLE-ACK REACTION STARVED BY PACING (#35). A reaction was best-effort: skipped whenever the
 *    phone's burst was spent (niete-logs production, 24 Sep–1 Oct: 3,796 of ~283.5k skipped, 1.34%).
 *    A reaction that IS the answer (soleAck) now waits briefly for its slot and is then sent anyway;
 *    a refusal from Meta → the text.
 * 4. QUIET-HOUR FREE TEXT (#36). The intent classifier decided 12.6 s in (18:39:00Z) — far past
 *    FX3's 3 s hold, so "typing…" showed over silence. The hold now lasts until the door decides.
 * 5. THE LP-OUTCOME FALLBACK TIMER (#34). Armed on every deferral and never cleared; with Redis
 *    down both claims "succeeded" and the outcome line was said twice. Now: no Redis at deferral →
 *    the line is said now, once; the timer is cleared when the joined line has gone in this process,
 *    and an unreadable claim at fallback time leaves the line to Step 2/5.
 *
 * Driven through the REAL /webhook and handlers; only the network is faked (Graph API fetch + axios,
 * Supabase in memory, Redis in memory with the pacer's schedule, the SQS queue, the intent LLM).
 */
const http = require('http');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');
const { FakePairStore } = require('../whatsapp/helpers/fake-pair-store');

const DEFER_MS = 150;
const PHONE = '923001112266';
const TEACHER = '11111111-1111-4111-8111-111111111166';
const LP = '33333333-3333-4333-8333-333333333366';
const SESSION = '44444444-4444-4444-8444-444444444466';
const QUIZ = '55555555-5555-4555-8555-555555555566';
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
  id: `wamid.FX4_${++seq}`, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'tap' } },
});
const row = (id) => ({
  id: `wamid.FX4_${++seq}`, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'row' } },
});
const text = (body) => ({ id: `wamid.FX4_${++seq}`, type: 'text', text: { body } });

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
  if (process.env.FX4_DEBUG) {
    try {
      const { logToFile } = require('../../bot/shared/utils/logger');
      require('fs').appendFileSync(process.env.FX4_DEBUG, logToFile.mock.calls.map((c) => `${c[0]} ${JSON.stringify(c[1] || '').slice(0, 160)}`).join('\n') + `\n${JSON.stringify(graph.map((g) => [g.t, g.body && (g.body.type || (g.body.typing_indicator ? 'typing' : g.body.status))]))}\n-----\n`);
    } catch (_) { /* debug only */ }
  }
  global.fetch = realFetch;
  delete process.env.INBOUND_TYPING_DEFER_MS;
  delete process.env.LP_OUTCOME_ACK_FALLBACK_MS;
  delete process.env.INBOUND_TYPING_QUIET_HOLD_MS;
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX4-1 — every lesson-plan door shows "typing…" at once and hands it to the job', () => {
  // Each Supabase round trip costs 40 ms, so the door reaches its deferral well after the 150 ms
  // deadline — as the recent-LP "Yes" did on sandbox (3 s against a 2 s deadline).
  beforeEach(() => { dbLatencyMs = 40; });

  test.each([
    ['recent-LP "Yes" confirm', () => tap(`lpconfirm_yes_${LP}_${SESSION}`), 'lessonPlan_linked'],
    ['LP list "No lesson plan" row', () => row(`lp_none_${SESSION}`), 'lessonPlan_skip'],
    ['"No" button', () => tap(`lessonplan_no_${SESSION}`), 'lessonPlan_skip'],
  ])('%s on a slow request: typing within the deadline, before the job; handed off, not lingering', async (_n, msg, key) => {
    await post(msg(), { tailMs: 50 });

    expect(queued.map((q) => q.jobType)).toEqual(['analysis']);
    expect(queued[0].payload.lpOutcomeKey).toBe(key);
    expect(messages()).toEqual([]);
    expect(typings()).toHaveLength(1);
    expect(typings()[0].t).toBeLessThan(DEFER_MS);           // at once — not the deadline
    expect(typings()[0].t).toBeLessThanOrEqual(queued[0].t);
    expect(logged('📎 LP outcome deferred onto Step 2/5')[0]).toMatchObject({ typing: true });
    expect(lastTypingReport()).toMatchObject({ typing: 'shown', answeredElsewhere: true, lingered: false, handedOff: true });
  }, 20000);

  test('CONTROL — a coach observation: typing, then the outcome text at once (nothing deferred)', async () => {
    seedDb({ observationType: 'leader_observation' });
    await post(tap(`lessonplan_no_${SESSION}`));
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    expect(texts()).toEqual([getCoachingMessage('lessonPlan_skip', 'en')]);
    expect(queued[0].payload.lpOutcomeKey).toBeUndefined();
    expect(lastTypingReport()).toMatchObject({ lingered: false });
  }, 20000);

  test('CONTROL — a fresh LP pick (asks to confirm) is not forced: the confirm prompt, no early typing', async () => {
    dbLatencyMs = 0;
    await post(row(`lp_select_${LP}_${SESSION}`));
    expect(messages()).toHaveLength(1);
    expect(typings()).toEqual([]);
  }, 20000);

  test('a PASTED plan: typing goes up and is handed to the job (its request sends nothing)', async () => {
    dbLatencyMs = 0;
    await post(text('Lesson: Introducing myself. Objective: students say their name. Activity: pair talk.'), { tailMs: 50 });
    expect(queued.map((q) => q.jobType)).toContain('analysis');
    expect(messages()).toEqual([]);
    expect(typings()).toHaveLength(1);
    const analysis = queued.find((q) => q.jobType === 'analysis');
    expect(typings()[0].t).toBeLessThanOrEqual(analysis.t);
    expect(lastTypingReport()).toMatchObject({ typing: 'shown', answeredElsewhere: true, lingered: false });
  }, 20000);

  test('an UPLOADED plan: typing as the handler starts, handed to the job', async () => {
    jest.doMock('../../bot/shared/storage/r2', () => ({
      uploadLessonPlanBuffer: jest.fn(async () => 'lp/key.pdf'),
      buildR2PublicUrl: (k) => `https://r2/${k}`,
    }));
    const IT = require('../../bot/shared/services/inbound-typing');
    const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
    WhatsAppService.downloadMedia = jest.fn(async () => { await later(300); return Buffer.from('%PDF-1.4 plan'); });
    const LessonPlanProcessor = require('../../bot/shared/services/coaching/lesson-plan-processor.service');
    t0 = Date.now();
    await IT.withRequest(async () => {
      IT.open(PHONE, 'wamid.DOC', WhatsAppService);
      await LessonPlanProcessor.handleLessonPlanResponse(SESSION, PHONE, true, 'media-doc-1');
      IT.endDispatch();
    });
    const analysis = queued.find((q) => q.jobType === 'analysis');
    expect(analysis.payload.lpOutcomeKey).toBe('lessonPlan_received');
    expect(typings()).toHaveLength(1);
    expect(typings()[0].t).toBeLessThan(DEFER_MS);
    expect(logged('📎 LP outcome deferred onto Step 2/5')[0]).toMatchObject({ typing: true });
    expect(lastTypingReport()).toMatchObject({ answeredElsewhere: true, lingered: false });
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX4-2 — the coaching-report survey acknowledges with 🙏, not a billed text', () => {
  test.each(['en', 'ur'])('[%s] "👍 Yes, useful" → 🙏 replaces the automatic 👍; rating stored; no text', async (l) => {
    lang = l; seedDb({ status: 'completed' });
    await post(tap(`coaching_fb_yes_${SESSION}`));
    expect(mockDb.rows('coaching_quality_metrics')[0]).toMatchObject({ user_satisfaction_rating: 1 });
    expect(reactions()).toHaveLength(2);
    expect(reactions()[1]).toBe('🙏');
    expect(messages()).toEqual([]);
    expect(typings()).toEqual([]);
  }, 20000);

  test('a typed reason after 👎 → 🙏 on the reason; stored; no text', async () => {
    seedDb({ status: 'completed' });
    const Fb = require('../../bot/shared/services/coaching/coaching-feedback.service');
    await mockRedis.set(Fb.REDIS_REASON_KEY(TEACHER), { coachingSessionId: SESSION, promptedAt: Date.now() }, 600);
    await post(text('the report was too long'));
    expect(mockDb.rows('coaching_quality_metrics')[0]).toMatchObject({ user_feedback: 'the report was too long' });
    expect(reactions()).toHaveLength(2);
    expect(reactions()[1]).toBe('🙏');
    expect(messages()).toEqual([]);
  }, 20000);

  test('CONTROL — "👎 Not really" still ASKS for the reason as text (a question, not an ack)', async () => {
    seedDb({ status: 'completed' });
    await post(tap(`coaching_fb_no_${SESSION}`));
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    expect(texts()).toEqual([resolveUx('coachingSurveyAskReason', { language: 'en' })]);
  }, 20000);

  describe('the reaction is refused → the original text, in her language', () => {
    beforeEach(() => { refuseReactions = 100; });
    test.each([
      ['en', 'Thanks — glad it was useful.'], ['ur', 'شکریہ — خوشی ہے کہ یہ کام آئی۔'],
    ])('[%s] Yes → "%s"', async (l, expected) => {
      lang = l; seedDb({ status: 'completed' });
      await post(tap(`coaching_fb_yes_${SESSION}`));
      expect(texts()).toEqual([expected]);
    }, 20000);

    test('typed reason → coachingSurveyReasonThanks', async () => {
      seedDb({ status: 'completed' });
      const Fb = require('../../bot/shared/services/coaching/coaching-feedback.service');
      await mockRedis.set(Fb.REDIS_REASON_KEY(TEACHER), { coachingSessionId: SESSION, promptedAt: Date.now() }, 600);
      await post(text('too long'));
      const { resolveUx } = require('../../bot/shared/config/ux-strings');
      expect(texts()).toEqual([resolveUx('coachingSurveyReasonThanks', { language: 'en' })]);
    }, 20000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX4-3 — a burst cannot starve a reaction that is the only answer', () => {
  const spendBurst = () => mockPairs.fill(`wa:pair:${require('crypto').createHash('sha1').update(PHONE).digest('hex').slice(0, 12)}`);

  test('survey Yes on a phone whose burst is spent: the automatic 👍 is skipped, the 🙏 still goes — no text', async () => {
    seedDb({ status: 'completed' });
    await spendBurst();
    await post(tap(`coaching_fb_yes_${SESSION}`));
    expect(reactions()).toEqual(['🙏']);       // the webhook's best-effort 👍 gave way; ours did not
    expect(messages()).toEqual([]);
  }, 20000);

  test.each([
    ['ack-reaction reactOrSay (photo 📸, card ✅, LP 🙏)', async (W) => {
      const { reactOrSay } = require('../../bot/shared/services/coaching/ack-reaction');
      return reactOrSay({ to: PHONE, messageId: 'wamid.X', emoji: '📸', text: 'Got your photo' });
    }, 'reaction'],
  ])('%s → sent despite the spent burst', async (_n, run, expected) => {
    await spendBurst();
    const W = require('../../bot/shared/services/whatsapp.service');
    expect(await run(W)).toBe(expected);
    expect(reactions()).toEqual(['📸']);
    expect(messages()).toEqual([]);
  }, 20000);

  test('Meta refuses the sole-ack reaction (131056) → the text fallback goes', async () => {
    refuseReactions = 131056;
    process.env.WA_RATE_LIMIT_RETRY_BASE_MS = '10';
    process.env.WA_PAIR_INTERVAL_MS = '20';
    try {
      const { reactOrSay } = require('../../bot/shared/services/coaching/ack-reaction');
      expect(await reactOrSay({ to: PHONE, messageId: 'wamid.X', emoji: '🙏', text: 'Thank you!' })).toBe('text');
      expect(texts()).toEqual(['Thank you!']);
    } finally {
      delete process.env.WA_RATE_LIMIT_RETRY_BASE_MS;
      delete process.env.WA_PAIR_INTERVAL_MS;
    }
  }, 20000);

  test('the sole-ack reaction still takes its slot (Meta counts reactions): the next billed send is paced behind it', async () => {
    const W = require('../../bot/shared/services/whatsapp.service');
    await spendBurst();
    await W.sendReaction(PHONE, 'wamid.X', '🙏', { soleAck: true });
    const key = [...mockPairs.tat.keys()][0];
    const before = mockPairs.tat.get(key);
    expect(before).toBeGreaterThan(Date.now() + 6000 * 7);   // 8 sends + this one on the schedule
  }, 20000);

  test('CONTROL — a plain reaction (the webhook receipt, a quiz verdict) stays best-effort: skipped on a spent burst', async () => {
    await spendBurst();
    const W = require('../../bot/shared/services/whatsapp.service');
    expect(await W.sendReaction(PHONE, 'wamid.X', '👍')).toBe(false);
    expect(reactions()).toEqual([]);
  }, 20000);

  test.each([
    ['quiz offer "Not now" 👌', 'bot/shared/services/quiz/transcript-quiz-offer.service.js', /sendReaction\(phone, opts\.messageId, '👌', \{ soleAck: true \}\)/],
    ['child refusal repeat ✍️/🙏', 'bot/shared/services/student-ingress.js', /REPEAT_REACTION\[key\] \|\| '🙏', \{ soleAck: true \}\)/],
    ['assessment "Making your new version" 📝', 'bot/shared/handlers/flow-response.handler.js', /sendReaction\(from, opts\.messageId, '📝', \{ soleAck: true \}\)/],
  ])('%s is sent as a sole ack', (_n, file, rx) => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../..', file), 'utf8');
    expect(src).toMatch(rx);
  });

  test('observe "Send now" on a spent burst → 📨, no "delivering" text', async () => {
    await spendBurst();
    const ObserveSend = require('../../bot/shared/services/observe/observe-send.service');
    await ObserveSend.handleSendConfirm(SESSION, PHONE, { id: TEACHER, preferred_language: 'en' }, { messageId: 'wamid.SEND' });
    expect(queued.map((q) => q.jobType)).toHaveLength(1);
    expect(reactions()).toEqual(['📨']);
    expect(messages()).toEqual([]);
  }, 20000);

  test('quiz offer "Not now" through the webhook on a spent burst → 👌, no text', async () => {
    await spendBurst();
    await post(tap(`tq_no_${QUIZ}`));
    expect(reactions()).toEqual(['👌']);
    expect(messages()).toEqual([]);
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX4-4 — quiet-hour FREE TEXT: "typing…" is held until the intent door decides', () => {
  function slowIntent(ms, type = 'lesson_plan') {
    const O = require('../../bot/shared/services/openai.service');
    jest.spyOn(O, 'detectIntent').mockImplementation(async () => { await later(ms); return { type }; });
  }

  test('the classifier takes longer than the old 3 s hold → still no "typing…", no message', async () => {
    seedDb({ status: 'completed', quietSince: Date.now() - 10 * 60 * 1000 });
    // Remember the quiet hour in this process, as a turn already silenced in it does.
    require('../../bot/shared/services/inbound-typing').expectSilence(PHONE, Date.now() + 50 * 60 * 1000);
    slowIntent(3600);
    await post(text('please make me a lesson plan for grade 4 maths fractions'), { tailMs: 300 });
    expect(logged('📵 App redirect: inside the quiet hour, no reply')).toHaveLength(1);
    expect(messages()).toEqual([]);
    expect(typings()).toEqual([]);
    expect(lastTypingReport()).toMatchObject({ typing: 'skipped', lingered: false, silentReason: 'app_redirect_quiet_hour' });
  }, 30000);

  test('CONTROL — same hour, the classifier says general chat (not redirected) → typing shows when the door decides', async () => {
    seedDb({ status: 'completed', quietSince: Date.now() - 10 * 60 * 1000 });
    require('../../bot/shared/services/inbound-typing').expectSilence(PHONE, Date.now() + 50 * 60 * 1000);
    slowIntent(600, 'general');
    const O = require('../../bot/shared/services/openai.service');
    if (typeof O.generateResponse === 'function') {
      jest.spyOn(O, 'generateResponse').mockImplementation(async () => { await later(400); return 'Here are some ideas.'; });
    }
    await post(text('how do I calm a noisy class after break'), { tailMs: 300 });
    expect(typings().length).toBeGreaterThanOrEqual(1);
    expect(typings()[0].t).toBeGreaterThanOrEqual(550);
  }, 30000);

  test('the plain hold stays FX3\'s 3 s; only a DECIDING door holds to WhatsApp\'s typing lifetime', () => {
    const IT = require('../../bot/shared/services/inbound-typing');
    expect(IT.DEFAULT_QUIET_HOLD_MS).toBe(3000);
    expect(IT.TYPING_LIFETIME_MS).toBeGreaterThanOrEqual(20000);
    expect(typeof IT.doorDeciding).toBe('function');
  });

  test('CONTROL — a quiet-hour turn with no deciding door (a slow non-text reply) still shows typing after the 3 s hold', async () => {
    process.env.INBOUND_TYPING_QUIET_HOLD_MS = '200';
    const IT = require('../../bot/shared/services/inbound-typing');
    const W = require('../../bot/shared/services/whatsapp.service');
    IT.expectSilence(PHONE, Date.now() + 60000);
    t0 = Date.now();
    await IT.withRequest(async () => {
      IT.open(PHONE, 'wamid.Q', W);
      await later(DEFER_MS + 350);
      IT.endDispatch();
    });
    expect(typings()).toHaveLength(1);
    expect(typings()[0].t).toBeGreaterThanOrEqual(DEFER_MS + 200 - 20);
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX4-5 — the LP-outcome fallback timer', () => {
  function loadAck({ available = true } = {}) {
    mockRedis.isAvailable = () => available;
    const Ack = require('../../bot/shared/services/coaching/lp-coaching/lp-outcome-ack.service');
    const sent = [];
    const sendMessage = jest.fn(async (to, t) => { sent.push(t); return true; });
    return { Ack, sent, sendMessage };
  }

  test('Redis down at the deferral → the outcome is said NOW, once; nothing rides on Step 2/5', async () => {
    process.env.LP_OUTCOME_ACK_FALLBACK_MS = '100';
    const { Ack, sent, sendMessage } = loadAck({ available: false });
    const extra = await Ack.deferOrSendLpOutcome({ sessionId: SESSION, from: PHONE, messageKey: 'lessonPlan_skip', language: 'en', sendMessage });
    expect(extra).toEqual({});
    const lead = await Ack.leadForStep2(SESSION, { from: PHONE, ...extra }, 'en');
    await later(200);
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    expect(lead).toBeNull();
    expect(sent).toEqual([getCoachingMessage('lessonPlan_skip', 'en')]);
  });

  test('Step 2/5 said it in this process → the fallback timer is cleared (no claim, no send)', async () => {
    process.env.LP_OUTCOME_ACK_FALLBACK_MS = '100';
    const { Ack, sent, sendMessage } = loadAck();
    const extra = await Ack.deferOrSendLpOutcome({ sessionId: SESSION, from: PHONE, messageKey: 'lessonPlan_linked', language: 'en', sendMessage });
    expect(await Ack.leadForStep2(SESSION, extra, 'en')).toBeTruthy();
    mockRedis.setNX.mockClear();
    await later(200);
    expect(mockRedis.setNX).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  test('Redis gone by the time the fallback fires → the fallback stays silent; Step 2/5 says it once', async () => {
    process.env.LP_OUTCOME_ACK_FALLBACK_MS = '80';
    const { Ack, sent, sendMessage } = loadAck();
    const extra = await Ack.deferOrSendLpOutcome({ sessionId: SESSION, from: PHONE, messageKey: 'lessonPlan_linked', language: 'en', sendMessage });
    mockRedis.isAvailable = () => false;
    await later(160);
    expect(sent).toEqual([]);
    const lead = await Ack.leadForStep2(SESSION, extra, 'en');   // the job (another process) fails open
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    expect(lead).toBe(getCoachingMessage('lessonPlan_linked', 'en'));
  });

  test('CONTROL — the job is slow and Redis is up → the fallback still says it, once, and Step 2/5 is plain', async () => {
    process.env.LP_OUTCOME_ACK_FALLBACK_MS = '80';
    const { Ack, sent, sendMessage } = loadAck();
    const extra = await Ack.deferOrSendLpOutcome({ sessionId: SESSION, from: PHONE, messageKey: 'lessonPlan_skip', language: 'en', sendMessage });
    await later(160);
    expect(sent).toHaveLength(1);
    expect(await Ack.leadForStep2(SESSION, extra, 'en')).toBeNull();
  });

  test('a second deferral for the same session replaces the first timer (one fallback, not two)', async () => {
    process.env.LP_OUTCOME_ACK_FALLBACK_MS = '80';
    const { Ack, sent, sendMessage } = loadAck();
    await Ack.deferOrSendLpOutcome({ sessionId: SESSION, from: PHONE, messageKey: 'lessonPlan_skip', language: 'en', sendMessage });
    await Ack.deferOrSendLpOutcome({ sessionId: SESSION, from: PHONE, messageKey: 'lessonPlan_skip', language: 'en', sendMessage });
    mockRedis.setNX.mockClear();
    await later(160);
    expect(mockRedis.setNX).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });
});
