/**
 * E2E cassette — record/replay for the three vendor calls that make a coaching E2E run cost
 * 20+ minutes: Soniox transcription, every LLM chat completion, ElevenLabs TTS.
 *
 * Contract under test:
 *   1. mode() is 'off' unless E2E_CASSETTE is set, and is FORCED off when SUPABASE_URL points at the
 *      NIETE production project (ihzciabopbttygxxgrkm) — cassettes never touch prod.
 *   2. wrap() in 'off' mode calls through and stores nothing.
 *   3. 'record' calls through and stores the result under a key derived ONLY from the request
 *      (kind + stable JSON of the key parts) — key order in objects does not change the key.
 *   4. 'replay' returns the stored value WITHOUT calling the function; a miss calls through and
 *      records (so one slow run makes the next fast, and a prompt change is one slow run).
 *   5. A thrown error is never recorded; it propagates.
 *   6. Buffers survive the round trip (TTS audio), via the serialize/deserialize hooks.
 *   7. The LLM wrapper bypasses the cassette for streaming requests.
 *
 * Red-first: fails on develop — the module does not exist.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cassette-'));
const fresh = (env) => {
  jest.resetModules();
  for (const k of ['E2E_CASSETTE', 'E2E_CASSETTE_DIR', 'SUPABASE_URL', 'R2_BUCKET_NAME']) delete process.env[k];
  Object.assign(process.env, env);
  return require('../../shared/services/e2e-cassette');
};

describe('e2e-cassette: mode', () => {
  test('off by default', () => {
    const c = fresh({});
    expect(c.mode()).toBe('off');
  });
  test('honours E2E_CASSETTE=replay / record', () => {
    expect(fresh({ E2E_CASSETTE: 'replay', SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' }).mode()).toBe('replay');
    expect(fresh({ E2E_CASSETTE: 'record', SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' }).mode()).toBe('record');
  });
  test('is FORCED off against the NIETE production database, whatever the env var says', () => {
    const c = fresh({ E2E_CASSETTE: 'replay', SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' });
    expect(c.mode()).toBe('off');
  });
  test('an unknown value is off', () => {
    expect(fresh({ E2E_CASSETTE: 'yes' }).mode()).toBe('off');
  });
});

describe('e2e-cassette: keys', () => {
  test('same request → same key; key ignores object key order', () => {
    const c = fresh({});
    const a = c.keyFor('llm', { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], temperature: 0 });
    const b = c.keyFor('llm', { temperature: 0, messages: [{ content: 'hi', role: 'user' }], model: 'gpt-4o' });
    expect(a).toBe(b);
    expect(a).toMatch(/^llm-[0-9a-f]{64}$/);
  });
  test('different kind or different request → different key', () => {
    const c = fresh({});
    expect(c.keyFor('llm', { a: 1 })).not.toBe(c.keyFor('tts', { a: 1 }));
    expect(c.keyFor('llm', { a: 1 })).not.toBe(c.keyFor('llm', { a: 2 }));
  });
});

describe('e2e-cassette: wrap', () => {
  test('off: calls through every time, writes nothing', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE_DIR: dir });
    const fn = jest.fn(async () => ({ text: 'live' }));
    expect(await c.wrap('asr', { f: 1 }, fn)).toEqual({ text: 'live' });
    expect(await c.wrap('asr', { f: 1 }, fn)).toEqual({ text: 'live' });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  test('record: calls through and stores the result', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'record', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    const fn = jest.fn(async () => ({ text: 'recorded', language: 'ur' }));
    expect(await c.wrap('asr', { f: 1 }, fn)).toEqual({ text: 'recorded', language: 'ur' });
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    expect(saved.kind).toBe('asr');
    expect(saved.value).toEqual({ text: 'recorded', language: 'ur' });
    expect(typeof saved.recordedAt).toBe('string');
  });

  test('replay: a hit returns the stored value and does NOT call the function', async () => {
    const dir = tmpDir();
    const rec = fresh({ E2E_CASSETTE: 'record', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    await rec.wrap('asr', { f: 1 }, async () => ({ text: 'from-the-past' }));
    const rep = fresh({ E2E_CASSETTE: 'replay', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    const fn = jest.fn(async () => ({ text: 'live' }));
    expect(await rep.wrap('asr', { f: 1 }, fn)).toEqual({ text: 'from-the-past' });
    expect(fn).not.toHaveBeenCalled();
  });

  test('replay: a miss calls through and records, so the next call is a hit', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'replay', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    const fn = jest.fn(async () => ({ n: 1 }));
    expect(await c.wrap('llm', { p: 'x' }, fn)).toEqual({ n: 1 });
    expect(await c.wrap('llm', { p: 'x' }, fn)).toEqual({ n: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a thrown error propagates and is never recorded', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'record', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    await expect(c.wrap('llm', { p: 'boom' }, async () => { throw new Error('vendor down'); })).rejects.toThrow('vendor down');
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  test('Buffers round-trip through serialize/deserialize (TTS audio)', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'replay', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    const audio = Buffer.from([0xff, 0xf3, 0x00, 0x01, 0x7f]);
    const opts = { serialize: r => ({ b64: r.data.toString('base64'), status: r.status }),
                  deserialize: s => ({ data: Buffer.from(s.b64, 'base64'), status: s.status }) };
    const first = await c.wrap('tts', { text: 'سلام' }, async () => ({ data: audio, status: 200 }), opts);
    expect(Buffer.isBuffer(first.data)).toBe(true);
    const second = await c.wrap('tts', { text: 'سلام' }, async () => { throw new Error('must not be called'); }, opts);
    expect(Buffer.isBuffer(second.data)).toBe(true);
    expect(second.data.equals(audio)).toBe(true);
    expect(second.status).toBe(200);
  });
});

describe('e2e-cassette: LLM client wrapper', () => {
  test('wrapChatCompletions replays a non-streaming completion and bypasses streaming ones', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'replay', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    const create = jest.fn(async (params) => ({ id: 'cmpl', choices: [{ message: { content: 'answer:' + params.model } }] }));
    const client = { chat: { completions: { create } } };
    c.wrapChatCompletions(client);
    const p = { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'q' }] };
    const r1 = await client.chat.completions.create(p);
    const r2 = await client.chat.completions.create({ ...p });
    expect(r2).toEqual(r1);
    expect(create).toHaveBeenCalledTimes(1);
    await client.chat.completions.create({ ...p, stream: true });
    await client.chat.completions.create({ ...p, stream: true });
    expect(create).toHaveBeenCalledTimes(3);   // streaming never goes through the cassette
  });
});
