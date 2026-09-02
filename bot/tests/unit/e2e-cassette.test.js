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


describe('e2e-cassette: wrapBuffer (TTS at the provider-agnostic seam)', () => {
  // The worker's Urdu voice does not go through ElevenLabs' _postTts — generateSpeechForLanguage
  // routes by voiceConfig.provider (elevenlabs | uplift | openai fallback). The record run of
  // 2026-09-02 18:00Z showed 0 tts cassette lines from the worker for that reason. The seam has to
  // be the Buffer-returning function itself, whatever provider it picks.
  test('replays a Buffer-returning function; the second call never reaches the provider', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'replay', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    const audio = Buffer.from('ID3 fake-mp3-bytes', 'binary');
    const live = jest.fn(async () => audio);
    const a = await c.wrapBuffer('tts', { text: 'shabash', languageCode: 'ur' }, live);
    const b = await c.wrapBuffer('tts', { languageCode: 'ur', text: 'shabash' }, live);
    expect(live).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(a)).toBe(true);
    expect(Buffer.isBuffer(b)).toBe(true);
    expect(b.equals(audio)).toBe(true);
  });
  test('a null/undefined result is passed through and not recorded', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'replay', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    const live = jest.fn(async () => null);
    expect(await c.wrapBuffer('tts', { text: 'x' }, live)).toBeNull();
    expect(await c.wrapBuffer('tts', { text: 'x' }, live)).toBeNull();
    expect(live).toHaveBeenCalledTimes(2);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});


describe('e2e-cassette: key normalisation for volatile prompt content', () => {
  // The record run stored the SAME reflective-question call twice (17:48 and 18:14) under different
  // keys: the prompt carries per-run content — ISO timestamps, UUIDs (session ids), "today" dates —
  // that changes nothing about the answer we want replayed. normaliseForKey() blanks those tokens
  // inside string leaves before hashing, so the key follows the request's SUBSTANCE.
  test('UUIDs, ISO timestamps and dates inside strings do not change the key', () => {
    const c = fresh({});
    const mk = (uuid, iso, date) => ({ model: 'm', messages: [{ role: 'system', content: 'Session ' + uuid + ' at ' + iso + ' on ' + date + '. Transcript: the teacher said hello.' }] });
    const a = c.keyFor('llm', c.normaliseForKey(mk('4f1cb316-061b-458a-a828-0cdc9f31225b', '2026-09-02T17:48:29.123Z', '2026-09-02')));
    const b = c.keyFor('llm', c.normaliseForKey(mk('ed353b3a-7b50-4429-b47d-c9b3a5ac82d0', '2026-09-03T05:01:10.000Z', '2026-09-03')));
    expect(a).toBe(b);
  });
  test('different substance still gives a different key', () => {
    const c = fresh({});
    const a = c.keyFor('llm', c.normaliseForKey({ messages: [{ content: 'Transcript: hello' }] }));
    const b = c.keyFor('llm', c.normaliseForKey({ messages: [{ content: 'Transcript: goodbye' }] }));
    expect(a).not.toBe(b);
  });
  test('wrapChatCompletions keys by the normalised params', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'replay', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    const create = jest.fn(async () => ({ choices: [{ message: { content: 'same answer' } }] }));
    const client = { chat: { completions: { create } } };
    c.wrapChatCompletions(client);
    await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'session 4f1cb316-061b-458a-a828-0cdc9f31225b at 2026-09-02T17:48:29Z' }] });
    await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'session ed353b3a-7b50-4429-b47d-c9b3a5ac82d0 at 2026-09-03T05:01:10Z' }] });
    expect(create).toHaveBeenCalledTimes(1);
  });
  test('the record keeps a sanitised copy of the request so a miss can be diagnosed', async () => {
    const dir = tmpDir();
    const c = fresh({ E2E_CASSETTE: 'record', E2E_CASSETTE_DIR: dir, SUPABASE_URL: 'https://rpqkekcfvumypldbejhp.supabase.co' });
    await c.wrap('llm', { model: 'm', messages: [{ role: 'user', content: 'q' }] }, async () => ({ ok: 1 }));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
    expect(saved.request).toEqual({ model: 'm', messages: [{ role: 'user', content: 'q' }] });
  });
});
