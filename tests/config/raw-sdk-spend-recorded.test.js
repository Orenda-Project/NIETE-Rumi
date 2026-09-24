/**
 * NIETE's biggest feature spent money that no telemetry could see. bd-wgso2.
 *
 * Five services build their own raw `new OpenAI(...)` instead of going through llm-client, and a
 * raw client never reaches recordModelCost -- so none of their spend was in api.cost.incurred, and
 * every NIETE total was a floor. The gap sat on the highest-volume feature: video_quiz reports run
 * ~1,500-2,200 times a day in production, on a model (gpt-5.4-mini) that had never appeared in the
 * spend table at all.
 *
 * THE FIX DELIBERATELY DOES NOT REROUTE. Moving these onto getClient() would send them through
 * OpenRouter instead of api.openai.com: a different provider, key and rate limits, a model prefix,
 * and gpt-5-family parameters handled by a different stack. Each is a behaviour change on a live
 * feature. Instead each service keeps its exact client and wraps it with withSpendRecording, which
 * strips the telemetry label and records the call -- and changes nothing else.
 *
 * EVERY SERVICE IS EXECUTED FOR REAL. The only thing replaced is `globalThis.fetch`: the network
 * boundary. The OpenAI SDK resolves fetch when a client is constructed, and these services construct
 * theirs per call, so the stub catches every vendor request -- including llm-router's hardcoded
 * OpenRouter URL. It also catches the WhatsApp send that handlePostQuizChat makes after its model
 * call (WhatsAppService uses the global fetch too), so nothing in this file can reach a real vendor,
 * a real teacher, or a real datastore: REDIS_URL is unset, which disables the Redis service.
 */

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID',
  'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
  'E2E_CASSETTE', 'SUPABASE_URL', 'OPENAI_BASE_URL', 'LLM_PROVIDER',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
];
const OPENROUTER_COST = 0.00123;

let seen;
const saved = {};

beforeEach(() => {
  seen = [];
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  // config/supabase exits the process at require time without these. An unroutable host, so no
  // database is reachable even in principle -- and anything supabase-js sent would hit the fetch
  // stub below anyway. Deliberately NOT a real project ref: the e2e cassette keys off this too.
  process.env.SUPABASE_URL = 'http://127.0.0.1:1/raw-sdk-spend-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-not-a-key';

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    seen.push({ url, body });
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { 'content-type': 'application/json' },
    });
    if (/\/chat\/completions/.test(url)) {
      if (body && body.__fail) return json({ error: { message: 'bad request', type: 'invalid_request_error' } }, 400);
      const onOpenRouter = /openrouter\.ai/.test(url);
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
        // api.openai.com reports tokens and no price; OpenRouter also reports what it charged.
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, ...(onOpenRouter ? { cost: OPENROUTER_COST } : {}) },
      });
    }
    // Anything else -- a WhatsApp send, an upload -- is answered here and never leaves the process.
    return json({ ok: true });
  };
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  for (const k of SCRUBBED) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

/**
 * Load a module in a fresh registry, alongside the structured-logger instance it will write to.
 *
 * resetModules + a plain require, NOT jest.isolateModules. These services require llm-client LAZILY,
 * at call time -- and a require that runs after an isolateModules block has returned resolves in a
 * different registry, so the event lands on a different logger instance and the test reads an empty
 * log. The first draft did exactly that: the label was stripped (so the wrapper ran) and zero events
 * were seen. One registry for load time and call time is what makes the observation trustworthy.
 */
function load(modPath) {
  jest.resetModules();
  const sl = require('../../bot/shared/utils/structured-logger');
  const mod = require(modPath);
  // tests/__mocks__/pino.js makes logger.info a jest.fn, so this is the REAL event that the REAL
  // model-cost -> logEvent path emitted. Nothing of ours is mocked to observe it.
  const costEvents = () => sl.logger.info.mock.calls.map((c) => c[0]).filter((e) => e && e.event === 'api.cost.incurred');
  return { mod, costEvents };
}

const completions = () => seen.filter((r) => /\/chat\/completions/.test(r.url));

/** The invariant that matters: one recorded spend per vendor completion, labelled, label never sent. */
function expectMeasured(costEvents, job, { lane, cost } = {}) {
  const sent = completions();
  expect(sent.length).toBeGreaterThan(0);                // it really called out
  for (const r of sent) {
    expect('job' in (r.body || {})).toBe(false);          // the label never reaches the vendor
    expect('fallbackModel' in (r.body || {})).toBe(false);
  }
  const ev = costEvents();
  expect(ev).toHaveLength(sent.length);                   // one spend per call: not zero, not doubled
  for (const e of ev) {
    expect(e.job).toBe(job);
    expect(e.tokensIn).toBe(11);
    expect(e.tokensOut).toBe(7);
    if (lane) expect(e.lane).toBe(lane);
    if (cost === null) { expect(e.estimatedCostUsd).toBeNull(); expect(e.costUnpriced).toBe(true); }
    else if (cost !== undefined) expect(e.estimatedCostUsd).toBe(cost);
  }
}

// ---------------------------------------------------------------------------------------------
describe('withSpendRecording (bd-wgso2)', () => {
  test('strips the label, records the call, and changes nothing else', async () => {
    const { mod: llm, costEvents } = load('../../bot/shared/services/llm-client');
    expect(typeof llm.withSpendRecording).toBe('function');

    const OpenAI = require('openai');
    const client = llm.withSpendRecording(new OpenAI({ apiKey: 'test', maxRetries: 0 }), { lane: 'openai-direct' });
    const params = { model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'x' }], max_completion_tokens: 900, job: 'quiz.videoReport', fallbackModel: null };
    await client.chat.completions.create(params);

    expectMeasured(costEvents, 'quiz.videoReport', { lane: 'openai-direct', cost: null });
    // everything that is not a label goes out exactly as given
    const { job, fallbackModel, ...asked } = params; // eslint-disable-line no-unused-vars
    expect(completions()[0].body).toEqual(asked);
  });

  test('a failed call records nothing and rethrows unchanged', async () => {
    const { mod: llm, costEvents } = load('../../bot/shared/services/llm-client');
    const OpenAI = require('openai');
    const client = llm.withSpendRecording(new OpenAI({ apiKey: 'test', maxRetries: 0 }), { lane: 'openai-direct' });

    await expect(client.chat.completions.create({ model: 'gpt-4o-mini', messages: [], job: 'quiz.insight', __fail: true }))
      .rejects.toMatchObject({ status: 400 });
    expect(costEvents()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the five raw-SDK services are measured when they actually run (bd-wgso2)', () => {
  test('quiz-generation', async () => {
    const { mod: Svc, costEvents } = load('../../bot/shared/services/quiz/quiz-generation.service');
    try { await Svc._generateQuestions({ topic: 'fractions', grade: 3, subject: 'maths' }); } catch (_) { /* stub reply is not questions */ }
    expectMeasured(costEvents, 'quiz.generate', { lane: 'openai-direct', cost: null });
  });

  test('quiz-report', async () => {
    const { mod: Svc, costEvents } = load('../../bot/shared/services/quiz/quiz-report.service');
    await Svc._generateInsightBody(
      { topic: 'fractions', grade: 'Grade 3' },
      { avgScore: 62, masteredCount: 4, needsPracticeCount: 6 },
      'en',
    );
    expectMeasured(costEvents, 'quiz.insight', { lane: 'openai-direct', cost: null });
  });

  test('quiz-session (post-quiz chat) -- and its WhatsApp send is caught, never sent', async () => {
    const { mod: Svc, costEvents } = load('../../bot/shared/services/quiz/quiz-session.service');
    try {
      await Svc.handlePostQuizChat('920000000000', 'why was question 2 wrong?', {
        _msgCount: 0, _lastMsgAt: 0, messages: [], topic: 'fractions', grade: 3,
      });
    } catch (_) { /* the Redis write after the reply is disabled here, by design */ }
    expectMeasured(costEvents, 'quiz.session', { lane: 'openai-direct', cost: null });
    // every request -- the model call AND the WhatsApp send -- was answered by the stub
    expect(seen.every((r) => typeof r.url === 'string')).toBe(true);
  });

  test('video-quiz-report -- and gpt-5 keeps max_completion_tokens', async () => {
    const { mod: Svc, costEvents } = load('../../bot/shared/services/quiz/video-quiz-report.service');
    await Svc.generateGuidance({
      topic: 'fractions', grade: 3, average: 48, finished: 10, started: 12, language: 'en',
      hardest: [{ question_text: 'What is 1/2 + 1/4?', correct_text: '3/4', wrong_count: 6, total: 10 }],
    });
    expectMeasured(costEvents, 'quiz.videoReport', { lane: 'openai-direct', cost: null });
    // gpt-5 rejects max_tokens silently -- the teacher just loses the box. It must pass untouched.
    for (const r of completions()) {
      expect(r.body).toHaveProperty('max_completion_tokens');
      expect(r.body).not.toHaveProperty('max_tokens');
    }
  });

  test('llm-router -- already on OpenRouter, so it records the REAL price', async () => {
    const { mod: router, costEvents } = load('../../bot/shared/services/coaching/reflective-questions/llm-router.service');
    await router.callReflective([{ role: 'user', content: 'reflect' }]);
    expectMeasured(costEvents, 'coaching.questionRouter', { cost: OPENROUTER_COST });
    // its provider routing is part of what it asks for, and must still go out
    expect(completions()[0].body.provider).toEqual(router.PROVIDER_ROUTING);
  });

  test('llm-router wraps its client ONCE, not once per call', async () => {
    const { mod: router, costEvents } = load('../../bot/shared/services/coaching/reflective-questions/llm-router.service');
    await router.callReflective([{ role: 'user', content: 'one' }]);
    await router.callReflective([{ role: 'user', content: 'two' }]);
    expect(completions()).toHaveLength(2);
    expect(costEvents()).toHaveLength(2); // double-wrapping would record 4
  });
});
