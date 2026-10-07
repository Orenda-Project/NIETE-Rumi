'use strict';
/**
 * Read aloud, live: the phone streams to Soniox real-time with a temporary key the bot mints for ONE run
 * (single use, 30 s to connect, a 90-s session cap); the main key never leaves the server. Behind
 * app_settings `web_quiz_challenge_realtime` (off unless true). The recording still goes to the usual
 * scorer, which stays the number of record; the live count is kept beside it (meta.live, numbers only).
 * Soniox's HTTP API (global fetch), Supabase, R2, the STT call and the LLM are the faked boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key, type, ttl) => `https://r2.test/put/${key}?ct=${encodeURIComponent(type)}&ttl=${ttl}&X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key, ttl, { bucket } = {}) => `https://signed.test/${key}?b=${bucket}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
// The voice gateway's provider calls are the network boundary for the mascot's clips.
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
// Redis is a boundary: an in-memory SET NX / GET, so the hub's first-device binding (web-quiz-hub deviceTrusted) runs for real.
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const AudioService = require('../../../shared/services/audio.service');
const llm = require('../../../shared/services/llm-client');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-444444444444';
const KID2 = '55555555-5555-4555-8555-555555555555';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SESSION = '66666666-6666-4666-8666-666666666666';
const SC = '33333333-3333-4333-8333-333333333333';

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
beforeEach(() => {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST }, { id: KID2, list_id: LIST }],
    quiz_share_codes: [{ id: SC, language: 'en' }],
    quiz_sessions: [{ id: SESSION, student_id: KID, share_code_id: SC, quiz_id: 'q1' }],
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  jest.clearAllMocks();
});

// The family's phone (the first to open the hub link); every hub-token call below comes from it.
const DEV = 'FamilyPhoneDeviceRef_1';
const DEV_B = 'ForwardedToPhoneRef_22';
const D = { device: DEV };
const hub = (ids = [KID]) => T.sign({ k: 'h', ids, exp: Math.floor(Date.now() / 1000) + 3600 });
const st = () => T.signSession({ sessionId: SESSION, deviceRef: 'd'.repeat(22), shareCodeId: SC });
const expectFail = async (p, status, error) => {
  await expect(p).rejects.toMatchObject({ status, body: expect.objectContaining({ error }) });
};

// ── tokens ───────────────────────────────────────────────────────────────────

const LIVE = { key: 'web_quiz_challenge_realtime', value: true };
const FAKE_MAIN_KEY = 'main-key-test-only';
const okMint = () => ({ ok: true, status: 200, json: async () => ({ api_key: 'temp:abc-test-only', expires_at: '2026-10-07T10:00:30Z' }) });
let logger;
beforeEach(() => {
  process.env.SONIOX_API_KEY = FAKE_MAIN_KEY;
  global.fetch = jest.fn(async () => okMint());
  logger = require('../../../shared/utils/logger');
});
afterAll(() => { delete global.fetch; });

const readCt = async () => (await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).ct;

describe('the exercise says whether this run may go live', () => {
  test('flag absent ⇒ live false (today\'s path); flag true ⇒ live true; "Which is bigger?" never', async () => {
    expect((await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).live).toBe(false);
    db.app_settings.push(LIVE);
    Ch.__reset();
    expect((await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).live).toBe(true);
    expect((await Ch.exercise(hub(), 'bigger', { ...D, lang: 'en' })).live).toBeUndefined();
  });

  test('a live read carries the child\'s last checked words-a-minute for the bar\'s "last time" mark (null the first time)', async () => {
    db.app_settings.push(LIVE);
    expect((await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).previous_wcpm).toBeNull();
    db.web_quiz_challenge_runs.push({ id: 'p1', student_id: KID, exercise: 'read', lang: 'en', status: 'scored', wcpm: 44, score: { correct: 44 }, created_at: new Date().toISOString() });
    expect((await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).previous_wcpm).toBe(44);
  });

  test('the flag fails closed: a string other than true, or a failed read, is off', async () => {
    db.app_settings.push({ key: 'web_quiz_challenge_realtime', value: 'maybe' });
    expect((await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).live).toBe(false);
  });
});

describe('liveKey: a temporary Soniox key for one run', () => {
  test('flag off ⇒ 503 live_off, and Soniox is never called', async () => {
    const ct = await readCt();
    await expectFail(Ch.liveKey({ ct }), 503, 'live_off');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('mints a single-use key (30 s to connect, 90-s session, the run id as reference) with the server key, and returns only the temporary one', async () => {
    db.app_settings.push(LIVE);
    const ct = await readCt();
    const runId = T.verify(ct, 'c').r;
    const out = await Ch.liveKey({ ct });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.soniox.com/v1/auth/temporary-api-key');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE_MAIN_KEY}`);
    expect(JSON.parse(init.body)).toEqual({ usage_type: 'transcribe_websocket', expires_in_seconds: 30, single_use: true, max_session_duration_seconds: 90, client_reference_id: runId });
    expect(out).toEqual({ api_key: 'temp:abc-test-only', expires_at: '2026-10-07T10:00:30Z', ws: 'wss://stt-rt.soniox.com/transcribe-websocket', model: 'stt-rt-v5', lang: 'en' });
    expect(JSON.stringify(out)).not.toContain(FAKE_MAIN_KEY);
    // the mint is the reading's start: a run row, counted by the per-child and per-day caps
    expect(db.web_quiz_challenge_runs).toEqual([expect.objectContaining({ id: runId, student_id: KID, exercise: 'read', status: 'scoring', lang: 'en', meta: { phase: 'live' } })]);
    // a poll of a minted run that has no result yet is "not found", never "pending"
    await expectFail(Ch.poll(ct), 404, 'not_found');
    // neither key is ever logged
    const logged = JSON.stringify([logger.logToFile.mock.calls, logger.logError.mock.calls, require('../../../shared/utils/structured-logger').logEvent.mock.calls]);
    expect(logged).not.toContain('temp:abc');
    expect(logged).not.toContain(FAKE_MAIN_KEY);
  });

  test('one key per run: a second ask is 409 already_done and Soniox is not called again', async () => {
    db.app_settings.push(LIVE);
    const ct = await readCt();
    await Ch.liveKey({ ct });
    await expectFail(Ch.liveKey({ ct }), 409, 'already_done');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a child with 10 readings in the last 24 h, or the day\'s cap reached ⇒ 429, no key minted', async () => {
    db.app_settings.push(LIVE);
    for (let k = 0; k < 10; k += 1) db.web_quiz_challenge_runs.push({ id: `old${k}`, student_id: KID, exercise: 'read', status: 'scored', created_at: new Date().toISOString() });
    const ct = await readCt();
    await expectFail(Ch.liveKey({ ct }), 429, 'enough_for_today');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a "Which is bigger?" token or a forged token is refused', async () => {
    db.app_settings.push(LIVE);
    const { ct } = await Ch.exercise(hub(), 'bigger', { ...D, lang: 'en' });
    await expectFail(Ch.liveKey({ ct }), 400, 'no_audio');
    await expectFail(Ch.liveKey({ ct: 'x.y' }), 401, 'bad_token');
  });

  test('Soniox refuses or is down ⇒ 502 live_unavailable, the status logged, no run row (the page falls back to the upload path)', async () => {
    db.app_settings.push(LIVE);
    global.fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    const ct = await readCt();
    await expectFail(Ch.liveKey({ ct }), 502, 'live_unavailable');
    expect(logger.logError).toHaveBeenCalledWith('web_quiz.ch_live_key_failed', expect.objectContaining({ status: 429 }));
    expect(db.web_quiz_challenge_runs).toHaveLength(0);
    global.fetch = jest.fn(async () => { throw new Error('network down'); });
    await expectFail(Ch.liveKey({ ct }), 502, 'live_unavailable');
  });

  test('no server key configured ⇒ 503 live_unavailable without a network call', async () => {
    db.app_settings.push(LIVE);
    delete process.env.SONIOX_API_KEY;
    const ct = await readCt();
    await expectFail(Ch.liveKey({ ct }), 503, 'live_unavailable');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('a live run is scored as today and keeps the live count beside it', () => {
  const enTokens = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.tokens;
  const FF = require('@ffmpeg-installer/ffmpeg').path;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqlive-'));
  const clip = (secs) => {
    const f = path.join(dir, `s${secs}.webm`);
    if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(secs), '-c:a', 'libopus', f]);
    return fs.readFileSync(f);
  };
  const heard = (n, gap) => ({ text: '', tokens: enTokens().slice(0, n).map((w, k) => ({ text: ` ${w}`, start_ms: Math.round(k * gap * 1000), end_ms: Math.round((k * gap + gap * 0.8) * 1000), speaker: 1 })) });
  const marks = (verdicts) => ({ usage: { cost: 0.0021 }, choices: [{ message: { content: JSON.stringify({
    words: verdicts.map((v, k) => ({ i: k + 1, w: enTokens()[k], v })), words_correct: 0, words_attempted: 0, notes: '' }) } }] });

  test('after a mint, the one result is accepted (not "already done"), the checked count is the score, and meta.live holds the live numbers only', async () => {
    db.app_settings.push(LIVE);
    // 9 readings already today: the mint was the 10th and must not be refused at the result by its own row
    for (let k = 0; k < 9; k += 1) db.web_quiz_challenge_runs.push({ id: `old${k}`, student_id: KID, exercise: 'read', status: 'scored', created_at: new Date().toISOString() });
    const ct = await readCt();
    await Ch.liveKey({ ct });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.downloadFromR2.mockResolvedValue(clip(60));
    AudioService.transcribe.mockResolvedValue(heard(45, 1.3));
    llm.__create.mockResolvedValue(marks(enTokens().map((_, k) => (k < 42 ? 'correct' : k < 45 ? 'wrong' : 'skipped'))));
    const r = await Ch.submit({ ct, key, ms: 60000, live: { correct: 38, attempted: 44, secs: 60 } }, { waitMs: 60000 });
    expect(r).toMatchObject({ score: { correct: 42 }, wcpm: 42 });
    const runId = T.verify(ct, 'c').r;
    const rows = db.web_quiz_challenge_runs.filter((x) => x.id === runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'scored', wcpm: 42 });
    expect(rows[0].meta.live).toEqual({ correct: 38, attempted: 44, secs: 60, v: 1 });
    await expectFail(Ch.submit({ ct, key, ms: 60000 }), 409, 'already_done');
  });

  test('live numbers that cannot be true are dropped, never stored', async () => {
    db.app_settings.push(LIVE);
    const ct = await readCt();
    await Ch.liveKey({ ct });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.downloadFromR2.mockResolvedValue(clip(60));
    AudioService.transcribe.mockResolvedValue(heard(10, 1.3));
    llm.__create.mockResolvedValue(marks(enTokens().map((_, k) => (k < 10 ? 'correct' : 'skipped'))));
    await Ch.submit({ ct, key, ms: 60000, live: { correct: 999, attempted: 5, secs: 60, transcript: 'words' } }, { waitMs: 60000 });
    const row = db.web_quiz_challenge_runs.find((x) => x.id === T.verify(ct, 'c').r);
    expect(row.meta.live).toBeUndefined();
  });
});

describe('"last time" means the same passage: a reading compares only with readings in its own language', () => {
  const enTokens = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.tokens;
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  test('an English reading\'s growth line and the bar\'s mark use the last English reading, never a later Urdu one', async () => {
    db.app_settings.push(LIVE);
    db.web_quiz_challenge_runs.push(
      { id: 'en-old', student_id: KID, exercise: 'read', lang: 'en', status: 'scored', wcpm: 120, score: { correct: 60 }, created_at: ago(30) },
      { id: 'ur-new', student_id: KID, exercise: 'read', lang: 'ur', status: 'scored', wcpm: 163, score: { correct: 60 }, created_at: ago(5) },
    );
    expect((await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).previous_wcpm).toBe(120);
    expect((await Ch.exercise(hub(), 'read', { ...D, lang: 'ur' })).previous_wcpm).toBe(163);
    const FF = require('@ffmpeg-installer/ffmpeg').path;
    const f = path.join(os.tmpdir(), `wqlang-${process.pid}.webm`);
    if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '60', '-c:a', 'libopus', f]);
    const ct = await readCt();
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.downloadFromR2.mockResolvedValue(fs.readFileSync(f));
    AudioService.transcribe.mockResolvedValue({ text: '', tokens: enTokens().slice(0, 45).map((w, k) => ({ text: ` ${w}`, start_ms: k * 1300, end_ms: k * 1300 + 1000, speaker: 1 })) });
    llm.__create.mockResolvedValue({ usage: { cost: 0.002 }, choices: [{ message: { content: JSON.stringify({ words: enTokens().map((w, k) => ({ i: k + 1, w, v: k < 42 ? 'correct' : 'skipped' })), notes: '' }) } }] });
    const r = await Ch.submit({ ct, key, ms: 60000, lang: 'en' }, { waitMs: 60000 });
    expect(r.previous).toMatchObject({ wcpm: 120 });
  });
});

describe('every status a run is written with is one the table allows (its CHECK)', () => {
  test('mint, live result, and scoring write only statuses in web_quiz_challenge.sql\'s CHECK list', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'database', 'migrations', 'web_quiz_challenge.sql'), 'utf8');
    const allowed = /status\s+text NOT NULL CHECK \(status IN \(([^)]*)\)\)/.exec(sql)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(allowed.length).toBeGreaterThan(0);
    const writes = [];
    const realFrom = supabase.from;
    supabase.from = (t) => {
      const b = realFrom(t);
      const ins = b.insert; const upd = b.update;
      b.insert = (row) => { [].concat(row).forEach((r) => r.status && writes.push(r.status)); return ins(row); };
      b.update = (patch) => { if (patch && patch.status) writes.push(patch.status); return upd(patch); };
      return b;
    };
    try {
      db.app_settings.push(LIVE);
      const ct = await readCt();
      await Ch.liveKey({ ct });
      const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
      r2.downloadFromR2.mockResolvedValue(Buffer.from('not audio'));
      await Ch.submit({ ct, key, ms: 60000, live: { correct: 1, attempted: 1, secs: 5 } }, { waitMs: 60000 });
    } finally { supabase.from = realFrom; }
    expect(writes.length).toBeGreaterThanOrEqual(3);
    writes.forEach((st) => expect(allowed).toContain(st));
  });
});

describe('internal route POST /api/internal/wq/ch/live', () => {
  test('answers the temporary key, and a service error keeps its status', async () => {
    const express = require('express');
    const http = require('http');
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    const srv = http.createServer(app);
    await new Promise((r) => srv.listen(0, r));
    try {
      const ct = await readCt();
      const post = (body) => fetchLocal(srv, '/api/internal/wq/ch/live', body);
      const off = await post({ ct });
      expect(off.status).toBe(503);
      db.app_settings.push(LIVE);
      Ch.__reset();
      const on = await post({ ct });
      expect(on.status).toBe(200);
      expect(on.body.api_key).toBe('temp:abc-test-only');
    } finally { srv.close(); }
  });
});

function fetchLocal(srv, p, body) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-api-key': 'test-internal-key' } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { j = null; } resolve({ status: res.statusCode, body: j }); });
    });
    rq.on('error', reject); rq.end(data);
  });
}
