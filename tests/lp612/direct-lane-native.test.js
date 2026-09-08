/**
 * bd-oak77.29 — the direct-Anthropic lane on the official SDK: caching, cost, and the
 * credit-exhaustion fallback.
 *
 * WHY THIS SUITE EXISTS
 *
 * Prompt caching went live on production on 2026-09-06 and is saving 38.3% per lesson (71.5% of
 * prompt tokens served from cache). The operator then asked for the author ladder to spend a
 * prepaid Anthropic balance instead of cash. The lane as it stood could not do both: its
 * `anthropic-direct/` path drove the OPENAI SDK against Anthropic's OpenAI-compatibility
 * endpoint, and that endpoint accepts `cache_control` with HTTP 200 and silently ignores it —
 * no `cache_read_input_tokens`, no `cache_creation_input_tokens`, no
 * `prompt_tokens_details.cached_tokens` at all. Switching to it would have bought credit-burn by
 * paying a 38% surcharge, and would have been UNVERIFIABLE besides.
 *
 * So the lane is rebuilt on `@anthropic-ai/sdk` / `/v1/messages`. These tests hold the four
 * properties that rebuild has to have, and every one of them drives the REAL SDK with only
 * `global.fetch` doubled — the network boundary, per root CLAUDE.md Rule 6. A test that stubbed
 * `llm-client` would assert the mock, not the translation, which is exactly the class of proof
 * that shipped a guaranteed runtime error on bd-s192t.
 *
 *   1. the cache breakpoints the author places SURVIVE the translation, byte for byte;
 *   2. the params that 400 on this model (`temperature`, `reasoning`) never reach the wire, and
 *      the params that mean the same thing natively do;
 *   3. a cached reply maps back into the usage fields `accumulateUsage` reads, with a cost —
 *      Anthropic returns none, and a lane whose whole purpose is cost reporting $0 is a lie;
 *   4. a credit-exhausted call FALLS BACK to OpenRouter and says so, and a call that failed for
 *      any other reason does not.
 *
 * The 400 body in the fallback tests is the REAL one, copied from a live call with the
 * production key on 2026-09-07 (evidence/probe_keys.txt). The production key authenticates fine;
 * its organisation simply has no balance — which is why the predicate cannot be "401".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLogEvent = jest.fn();
const mockLogToFile = jest.fn();

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: (...a) => mockLogToFile(...a), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a), getCurrentCorrelationId: () => undefined,
}));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off', wrapChatCompletions: jest.fn(),
}), { virtual: true });

// `virtual: true` because `e2e-cassette.js` exists on `develop` but NOT on `main` — the lp612
// extraction left it behind. Without it this file cannot be cherry-picked to prod at all: jest
// resolves a mocked path even when a factory is supplied, and a MODULE_NOT_FOUND here would fail
// the whole suite for a module the test never uses.

const LLM_CLIENT = '../../bot/shared/services/llm-client';
const AUTHOR = '../../bot/shared/services/lp612-author.service';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** The exact body the production key returns. Authenticated, org named, and unable to spend. */
const CREDIT_400 = {
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'Your credit balance is too low to access the Anthropic API. '
      + 'Please go to Plans & Billing to upgrade or purchase credits.',
  },
};

const nativeReply = (text, usage) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: Object.assign({
    input_tokens: 100,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    output_tokens: 50,
    output_tokens_details: { thinking_tokens: 0 },
  }, usage || {}),
});

const orReply = (text) => ({
  id: 'gen-test',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 },
});

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

/**
 * Doubles the network, not the client. `route` is called with (url, parsedBody) and returns
 * `[status, body]`; every request is recorded so the test can assert what actually went out.
 */
function installFetch(route) {
  const seen = [];
  const spy = jest.fn(async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    const body = init && init.body ? JSON.parse(init.body) : null;
    seen.push({ url: u, body, headers: (init && init.headers) || {} });
    const [status, payload] = route(u, body, seen.length);
    return jsonResponse(status, payload);
  });
  const previous = global.fetch;
  global.fetch = spy;
  return { seen, restore: () => { global.fetch = previous; } };
}

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER', 'LLM_REQUEST_TIMEOUT_MS',
  'LLM_MAX_RETRIES', 'LLM_DIRECT_FALLBACK_MODEL', 'LP612_PROMPT_CACHE', 'LP612_TARGETED_REVISION',
  'LP612_PAGE_TRUTH_DIR', 'E2E_CASSETTE', 'LP612_WIDE_SEGMENTS',
];

function freshLlmClient(env) {
  jest.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    ANTHROPIC_API_KEY: 'test-credit-key',
    OPENROUTER_API_KEY: 'test-or-key',
    // The SDK's retry budget doubles every assertion about call counts; 0 keeps the
    // network double honest about how many attempts the code itself made.
    LLM_MAX_RETRIES: '1',
  }, env || {});
  // eslint-disable-next-line global-require
  return require(LLM_CLIENT);
}

let restoreFetch;
afterEach(() => {
  if (restoreFetch) { restoreFetch(); restoreFetch = undefined; }
  for (const k of ENV_KEYS) delete process.env[k];
  jest.clearAllMocks();
  jest.resetModules();
});

// ── 1. the translation: what reaches /v1/messages ───────────────────────────

describe('the OpenAI-shaped payload is translated for /v1/messages', () => {
  test('the system message becomes the TOP-LEVEL `system` and its cache_control breakpoint survives byte for byte', async () => {
    const net = installFetch(() => [200, nativeReply('{"ok":true}')]);
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 24000,
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'BRIEF', cache_control: { type: 'ephemeral' } }] },
        { role: 'user', content: [
          { type: 'text', text: 'STABLE-TASK', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'volatile tail' },
        ] },
      ],
    });

    expect(net.seen).toHaveLength(1);
    const sent = net.seen[0];
    expect(sent.url).toBe(ANTHROPIC_URL);

    // BP1 — the system brief. This IS the win: 77% of the prompt, byte-identical every round.
    expect(sent.body.system).toEqual([
      { type: 'text', text: 'BRIEF', cache_control: { type: 'ephemeral' } },
    ]);
    // ...and it must NOT still be sitting in `messages`, which is a hard 400 on this model:
    // "messages.0: use the top-level 'system' parameter for the initial system prompt".
    expect(sent.body.messages.some((m) => m.role === 'system')).toBe(false);

    // BP2 — the stable head of the user turn, marker intact, volatile tail after it unmarked.
    expect(sent.body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'STABLE-TASK', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'volatile tail' },
      ],
    });
  });

  test('`temperature` and `reasoning` — both a 400 on this model — never reach the wire, and `thinking` carries the same intent', async () => {
    const net = installFetch(() => [200, nativeReply('{"ok":true}')]);
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    await client.chat.completions.create({
      model, temperature: 0.2, max_tokens: 1000, reasoning: { enabled: false },
      messages: [{ role: 'user', content: 'hi' }],
    });

    const body = net.seen[0].body;
    // Measured against the live API 2026-09-07: `temperature` -> 400 "`temperature` is
    // deprecated for this model."; `reasoning` -> 400 "reasoning: Extra inputs are not
    // permitted". Either one fails round 0 and costs a teacher her lesson.
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('reasoning');
    expect(body.thinking).toEqual({ type: 'disabled' });
    // The routing prefix is ours; Anthropic 404s on it.
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.max_tokens).toBe(1000);
  });
});

  test('a param this facade cannot faithfully translate is a NAMED THROW, not a silent drop', async () => {
    const net = installFetch(() => [200, nativeReply('{"ok":true}')]);
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    // `quiz/transcript-quiz-llm.js` is the live second consumer of `getClientForModel`, and it
    // sends exactly this. Dropping it would remove JSON-mode enforcement from a path whose next
    // line is `JSON.parse` — a bad-JSON bug with no error to read, appearing only once someone
    // points that model id at this lane.
    await expect(client.chat.completions.create({
      model, max_tokens: 1000, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toThrow(/response_format/);

    expect(net.seen).toHaveLength(0);
  });

// ── 2. the reply: cache telemetry and cost survive the mapping ──────────────

describe('the native reply maps into the usage fields the author already reads', () => {
  test('a cache READ becomes prompt_tokens_details.cached_tokens, and prompt_tokens counts the whole prompt', async () => {
    const net = installFetch(() => [200, nativeReply('{"ok":true}', {
      input_tokens: 1200,
      cache_read_input_tokens: 37536,
      cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      output_tokens: 4000,
    })]);
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    const res = await client.chat.completions.create({
      model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.usage.prompt_tokens_details.cached_tokens).toBe(37536);
    expect(res.usage.prompt_tokens_details.cache_write_tokens).toBe(0);
    // OpenRouter reports the FULL prompt on a cached call too (the tokens were processed, just
    // billed at 0.1x). Matching that keeps "share of prompt served from cache" one number across
    // both lanes instead of two different denominators wearing one name.
    expect(res.usage.prompt_tokens).toBe(1200 + 37536);
    expect(res.usage.completion_tokens).toBe(4000);
    expect(res.choices[0].message.content).toBe('{"ok":true}');
  });

  test('cost is computed at Anthropic list price — Anthropic returns none, and accumulateUsage reads `usage.cost`', async () => {
    const net = installFetch(() => [200, nativeReply('{"ok":true}', {
      input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 0 },
      output_tokens: 1_000_000,
    })]);
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    const res = await client.chat.completions.create({
      model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }],
    });

    // claude-sonnet-5: $2.00/MTok in, $10.00/MTok out; cache read 0.1x, 5-minute write 1.25x.
    // 1M fresh ($2.00) + 1M read ($0.20) + 1M 5m-write ($2.50) + 1M out ($10.00) = $14.70.
    expect(res.usage.cost).toBeCloseTo(14.70, 6);
    expect(res.usage.cost_unpriced).toBeUndefined();
  });

  test('an UNPRICED model reports `cost_unpriced` rather than a $0 lesson', async () => {
    const net = installFetch(() => [200, Object.assign(nativeReply('{"ok":true}'), { model: 'claude-not-a-real-model' })]);
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-not-a-real-model');
    const res = await client.chat.completions.create({
      model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.usage.cost).toBeUndefined();
    expect(res.usage.cost_unpriced).toBe(true);
  });
});

// ── 3. the credit-exhaustion fallback, FORCED ───────────────────────────────

describe('a prepaid balance that runs dry must not stop lesson generation', () => {
  test('the REAL 400 credit body falls the call back to OpenRouter, on the OpenRouter model id, with the same prompt', async () => {
    const net = installFetch((url) => (
      url === ANTHROPIC_URL ? [400, CREDIT_400] : [200, orReply('{"from":"openrouter"}')]
    ));
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5',
      { correlationId: 'corr-fb', stage: 'author' });
    const res = await client.chat.completions.create({
      model, max_tokens: 1000, temperature: 0.2, reasoning: { enabled: false },
      messages: [
        { role: 'system', content: 'BRIEF' },
        { role: 'user', content: 'TASK' },
      ],
    });

    const urls = net.seen.map((s) => s.url);
    expect(urls[0]).toBe(ANTHROPIC_URL);
    expect(urls[urls.length - 1]).toBe(OPENROUTER_URL);

    // `claude-sonnet-5` is Anthropic's id for the model; OpenRouter's is `anthropic/…`. Sending
    // the bare id to OpenRouter would 404 — a fallback that fails is not a fallback.
    const or = net.seen[net.seen.length - 1].body;
    expect(or.model).toBe('anthropic/claude-sonnet-5');
    // The OpenRouter payload is the ORIGINAL OpenAI-shaped one, untranslated: the system message
    // stays in `messages`, and the params the native surface rejects are legal here.
    expect(or.messages[0]).toEqual({ role: 'system', content: 'BRIEF' });
    expect(or.temperature).toBe(0.2);

    expect(res.choices[0].message.content).toBe('{"from":"openrouter"}');
    // The lesson must be able to say it was NOT authored on the credit.
    expect(res.usage.provider_fallback).toBe(true);
    expect(res.usage.provider_fallback_to).toBe('anthropic/claude-sonnet-5');
  });

  test('the fallback emits lp612.llm.fallback_provider exactly once, naming both providers and the reason', async () => {
    const net = installFetch((url) => (
      url === ANTHROPIC_URL ? [400, CREDIT_400] : [200, orReply('{}')]
    ));
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5',
      { correlationId: 'corr-fb', stage: 'revision2' });
    await client.chat.completions.create({
      model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }],
    });

    const events = mockLogEvent.mock.calls.filter((c) => c[0] === 'lp612.llm.fallback_provider');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({
      correlationId: 'corr-fb',
      stage: 'revision2',
      from: 'anthropic-direct/claude-sonnet-5',
      to: 'anthropic/claude-sonnet-5',
      status: 400,
    });
    expect(String(events[0][1].reason)).toMatch(/credit balance is too low/i);
  });

  test('401 and 429 also fall back — a revoked key and an exhausted quota are the same problem for a teacher who is waiting', async () => {
    for (const status of [401, 429]) {
      const net = installFetch((url) => (
        url === ANTHROPIC_URL
          ? [status, { type: 'error', error: { type: 'x', message: 'nope' } }]
          : [200, orReply('{}')]
      ));
      restoreFetch = net.restore;
      const mod = freshLlmClient();
      const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
      const res = await client.chat.completions.create({
        model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }],
      });
      expect(res.usage.provider_fallback).toBe(true);
      restoreFetch(); restoreFetch = undefined;
    }
  });

  test('a NON-credit 400 does NOT fall back — silently switching providers on a malformed payload would hide the bug behind a working lesson', async () => {
    const net = installFetch((url) => (
      url === ANTHROPIC_URL
        ? [400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: Field required' } }]
        : [200, orReply('{}')]
    ));
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    await expect(client.chat.completions.create({
      model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toThrow(/max_tokens/);

    expect(net.seen.map((s) => s.url)).not.toContain(OPENROUTER_URL);
    expect(mockLogEvent.mock.calls.filter((c) => c[0] === 'lp612.llm.fallback_provider')).toHaveLength(0);
  });

  test('when BOTH providers fail, the thrown error still names the credit failure that started it', async () => {
    const net = installFetch((url) => (
      url === ANTHROPIC_URL
        ? [400, CREDIT_400]
        : [502, { error: { message: 'openrouter is down' } }]
    ));
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    // "OpenRouter returned 502" on its own sends the next engineer at OpenRouter, when the story
    // is "the prepaid balance ran out AND the fallback was down".
    await expect(client.chat.completions.create({
      model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toThrow(/credit balance is too low/i);
  });

  test('LLM_DIRECT_FALLBACK_MODEL overrides the derived OpenRouter id exactly', async () => {
    const net = installFetch((url) => (
      url === ANTHROPIC_URL ? [400, CREDIT_400] : [200, orReply('{}')]
    ));
    restoreFetch = net.restore;
    const mod = freshLlmClient({ LLM_DIRECT_FALLBACK_MODEL: 'openai/gpt-4o' });

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    await client.chat.completions.create({
      model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }],
    });

    expect(net.seen[net.seen.length - 1].body.model).toBe('openai/gpt-4o');
  });
});

// ── 3b. the fallback cannot be silently disabled (operator: "Keep the fall back on") ──

describe('the direct lane refuses to run without a usable fallback', () => {
  test('no OPENROUTER_API_KEY: the lane refuses at RESOLUTION time, before a token is spent', () => {
    const mod = freshLlmClient();
    delete process.env.OPENROUTER_API_KEY;
    // Not "throws on the first fallback" — throws BEFORE the first author call. A deployment that
    // could author one credit-funded lesson and then strand the next when the balance ran out is
    // exactly the failure this refusal exists to prevent.
    expect(() => mod.getClientForModel('anthropic-direct/claude-sonnet-5'))
      .toThrow(/MANDATORY credit-exhaustion fallback is not usable[\s\S]*OPENROUTER_API_KEY/);
  });

  test('LLM_PROVIDER=openai: the lane refuses, because the fallback would post an OpenRouter model id to OpenAI', () => {
    const mod = freshLlmClient({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' });
    expect(() => mod.getClientForModel('anthropic-direct/claude-sonnet-5'))
      .toThrow(/MANDATORY credit-exhaustion fallback is not usable[\s\S]*wrong vendor/);
  });

  test('a correctly wired environment resolves normally — the guard narrows nothing else', async () => {
    const net = installFetch(() => [200, nativeReply('{"ok":true}')]);
    restoreFetch = net.restore;
    const mod = freshLlmClient();
    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    const res = await client.chat.completions.create({
      model, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.choices[0].message.content).toBe('{"ok":true}');
  });

  test('there is NO env var that switches the fallback off — only one that retargets it', () => {
    const mod = freshLlmClient({ LLM_DIRECT_FALLBACK_MODEL: '   ' });
    // A blank override falls through to the derived id rather than disabling anything: whitespace
    // must not be a way to unwire the net by accident.
    expect(mod.directFallbackModel('claude-sonnet-5')).toBe('anthropic/claude-sonnet-5');
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../bot/shared/services/llm-client.js'), 'utf8');
    // Guards the PROPERTY, not the spelling: any new env read in this module must be justified,
    // and none of them may be a fallback kill switch.
    const envVars = [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(new Set(envVars)).toEqual(new Set([
      'ANTHROPIC_API_KEY', 'APP_URL', 'LLM_DIRECT_FALLBACK_MODEL', 'LLM_MAX_RETRIES',
      'LLM_MODEL', 'LLM_PROVIDER', 'LLM_REQUEST_TIMEOUT_MS', 'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
    ]));
  });
});

// ── 4. the whole ladder, on the direct lane, through the real author service ──

describe('the real author ladder on the direct lane', () => {
  const BOOK = { title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9, medium: 'en', language: 'English', offset: 4 };
  const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
  const SEGMENT = {
    segment_id: 'seg-direct', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
    medium: 'en', language: 'English', chapter_number: 1, chapter_title: 'The Biological Method',
    chapter_key: 'g9-bio-ch1', subtopic_title: 'Observation and hypothesis',
    menu_title: 'Observation & hypothesis', printed_page_start: 11, printed_page_end: 12,
    pages_covered: [11, 12], order_index: 3, lp_type: 'SCI-9-10', yt: null, notes: null,
  };
  const CLIPPED = 'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)';

  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-direct-'));
    const d = path.join(dir, SEGMENT.book_stem);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
    fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
    for (const n of [11, 12]) {
      fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
        printed_page_number: n, pdf_page_index: n + 4, page_type: 'content',
        blocks: [{ t: 'heading', text: `1.${n} Observation` }],
      }));
    }
  });

  /** Loads the author service fresh, with llm-client NOT mocked, under the given env. */
  function loadAuthor(env) {
    jest.resetModules();
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: 'test-credit-key',
      OPENROUTER_API_KEY: 'test-or-key',
      LLM_MAX_RETRIES: '1',
      LP612_PAGE_TRUTH_DIR: dir,
    }, env || {});
    // eslint-disable-next-line global-require
    return require(AUTHOR);
  }

  test('caching SURVIVES the direct lane end to end: round 0 writes the entry, every later round reads it, and the counters reach lp612.author.completed', async () => {
    // eslint-disable-next-line global-require
    const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');
    let call = 0;
    const net = installFetch(() => {
      call += 1;
      // Round 0 WRITES the 37,536-token brief; every revision round READS it. This is the exact
      // shape the healthy loop has on production, and a run that never showed a read would be a
      // silent invalidator — a failure, not a partial win.
      const usage = call === 1
        ? { input_tokens: 4000, cache_creation_input_tokens: 37536,
            cache_creation: { ephemeral_5m_input_tokens: 37536, ephemeral_1h_input_tokens: 0 },
            cache_read_input_tokens: 0, output_tokens: 6000 }
        : { input_tokens: 4000, cache_creation_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
            cache_read_input_tokens: 37536, output_tokens: 6000 };
      return [200, nativeReply(JSON.stringify(CLEAN_DOC), usage)];
    });
    restoreFetch = net.restore;

    const { authorLessonPlan } = loadAuthor({ LP612_PROMPT_CACHE: 'true' });
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED])
      .mockResolvedValueOnce([]);

    const out = await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'anthropic-direct/claude-sonnet-5', rounds: 3,
      renderCheck, correlationId: 'corr-direct',
    });

    // Every call went to Anthropic's NATIVE endpoint, not the compatibility shim and not
    // OpenRouter — the whole point of the lane.
    expect(net.seen.length).toBeGreaterThanOrEqual(2);
    expect(net.seen.every((s) => s.url === ANTHROPIC_URL)).toBe(true);
    // And every one of them carried the breakpoint on the system brief.
    for (const s of net.seen) {
      expect(Array.isArray(s.body.system)).toBe(true);
      expect(s.body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    }

    // THE HEADLINE. Zero cache reads is a failure, not a partial win.
    expect(out.usage.cached_tokens).toBeGreaterThan(0);
    expect(out.usage.cache_write_tokens).toBe(37536);
    expect(out.usage.cost_usd).toBeGreaterThan(0);
    expect(out.usage.provider_fallback_calls).toBe(0);
    expect(out.model).toBe('anthropic-direct/claude-sonnet-5');

    const completed = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.author.completed');
    expect(completed).toBeDefined();
    expect(completed[1].cachedTokens).toBeGreaterThan(0);
    expect(completed[1].costUsd).toBeGreaterThan(0);
    expect(completed[1].providerFallbackCalls).toBe(0);
  });

  test('with the balance gone, the lesson STILL COMPLETES on OpenRouter and the render row can say so', async () => {
    // eslint-disable-next-line global-require
    const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');
    const net = installFetch((url) => (
      url === ANTHROPIC_URL
        ? [400, CREDIT_400]
        : [200, orReply(JSON.stringify(CLEAN_DOC))]
    ));
    restoreFetch = net.restore;

    const { authorLessonPlan } = loadAuthor({ LP612_PROMPT_CACHE: 'true' });
    const renderCheck = jest.fn().mockResolvedValue([]);

    const out = await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'anthropic-direct/claude-sonnet-5', rounds: 3,
      renderCheck, correlationId: 'corr-dry',
    });

    // The teacher got her lesson.
    expect(out.lpDoc).toBeTruthy();
    expect(out.usage.provider_fallback_calls).toBeGreaterThan(0);
    // `model_used` on the render row must not claim the prepaid credit paid for this. The reuse
    // lane already writes non-model markers there (`reused:v9.1`) for exactly this reason.
    expect(out.model).toBe('anthropic-direct/claude-sonnet-5+fallback');

    const completed = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.author.completed');
    expect(completed[1].providerFallbackCalls).toBeGreaterThan(0);
    expect(mockLogEvent.mock.calls.filter((c) => c[0] === 'lp612.llm.fallback_provider').length)
      .toBeGreaterThan(0);
  });
});

// ── 5. COMPOSITION: a WIDE segment authored on the direct lane ──────────────
//
// bd-oak77.30 (lane 17) let a page range past the 25-page cap author instead of refusing, and it
// changes the ROUND-0 USER TURN for those segments — it injects a "revision span" card. bd-oak77.29
// (this lane) puts the cache breakpoint at the end of the round-0 user turn and relies on
// `buildRevisionPrompt(stableFirst)` replaying those exact bytes at the FRONT of every later round.
//
// Those two facts have never met. If the card made round 0's turn differ from what later rounds
// replay, `userContent`'s `startsWith` guard would decline to split, the BP2 entry would never be
// read, and caching would degrade to zero **on wide segments only** — a silent, per-segment-class
// regression that neither lane's own tests would catch. Hence this suite.
//
// (Lane 17 put the card in the USER turn rather than the brief for exactly this reason; their
// comment says so. This asserts the property rather than trusting the comment.)

describe('a wide segment on the direct lane', () => {
  // 30 printed pages — past MAX_SEGMENT_PAGES (25), under WIDE_SEGMENT_PAGE_CEILING.
  const WIDE_PAGES = Array.from({ length: 30 }, (_, i) => 11 + i);
  const BOOK = { title: 'Mathematics 6', publisher: 'PCTB', subject: 'mathematics', grade: 6, medium: 'en', language: 'English', offset: 4 };
  const TOC = { chapters: [{ number: 9, title: 'Review', printed_start: 9 }] };
  const WIDE_SEGMENT = {
    segment_id: 'grade_6_mathematics.s901', book_stem: 'grade_6_mathematics', grade: 6,
    subject: 'mathematics', medium: 'en', language: 'English', chapter_number: 9,
    chapter_title: 'Review', chapter_key: 'g6-m-ch9', subtopic_title: 'Whole-chapter revision',
    menu_title: 'Chapter revision', printed_page_start: 11, printed_page_end: 40,
    pages_covered: WIDE_PAGES, order_index: 1, lp_type: 'RECALL', yt: null, notes: null,
  };
  const CLIPPED = 'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)';

  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-wide-direct-'));
    const d = path.join(dir, WIDE_SEGMENT.book_stem);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
    fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
    for (const n of WIDE_PAGES) {
      fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
        printed_page_number: n, pdf_page_index: n + 4, page_type: 'content',
        blocks: [{ t: 'heading', text: `9.${n} Revision point` }],
      }));
    }
  });

  function loadAuthor(env) {
    jest.resetModules();
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: 'test-credit-key',
      OPENROUTER_API_KEY: 'test-or-key',
      LLM_MAX_RETRIES: '1',
      LP612_PAGE_TRUTH_DIR: dir,
      // bd-oak77.30's flag. Without it a 30-page range is REFUSED and nothing below runs — which
      // is itself worth asserting, so the first test checks that too.
      LP612_WIDE_SEGMENTS: 'true',
      LP612_PROMPT_CACHE: 'true',
    }, env || {});
    // eslint-disable-next-line global-require
    return require(AUTHOR);
  }

  test('CACHING SURVIVES the wide-segment card: round 0 writes the entry and every later round reads it, with the same prefix bytes', async () => {
    // eslint-disable-next-line global-require
    const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');
    let call = 0;
    const net = installFetch(() => {
      call += 1;
      const usage = call === 1
        ? { input_tokens: 5000, cache_creation_input_tokens: 41000,
            cache_creation: { ephemeral_5m_input_tokens: 41000, ephemeral_1h_input_tokens: 0 },
            cache_read_input_tokens: 0, output_tokens: 7000 }
        : { input_tokens: 5000, cache_creation_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
            cache_read_input_tokens: 41000, output_tokens: 7000 };
      return [200, nativeReply(JSON.stringify(CLEAN_DOC), usage)];
    });
    restoreFetch = net.restore;

    const { authorLessonPlan } = loadAuthor();
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED])
      .mockResolvedValueOnce([]);

    const out = await authorLessonPlan({
      segment: WIDE_SEGMENT, lang: 'en', model: 'anthropic-direct/claude-sonnet-5', rounds: 3,
      renderCheck, correlationId: 'corr-wide-direct',
    });

    expect(net.seen.length).toBeGreaterThanOrEqual(2);
    expect(net.seen.every((s) => s.url === ANTHROPIC_URL)).toBe(true);

    // bd-oak77.30 actually fired: the wide card is in the round-0 USER turn.
    const round0 = net.seen[0].body;
    const round0User = round0.messages[0].content;
    const round0Text = Array.isArray(round0User)
      ? round0User.map((b) => b.text).join('') : String(round0User);
    expect(round0Text).toMatch(/REVISION LESSON OVER A WHOLE CHAPTER/);
    expect(round0Text).toMatch(/30 printed pages/);

    // BP1 — the system brief still carries its breakpoint on every call, and the wide card did
    // NOT leak into the brief (which would split the shared cache across segment widths).
    for (const s of net.seen) {
      expect(Array.isArray(s.body.system)).toBe(true);
      expect(s.body.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(s.body.system[0].text).not.toMatch(/REVISION LESSON OVER A WHOLE CHAPTER/);
    }

    // BP2 — THE PROPERTY THAT COULD HAVE BROKEN. Every revision round must still open with the
    // round-0 turn, byte for byte, behind a breakpoint. A plain string here means `startsWith`
    // declined and the entry is never read again.
    const later = net.seen.slice(1);
    expect(later.length).toBeGreaterThan(0);
    for (const s of later) {
      const content = s.body.messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(content[0].text).toBe(round0Text);
    }

    // ...and the effect of that, in the counters the operator will read on prod.
    expect(out.usage.cached_tokens).toBeGreaterThan(0);
    expect(out.usage.cache_write_tokens).toBe(41000);
    expect(out.usage.provider_fallback_calls).toBe(0);
    expect(out.model).toBe('anthropic-direct/claude-sonnet-5');
  });

  test('THE FALLBACK STILL FIRES on a wide segment: credit dry, lesson still delivered, row says +fallback', async () => {
    // eslint-disable-next-line global-require
    const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');
    const net = installFetch((url) => (
      url === ANTHROPIC_URL ? [400, CREDIT_400] : [200, orReply(JSON.stringify(CLEAN_DOC))]
    ));
    restoreFetch = net.restore;

    const { authorLessonPlan } = loadAuthor();
    const out = await authorLessonPlan({
      segment: WIDE_SEGMENT, lang: 'en', model: 'anthropic-direct/claude-sonnet-5', rounds: 3,
      renderCheck: jest.fn().mockResolvedValue([]), correlationId: 'corr-wide-dry',
    });

    expect(out.lpDoc).toBeTruthy();
    expect(out.usage.provider_fallback_calls).toBeGreaterThan(0);
    expect(out.model).toBe('anthropic-direct/claude-sonnet-5+fallback');

    // The OpenRouter re-issue carried the wide card too — a fallback that dropped it would author
    // a single-sub-topic lesson over a 30-page revision span and nobody would see why.
    const or = net.seen.filter((s) => s.url === OPENROUTER_URL);
    expect(or.length).toBeGreaterThan(0);
    const orUser = or[0].body.messages[1].content;
    const orText = Array.isArray(orUser) ? orUser.map((b) => b.text).join('') : String(orUser);
    expect(orText).toMatch(/REVISION LESSON OVER A WHOLE CHAPTER/);

    expect(mockLogEvent.mock.calls.filter((c) => c[0] === 'lp612.llm.fallback_provider').length)
      .toBeGreaterThan(0);
  });

  test('with bd-oak77.30 OFF, a 30-page range is still REFUSED on the direct lane — the cap behaviour is unchanged by the provider', async () => {
    const net = installFetch(() => [200, nativeReply('{}')]);
    restoreFetch = net.restore;
    const { authorLessonPlan } = loadAuthor({ LP612_WIDE_SEGMENTS: 'false' });
    await expect(authorLessonPlan({
      segment: WIDE_SEGMENT, lang: 'en', model: 'anthropic-direct/claude-sonnet-5', rounds: 3,
      renderCheck: jest.fn().mockResolvedValue([]), correlationId: 'corr-wide-off',
    })).rejects.toThrow(/cap is 25|PAGE_RANGE_TOO_LARGE/);
    expect(net.seen).toHaveLength(0);
  });
});
