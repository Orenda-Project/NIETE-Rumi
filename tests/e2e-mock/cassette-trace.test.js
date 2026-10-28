/**
 * Mock-lane profiling — the cassette seam times every vendor call it mediates.
 *
 * WHY. On the sealed lane every LLM / ASR / TTS call is a cassette replay, so "LLM time" in a mock
 * run is the replay cost, not what production pays. The record carries `liveMs` from the day it
 * was recorded; the trace line reports both, so the profile can say "this scenario replayed 4 LLM
 * answers in 12 ms that cost 18.4 s live". Off unless E2E_CASSETTE_TRACE_LOG is set.
 *
 * Red-first: fails on sandbox — the env var is unknown to e2e-cassette.js and no line is written.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = 'https://olvritwoqujtjvwfulbh.supabase.co';
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cassette-trace-'));
const fresh = (env) => {
  jest.resetModules();
  for (const k of ['E2E_CASSETTE', 'E2E_CASSETTE_DIR', 'E2E_CASSETTE_MISS_LOG', 'E2E_CASSETTE_TRACE_LOG', 'SUPABASE_URL', 'R2_BUCKET_NAME']) delete process.env[k];
  Object.assign(process.env, env);
  return require('../../bot/shared/services/e2e-cassette');
};
const lines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

describe('e2e-cassette: E2E_CASSETTE_TRACE_LOG', () => {
  test('a replay hit is traced with its replay ms and the recorded live ms', async () => {
    const dir = tmpDir(); const log = path.join(dir, 'cassette-trace.jsonl');
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: dir, E2E_CASSETTE_TRACE_LOG: log, SUPABASE_URL: SANDBOX });
    const parts = { model: 'x', messages: [{ role: 'user', content: 'hi' }] };
    const key = c.keyFor('llm', parts);
    fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify({ kind: 'llm', key, recordedAt: '2026-10-01T00:00:00Z', liveMs: 4321, request: {}, value: { answer: 1 } }));
    const fn = jest.fn(async () => 'live');
    const v = await c.wrap('llm', parts, fn);
    expect(v).toEqual({ answer: 1 });
    expect(fn).not.toHaveBeenCalled();
    const [row] = lines(log);
    expect(row).toMatchObject({ kind: 'llm', outcome: 'hit', liveMs: 4321, key });
    expect(typeof row.ms).toBe('number');
    expect(typeof row.ts).toBe('number');
  });

  test('a strict miss is traced as a miss before it throws', async () => {
    const dir = tmpDir(); const log = path.join(dir, 'cassette-trace.jsonl');
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: dir, E2E_CASSETTE_TRACE_LOG: log, SUPABASE_URL: SANDBOX });
    await expect(c.wrap('llm', { q: 1 }, async () => 'x')).rejects.toThrow(/E2E_CASSETTE_MISS/);
    const [row] = lines(log);
    expect(row).toMatchObject({ kind: 'llm', outcome: 'miss' });
  });

  test('a live call (record mode) is traced as live with the vendor ms', async () => {
    const dir = tmpDir(); const log = path.join(dir, 'cassette-trace.jsonl');
    const c = fresh({ E2E_CASSETTE: 'record', E2E_CASSETTE_DIR: dir, E2E_CASSETTE_TRACE_LOG: log, SUPABASE_URL: SANDBOX });
    await c.wrap('llm', { q: 2 }, async () => { await new Promise((r) => setTimeout(r, 30)); return 'y'; });
    const [row] = lines(log);
    expect(row).toMatchObject({ kind: 'llm', outcome: 'live' });
    expect(row.ms).toBeGreaterThanOrEqual(25);
  });

  test('a buffer replay (tts/asr) is traced too', async () => {
    const dir = tmpDir(); const log = path.join(dir, 'cassette-trace.jsonl');
    const c = fresh({ E2E_CASSETTE: 'replay-strict', E2E_CASSETTE_DIR: dir, E2E_CASSETTE_TRACE_LOG: log, SUPABASE_URL: SANDBOX });
    const parts = { provider: 'elevenlabs', text: 'salaam' };
    const key = c.keyFor('tts', parts);
    fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify({ kind: 'tts', key, recordedAt: '2026-10-01T00:00:00Z', liveMs: 900, request: {}, b64: Buffer.from('abc').toString('base64') }));
    const buf = await c.wrapBuffer('tts', parts, async () => Buffer.from('live'));
    expect(buf.toString()).toBe('abc');
    const [row] = lines(log);
    expect(row).toMatchObject({ kind: 'tts', outcome: 'hit', liveMs: 900 });
  });

  test('without the env var nothing is written and nothing changes', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'record', E2E_CASSETTE_DIR: dir, SUPABASE_URL: SANDBOX });
    await c.wrap('llm', { q: 3 }, async () => 'z');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))).toEqual([]);
  });
});
