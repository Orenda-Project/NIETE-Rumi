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
