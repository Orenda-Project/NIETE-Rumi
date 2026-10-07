'use strict';
/**
 * A reading's row has two writers of meta: the checked score (when the background scoring finishes) and each tap
 * of the questions after reading (meta.comp). Each read the row, then wrote meta from that read, so a write that
 * landed in between was lost: a child answered 3 questions and the stored tally kept 2. Here the second writer is
 * made to land exactly between the first one's read and its write (at the database boundary), both ways round.
 * Supabase, R2, the STT call, the LLM and the voice gateway are the faked boundaries.
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
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
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
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SESSION = '66666666-6666-4666-8666-666666666666';
const SC = '33333333-3333-4333-8333-333333333333';
const D = { device: 'FamilyPhoneDeviceRef_1' };
const hub = () => T.sign({ k: 'h', ids: [KID], exp: Math.floor(Date.now() / 1000) + 3600 });
const runIdOf = (ct) => T.verify(ct, 'c').r;
const enStory = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' });

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
beforeEach(() => {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_questions', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST }],
    quiz_share_codes: [{ id: SC, language: 'en' }],
    quiz_sessions: [{ id: SESSION, student_id: KID, share_code_id: SC, quiz_id: 'q1' }],
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  jest.clearAllMocks();
});
afterEach(() => { delete global.fetch; });

/** The first update of a run row whose patch matches `pred` is held at the database until `other()` has finished. */
function landBetween(pred, other) {
  const from = supabase.from;
  let fired = false;
  supabase.from = (t) => {
    const b = from(t);
    if (t !== 'web_quiz_challenge_runs') return b;
    let held = false;
    const update = b.update;
    b.update = (patch) => { if (!fired && pred(patch)) { fired = true; held = true; } return update(patch); };
    const then = b.then;
    b.then = (res, rej) => (held ? Promise.resolve(other()).then(() => then(res, rej), rej) : then(res, rej));
    return b;
  };
  return () => fired;
}

test('the checked score lands between two taps: the tap answered in between is kept (and meta.live too)', async () => {
  db.app_settings.push({ key: 'web_quiz_challenge_realtime', value: true });
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ api_key: 'temp:k-test-only', expires_at: 'x' }) }));
  process.env.SONIOX_API_KEY = 'main-test-only';
  const ct = (await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).ct;
  await Ch.liveKey({ ct });
  const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
  const FF = require('@ffmpeg-installer/ffmpeg').path;
  const f = path.join(os.tmpdir(), `wqrace-${process.pid}.webm`);
  if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '60', '-c:a', 'libopus', f]);
  r2.downloadFromR2.mockResolvedValue(fs.readFileSync(f));
  const toks = enStory().story.tokens;
  AudioService.transcribe.mockResolvedValue({ text: '', tokens: toks.map((w, k) => ({ text: ` ${w}`, start_ms: k * 500, end_ms: k * 500 + 400, speaker: 1 })) });
  let release;
  const gate = new Promise((r) => { release = r; });
  llm.__create.mockImplementation(async () => { await gate; return { usage: { cost: 0.002 }, choices: [{ message: { content: JSON.stringify({ words: toks.map((w, k) => ({ i: k + 1, w, v: 'correct' })), notes: '' }) } }] }; });
  expect(await Ch.submit({ ct, key, ms: 30000, lang: 'en', live: { correct: 60, attempted: 60, secs: 30 } }, { waitMs: 0 })).toEqual({ pending: true });
  const qs = (await Ch.questions({ ct })).questions;
  await Ch.answer({ ct, q: qs[0].id, pick: 0 });
  // the second tap is written after the scorer has read the row and before its own write lands
  const hit = landBetween((p) => p.status === 'scored', () => Ch.answer({ ct, q: qs[1].id, pick: 1 }));
  release();
  for (let i = 0; i < 100 && (await Ch.poll(ct)).pending; i += 1) await new Promise((r) => setTimeout(r, 20));
  expect(hit()).toBe(true);
  const row = db.web_quiz_challenge_runs.find((r) => r.id === runIdOf(ct));
  expect(row.status).toBe('scored');
  expect(Object.keys(row.meta.comp.a).sort()).toEqual([qs[0].id, qs[1].id].map((q) => q.split('.').pop()).sort());
  expect(row.meta.comp.asked).toBe(2);
  expect(row.meta.live).toEqual({ correct: 60, attempted: 60, secs: 30, v: 1 });
});

test('a tap lands while another writer changes the row: the tap keeps that writer\'s keys (the score\'s meta)', async () => {
  const ct = (await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).ct;
  const id = runIdOf(ct);
  db.web_quiz_challenge_runs.push({ id, student_id: KID, exercise: 'read', lang: 'en', status: 'scoring', meta: { ms: 30000, live: { v: 1, correct: 60, attempted: 60, secs: 30 } }, created_at: new Date().toISOString() });
  const qs = (await Ch.questions({ ct, attempted: 60 })).questions;
  // the checked score (another replica) is written after this tap read the row and before the tap's write lands
  const hit = landBetween((p) => p.meta && p.meta.comp && !p.status, () => {
    const row = db.web_quiz_challenge_runs.find((r) => r.id === id);
    Object.assign(row, { status: 'scored', wcpm: 120, meta: { ...row.meta, seconds: 14, cost_usd: 0.005 } });
  });
  await Ch.answer({ ct, q: qs[0].id, pick: 0 });
  expect(hit()).toBe(true);
  const row = db.web_quiz_challenge_runs.find((r) => r.id === id);
  expect(row.meta).toMatchObject({ seconds: 14, cost_usd: 0.005, live: { v: 1, correct: 60, attempted: 60, secs: 30 } });
  expect(row.meta.comp).toMatchObject({ asked: 1, v: 1 });
});
