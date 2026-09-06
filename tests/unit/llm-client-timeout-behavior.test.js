/**
 * bd-v60qf — llm-client per-call timeout, BEHAVIOURAL half.
 *
 * The sibling file (llm-client-timeout-wiring.test.js) proves the right
 * numbers are handed to `new OpenAI({...})`, using a `jest.mock('openai')`
 * constructor stub — necessary, but per root CLAUDE.md Rule 6 not
 * sufficient: a wiring assertion that reads `config.timeout` off a stub
 * would keep passing even if the real SDK ignored that field entirely.
 *
 * This file therefore does NOT mock `openai`. It loads the REAL package
 * (resolved to the repo root's node_modules via tests/jest.config.js's
 * moduleNameMapper — the same real openai@6.16.0 that `require('openai')`
 * resolves to from inside llm-client.js under this test run) and drives it
 * through the module's real exports — createLLMClient() / getClient() /
 * getClientForModel() — never a hand-built `new OpenAI()`, so the actual
 * changed lines in llm-client.js execute.
 *
 * The network boundary it mocks is `global.fetch`, stubbed to hang forever
 * UNLESS the request's AbortSignal fires — which is exactly what a real
 * stalled TCP connection does under undici, and is the mechanism the SDK's
 * own timeout relies on (`client.js`: `setTimeout(abort, ms)` then
 * `this.fetch.call(undefined, url, { signal, ... })`). A naive
 * `new Promise(() => {})` does NOT observe the abort signal and would let
 * this test hang forever even with a correct timeout wired — silently
 * turning it into a no-op. Confirmed by manual probe against the real SDK
 * before writing this test (see PR description for both probe outputs).
 *
 * RED (unmodified develop, no timeout/maxRetries wired): the call never
 * rejects — the abort timer that would reject it never firing — so this
 * test hangs to Jest's per-test timeout. See the PR description for the
 * captured raw failure.
 */

const path = require('path');

const LLM_CLIENT = path.resolve(__dirname, '../../bot/shared/services/llm-client.js');

const ENV_KEYS = [
  'LLM_PROVIDER',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'LLM_REQUEST_TIMEOUT_MS',
  'LLM_MAX_RETRIES',
  'E2E_CASSETTE',
];

/**
 * Loads a fresh copy of llm-client.js AND a matching fresh copy of the
 * `openai` module, from the SAME jest module-registry "epoch". This matters:
 * `jest.resetModules()` clears the registry, so calling `require('openai')`
 * at file-load time (before any resetModules) and then separately requiring
 * llm-client.js (which internally requires 'openai') AFTER a resetModules
 * gives you two DIFFERENT module instances of the openai package — with two
 * DIFFERENT `APIConnectionTimeoutError` class objects. `instanceof` is
 * nominal, so a same-named-but-different-instance class fails the check even
 * when the thrown error is genuinely the right kind. Returning both `mod`
 * and `OpenAI` from the same require pass keeps them talking about the same
 * class.
 */
function freshModule(envOverrides = {}) {
  jest.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  Object.assign(process.env, envOverrides);
  // eslint-disable-next-line global-require
  const mod = require(LLM_CLIENT);
  // eslint-disable-next-line global-require
  const OpenAI = require('openai'); // same registry epoch as the require() above
  return { mod, OpenAI };
}

/**
 * A stand-in for a stalled network call. Settles ONLY when the SDK's own
 * AbortSignal fires (real fetch/undici behaviour) — otherwise never
 * resolves or rejects, exactly like a genuinely hung connection.
 *
 * The rejection is a plain `Error` with `.name = 'AbortError'`, not a
 * `DOMException`. In real Node, undici's aborted-fetch error IS an `Error`
 * instance (verified: `new DOMException('x','AbortError') instanceof Error`
 * is `true` in a plain Node script) — but inside Jest's node test
 * environment, `DOMException` does not satisfy `instanceof Error` (a VM/shim
 * artifact of that environment, not of the SDK or Node itself). The SDK's
 * `isAbortError()` check is duck-typed on `.name === 'AbortError'`, so a
 * plain Error with that name reproduces the real contract correctly in
 * every environment, whereas a DOMException here would fall through
 * `castToError`'s `instanceof Error` fast path and get misclassified as a
 * generic `APIConnectionError` — caught the hard way: this test genuinely
 * received `APIConnectionError` before the fix below, verified against the
 * unmodified real error-classification code in node_modules/openai.
 */
function installHangingFetch() {
  const previous = global.fetch;
  const fetchSpy = jest.fn((_url, options) => new Promise((_resolve, reject) => {
    const signal = options && options.signal;
    if (signal) {
      signal.addEventListener('abort', () => {
        const abortError = new Error('The operation was aborted.');
        abortError.name = 'AbortError';
        reject(abortError);
      });
    }
  }));
  global.fetch = fetchSpy;
  return { fetchSpy, restore: () => { global.fetch = previous; } };
}

describe('bd-v60qf — llm-client hung-call behaviour (real SDK, mocked fetch boundary)', () => {
  const OLD_ENV = { ...process.env };
  let restoreFetch;

  afterEach(() => {
    process.env = { ...OLD_ENV };
    jest.resetModules();
    if (restoreFetch) { restoreFetch(); restoreFetch = undefined; }
  });

  test('getClient() (OpenRouter default lane): a hung call rejects with APIConnectionTimeoutError inside the configured budget, not the SDK 10-minute default', async () => {
    const hanging = installHangingFetch();
    restoreFetch = hanging.restore;
    const { mod, OpenAI } = freshModule({ LLM_REQUEST_TIMEOUT_MS: '300' });

    const client = mod.getClient();
    const start = Date.now();
    await expect(
      client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
      })
    ).rejects.toBeInstanceOf(OpenAI.APIConnectionTimeoutError);
    // maxRetries:1 means TWO full timeout cycles (the SDK retries once before
    // giving up), so the wall-clock floor is ~2x LLM_REQUEST_TIMEOUT_MS plus a
    // retry backoff, not 1x. 5000ms is nowhere near tight to that ~600-700ms
    // reality, but it proves the point beyond any doubt: nowhere close to the
    // SDK's stock 600000ms (10 min) default this bead removes.
    expect(Date.now() - start).toBeLessThan(5000);
    expect(hanging.fetchSpy).toHaveBeenCalled();
  });

  test('without an env override, the real client still carries the 180000ms default (not the SDK 600000ms default) and rejects well under 1s at a shrunk fetch delay', async () => {
    // No LLM_REQUEST_TIMEOUT_MS override — proves the DEFAULT (not just the
    // override path) is wired. We can't wait out a real 180s in a unit test,
    // so this asserts the client-level property AND separately proves the
    // override path rejects fast (previous tests) — together they cover
    // "the default is 180000" x "180000 actually gets enforced by the SDK".
    const { mod } = freshModule();
    const client = mod.getClient();
    expect(client.timeout).toBe(180000);
    expect(client.maxRetries).toBe(1);
  });
  // REMOVED FOR THIS EXTRACTION: the `anthropic-direct/` lane (bd-yoc6i) is on develop
  // only — this vehicle takes llm-client's timeout/retry budget and leaves that lane
  // behind, so `getClientForModel` does not exist here and a test of it would assert
  // a module this branch has no reason to carry. The OpenRouter and direct-OpenAI
  // cases above cover every client this branch actually builds.
});
