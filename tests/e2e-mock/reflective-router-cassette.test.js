/**
 * Red-first (bd-yjyn0): the reflective corpus/question LLM (llm-router.service) builds its OWN
 * OpenRouter client and must route it through the e2e cassette. Unwrapped, it calls the vendor LIVE;
 * in the sealed mock lane (no keys) that 401s → no corpus → a generic fallback reflective question
 * whose TTS was never recorded → an unattributable cassette miss. Wrapped, a miss is a loud,
 * attributable E2E_CASSETTE_MISS and NOTHING goes live.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('openai');
const SANDBOX = 'https://olvritwoqujtjvwfulbh.supabase.co';

function setup() {
  jest.resetModules();
  for (const k of ['E2E_CASSETTE', 'E2E_CASSETTE_DIR', 'E2E_CASSETTE_MISS_LOG', 'SUPABASE_URL', 'R2_BUCKET_NAME']) delete process.env[k];
  const liveCreate = jest.fn(async () => ({ choices: [{ message: { content: '{}' } }], usage: {} }));
  // Re-require the mocked SDK AFTER resetModules so the router's require('openai') sees this impl.
  const FreshOpenAI = require('openai');
  FreshOpenAI.mockImplementation(() => ({ chat: { completions: { create: liveCreate } } }));
  return { liveCreate };
}

test('reflective LLM call goes through the cassette — replay-strict miss throws, vendor never called', async () => {
  const { liveCreate } = setup();
  process.env.OPENROUTER_API_KEY = 'sk-test-dummy';
  process.env.SUPABASE_URL = SANDBOX;
  process.env.E2E_CASSETTE = 'replay-strict';
  process.env.E2E_CASSETTE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'refl-cassette-'));
  const { callReflective } = require('../../bot/shared/services/coaching/reflective-questions/llm-router.service');
  await expect(callReflective([{ role: 'user', content: 'hi' }], { timeoutMs: 2000 }))
    .rejects.toThrow(/E2E_CASSETTE_MISS/);
  expect(liveCreate).not.toHaveBeenCalled();
});
