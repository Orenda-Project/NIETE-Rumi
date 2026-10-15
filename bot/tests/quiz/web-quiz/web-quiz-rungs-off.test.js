'use strict';
/**
 * Golden: with app_settings `web_quiz_challenge_rungs` off (absent, false, or on under web_quiz_challenge_v2 off),
 * the Challenge's submit path is byte-identical to before the rung job: every event (name and payload) and every
 * database call (table, operation, payload) for a scored bigger run, a scored missing-number run under the record
 * rules, a reading that fails scoring, and a scored v2 row with events v2 on.
 * The snapshot was written by this file against the code BEFORE the change (origin/sandbox 86b03d07c, no rung job) and is committed; the change must keep
 * matching it. Supabase, R2, speech, the LLM client, Redis and the logger transport are the faked boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), logError: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}?X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true), sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const K = require('../../../shared/services/quiz/web-quiz-kid');

const KID = '44444444-4444-4444-8444-000000000001';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// Values that move with the wall clock or a random draw; their keys stay, so a key added or dropped still shows.
const VOLATILE = new Set(['elapsed_s', 'too_fast', 'kid', 'sitting']);

const V2_COLS = {
  mode: 'check', period_id: '2026-11', form: 'G3', band: null, exposure_no: 1, record: true, canonical_id: KID,
  id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false, via: 'quiz_card', helped: 'self',
};

let db;
let fake;
let stampV2 = false;
function seed(extra = []) {
  db = {
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_challenge', value: true }, ...extra],
    students: [{ id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '923001112223' }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [], student_videos: [], web_quiz_challenge_runs: [], child_rungs: [],
  };
  fake = makeFake(db);
  const from = fake.from;
  fake.from = (t) => {
    const b = from(t);
    if (t !== 'web_quiz_challenge_runs') return b;
    const insert = b.insert;
    b.insert = (row) => insert(stampV2 ? (Array.isArray(row) ? row.map((r) => ({ ...V2_COLS, ...r })) : { ...V2_COLS, ...row }) : row);
    return b;
  };
  Object.assign(supabase, fake);
}

const norm = (v, k = null) => {
  if (k && VOLATILE.has(k)) return '<v>';
  if (Array.isArray(v)) return v.map((x) => norm(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).map((kk) => [kk, norm(v[kk], kk)]));
  if (typeof v === 'string' && UUID_RX.test(v)) return '<uuid>';
  if (typeof v === 'string' && ISO_RX.test(v)) return '<ts>';
  if (typeof v === 'string') return v.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').replace(/read-\d{13}/g, 'read-<ms>');
  return v;
};
const trace = () => ({
  events: logEvent.mock.calls.map((c) => [c[0], norm(c[1])]),
  db: fake.calls.map((c) => norm(c)),
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'rungs-golden-secret';
  process.env.WEB_QUIZ_KID_KEY = 'test-only-kid-key-0123456789abcdef0123456789';
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
  process.env.CHILD_TEST_R2_ENV = 'sandbox';
  stampV2 = false;
  Hub._resetCache();
  Ch.__reset();
  K._reset();
  require('../../../shared/services/cache/railway-redis.service')._store.clear();
});

const OFF = [
  ['absent', []],
  ['false', [{ key: 'web_quiz_challenge_rungs', value: false }]],
  ['on under challenge v2 off', [{ key: 'web_quiz_challenge_rungs', value: true }]],
];
const RECORD_RULES = ['web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_items'].map((key) => ({ key, value: true }));
const allRight = (items) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2500 }));

describe('web_quiz_challenge_rungs off: the submit path is byte-identical', () => {
  test.each(OFF)('a scored bigger run (%s)', async (_label, extra) => {
    seed(extra);
    const ex = await Ch.exercise(T.signHub([KID]), 'bigger', { device: DEV });
    await Ch.submit({ ct: ex.ct, taps: allRight(ex.items), ms: 25000 });
    expect(trace()).toMatchSnapshot();
  });

  test.each(OFF)('a scored missing-number run under the record rules (%s)', async (_label, extra) => {
    seed([...RECORD_RULES, ...extra]);
    const ex = await Ch.exercise(T.signHub([KID]), 'missing', { device: DEV });
    const answers = ex.items.map((it, i) => ({ i, value: '7', ms: 3000, first_key_ms: 900, keys: 1 }));
    await Ch.submit({ ct: ex.ct, answers, ms: 30000, helped: 'self' });
    expect(trace()).toMatchSnapshot();
  });

  test.each(OFF)('a reading that fails scoring (%s)', async (_label, extra) => {
    seed(extra);
    const { ct } = await Ch.exercise(T.signHub([KID]), 'read', { device: DEV, lang: 'en' });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.downloadFromR2.mockRejectedValue(new Error('r2 down'));
    await Ch.submit({ ct, key, ms: 60000, lang: 'en' }, { waitMs: 60000 });
    expect(trace()).toMatchSnapshot();
  });

  test.each(OFF)('a scored v2 row with events v2 on (%s)', async (_label, extra) => {
    seed([{ key: 'web_quiz_events_v2', value: true }, ...extra]);
    stampV2 = true;
    const ex = await Ch.exercise(T.signHub([KID]), 'bigger', { device: DEV });
    await Ch.submit({ ct: ex.ct, taps: allRight(ex.items), ms: 25000 });
    expect(trace()).toMatchSnapshot();
  });
});
