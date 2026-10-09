'use strict';
/**
 * Keeping the Challenge's readings (app_settings `web_quiz_challenge_keep_audio`): off ⇒ a reading is scored and
 * deleted, as today; on ⇒ it is uploaded to child-voice/<env>/kept/<YYYY-MM-DD>/<run>/, scoring keeps it, the run
 * row says where it is (meta.audio_key), the orphan sweep leaves it, and only the purge script removes it.
 * Faked boundaries only (Supabase, R2, speech, the LLM client); the service, tokens, bank and scorer run for real.
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
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
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
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-444444444444';
const KID2 = '55555555-5555-4555-8555-555555555555';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SESSION = '66666666-6666-4666-8666-666666666666';
const SC = '33333333-3333-4333-8333-333333333333';
const RECORD = { key: 'web_quiz_challenge_record', value: true };
const GUARD = { key: 'web_quiz_challenge_read_guard', value: true };
const ITEMS = { key: 'web_quiz_challenge_items', value: true };
const KEEP = { key: 'web_quiz_challenge_keep_audio', value: true };

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
beforeEach(() => {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST, student_name: 'Sana Testwala' }, { id: KID2, list_id: LIST, student_name: 'Omar Khan' }],
    quiz_share_codes: [{ id: SC, language: 'en' }],
    quiz_sessions: [{ id: SESSION, student_id: KID, share_code_id: SC, quiz_id: 'q1' }],
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  jest.clearAllMocks();
});

const DEV = 'FamilyPhoneDeviceRef_1';
const D = { device: DEV };
const hub = (ids = [KID]) => T.sign({ k: 'h', ids, exp: Math.floor(Date.now() / 1000) + 3600 });
const on = (...flags) => flags.forEach((f) => db.app_settings.push(f));

// "Which is bigger?": the served pairs answered right (or a given way), one tap each.
const spec3 = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.discrimination' });
const allRight = (items, ms = 2500) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms }));
const bigger = async (taps, extra = {}, opts = {}) => {
  const ex = await Ch.exercise(hub(), 'bigger', D);
  const r = await Ch.submit({ ct: ex.ct, taps: typeof taps === 'function' ? taps(ex.items) : taps, ms: 25000, ...extra }, opts);
  return { ex, r, row: db.web_quiz_challenge_runs[db.web_quiz_challenge_runs.length - 1] };
};

// Read aloud: a silent clip of `secs` seconds, Soniox heard `n` words, the LLM marked `verdicts`.
const FF = require('@ffmpeg-installer/ffmpeg').path;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqrec-'));
const clip = (secs) => {
  const f = path.join(dir, `s${secs}.webm`);
  if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(secs), '-c:a', 'libopus', f]);
  return fs.readFileSync(f);
};
const enTokens = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.tokens;
const heard = (n, gap, from = 0) => ({ text: '', tokens: enTokens().slice(0, n).map((w, k) => ({ text: ` ${w}`, start_ms: Math.round((from + k * gap) * 1000), end_ms: Math.round((from + k * gap + gap * 0.8) * 1000), speaker: 1 })) });
const marks = (verdicts) => ({ usage: { cost: 0.0021 }, choices: [{ message: { content: JSON.stringify({
  words: verdicts.map((v, k) => ({ i: k + 1, w: enTokens()[k], v })), words_correct: 0, words_attempted: 0, notes: '' }) } }] });
const verdicts = (right, tried) => enTokens().map((_, k) => (k < right ? 'correct' : k < tried ? 'wrong' : 'skipped'));
const read = async ({ secs, n, gap = 1.3, right, tried, body = {}, from = 0 }) => {
  const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
  const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
  r2.downloadFromR2.mockResolvedValue(clip(secs));
  AudioService.transcribe.mockResolvedValue(heard(n, gap, from));
  llm.__create.mockResolvedValue(marks(verdicts(right, tried)));
  const r = await Ch.submit({ ct, key, ms: secs * 1000, lang: 'en', ...body }, { waitMs: 60000 });
  return { ct, r, row: db.web_quiz_challenge_runs.find((x) => x.exercise === 'read' && x.id === T.verify(ct, 'c').r) };
};


const KEPT_RX = (run) => new RegExp(`^child-voice/sandbox/kept/\\d{4}-\\d{2}-\\d{2}/${run}/read-\\d{13}\\.webm$`);
const runOf = (ct) => T.verify(ct, 'c').r;
const upKey = () => r2.getPresignedUploadUrl.mock.calls[0][0];
const deleted = () => r2.deleteKey.mock.calls.map((c) => c[0]);

describe('keep off: scored and deleted, as today', () => {
  test('the upload key is the run prefix, the reading is deleted after scoring, the row names no audio', async () => {
    const { ct, row } = await read({ secs: 60, n: 40, right: 38, tried: 40 });
    const key = upKey();
    expect(key).toMatch(new RegExp(`^child-voice/sandbox/${runOf(ct)}/read-\\d{13}\\.webm$`));
    expect(deleted()).toContain(key);
    expect(row.status).toBe('scored');
    expect(row.meta).not.toHaveProperty('audio_key');
  });
});

describe('keep on: the reading stays, private, dated, and the row says where', () => {
  test('presign puts it under child-voice/<env>/kept/<today>/<run>/ in the child-voice bucket', async () => {
    on(KEEP);
    const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    const u = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    expect(u.key).toMatch(KEPT_RX(runOf(ct)));
    expect(u.key.split('/')[3]).toBe(new Date().toISOString().slice(0, 10));
    expect(r2.getPresignedUploadUrl).toHaveBeenLastCalledWith(u.key, 'audio/webm', 180, { bucket: 'r2-default', signContentType: true });
  });

  test('scoring keeps the reading — and anything else under its kept prefix; meta.audio_key is the key', async () => {
    on(KEEP);
    r2.listKeys.mockImplementation(async (prefix) => (prefix.includes('/kept/') ? [`${prefix}read-1111111111111.webm`] : []));
    const { ct, r, row } = await read({ secs: 60, n: 40, right: 38, tried: 40 });
    const key = upKey();
    expect(key).toMatch(KEPT_RX(runOf(ct)));
    expect(r.wcpm).toBeGreaterThan(0);
    expect(deleted()).not.toContain(key);
    expect(deleted()).toEqual([]);
    expect(row.status).toBe('scored');
    expect(row.meta.audio_key).toBe(key);
    r2.listKeys.mockImplementation(async () => []);
  });

  test('a reading that failed to score (nothing heard) is kept too, and its row points at it', async () => {
    on(KEEP);
    const { row } = await read({ secs: 60, n: 0, right: 0, tried: 0 });
    const key = upKey();
    expect(row.status).toBe('failed');
    expect(row.meta.reason).toBe('unheard');
    expect(row.meta.audio_key).toBe(key);
    expect(deleted()).not.toContain(key);
  });

  test('with the record rule on, the final write keeps audio_key beside the stamps', async () => {
    on(KEEP, { key: 'web_quiz_challenge_record', value: true });
    const { row } = await read({ secs: 60, n: 40, right: 38, tried: 40 });
    expect(row.meta.audio_key).toBe(upKey());
    expect(row.meta.attempt_no).toBe(1);
  });

  test('a kept upload the server refuses (too large) is refused and still kept: only the purge deletes under kept/', async () => {
    on(KEEP);
    const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.headObject.mockResolvedValueOnce({ exists: true, sizeBytes: 9 * 1024 * 1024 });
    await expect(Ch.submit({ ct, key, ms: 60000, lang: 'en' })).rejects.toMatchObject({ status: 413 });
    expect(deleted()).toEqual([]);
  });

  test('a kept key of another run is refused and never deleted', async () => {
    on(KEEP);
    const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    const other = 'child-voice/sandbox/kept/2026-10-09/another-run/read-1234567890123.webm';
    await expect(Ch.submit({ ct, key: other, ms: 1 })).rejects.toMatchObject({ status: 403 });
    expect(deleted()).not.toContain(other);
  });

  test('switched on after a plain upload: that reading is still deleted, and the row says it was not kept', async () => {
    const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    on(KEEP);
    Ch.__reset();
    r2.downloadFromR2.mockResolvedValue(clip(60));
    AudioService.transcribe.mockResolvedValue(heard(40, 1.3));
    llm.__create.mockResolvedValue(marks(verdicts(38, 40)));
    await Ch.submit({ ct, key, ms: 60000, lang: 'en' }, { waitMs: 60000 });
    expect(deleted()).toContain(key);
    const row = db.web_quiz_challenge_runs.find((x) => x.id === runOf(ct));
    expect(row.meta.audio_kept).toBe(false);
    expect(row.meta).not.toHaveProperty('audio_key');
  });

  test('switched off after the upload: the kept key is still accepted and still kept', async () => {
    on(KEEP);
    const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    db.app_settings = db.app_settings.filter((s) => s.key !== KEEP.key);
    Ch.__reset();
    r2.downloadFromR2.mockResolvedValue(clip(60));
    AudioService.transcribe.mockResolvedValue(heard(40, 1.3));
    llm.__create.mockResolvedValue(marks(verdicts(38, 40)));
    await Ch.submit({ ct, key, ms: 60000, lang: 'en' }, { waitMs: 60000 });
    expect(deleted()).not.toContain(key);
    expect(db.web_quiz_challenge_runs.find((x) => x.id === runOf(ct)).meta.audio_key).toBe(key);
  });
});

describe('the orphan sweep never takes a kept reading', () => {
  test('an hour-old kept reading is listed and left; an hour-old plain orphan is deleted', async () => {
    const now = Date.now();
    const kept = `child-voice/sandbox/kept/2026-10-09/run-k/read-${now - 60 * 60 * 1000}.webm`;
    const orphan = `child-voice/sandbox/run-o/read-${now - 60 * 60 * 1000}.webm`;
    r2.listKeys.mockResolvedValueOnce([kept, orphan]);
    const out = await Ch.sweepOrphans({ now });
    expect(deleted()).toEqual([orphan]);
    expect(out).toEqual({ listed: 2, deleted: 1, failed: 0 });
  });
});

describe('the purge: dry run first, counts only, one env, one prefix', () => {
  const { purgeKept, parseArgs } = require('../../../scripts/quiz/purge-kept-child-voice');
  const keys = [
    'child-voice/sandbox/kept/2026-10-08/r1/read-1111111111111.webm',
    'child-voice/sandbox/kept/2026-10-09/r2/read-2222222222222.webm',
    'child-voice/sandbox/kept/2026-10-09/r3/read-3333333333333.ogg',
    'child-voice/sandbox/kept/2026-10-10/r4/read-4444444444444.webm',
    'child-voice/sandbox/kept/notes.txt',
  ];
  const fakeR2 = () => ({ listKeys: jest.fn(async () => keys), deleteKey: jest.fn(async () => true) });

  test('dry run: counts per upload day, deletes nothing', async () => {
    const r = fakeR2();
    const out = await purgeKept({ env: 'sandbox', r2: r, bucket: 'b', ownEnv: 'sandbox' });
    expect(r.listKeys).toHaveBeenCalledWith('child-voice/sandbox/kept/', { bucket: 'b' });
    expect(r.deleteKey).not.toHaveBeenCalled();
    expect(out).toEqual({ env: 'sandbox', from: null, to: null, apply: false, listed: 5, matched: 4, by_day: { '2026-10-08': 1, '2026-10-09': 2, '2026-10-10': 1 }, deleted: 0, failed: 0, rows_cleared: 0 });
    expect(JSON.stringify(out)).not.toMatch(/read-|r1|r2/);
  });

  test('--from/--to narrow it; --apply deletes exactly the counted ones and clears each run row', async () => {
    const r = fakeR2();
    const clearRow = jest.fn(async () => true);
    const out = await purgeKept({ env: 'sandbox', from: '2026-10-09', to: '2026-10-09', apply: true, r2: r, bucket: 'b', clearRow, ownEnv: 'sandbox' });
    expect(out.matched).toBe(2);
    expect(out.deleted).toBe(2);
    expect(out.rows_cleared).toBe(2);
    expect(r.deleteKey.mock.calls.map((c) => c[0])).toEqual([keys[1], keys[2]]);
    expect(clearRow.mock.calls).toEqual([['r2', keys[1]], ['r3', keys[2]]]);
  });

  test('a dry run clears no row', async () => {
    const clearRow = jest.fn(async () => true);
    await purgeKept({ env: 'sandbox', r2: fakeR2(), bucket: 'b', clearRow, ownEnv: 'sandbox' });
    expect(clearRow).not.toHaveBeenCalled();
  });

  test('the row write: a purged reading\'s row no longer names it; a row naming another key is left alone', async () => {
    on(KEEP);
    const { ct, row } = await read({ secs: 60, n: 40, right: 38, tried: 40 });
    const key = upKey();
    expect(await Ch.forgetAudioKey(runOf(ct), 'child-voice/sandbox/kept/2026-10-09/x/read-1.webm')).toBe(false);
    expect(row.meta.audio_key).toBe(key);
    expect(await Ch.forgetAudioKey(runOf(ct), key, { now: Date.parse('2026-12-01T10:00:00Z') })).toBe(true);
    const after = db.web_quiz_challenge_runs.find((x) => x.id === runOf(ct));
    expect(after.meta.audio_key).toBeNull();
    expect(after.meta.audio_purged_on).toBe('2026-12-01');
    expect(after.status).toBe('scored');
  });

  test('refuses without --env, with another deployment\'s env, or a malformed day', async () => {
    const r = fakeR2();
    await expect(purgeKept({ r2: r, bucket: 'b', ownEnv: 'sandbox' })).rejects.toThrow(/--env is required/);
    await expect(purgeKept({ env: 'production', r2: r, bucket: 'b', ownEnv: 'staging' })).rejects.toThrow(/not this deployment/);
    await expect(purgeKept({ env: 'sandbox', from: '9 Oct', r2: r, bucket: 'b', ownEnv: 'sandbox' })).rejects.toThrow(/YYYY-MM-DD/);
    expect(r.listKeys).not.toHaveBeenCalled();
  });

  test('arguments: dry run unless --apply', () => {
    expect(parseArgs(['--env', 'staging'])).toEqual({ env: 'staging', from: null, to: null, apply: false });
    expect(parseArgs(['--env', 'staging', '--apply']).apply).toBe(true);
    expect(() => parseArgs(['--force'])).toThrow(/unknown argument/);
  });
});
