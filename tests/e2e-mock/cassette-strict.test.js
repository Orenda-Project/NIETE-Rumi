/**
 * E2E cassette — STRICT replay for the local mock lane.
 *
 * The mock E2E must never reach a live vendor (Soniox / LLM / ElevenLabs). Plain `replay`
 * goes live on a miss and records, which is right for staging and wrong here. `replay-strict`
 * answers a hit exactly like `replay` and turns a miss into a loud, attributable failure:
 * the wrapped call throws `E2E_CASSETTE_MISS`, nothing is called, nothing is recorded, and
 * the miss is appended to E2E_CASSETTE_MISS_LOG (when set) so the runner can report it.
 *
 * Red-first: fails on develop — `replay-strict` is an unknown value and reads as `off`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = 'https://olvritwoqujtjvwfulbh.supabase.co';
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cassette-strict-'));
const fresh = (env) => {
  jest.resetModules();
  for (const k of ['E2E_CASSETTE', 'E2E_CASSETTE_DIR', 'E2E_CASSETTE_MISS_LOG', 'SUPABASE_URL', 'R2_BUCKET_NAME']) delete process.env[k];
  Object.assign(process.env, env);
  return require('../../bot/shared/services/e2e-cassette');
};

describe('e2e-cassette: replay-strict', () => {
  test('is a replay mode, and reports itself strict', () => {
    const c = fresh({ E2E_CASSETTE: 'replay-strict', SUPABASE_URL: SANDBOX });
    expect(c.mode()).toBe('replay');
    expect(c.strict()).toBe(true);
  });

  test('plain replay is not strict', () => {
    const c = fresh({ E2E_CASSETTE: 'replay', SUPABASE_URL: SANDBOX });
    expect(c.strict()).toBe(false);
  });

  test('is still forced off against the production database', () => {
    const c = fresh({ E2E_CASSETTE: 'replay-strict', SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' });
    expect(c.mode()).toBe('off');
  });

  test('a miss throws E2E_CASSETTE_MISS, never calls the vendor, records nothing', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: dir, SUPABASE_URL: SANDBOX });
    const fn = jest.fn(async () => 'live answer');
    await expect(c.wrap('llm', { model: 'x', messages: [{ role: 'user', content: 'hi' }] }, fn))
      .rejects.toThrow(/E2E_CASSETTE_MISS/);
    expect(fn).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json'))).toEqual([]);
  });

  test('a miss is appended to E2E_CASSETTE_MISS_LOG as one JSON line naming kind and key', async () => {
    const dir = tmpDir();
    const log = path.join(dir, 'misses.jsonl');
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: dir, E2E_CASSETTE_MISS_LOG: log, SUPABASE_URL: SANDBOX });
    await c.wrap('llm', { q: 1 }, async () => 'x').catch(() => {});
    await c.wrap('llm', { q: 2 }, async () => 'y').catch(() => {});
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].kind).toBe('llm');
    expect(lines[0].key).toMatch(/^llm-[0-9a-f]{64}$/);
    expect(typeof lines[0].ts).toBe('string');
  });

  test('a hit is served from the library without calling the vendor', async () => {
    const dir = tmpDir();
    const rec = fresh({ E2E_CASSETTE: 'record', E2E_CASSETTE_DIR: dir, SUPABASE_URL: SANDBOX });
    await rec.wrap('llm', { q: 'same' }, async () => ({ text: 'stored' }));
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: dir, SUPABASE_URL: SANDBOX });
    const fn = jest.fn(async () => ({ text: 'live' }));
    await expect(c.wrap('llm', { q: 'same' }, fn)).resolves.toEqual({ text: 'stored' });
    expect(fn).not.toHaveBeenCalled();
  });

  test('wrapBuffer misses the same way', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: dir, SUPABASE_URL: SANDBOX });
    const fn = jest.fn(async () => Buffer.from('audio'));
    await expect(c.wrapBuffer('tts', { text: 'hello' }, fn)).rejects.toThrow(/E2E_CASSETTE_MISS/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('e2e-cassette: key is stable across volatile date tokens', () => {
  // The coaching analysis prompt embeds prior-observation feedback dated with
  // toLocaleDateString('en-US', numeric) → "M/D/YYYY" (e.g. "9/8/2026"). That date changes
  // day-to-day and run-to-run, so it must be blanked from the cassette KEY or a committed
  // fixture recorded today misses tomorrow. VOLATILE already blanks ISO and YYYY-MM-DD dates;
  // this asserts the same for the M/D/YYYY the coaching prompt actually uses.
  const mkPrompt = (date) => ({
    model: 'gpt-5-mini-2025-08-07',
    messages: [
      { role: 'system', content: 'You are a teacher coach.' },
      { role: 'user', content: `PRIOR FEEDBACK FROM PREVIOUS OBSERVATION(S):\nObservation ${date}:\nGrowth Areas: Effective Feedback (C3), Differentiation (B6)` },
    ],
  });

  test('two prompts differing only by an M/D/YYYY date hash to the same key', () => {
    const c = fresh({ E2E_CASSETTE: 'replay-strict', SUPABASE_URL: SANDBOX });
    const k1 = c.keyFor('llm', c.normaliseForKey(mkPrompt('9/8/2026')));
    const k2 = c.keyFor('llm', c.normaliseForKey(mkPrompt('9/14/2026')));
    expect(k1).toBe(k2);
  });

  test('a real fraction like 1/2 in a transcript is NOT blanked (not a date)', () => {
    const c = fresh({ E2E_CASSETTE: 'replay-strict', SUPABASE_URL: SANDBOX });
    const withHalf = c.normaliseForKey({ messages: [{ role: 'user', content: 'the cake is cut into 1/2 pieces' }] });
    expect(JSON.stringify(withHalf)).toContain('1/2');
  });
});
