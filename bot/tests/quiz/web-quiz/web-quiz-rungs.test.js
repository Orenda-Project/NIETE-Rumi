'use strict';
/**
 * The rung job (web-quiz-rungs.js), app_settings `web_quiz_challenge_rungs` (effective only with web_quiz_challenge_v2
 * and its parent web_quiz_challenge on); its event web_quiz.lamp_lit also needs web_quiz_events_v2 (parent web_quiz_hub).
 *
 *   computeRung  the highest rung met on a ladder under badges-v1, from record rows only; every rung edge (just under
 *                and at) from the contract text, both grade bands, grade 1; rungs chain and a row may light several
 *   eligible     only mode='check' record rows with a final status (scored | failed); never practice, Story Time,
 *                a teacher device's preview, a class round, a replay, a served or abandoned row
 *   onRecordFinal  up only; at most one child_rungs row per child × ladder × stop × period (the DB refuses a second); the
 *                event only after the insert; switch off ⇒ no query to the runs or the lamps table; never throws
 *   the hook     a scored run stored by the Challenge reaches the job (web-quiz-challenge.js measureOutcome)
 * Faked boundaries only: Supabase, R2, speech, the LLM client, Redis, WhatsApp, the logger transport.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
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
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
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
const { logEvent } = require('../../../shared/utils/structured-logger');
const { logError } = require('../../../shared/utils/logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const K = require('../../../shared/services/quiz/web-quiz-kid');
const R = require('../../../shared/services/quiz/web-quiz-rungs');

const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';

// ── row builders (synthetic record rows, the runs migration's columns) ───────────────────────────────
let seq = 0;
const rid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const base = (over = {}) => ({
  id: rid(), student_id: KID, canonical_id: KID, mode: 'check', record: true, status: 'scored', period_id: '2026-11',
  form: 'G3', grade: 3, lang: 'en', exposure_no: 1, created_at: '2026-11-03T10:00:00Z', meta: {}, ...over,
});
/** A reading: band, words per minute (0 = a line-1 stop / 0 words), comprehension asked / right. */
const read = (band, wcpm, asked = 0, right = 0, over = {}) => base({
  exercise: 'read', band, wcpm, meta: asked ? { comp: { asked, correct: right } } : {}, passage_id: `en.read.${band}.p`, ...over,
});
const listen = (asked = 3, right = 0, over = {}) => base({ exercise: 'listen', band: 1, wcpm: null, meta: { comp: { asked, correct: right } }, ...over });
/** The A1 anchor (warm-up) row: oks = 10 booleans for items 1–10 (ok_5s deliberately false everywhere). */
const anchor = (oks, over = {}) => base({
  exercise: 'missing', anchor_block: 'A1', anchor_exposure_no: 1,
  meta: { items: oks.map((ok, i) => ({ i: i + 1, verdict: ok ? 'correct' : 'wrong', ok, ok_5s: false })) }, ...over,
});
/** The bigger stop: oks for pairs 1–6 (and four more pairs wrong). */
const bigger = (oks, over = {}) => base({
  exercise: 'bigger', meta: { items: [...oks, false, false, false, false].map((ok, i) => ({ i: i + 1, ok, ms: 2000 })) }, ...over,
});
const n6 = (k) => Array.from({ length: 6 }, (_, i) => i < k);
const n4 = (k) => Array.from({ length: 4 }, (_, i) => i < k);
const A = (six, four) => [...n6(six), ...n4(four)];
const G5 = { form: 'G5', grade: 5 };
const g5 = (row) => ({ ...row, ...G5 });

const rung = (ladder, rows, ctx) => R.computeRung(ladder, rows, ctx);

describe('computeRung · Reading, grades 2–3 (L = 1, U = 2)', () => {
  test.each([
    ['no rows', [], 0],
    ['R1: a listen with 0 right', [listen(3, 0)], 1],
    ['R1: a 0-word reading (scored, wcpm 0)', [read(1, 0)], 1],
    ['R1: a failed reading (lost after the mic)', [read(1, null, 0, 0, { status: 'failed' })], 1],
    ['R1 only: a swept reading (failed, swept) on band 1', [read(1, 40, 3, 3, { status: 'failed', meta: { fail_reason: 'stt_timeout', comp: { asked: 3, correct: 3 } } })], 1],
    ['R2: band 1, past line 1 (wcpm 1), no questions', [read(1, 1)], 2],
    ['R2 just under R3: asked 2, right 1', [read(1, 30, 2, 1)], 2],
    ['R2, R3 waits: asked 1, right 1 (the app delivered one question)', [read(1, 30, 1, 1)], 2],
    ['R3 at the edge: asked 2, right 2', [read(1, 30, 2, 2)], 3],
    ['R1+R2+R3 from one row: 2 of 3 right', [read(1, 30, 3, 2)], 3],
    ['R2 needs band 1 for grades 2–3: a band-2 read past line 1 alone is R1 (rungs never skip)', [read(2, 30, 3, 3)], 1],
    ['R3 needs the same row: R2 on one row, 2/2 on a line-1 stop', [read(1, 30), read(1, 0, 2, 2)], 2],
    ['R4 just under: R3, then a band-2 line-1 stop', [read(1, 30, 2, 2), read(2, 0)], 3],
    ['R4 at the edge: R3, then band 2 past line 1', [read(1, 30, 2, 2), read(2, 1)], 4],
    ['R4 just under R5: band 2 with asked 2 right 1', [read(1, 30, 2, 2), read(2, 30, 2, 1)], 4],
    ['R5 at the edge: band 2 with asked 2 right 2', [read(1, 30, 2, 2), read(2, 30, 2, 2)], 5],
    ['a listen never lights R3/R5: 3 of 3 right', [listen(3, 3)], 1],
    ['a listen beside R2 adds nothing', [read(1, 30), listen(3, 3)], 2],
    ['a band-3 read past line 1 is not R4 for grades 2–3', [read(1, 30, 2, 2), read(3, 30, 2, 2)], 3],
    // the draw's own line-1 rule (web-quiz-challenge-draw.js isLine1OrZero), not wcpm alone
    ['a line-1 stop with a few words (meta.stop_line 1, wcpm 4) is R1, not R2', [read(1, 4, 0, 0, { meta: { stop_line: 1 } })], 1],
    ['a stopped reading (score.stopped, wcpm 4) is R1, not R2', [read(1, 4, 0, 0, { score: { stopped: true, attempted: 3 } })], 1],
    ['R2 still waits after a line-1 stop with 2/2: R3 needs R2 on the same row', [read(1, 4, 2, 2, { meta: { stop_line: 1, comp: { asked: 2, correct: 2 } } })], 1],
    ['a reading that went past line 1 (stop_line 2) is R2', [read(1, 12, 0, 0, { meta: { stop_line: 2 } })], 2],
  ])('%s → R%s', (_label, rows, want) => {
    expect(rung('reading', rows)).toBe(want);
  });
});

describe('computeRung · Reading, grades 4–5 (L = 2, U = 3)', () => {
  test.each([
    ['R1: a 0-word reading', [g5(read(2, 0))], 1],
    ['R2: band 2 past line 1', [g5(read(2, 1))], 2],
    ['R2: a band-1 read after a line-1 stop counts', [g5(read(2, 0)), g5(read(1, 20))], 2],
    ['R2, not R3: band 1 with 2/2 (R3 needs band 2)', [g5(read(1, 20, 2, 2))], 2],
    ['R3 just under: band 2, asked 2 right 1', [g5(read(2, 20, 2, 1))], 2],
    ['R3 at the edge: band 2, asked 2 right 2', [g5(read(2, 20, 2, 2))], 3],
    ['R3: a band-2 read lights R2 and R3 together', [g5(read(2, 20, 3, 2))], 3],
    ['R4 just under: R3, band-3 line-1 stop', [g5(read(2, 20, 2, 2)), g5(read(3, 0))], 3],
    ['R4 just under: R3, a band-3 line-1 stop with a few words (stop_line 1, wcpm 4)', [g5(read(2, 20, 2, 2)), g5(read(3, 4, 0, 0, { meta: { stop_line: 1 } }))], 3],
    ['R4 at the edge: R3, band 3 past line 1', [g5(read(2, 20, 2, 2)), g5(read(3, 1))], 4],
    ['R4 without R3 never skips: band 3 past line 1 with 2/2 alone', [g5(read(3, 20, 2, 2))], 1],
    ['R5 just under: band 3, asked 2 right 1', [g5(read(2, 20, 2, 2)), g5(read(3, 20, 2, 1))], 4],
    ['R5 at the edge: band 3, asked 2 right 2', [g5(read(2, 20, 2, 2)), g5(read(3, 20, 2, 2))], 5],
  ])('%s → R%s', (_label, rows, want) => {
    expect(rung('reading', rows)).toBe(want);
  });

  test('the grade band is the fixed grade\'s form (G3 / G5), the same rows read differently', () => {
    const rows = [read(1, 20, 2, 2)];
    expect(rung('reading', rows)).toBe(3);
    expect(rung('reading', rows.map(g5))).toBe(2);
    expect(rung('reading', rows, { form: 'G5' })).toBe(2);
  });
});

describe('computeRung · Numbers (the same for both grade bands; ok_5s is read by no rule)', () => {
  test.each([
    ['N1: a bigger row, all wrong', [bigger(n6(0))], 1],
    ['N1: a warm-up row, all wrong', [anchor(A(0, 0))], 1],
    ['N1: a failed warm-up row (its items never count)', [anchor(A(6, 4), { status: 'failed' })], 1],
    ['N2 (a): bigger 5/6 and 1 anchor item right', [bigger(n6(5)), anchor(A(1, 0))], 2],
    ['N2 (a) just under: bigger 4/6 and 1 anchor item right', [bigger(n6(4)), anchor(A(1, 0))], 1],
    ['N2 (a) just under: bigger 6/6 and no anchor item right', [bigger(n6(6)), anchor(A(0, 0))], 1],
    ['N2 (a): the anchor item may be one of 7–10', [bigger(n6(5)), anchor(A(0, 1))], 2],
    ['N2 (a) just under: bigger 6/6, no anchor row at all', [bigger(n6(6))], 1],
    ['N2 (b) at the edge: anchor 1–6 3/6', [anchor(A(3, 0))], 2],
    ['N2 (b) just under: anchor 1–6 2/6', [anchor(A(2, 4))], 1],
    ['N3 at the edge: anchor 1–6 5/6', [anchor(A(5, 0))], 3],
    ['N3 just under: anchor 1–6 4/6', [anchor(A(4, 4))], 2],
    ['N4 at the edge: 1–6 5/6 and 7–10 3/4 on one row', [anchor(A(5, 3))], 4],
    ['N4 just under: 7–10 2/4', [anchor(A(6, 2))], 3],
    ['N4 needs one row: 5/6 on one sitting, 3/4 on another', [anchor(A(5, 0)), anchor(A(4, 3))], 3],
    ['N5 at the edge: 10 of 10 on one row', [anchor(A(6, 4))], 5],
    ['N5 just under: 9 of 10', [anchor(A(6, 3))], 4],
    ['N5 needs one row: 6/6 + 3/4, then 5/6 + 4/4', [anchor(A(6, 3)), anchor(A(5, 4))], 4],
    ['a returner\'s anchor (exposure 2) counts', [anchor(A(6, 4), { anchor_exposure_no: 2 })], 5],
    ['the A2 block reads no rung beyond N1', [anchor(A(6, 4), { anchor_block: 'A2' })], 1],
  ])('%s → N%s', (_label, rows, want) => {
    expect(rung('numbers', rows)).toBe(want);
    expect(rung('numbers', rows.map(g5))).toBe(want);
  });

  test('ok_5s is never read: every item right but slow is N5; every item fast-but-wrong is N1', () => {
    const slowRight = anchor(A(6, 4));
    expect(rung('numbers', [slowRight])).toBe(5);
    const fastWrong = anchor(A(0, 0));
    fastWrong.meta.items.forEach((it) => { it.ok_5s = true; });
    expect(rung('numbers', [fastWrong])).toBe(1);
  });

  test('reading rows do not feed numbers, nor numbers rows reading', () => {
    expect(rung('numbers', [read(1, 30, 3, 3)])).toBe(0);
    expect(rung('reading', [anchor(A(6, 4))])).toBe(0);
  });
});

describe('computeRung · grade 1: N1 only', () => {
  const g1 = (row) => ({ ...row, form: 'G1', grade: 1, anchor_block: row.anchor_block === 'A1' ? 'G1A' : row.anchor_block });
  test('any record row of the number stop is N1, and nothing higher', () => {
    expect(rung('numbers', [g1(anchor(A(6, 4)))])).toBe(1);
    expect(rung('numbers', [g1(bigger(n6(6)))])).toBe(1);
  });
  test('no Reading rung', () => {
    expect(rung('reading', [g1(read(1, 40, 3, 3))])).toBe(0);
  });
});

describe('computeRung · only record rows count, whatever is passed in', () => {
  test.each([
    ['practice (Story Time, a replay under the practice banner, a teacher\'s device)', { mode: 'practice' }],
    ['a class round', { mode: 'class_round' }],
    ['a replay (record false)', { record: false }],
    ['no record decided (record null)', { record: null }],
    ['a row written before the provenance columns (no mode)', { mode: null }],
    ['served, never played', { status: 'served' }],
    ['abandoned', { status: 'abandoned' }],
    ['still scoring', { status: 'scoring' }],
  ])('%s is ignored', (_label, over) => {
    expect(rung('reading', [read(1, 40, 3, 3, over)])).toBe(0);
    expect(rung('numbers', [anchor(A(6, 4), over)])).toBe(0);
    expect(rung('reading', [read(1, 0), read(2, 40, 3, 3, over)])).toBe(1);
  });
});

describe('eligible', () => {
  test('a check record row with a final status: scored, failed (a swept row is failed)', () => {
    expect(R.eligible(read(1, 30))).toBe(true);
    expect(R.eligible(read(1, null, 0, 0, { status: 'failed' }))).toBe(true);
    expect(R.eligible(read(1, null, 0, 0, { status: 'failed', meta: { fail_reason: 'page_gone', swept_at: '2026-11-03T10:30:00Z' } }))).toBe(true);
  });
  test.each([
    ['practice', { mode: 'practice' }],
    ['Story Time (served as practice)', { mode: 'practice', via: 'hub' }],
    ['a teacher device\'s class-link preview (practice)', { mode: 'practice', via: 'class_link' }],
    ['a class round', { mode: 'class_round', via: 'class_round' }],
    ['a replay', { record: false, exposure_no: 2 }],
    ['served', { status: 'served' }],
    ['abandoned', { status: 'abandoned' }],
    ['scoring', { status: 'scoring' }],
    ['no canonical id', { canonical_id: null }],
    ['no period', { period_id: null }],
    ['a legacy row (no mode)', { mode: undefined, record: undefined }],
  ])('never %s', (_label, over) => {
    expect(R.eligible(read(1, 30, 3, 3, over))).toBe(false);
  });
  test('nothing at all', () => {
    expect(R.eligible(null)).toBe(false);
    expect(R.eligible(undefined)).toBe(false);
  });
});

// ── onRecordFinal against the faked Supabase ─────────────────────────────────────────────────────────
const ALL_ON = [
  { key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_challenge_rungs', value: true },
  { key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_events_v2', value: true },
];
let db;
let fake;
function seed(settings = ALL_ON) {
  db = {
    app_settings: settings.map((s) => ({ ...s })),
    students: [
      { id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '923001112223' },
      { id: SIB, student_name: 'Bilal Testwala', student_name_urdu: null, self_reported_class: '5', list_id: null, is_active: true, phone: '923001112223' },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [], student_videos: [], web_quiz_challenge_runs: [], child_rungs: [],
  };
  // The unique index of the lamps migration: one row per child × ladder × stop × period.
  fake = makeFake(db, { uniques: { child_rungs: ['canonical_id', 'ladder', 'stop', 'period_id'] } });
  Object.assign(supabase, fake);
}
const without = (...keys) => ALL_ON.filter((s) => !keys.includes(s.key));
const named = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const touched = (t) => fake.calls.filter((c) => c.table === t);
const put = (...rows) => { db.web_quiz_challenge_runs.push(...rows); return rows[rows.length - 1]; };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'rungs-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 'test-only-kid-key-0123456789abcdef0123456789';
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
  process.env.CHILD_TEST_R2_ENV = 'sandbox';
  Hub._resetCache();
  Ch.__reset();
  K._reset();
  require('../../../shared/services/cache/railway-redis.service')._store.clear();
  seed();
});

describe('onRecordFinal', () => {
  test('a first record row writes ONE child_rungs row (badges-v1, the period, the run) and then one lamp_lit', async () => {
    const row = put(read(1, 30, 3, 2));
    const out = await R.onRecordFinal(row.id);
    expect(out).toMatchObject({ ladder: 'reading', rung: 3 });
    expect(db.child_rungs).toHaveLength(1);
    expect(db.child_rungs[0]).toMatchObject({ canonical_id: KID, ladder: 'reading', rung: 3, rule_v: 'badges-v1', stop: 'read', period_id: '2026-11', row_id: row.id });
    const ev = named('web_quiz.lamp_lit');
    expect(ev).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID), ladder: 'reading', rung: 3, rule_v: 'badges-v1', band: 1, fixed_band: 'G2-3', period_id: '2026-11' }]);
    expect(JSON.stringify(ev)).not.toMatch(/44444444|student_id|canonical_id/);
    // the event follows the insert
    const insertAt = fake.calls.findIndex((c) => c.table === 'child_rungs' && c.op === 'insert');
    expect(insertAt).toBeGreaterThan(-1);
  });

  test('accepts the stored row itself as well as its id', async () => {
    const row = put(anchor(A(5, 0)));
    expect(await R.onRecordFinal(row)).toMatchObject({ ladder: 'numbers', rung: 3 });
    expect(named('web_quiz.lamp_lit')[0]).toMatchObject({ ladder: 'numbers', rung: 3, fixed_band: 'G2-3', band: null });
  });

  test('reads every period\'s record rows: last month\'s band-1 R3 and this month\'s band-2 read make R4', async () => {
    db.child_rungs.push({ canonical_id: KID, ladder: 'reading', rung: 3, rule_v: 'badges-v1', period_id: '2026-10', row_id: null });
    put(read(1, 30, 2, 2, { period_id: '2026-10' }));
    const row = put(read(2, 25, 3, 1, { period_id: '2026-11' }));
    expect(await R.onRecordFinal(row.id)).toMatchObject({ rung: 4 });
    expect(db.child_rungs.map((r) => [r.period_id, r.rung])).toEqual([['2026-10', 3], ['2026-11', 4]]);
    expect(named('web_quiz.lamp_lit')).toHaveLength(1);
    expect(named('web_quiz.lamp_lit')[0]).toMatchObject({ rung: 4, band: 2, period_id: '2026-11' });
  });

  test('up only: a lower computed rung writes nothing and logs nothing; an equal one too', async () => {
    db.child_rungs.push({ canonical_id: KID, ladder: 'reading', rung: 3, rule_v: 'badges-v1', period_id: '2026-10', row_id: null });
    const low = put(read(1, 0));                       // R1 by itself
    expect(await R.onRecordFinal(low.id)).toBeNull();
    const same = put(read(1, 30, 2, 2));               // R3 again
    expect(await R.onRecordFinal(same.id)).toBeNull();
    expect(db.child_rungs).toHaveLength(1);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
  });

  test('per stop: listen lights R1, then read lights R3 in the same period — two rows, two lamp_lit', async () => {
    const first = put(listen(3, 0));                   // R1
    expect(await R.onRecordFinal(first.id)).toMatchObject({ rung: 1 });
    const second = put(read(1, 30, 3, 3));             // R3, same period, another stop
    expect(await R.onRecordFinal(second.id)).toMatchObject({ rung: 3, from: 1 });
    expect(db.child_rungs.map((r) => [r.stop, r.period_id, r.rung])).toEqual([['listen', '2026-11', 1], ['read', '2026-11', 3]]);
    expect(named('web_quiz.lamp_lit').map((e) => e.rung)).toEqual([1, 3]);
    expect(logError).not.toHaveBeenCalled();
  });

  test('one per child × ladder × stop × period: a second change on the same stop in the same period is refused by the DB (23505), no event', async () => {
    const first = put(read(1, 30));                    // R2 on the read stop
    expect(await R.onRecordFinal(first.id)).toMatchObject({ rung: 2 });
    const second = put(read(1, 30, 3, 3));             // would be R3, same stop, same period
    expect(await R.onRecordFinal(second.id)).toBeNull();
    expect(db.child_rungs).toHaveLength(1);
    expect(named('web_quiz.lamp_lit')).toHaveLength(1);
    expect(logError).not.toHaveBeenCalled();
    const ins = touched('child_rungs').filter((c) => c.op === 'insert');
    expect(ins).toHaveLength(2);                       // the job asked; the index refused
    // the next period, the same stop is its own change
    const later = put(read(1, 30, 3, 3, { period_id: '2026-12' }));
    expect(await R.onRecordFinal(later.id)).toMatchObject({ rung: 3 });
    expect(named('web_quiz.lamp_lit')).toHaveLength(2);
  });

  test('the other ladder in the same period is its own lamp', async () => {
    put(listen(3, 0)); await R.onRecordFinal(db.web_quiz_challenge_runs[0].id);
    const num = put(anchor(A(3, 0)));
    expect(await R.onRecordFinal(num.id)).toMatchObject({ ladder: 'numbers', rung: 2 });
    expect(named('web_quiz.lamp_lit')).toHaveLength(2);
  });

  test('never updates or deletes a lamp row', async () => {
    put(read(1, 30)); await R.onRecordFinal(db.web_quiz_challenge_runs[0].id);
    const next = put(read(2, 30, 2, 2, { period_id: '2026-12' }), read(1, 30, 2, 2, { period_id: '2026-12' }));
    await R.onRecordFinal(next.id);
    expect(touched('child_rungs').map((c) => c.op).filter((op) => op !== 'select' && op !== 'insert')).toEqual([]);
  });

  test.each([
    ['the rung switch absent', without('web_quiz_challenge_rungs')],
    ['the rung switch false', [...without('web_quiz_challenge_rungs'), { key: 'web_quiz_challenge_rungs', value: false }]],
    ['challenge v2 off', without('web_quiz_challenge_v2')],
    ['the challenge off (v2\'s parent)', without('web_quiz_challenge')],
  ])('switch off (%s): no query to the runs or lamps table, no row, no event', async (_label, settings) => {
    seed(settings);
    const row = put(read(1, 30, 3, 3));
    expect(await R.onRecordFinal(row.id)).toBeNull();
    expect(touched('web_quiz_challenge_runs')).toHaveLength(0);
    expect(touched('child_rungs')).toHaveLength(0);
    expect(db.child_rungs).toHaveLength(0);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
  });

  test.each([
    ['events v2 off', without('web_quiz_events_v2')],
    ['events v2 on but its parent hub off', without('web_quiz_hub')],
  ])('%s: the row is written, no lamp_lit', async (_label, settings) => {
    seed(settings);
    const row = put(read(1, 30, 3, 3));
    expect(await R.onRecordFinal(row.id)).toMatchObject({ rung: 3 });
    expect(db.child_rungs).toHaveLength(1);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
  });

  test('the insert fails: no event, no throw, null', async () => {
    const row = put(read(1, 30, 3, 3));
    const from = fake.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'child_rungs') b.insert = () => ({ then: (res) => Promise.resolve({ data: null, error: { code: 'XX000', message: 'disk full' } }).then(res) });
      return b;
    };
    await expect(R.onRecordFinal(row.id)).resolves.toBeNull();
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
    expect(logError).toHaveBeenCalledWith('web_quiz.rung_write_failed', expect.objectContaining({ code: 'XX000' }));
  });

  test('the lamps read fails: nothing written (the current rung is unknown), no throw', async () => {
    const row = put(read(1, 30, 3, 3));
    const from = fake.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'child_rungs') { b.then = (res) => Promise.resolve({ data: null, error: { code: '57014', message: 'timeout' } }).then(res); }
      return b;
    };
    await expect(R.onRecordFinal(row.id)).resolves.toBeNull();
    expect(db.child_rungs).toHaveLength(0);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
  });

  test('the client throws: no throw, null', async () => {
    supabase.from = () => { throw new Error('socket hang up'); };
    await expect(R.onRecordFinal('00000000-0000-4000-8000-0000000000ff')).resolves.toBeNull();
  });

  test.each([
    ['practice', { mode: 'practice' }],
    ['Story Time (practice)', { mode: 'practice', via: 'hub' }],
    ['a teacher device\'s preview (practice)', { mode: 'practice', via: 'class_link' }],
    ['a class round', { mode: 'class_round' }],
    ['a replay', { record: false, exposure_no: 2 }],
  ])('every switch on: a %s row moves nothing and reads no lamp', async (_label, over) => {
    const row = put(read(1, 40, 3, 3, over));
    expect(await R.onRecordFinal(row.id)).toBeNull();
    expect(touched('child_rungs')).toHaveLength(0);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
  });

  test('every switch on: high-scoring practice / Story Time / teacher-device rows in the history never lift a record row\'s rung', async () => {
    put(read(1, 40, 3, 3, { mode: 'practice' }), read(2, 40, 3, 3, { mode: 'practice', via: 'class_link' }), read(1, 40, 3, 3, { mode: 'class_round' }), read(1, 40, 3, 3, { record: false }));
    const row = put(read(1, 0));
    expect(await R.onRecordFinal(row.id)).toMatchObject({ rung: 1 });
    expect(db.child_rungs.map((r) => r.rung)).toEqual([1]);
  });

  test('another child\'s rows never count', async () => {
    put(read(1, 40, 3, 3, { canonical_id: SIB, student_id: SIB }));
    const row = put(read(1, 0));
    expect(await R.onRecordFinal(row.id)).toMatchObject({ rung: 1 });
  });

  test('grades 4–5: fixed_band G4-5 on the event', async () => {
    const row = put(g5(read(2, 30, 2, 2)));
    expect(await R.onRecordFinal(row.id)).toMatchObject({ rung: 3 });
    expect(named('web_quiz.lamp_lit')[0]).toMatchObject({ fixed_band: 'G4-5', band: 2 });
  });
});

// ── the hook: a record row the Challenge stores as scored (or failed) reaches the job ────────────────
// The landed path, end to end: serve under web_quiz_challenge_v2 + _period (the run row inserted at serve with
// mode / record / period decided there), then submit (finishServed / updateRunMeta → status scored | failed), then
// measureOutcome → onRecordFinal. Only Supabase, R2, speech, the LLM client and Redis are faked.
const PERIOD_ON = [...ALL_ON, { key: 'web_quiz_challenge_period', value: true }];
const DAY = 24 * 3600 * 1000;
const periodsNow = () => [
  { period_id: '2026-10', starts_at: new Date(Date.now() - 40 * DAY).toISOString(), ends_at: new Date(Date.now() - DAY).toISOString(), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
  { period_id: '2026-11', starts_at: new Date(Date.now() - DAY).toISOString(), ends_at: new Date(Date.now() + 29 * DAY).toISOString(), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
];
function seedLanded(settings = PERIOD_ON) {
  seed(settings);
  db.challenge_periods = periodsNow();
}
const allRight = (items) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2500 }));
const serveBigger = () => Ch.exercise(T.signHub([KID]), 'bigger', { device: DEV });
const submitBigger = (ex) => Ch.submit({ ct: ex.ct, taps: allRight(ex.items), ms: 25000 });
const playBigger = async () => {
  const ex = await serveBigger();
  await submitBigger(ex);
  return T.verify(ex.ct, 'c').r;
};
const runRow = (id) => db.web_quiz_challenge_runs.find((r) => r.id === id);
/** The Supabase calls a step makes (the serve reads child_rungs for the open band; the submit must not, when off). */
async function callsOf(step) {
  const from = fake.calls.length;
  await step();
  return fake.calls.slice(from);
}

describe('the hook in the Challenge (the landed serve → store → score path)', () => {
  test('a v2 record row stored as scored lights N1 once, with every switch on', async () => {
    seedLanded();
    const run = await playBigger();
    expect(runRow(run)).toMatchObject({ mode: 'check', record: true, period_id: '2026-11', status: 'scored', canonical_id: KID });
    expect(db.child_rungs).toHaveLength(1);
    expect(db.child_rungs[0]).toMatchObject({ canonical_id: KID, ladder: 'numbers', rung: 1, rule_v: 'badges-v1', stop: 'bigger', period_id: '2026-11', row_id: run });
    expect(named('web_quiz.lamp_lit')).toHaveLength(1);
    expect(named('web_quiz.m_result')).toHaveLength(1);
  });

  test('a practice row (the stop already has this period\'s record row) lights nothing', async () => {
    seedLanded();
    put(bigger(n6(6), { period_id: '2026-11', item_set_id: 'bigger.G3.A' }));   // this period's record row, no lamp yet
    const run = await playBigger();
    expect(runRow(run)).toMatchObject({ mode: 'practice', status: 'scored' });
    expect(db.child_rungs).toHaveLength(0);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
  });

  test('a record row whose scored write failed (the row is still served) lights nothing', async () => {
    seedLanded();
    const ex = await serveBigger();
    const run = T.verify(ex.ct, 'c').r;
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'web_quiz_challenge_runs') return b;
      b.update = () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } }) }) }) });
      return b;
    };
    await submitBigger(ex);
    expect(runRow(run)).toMatchObject({ mode: 'check', record: true, status: 'served' });
    expect(db.child_rungs).toHaveLength(0);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
  });

  test('a record reading lost after the mic (stored as failed) lights R1 only (BADGES §1.1: R1 is any outcome)', async () => {
    seedLanded();
    const r2 = require('../../../shared/storage/r2');
    const { ct } = await Ch.exercise(T.signHub([KID]), 'read', { device: DEV, lang: 'en' });
    const run = T.verify(ct, 'c').r;
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.downloadFromR2.mockRejectedValueOnce(new Error('r2 down'));
    await Ch.submit({ ct, key, ms: 60000, lang: 'en' }, { waitMs: 60000 });
    expect(runRow(run)).toMatchObject({ mode: 'check', record: true, status: 'failed' });
    expect(db.child_rungs).toHaveLength(1);
    expect(db.child_rungs[0]).toMatchObject({ ladder: 'reading', rung: 1, stop: 'read', period_id: '2026-11', row_id: run });
  });

  test('a second scoring call for the same row (a resubmit, then the job again) still leaves one row', async () => {
    seedLanded();
    const ex = await serveBigger();
    const run = T.verify(ex.ct, 'c').r;
    await submitBigger(ex);
    await expect(submitBigger(ex)).rejects.toMatchObject({ status: 409 });
    expect(await R.onRecordFinal(run)).toBeNull();
    expect(db.child_rungs).toHaveLength(1);
    expect(named('web_quiz.lamp_lit')).toHaveLength(1);
  });

  test('the rung switch off: the submit reads and writes nothing of the job (no child_rungs, no extra runs read)', async () => {
    seedLanded(PERIOD_ON.filter((s) => s.key !== 'web_quiz_challenge_rungs'));
    const ex = await serveBigger();
    const calls = await callsOf(() => submitBigger(ex));
    expect(calls.filter((c) => c.table === 'child_rungs')).toHaveLength(0);
    expect(db.child_rungs).toHaveLength(0);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
    // the same submit with the switch on makes exactly the job's reads (the run, the record rows, the lamp) and one insert
    Ch.__reset(); Hub._resetCache();
    seedLanded();
    const ex2 = await serveBigger();
    const on = await callsOf(() => submitBigger(ex2));
    expect(on.length - calls.length).toBe(4);
    expect(on.filter((c) => c.table === 'child_rungs').map((c) => c.op)).toEqual(['select', 'insert']);
  });

  test('a row written without the provenance columns (challenge v2 off: no mode) moves nothing', async () => {
    seedLanded(PERIOD_ON.filter((s) => s.key !== 'web_quiz_challenge_v2'));
    await playBigger();
    expect(touched('child_rungs')).toHaveLength(0);
    expect(named('web_quiz.lamp_lit')).toHaveLength(0);
  });
});

// ── a reading's questions answered after it is stored as scored: R3 lives on R2's own row ──────────────
// The landed read path end to end: serve (v2 + _period; passage en.read.2.setA, band 2) → upload → the real scorer
// (the speech service, the LLM and R2 faked) → stored as scored → questions → answers (meta.comp). A grade-5 child:
// band 2 past line 1 is R2, the same row with asked ≥ 2 and right ≥ 2 is R3.
describe('the questions after scored (the settle rule)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const r2 = require('../../../shared/storage/r2');
  const AudioService = require('../../../shared/services/audio.service');
  const llm = require('../../../shared/services/llm-client');
  const Bank = require('../../../shared/services/child-test/item-bank');
  const FF = require('@ffmpeg-installer/ffmpeg').path;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqrung-'));
  const clip = (secs) => {
    const f = path.join(dir, `s${secs}.webm`);
    if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(secs), '-c:a', 'libopus', f]);
    return fs.readFileSync(f);
  };
  const spec3 = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' });
  const heard = (n, gap) => ({ text: '', tokens: spec3().story.tokens.slice(0, n).map((w, k) => ({ text: ` ${w}`, start_ms: Math.round(k * gap * 1000), end_ms: Math.round((k * gap + gap * 0.8) * 1000), speaker: 1 })) });
  const marks = (right, tried) => ({ usage: { cost: 0.0021 }, choices: [{ message: { content: JSON.stringify({
    words: spec3().story.tokens.map((w, k) => ({ i: k + 1, w, v: k < right ? 'correct' : k < tried ? 'wrong' : 'skipped' })), words_correct: 0, words_attempted: 0, notes: '' }) } }] });
  const QS = { key: 'web_quiz_challenge_questions', value: true };
  const G5_CHILD = () => {
    db.students[0].self_reported_class = '5';
    db.student_lists[0].class_name = '5';
  };
  async function readScored(settings = [...PERIOD_ON, QS]) {
    seedLanded(settings);
    G5_CHILD();
    const { ct } = await Ch.exercise(T.signHub([KID]), 'read', { device: DEV, lang: 'en' });
    const run = T.verify(ct, 'c').r;
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.downloadFromR2.mockResolvedValue(clip(61));
    AudioService.transcribe.mockResolvedValue(heard(50, 1.1));
    llm.__create.mockResolvedValue(marks(45, 50));
    await Ch.submit({ ct, key, ms: 61000, lang: 'en', ended: 'timer', mic_check: 'pass', read_s: 61 }, { waitMs: 60000 });
    return { ct, run };
  }
  const rightPick = (q, ct) => {
    const p = typeof Bank.getPassage === 'function' ? Bank.getPassage('en.read.2.setA') : null;
    const bq = [...((p && p.questions) || []), ...spec3().questions].find((x) => x.id === q.id);
    return q.options.indexOf(Ch.tapOptions(bq, 'en', T.verify(ct, 'c').r).right);
  };
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('answers arrive after scored: nothing at scored, then ONE child_rungs row at R3 once the answers are in (not R2, then blocked)', async () => {
    const { ct, run } = await readScored();
    expect(runRow(run)).toMatchObject({ mode: 'check', record: true, status: 'scored', passage_id: 'en.read.2.setA', form: 'G5' });
    expect(Number(runRow(run).wcpm)).toBeGreaterThan(0);
    expect(db.child_rungs).toHaveLength(0);                         // deferred: the questions are still to come
    const qs = (await Ch.questions({ ct })).questions;
    expect(qs.length).toBeGreaterThanOrEqual(2);
    for (const q of qs) await Ch.answer({ ct, q: q.id, pick: rightPick(q, ct) });
    expect(runRow(run).meta.comp).toMatchObject({ asked: qs.length, correct: qs.length });
    expect(db.child_rungs).toHaveLength(1);
    expect(db.child_rungs[0]).toMatchObject({ ladder: 'reading', rung: 3, stop: 'read', period_id: '2026-11', row_id: run });
    expect(named('web_quiz.lamp_lit')).toHaveLength(1);
  });

  test('questions never answered: nothing at scored; settleDeferred after 30 min lights R2 (R3 not evaluated)', async () => {
    const { run } = await readScored();
    expect(db.child_rungs).toHaveLength(0);
    expect(await R.settleDeferred({ now: Date.now() + 10 * 60 * 1000 })).toEqual({ checked: 0, settled: 0 });   // inside the window
    expect(db.child_rungs).toHaveLength(0);
    expect(await R.settleDeferred({ now: Date.now() + R.SETTLE_MS + 60 * 1000 })).toEqual({ checked: 1, settled: 1 });
    expect(db.child_rungs).toHaveLength(1);
    expect(db.child_rungs[0]).toMatchObject({ ladder: 'reading', rung: 2, stop: 'read', period_id: '2026-11', row_id: run });
    // a second daily run: the lamp row is there, nothing more
    expect(await R.settleDeferred({ now: Date.now() + R.SETTLE_MS + 120 * 1000 })).toMatchObject({ settled: 0 });
    expect(db.child_rungs).toHaveLength(1);
  });

  test('no questions served (the questions switch off): computed at scored, as before (R2)', async () => {
    const { run } = await readScored();
    db.child_rungs.length = 0;
    // the same reading with the questions off
    Ch.__reset(); Hub._resetCache();
    const again = await readScored([...PERIOD_ON]);
    expect(runRow(again.run)).toMatchObject({ status: 'scored', record: true });
    expect(db.child_rungs).toHaveLength(1);
    expect(db.child_rungs[0]).toMatchObject({ ladder: 'reading', rung: 2, row_id: again.run });
    expect(run).not.toBe(again.run);
  });

  test('the rung switch off: settleDeferred makes no query; the answers reach nothing of the job', async () => {
    const off = [...PERIOD_ON.filter((x) => x.key !== 'web_quiz_challenge_rungs'), QS];
    const { ct } = await readScored(off);
    const qs = (await Ch.questions({ ct })).questions;
    const calls = await callsOf(async () => { for (const q of qs) await Ch.answer({ ct, q: q.id, pick: rightPick(q, ct) }); });
    expect(calls.filter((c) => c.table === 'child_rungs')).toHaveLength(0);
    const settle = await callsOf(() => R.settleDeferred({ now: Date.now() + R.SETTLE_MS + 60 * 1000 }));
    expect(settle.filter((c) => c.table !== 'app_settings')).toHaveLength(0);
    expect(db.child_rungs).toHaveLength(0);
  });
});
