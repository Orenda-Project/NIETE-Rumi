'use strict';
/**
 * The runs table's provenance columns and its two new states (migration web_quiz_challenge_runs_v2.sql).
 *
 * A 'served' row is written when an exercise is served (before the child plays), an 'abandoned' one is a served row
 * nobody played. Neither is a reading or a play, so every reader written before them must not see them:
 *   - the class results (listResults) and the menu are byte-identical with such rows present and every new column NULL;
 *   - the child's ten-readings-a-day limit, the environment's daily read cap, and the record stamp
 *     (attempt_no / exposure_no / sequence_n) count only rows that reached scoring.
 *
 * Faked boundaries only: Supabase (in memory, filters applied), R2, Redis, logger; the challenge service runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000 })),
  presignKey: jest.fn(async () => null),
  getPresignedUploadUrl: jest.fn(async (k) => `https://r2.test/put/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
  downloadFromR2: jest.fn(async () => Buffer.from('x')),
}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return { _store: store, isAvailable: () => true, get: async (k) => (store.has(k) ? store.get(k) : null),
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; } };
});
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn(async () => { throw new Error('stt down'); }) }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-444444444444';
const KID2 = '55555555-5555-4555-8555-555555555555';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const HOUR = 3600 * 1000;
const at = (ms) => new Date(ms).toISOString();
const D = { device: 'RunsTestPhoneRef_00001' };
const hub = () => T.signHub([KID]);
// A reading handed in after its upload: the child's ten-a-day limit is checked here. Returns the refusal's status, or 'taken'.
const handIn = async () => {
  const ex = await Ch.exercise(hub(), 'read', D);
  const up = await Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 1000 });
  try { await Ch.submit({ ct: ex.ct, key: up.key, ms: 30000 }, { waitMs: 0 }); return 'taken'; } catch (e) { return e.status === 429 ? 429 : 'taken'; }
};

// Every column the migration adds, all NULL: what a row written before (or without) the v2 switch reads back as.
const V2_NULL = Object.freeze(Object.fromEntries([
  'bank_version', 'set', 'form', 'passage_id', 'item_set_id', 'mode', 'period_id', 'exposure_no', 'band',
  'anchor_exposure_no', 'anchor_block', 'homonym_in_list', 'draw_seed', 'canonical_id', 'id_src', 'id_confidence', 'via',
  'share_code_id', 'class_id', 'helped', 'record', 'scorer_v', 'started_at', 'audio_consent', 'audio_consent_at',
  'audio_consent_by', 'audio_keep_until',
].map((c) => [c, null])));

// A v2 row as the content engine will write it at serve time, before the child plays.
const v2Row = (id, student, exercise, status, when) => ({
  id, student_id: student, exercise, grade: 3, lang: 'en', status, score: null, wcpm: null, meta: {}, created_at: at(when), scored_at: null,
  bank_version: 'child-test-items-v4', set: 'A', form: 'G3', mode: 'check', period_id: '2026-10', exposure_no: 1, band: 1,
  homonym_in_list: false, canonical_id: student, id_src: 'roster_pick', id_confidence: 'high', via: 'hub', helped: 'self', record: true,
});

const oldRows = (now) => [
  { id: 'old-b1', student_id: KID, exercise: 'bigger', grade: 3, lang: 'en', status: 'scored', score: { correct: 8, n: 10 }, wcpm: null, meta: {}, created_at: at(now - 30 * HOUR), scored_at: at(now - 30 * HOUR) },
  { id: 'old-r1', student_id: KID, exercise: 'read', grade: 3, lang: 'en', status: 'scored', score: { correct: 31, attempted: 33 }, wcpm: 31, meta: {}, created_at: at(now - 29 * HOUR), scored_at: at(now - 29 * HOUR) },
  { id: 'old-b2', student_id: KID2, exercise: 'bigger', grade: 3, lang: 'en', status: 'scored', score: { correct: 6, n: 10 }, wcpm: null, meta: {}, created_at: at(now - 28 * HOUR), scored_at: at(now - 28 * HOUR) },
  { id: 'old-f1', student_id: KID2, exercise: 'read', grade: 3, lang: 'en', status: 'failed', score: null, wcpm: null, meta: { reason: 'stt' }, created_at: at(now - 27 * HOUR), scored_at: null },
];

// served / abandoned rows OLDER than every real play, so an "oldest first" reader that saw them would pick them
const servedRows = (now) => [
  v2Row('srv-b', KID, 'bigger', 'served', now - 40 * HOUR),
  v2Row('srv-r', KID, 'read', 'served', now - 40 * HOUR),
  v2Row('abn-b', KID2, 'bigger', 'abandoned', now - 41 * HOUR),
  v2Row('abn-r', KID2, 'read', 'abandoned', now - 41 * HOUR),
];

let db;
function seed(runs, extraSettings = []) {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }, ...extraSettings],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST, student_name: 'Sana Testwala' }, { id: KID2, list_id: LIST, student_name: 'Omar Testwala' }],
    class_enrollments: [],
    quiz_share_codes: [], quiz_sessions: [],
    web_quiz_challenge_runs: runs,
  };
  Object.assign(supabase, makeFake(db));
  redis._store.clear();
  Ch.__reset();
  jest.clearAllMocks();
}
const RECORD = { key: 'web_quiz_challenge_record', value: true };

beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });

describe('golden: readers are byte-identical with the new columns NULL and served/abandoned rows present', () => {
  test.each([['record off', []], ['record on', [RECORD]]])('listResults (%s)', async (_, flags) => {
    const now = Date.now();
    seed(oldRows(now), flags);
    const before = JSON.stringify(await Ch.listResults({ list: LIST }));
    seed([...oldRows(now).map((r) => ({ ...r, ...V2_NULL })), ...servedRows(now)], flags);
    const after = JSON.stringify(await Ch.listResults({ list: LIST }));
    expect(after).toBe(before);
    expect(JSON.parse(before).length).toBe(3);
  });

  test.each([['record off', []], ['record on', [RECORD]]])('the menu (%s)', async (_, flags) => {
    const now = Date.now();
    seed(oldRows(now), flags);
    const before = JSON.stringify(await Ch.menu(hub(), D));
    seed([...oldRows(now).map((r) => ({ ...r, ...V2_NULL })), ...servedRows(now)], flags);
    const after = JSON.stringify(await Ch.menu(hub(), D));
    expect(after).toBe(before);
  });
});

describe('served and abandoned rows are not readings', () => {
  test("ten served/abandoned reads today do not use up the child's ten readings a day", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 10 }, (_, i) => v2Row(`srv-${i}`, KID, 'read', i % 2 ? 'served' : 'abandoned', now - HOUR));
    seed(rows);
    expect(await handIn()).toBe('taken');
  });

  test('ten scored reads today still use them up (the limit itself is unchanged)', async () => {
    const now = Date.now();
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...v2Row(`r-${i}`, KID, 'read', 'scored', now - HOUR), score: { correct: 5 }, wcpm: 5 }));
    seed(rows);
    expect(await handIn()).toBe(429);
  });

  test("served/abandoned reads do not count toward the environment's daily read cap", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 3 }, (_, i) => v2Row(`srv-${i}`, `other-${i}`, 'read', 'served', now - 60 * 1000));
    seed(rows, [{ key: 'web_quiz_challenge_daily_reads', value: 3 }]);
    const ids = (await Ch.menu(hub(), D)).exercises.map((e) => e.id);
    expect(ids).toContain('read');
  });

  test('the record stamp (attempt_no, exposure_no, sequence_n) counts only rows that reached scoring', async () => {
    const now = Date.now();
    seed([v2Row('srv-b', KID, 'bigger', 'served', now - HOUR), v2Row('abn-b', KID, 'bigger', 'abandoned', now - HOUR)], [RECORD]);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    await Ch.submit({ ct: ex.ct, taps: ex.items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2500 })), ms: 25000 });
    const row = db.web_quiz_challenge_runs.find((r) => r.status === 'scored');
    expect(row.meta).toMatchObject({ attempt_no: 1, exposure_no: 1, counted: true, sequence_n: 1 });
  });
});
