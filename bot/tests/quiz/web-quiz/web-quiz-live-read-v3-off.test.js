'use strict';
/**
 * Live reading v3 switched OFF (app_settings `web_quiz_live_read_v3` absent), against a golden RECORDED FROM THE BASE:
 * fixtures/live-read-off-golden.json was written by this same file run on the sandbox tip before live reading v3
 * (the record step runs only when the file is missing). With the switch off, the menu, the read payload (English and
 * Urdu, real-time on) and the row a scored reading leaves must stay those bytes, whatever the page sends.
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
const D = { device: DEV };
const hub = (ids = [KID]) => T.sign({ k: 'h', ids, exp: Math.floor(Date.now() / 1000) + 3600 });


const GOLDEN = path.join(__dirname, 'fixtures', 'live-read-off-golden.json');
const FF = require('@ffmpeg-installer/ffmpeg').path;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqlr3off-'));
const clip = (secs) => {
  const f = path.join(dir, `s${secs}.webm`);
  if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(secs), '-c:a', 'libopus', f]);
  return fs.readFileSync(f);
};
const enTokens = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.tokens;
const heard = (n, gap) => ({ text: '', tokens: enTokens().slice(0, n).map((w, k) => ({ text: ` ${w}`, start_ms: Math.round(k * gap * 1000), end_ms: Math.round((k * gap + gap * 0.8) * 1000), speaker: 1 })) });
const marks = (verdicts) => ({ usage: { cost: 0.0021 }, choices: [{ message: { content: JSON.stringify({
  words: verdicts.map((v, k) => ({ i: k + 1, w: enTokens()[k], v })), words_correct: 0, words_attempted: 0, notes: '' }) } }] });
// what changes run to run (signed tokens, ids, clocks, storage keys) is masked; everything else is compared byte for byte
const VOLATILE = new Set(['ct', 'run', 'key', 'id', 'created_at', 'updated_at', 'started_at', 'scored_at', 'finished_at', 'expires_at', 'audio_key', 'audio_url', 'url', 'put_url', 'seconds']);
const stable = (o) => JSON.parse(JSON.stringify(o, (k, v) => (VOLATILE.has(k) ? '~' : (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? '~' : v))));

test('switch off: the menu, the read payload (EN and UR, real-time on) and a scored reading\'s row equal the base\'s', async () => {
  db.app_settings.push({ key: 'web_quiz_challenge_realtime', value: true });
  process.env.SONIOX_API_KEY = 'main-key-test-only';
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ api_key: 'temp:abc-test-only', expires_at: '2026-10-07T10:00:30Z' }) }));
  const out = {};
  out.menu_en = stable(await Ch.menu(hub(), { ...D, lang: 'en' }));
  out.menu_ur = stable(await Ch.menu(hub(), { ...D, lang: 'ur' }));
  out.read_ur = stable(await Ch.exercise(hub(), 'read', { ...D, lang: 'ur' }));
  const ex = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
  out.read_en = stable(ex);
  const { key } = await Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 500000 });
  r2.downloadFromR2.mockResolvedValue(clip(60));
  AudioService.transcribe.mockResolvedValue(heard(24, 1.3));
  llm.__create.mockResolvedValue(marks(enTokens().map((_, k) => (k < 20 ? 'correct' : k < 24 ? 'wrong' : 'skipped'))));
  // the page under v3 adds these; with the switch off they must leave no trace
  out.result = stable(await Ch.submit({ ct: ex.ct, key, ms: 60000, live_ui_v: 3, ended: 'quiet' }, { waitMs: 60000 }));
  const row = db.web_quiz_challenge_runs[0];
  out.row = stable({ status: row.status, exercise: row.exercise, wcpm: row.wcpm, score: row.score, record: row.record, meta: row.meta });
  delete global.fetch;
  if (!fs.existsSync(GOLDEN)) { fs.mkdirSync(path.dirname(GOLDEN), { recursive: true }); fs.writeFileSync(GOLDEN, `${JSON.stringify(out, null, 1)}\n`); }
  expect(JSON.stringify(out, null, 1)).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd());
});
