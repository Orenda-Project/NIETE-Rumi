/**
 * §D-1 guard — `validate:connections` must not print a misleading
 * "All connections successful" line when nothing was actually tested.
 *
 * Before this fix, an adopter with no credentials in `.env` saw a green
 * success message even though every check had been SKIPped. The fix counts
 * OK vs SKIP and emits one of three honest messages.
 */

const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../infrastructure/scripts/test-connections.js');

describe('validate:connections honest output', () => {
  let originalEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
    // Wipe all the keys the script reads.
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REDIS_URL',
      'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER']) {
      delete process.env[k];
    }
    jest.resetModules();
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('prints the "Nothing was tested" message when no services are configured', async () => {
    const { runTests } = require(SCRIPT);
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      const results = await runTests();
      expect(results.every((r) => r.status === 'SKIP')).toBe(true);
    } finally {
      console.log = orig;
    }
    const all = logs.join('\n');
    expect(all).toMatch(/Nothing was tested/);
    expect(all).not.toMatch(/All connections successful/);
  });
});
