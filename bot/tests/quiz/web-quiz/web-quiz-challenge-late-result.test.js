'use strict';
/**
 * A Challenge result that arrives late: app_settings `web_quiz_challenge_late_result` (take it for the run it was
 * played in) and `web_quiz_challenge_late_record` (give that run its record back). Both default off.
 *
 * A school Chromebook gets its games ready online and is then used with no network: a result reaches the server hours
 * or days after its run was served, when the run's token (two hours) has lapsed and, after a day, the sweep has closed
 * its row (served → abandoned, record=false). Today that result is refused (401 bad_token) and the next serve draws
 * other questions, so what the child answered has no run left to go to.
 *   - switch off (default), or a request that does not say it is late: 401 bad_token, as today
 *   - on + `late`: the run's own lapsed token is taken (genuine, this run's, no older than 45 days) and finishes the
 *     run's own row, served or abandoned: scored against the questions that row holds; meta.late says when
 *   - the record: back on the row only with _late_record on, only when the row was the record at its serve, and only
 *     when no other row holds the stop's record this period (the record locks answer 23505: stored without it)
 *   - bigger, the warm-up, the grade-1 dots, a reading (the upload, then the result) and listening (the answers)
 *   - a run that already has its result: 409 already_done; a class-round token is never late; too old: 401
 * Faked boundaries only (Supabase, R2, speech, the LLM client); the service, the sweep, the draw and the scorer are real.
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
  return { _store: store, isAvailable: () => true, get: async (k) => (store.has(k) ? store.get(k) : null), setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; } };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeFake } = require('./fake-supabase');
const { guardColumns } = require('./registry-columns');   // a select naming a column the table lacks is 42703
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const AudioService = require('../../../shared/services/audio.service');
const llm = require('../../../shared/services/llm-client');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const Sweeper = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');

const K3 = '44444444-4444-4444-8444-444444444444';
const K1 = '11111111-1111-4111-8111-111111111111';
const L3 = 'a0000000-0000-4000-8000-000000000003';
const L1 = 'a0000000-0000-4000-8000-000000000001';

const BASE_FLAGS = ['web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_listen', 'web_quiz_challenge_questions'];
// the served row (v2), the record per month (period) and its parent (the identity canon, under the hub)
const SERVED = ['web_quiz_challenge_v2', 'web_quiz_challenge_period', 'web_quiz_hub', 'web_quiz_identity_canon'];
const POOL = 'web_quiz_challenge_pool';
const G1 = 'web_quiz_challenge_g1';
const LATE = 'web_quiz_challenge_late_result';
const LATE_RECORD = 'web_quiz_challenge_late_record';
const on = (...keys) => keys.forEach((key) => db.app_settings.push({ key, value: true }));

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (t) => new Date(t).toISOString();
const periodsNow = (t) => [
  { period_id: '2026-10', starts_at: iso(t - 40 * DAY), ends_at: iso(t - DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
  { period_id: '2026-11', starts_at: iso(t - DAY), ends_at: iso(t + 60 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
];

// web_quiz_challenge_runs_record_locks.sql: one record per child × stop (× language for read and listen) × period.
// An update that would make a second one is refused 23505, as the partial unique indexes do.
const recordKey = (r) => [r.canonical_id || r.student_id, r.exercise, r.exercise === 'read' || r.exercise === 'listen' ? r.lang : '', r.period_id].join('|');
function recordLocks(fake) {
  const from = fake.from;
  fake.from = (t) => {
    const b = from(t);
    if (t !== 'web_quiz_challenge_runs') return b;
    let patch = null;
    const filters = [];
    const { update, eq, then } = b;
    const inList = b.in;
    b.update = (p) => { patch = p; return update(p); };
    b.eq = (c, v) => { filters.push((r) => r[c] === v); return eq(c, v); };
    b.in = (c, vs) => { filters.push((r) => vs.includes(r[c])); return inList(c, vs); };
    b.then = (res, rej) => {
      if (patch && patch.record === true) {
        const rows = db.web_quiz_challenge_runs;
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (hit.some((h) => rows.some((o) => o !== h && o.record === true && recordKey(o) === recordKey({ ...h, ...patch })))) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "web_quiz_challenge_runs_one_record_stop_uidx"' } }).then(res, rej);
        }
      }
      return then(res, rej);
    };
    return b;
  };
  return fake;
}

let db;
let T0;
let clock;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
beforeEach(() => {
  T0 = Math.floor(Date.now() / 1000) * 1000;   // a whole second: a token's times are in seconds
  db = {
    app_settings: BASE_FLAGS.map((key) => ({ key, value: true })),
    student_lists: [{ id: L3, class_name: '3', is_active: true }, { id: L1, class_name: '1', is_active: true }],
    students: [{ id: K3, list_id: L3, student_name: 'Sana Testwala' }, { id: K1, list_id: L1, student_name: 'Zara Testwala' }],
    quiz_share_codes: [], quiz_sessions: [],
    web_quiz_challenge_runs: [],
    challenge_periods: periodsNow(T0),
    challenge_passages: [],
    challenge_draws: [],
  };
  Object.assign(supabase, recordLocks(guardColumns(makeFake(db))));
  Ch.__reset();
  for (const m of ['web-quiz-hub-flags', 'web-quiz-identity-flags']) require(`../../../shared/services/quiz/${m}`)._resetCache();
  jest.clearAllMocks();
  r2.headObject.mockImplementation(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' }));
  clock = jest.spyOn(Date, 'now').mockImplementation(() => T0);
});
afterEach(() => { clock.mockRestore(); });
// Every run row a test leaves behind holds the runs CHECKs (web_quiz_challenge_runs_v2.sql, _sampling.sql, _record_locks.sql).
const RUN_CHECKS = {
  wqcr_status_v2_chk: (r) => ['served', 'scoring', 'scored', 'failed', 'abandoned'].includes(r.status),
  wqcr_record_is_check_chk: (r) => r.record !== true || r.mode === 'check',
  wqcr_record_first_exposure_chk: (r) => r.record !== true || r.anchor_block != null || r.exposure_no === 1,
  wqcr_record_key_not_null_chk: (r) => r.record !== true || (r.period_id != null && (r.canonical_id || r.student_id) != null),
  one_record_per_stop: (r) => r.record !== true || db.web_quiz_challenge_runs.filter((o) => o.record === true && recordKey(o) === recordKey(r)).length === 1,
};
afterEach(() => {
  const broken = (db.web_quiz_challenge_runs || []).flatMap((r) => Object.keys(RUN_CHECKS).filter((k) => !RUN_CHECKS[k](r)).map((k) => `${r.id}: ${k}`));
  expect(broken).toEqual([]);
});

const D = { device: 'SchoolChromebookRef_01', lang: 'en' };
const hub = (id = K3) => T.sign({ k: 'h', ids: [id], exp: Math.floor(Date.now() / 1000) + 3600 });
const runOf = (ct) => T.verify(ct, 'c', { allowExpired: true }).r;
const rowOf = (ct) => db.web_quiz_challenge_runs.find((r) => r.id === runOf(ct));
const errOf = async (p) => { try { await p; } catch (e) { return { status: e.status, body: e.body }; } throw new Error('expected a refusal'); };
const BAD_TOKEN = { status: 401, body: { error: 'bad_token' } };
const DONE = { status: 409, body: { error: 'already_done' } };
/** The clock moves on: the run's token lapses after two hours; the sweep closes rows as the worker's tick would. */
const later = async (ms, { sweep = true } = {}) => {
  clock.mockImplementation(() => T0 + ms);
  return sweep ? Sweeper.sweepStuck({ now: T0 + ms, flags: { sweeper: true, eventsV2: false } }) : null;
};
/** The same call as another process would see it (nothing of the run kept in memory), switches read again. */
const restart = () => { Ch.__reset(); for (const m of ['web-quiz-hub-flags', 'web-quiz-identity-flags']) require(`../../../shared/services/quiz/${m}`)._resetCache(); };
const biggerTaps = (items) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2500 }));
const missingAnswers = (items) => items.map((it, i) => ({ i, value: String(it.answer), ms: 3000, first_key_ms: 1200, keys: String(it.answer).length }));
const dots = (items) => items.map((it, i) => ({ i, pick: it.n, ms: 2000, first_tap_ms: 2000 }));
/** What the Chromebook sends with a late result: its own clock when the child finished. */
const lateAt = (ms) => ({ at: T0 + ms });

// Read aloud: a silent clip, the speech service heard `n` words, the LLM marked `right` of `tried`.
const FF = require('@ffmpeg-installer/ffmpeg').path;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqlate-'));
const clip = (secs) => {
  const f = path.join(dir, `s${secs}.webm`);
  if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(secs), '-c:a', 'libopus', f]);
  return fs.readFileSync(f);
};
const enTokens = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.tokens;
const heard = (n, gap) => ({ text: '', tokens: enTokens().slice(0, n).map((w, k) => ({ text: ` ${w}`, start_ms: Math.round(k * gap * 1000), end_ms: Math.round((k * gap + gap * 0.8) * 1000), speaker: 1 })) });
const marks = (right, tried) => ({ usage: { cost: 0.0021 }, choices: [{ message: { content: JSON.stringify({
  words: enTokens().map((w, k) => ({ i: k + 1, w, v: k < right ? 'correct' : k < tried ? 'wrong' : 'skipped' })), words_correct: 0, words_attempted: 0, notes: '' }) } }] });
const scorerHears = () => {
  r2.downloadFromR2.mockResolvedValue(clip(61));
  AudioService.transcribe.mockResolvedValue(heard(50, 1.1));
  llm.__create.mockResolvedValue(marks(45, 50));
};

describe('today, unchanged: the switch off, or a request that does not say it is late', () => {
  test('switch off (the default): a lapsed token is refused 401 whatever the request says; the row is left as it is', async () => {
    on(...SERVED);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    await later(3 * HOUR);
    expect(await errOf(Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000, late: lateAt(HOUR) }))).toEqual(BAD_TOKEN);
    expect(rowOf(ex.ct)).toMatchObject({ status: 'served', record: true });
    expect(rowOf(ex.ct).meta.late).toBeUndefined();
  });

  test('switch on, the request does not say it is late: 401, as today', async () => {
    on(...SERVED, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    await later(3 * HOUR);
    expect(await errOf(Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000 }))).toEqual(BAD_TOKEN);
    expect(rowOf(ex.ct).status).toBe('served');
  });

  test('switch on, the token still alive: today\'s path; `late` changes nothing and the row says nothing of it', async () => {
    on(...SERVED, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    await later(HOUR);
    await Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000, late: lateAt(HOUR) });
    expect(rowOf(ex.ct)).toMatchObject({ status: 'scored', record: true });
    expect(rowOf(ex.ct).meta.late).toBeUndefined();
  });
});

describe('Which is bigger?: a late result goes to the run it was played in', () => {
  test('three hours on (the token lapsed, the row still served): scored on that row, which keeps its record and says it was late', async () => {
    on(...SERVED, LATE);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    await later(3 * HOUR);
    const out = await Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000, late: lateAt(HOUR) });
    expect(out.score).toMatchObject({ correct: ex.items.length, n: ex.items.length });
    const row = rowOf(ex.ct);
    expect(row).toMatchObject({ status: 'scored', record: true, mode: 'check', score: { correct: ex.items.length } });
    expect(row.meta.late).toEqual({ played_at: iso(T0 + HOUR), received_at: iso(T0 + 3 * HOUR), age_s: 3 * 3600 });
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
  });

  test('three days on (the sweep closed the row): scored on that row against its own questions; the record is not given back without its switch', async () => {
    on(...SERVED, LATE);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(await later(3 * DAY)).toMatchObject({ abandoned: 1 });
    expect(rowOf(ex.ct)).toMatchObject({ status: 'abandoned', record: false });
    restart();
    // one tap wrong: the score is the row's own item set's, not another set's
    const taps = biggerTaps(ex.items).map((t, i) => (i === 0 ? { ...t, pick: Math.min(ex.items[0].a, ex.items[0].b) } : t));
    const out = await Ch.submit({ ct: ex.ct, taps, ms: 25000, late: lateAt(DAY) });
    expect(out.score).toMatchObject({ correct: ex.items.length - 1, n: ex.items.length });
    const row = rowOf(ex.ct);
    expect(row).toMatchObject({ status: 'scored', record: false, mode: 'check', score: { correct: ex.items.length - 1 } });
    expect(row.meta.late).toEqual({ played_at: iso(T0 + DAY), received_at: iso(T0 + 3 * DAY), age_s: 3 * 24 * 3600 });
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
  });

  test('_late_record on: the row was the record at its serve and nothing else holds it, so it is the record again', async () => {
    on(...SERVED, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    await later(3 * DAY);
    restart();
    await Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000, late: lateAt(DAY) });
    const row = rowOf(ex.ct);
    expect(row).toMatchObject({ status: 'scored', record: true, mode: 'check' });
    expect(row.meta.late).toMatchObject({ record: 'restored', played_at: iso(T0 + DAY) });
  });

  test('the same process still holding the run in memory finishes the closed row too', async () => {
    on(...SERVED, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    await later(3 * DAY);
    await Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000, late: lateAt(DAY) });
    expect(rowOf(ex.ct)).toMatchObject({ status: 'scored', record: true });
  });

  test('a run takes one result: the same late result sent again is 409 already_done and changes nothing', async () => {
    on(...SERVED, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    await later(3 * DAY);
    restart();
    await Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000, late: lateAt(DAY) });
    const before = JSON.stringify(rowOf(ex.ct));
    restart();
    expect(await errOf(Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items).map((t) => ({ ...t, pick: 0 })), ms: 1, late: lateAt(DAY) }))).toEqual(DONE);
    expect(JSON.stringify(rowOf(ex.ct))).toBe(before);
  });

  test('a token older than 45 days is refused; so is a class-round token (its turn is the teacher\'s), and a forged one', async () => {
    on(...SERVED, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    const run = runOf(ex.ct);
    const round = T.sign({ k: 'c', sid: K3, ex: 'bigger', r: run, exp: Math.floor(T0 / 1000) + 60, cr: 'round-1', cm: 'check' });
    await later(3 * DAY);
    restart();
    expect(await errOf(Ch.submit({ ct: round, taps: biggerTaps(ex.items), ms: 25000, late: lateAt(DAY) }))).toEqual(BAD_TOKEN);
    expect(await errOf(Ch.submit({ ct: `${ex.ct.slice(0, -2)}xx`, taps: biggerTaps(ex.items), ms: 25000, late: lateAt(DAY) }))).toEqual(BAD_TOKEN);
    await later(46 * DAY, { sweep: false });
    restart();
    expect(await errOf(Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000, late: lateAt(DAY) }))).toEqual(BAD_TOKEN);
    expect(rowOf(ex.ct)).toMatchObject({ status: 'abandoned', record: false });
  });

  test('the device\'s clock is kept only when it can be true: a time before the serve or after now is not', async () => {
    on(...SERVED, LATE);
    const a = await Ch.exercise(hub(), 'bigger', D);
    await later(3 * HOUR);
    await Ch.submit({ ct: a.ct, taps: biggerTaps(a.items), ms: 25000, late: { at: T0 - 2 * DAY } });
    expect(rowOf(a.ct).meta.late).toEqual({ played_at: null, received_at: iso(T0 + 3 * HOUR), age_s: 3 * 3600 });
    const b = await Ch.exercise(hub(), 'missing', D);
    await later(6 * HOUR);
    await Ch.submit({ ct: b.ct, answers: missingAnswers(b.items), ms: 30000, late: { at: T0 + 9 * DAY } });
    expect(rowOf(b.ct).meta.late).toMatchObject({ played_at: null });
    const c = await Ch.exercise(hub(), 'listen', D);
    await later(9 * HOUR, { sweep: false });
    const qs = (await Ch.questions({ ct: c.ct, late: true })).questions;   // `late: true` says it, with no clock
    for (const q of qs) await Ch.answer({ ct: c.ct, q: q.id, pick: 0, late: true });
    expect(rowOf(c.ct)).toMatchObject({ status: 'scored' });
    expect(rowOf(c.ct).meta.late).toMatchObject({ played_at: null });
  });
});

describe('the warm-up (missing number): the record goes to one row only', () => {
  test('another serve took the stop\'s record meanwhile: the late result is stored as played, not as a second record', async () => {
    on(...SERVED, POOL, LATE, LATE_RECORD);
    const first = await Ch.exercise(hub(), 'missing', D);
    expect(rowOf(first.ct)).toMatchObject({ status: 'served', record: true, anchor_block: 'A1' });
    await later(3 * DAY);
    restart();
    const second = await Ch.exercise(hub(), 'missing', D);   // the Chromebook got ready again before its waiting result went up
    expect(rowOf(second.ct)).toMatchObject({ status: 'served', record: true });
    expect(runOf(second.ct)).not.toBe(runOf(first.ct));
    const out = await Ch.submit({ ct: first.ct, answers: missingAnswers(first.items), ms: 30000, late: lateAt(DAY) });
    expect(out.score).toMatchObject({ correct: first.items.length });
    expect(rowOf(first.ct)).toMatchObject({ status: 'scored', record: false });
    expect(rowOf(first.ct).meta.late).toMatchObject({ record: 'taken' });
    expect(rowOf(second.ct)).toMatchObject({ status: 'served', record: true });
  });

  test('nothing took it: the warm-up is the record again', async () => {
    on(...SERVED, POOL, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(), 'missing', D);
    await later(3 * DAY);
    restart();
    await Ch.submit({ ct: ex.ct, answers: missingAnswers(ex.items), ms: 30000, late: lateAt(DAY) });
    expect(rowOf(ex.ct)).toMatchObject({ status: 'scored', record: true, anchor_block: 'A1' });
    expect(rowOf(ex.ct).meta.late).toMatchObject({ record: 'restored' });
  });
});

describe('How many dots? (grade 1)', () => {
  test('switch off: a lapsed token is refused, as today', async () => {
    on(...SERVED, G1);
    const ex = await Ch.exercise(hub(K1), 'numbers', D);
    await later(3 * DAY);
    restart();
    expect(await errOf(Ch.submit({ ct: ex.ct, taps: dots(ex.items), ms: 30000, late: lateAt(DAY) }))).toEqual(BAD_TOKEN);
    expect(rowOf(ex.ct)).toMatchObject({ status: 'abandoned', record: false });
  });

  test('on: three days late, the closed row is scored, is the record again, and says it was late', async () => {
    on(...SERVED, G1, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(K1), 'numbers', D);
    expect(rowOf(ex.ct)).toMatchObject({ status: 'served', record: true });
    await later(3 * DAY);
    restart();
    const out = await Ch.submit({ ct: ex.ct, taps: dots(ex.items), ms: 30000, late: lateAt(DAY) });
    expect(out).toEqual({ score: { correct: 10, n: 10, stopped: false } });
    expect(rowOf(ex.ct)).toMatchObject({ status: 'scored', record: true, score: { correct: 10, n: 10 } });
    expect(rowOf(ex.ct).meta.late).toEqual({ played_at: iso(T0 + DAY), received_at: iso(T0 + 3 * DAY), age_s: 3 * 24 * 3600, record: 'restored' });
    restart();
    expect(await errOf(Ch.submit({ ct: ex.ct, taps: dots(ex.items), ms: 30000, late: lateAt(DAY) }))).toEqual(DONE);
  });
});

describe('a reading recorded with no network', () => {
  test('today: neither the upload nor the result is taken with a lapsed token', async () => {
    on(...SERVED);
    const ex = await Ch.exercise(hub(), 'read', D);
    await later(3 * DAY);
    restart();
    expect(await errOf(Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 500000, late: lateAt(DAY) }))).toEqual(BAD_TOKEN);
    expect(r2.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  test('on: the recording goes up for the run it was read in and is scored against that run\'s passage; the row keeps `late` through the scorer\'s last write', async () => {
    on(...SERVED, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(), 'read', D);
    const passage = rowOf(ex.ct).passage_id;
    expect(rowOf(ex.ct)).toMatchObject({ status: 'served', record: true });
    await later(3 * DAY);
    expect(rowOf(ex.ct)).toMatchObject({ status: 'abandoned', record: false });
    restart();
    const up = await Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 500000, late: lateAt(DAY) });
    expect(up.key).toContain(runOf(ex.ct));
    scorerHears();
    const out = await Ch.submit({ ct: ex.ct, key: up.key, ms: 61000, lang: 'en', ended: 'timer', mic_check: 'level_ok', read_s: 61, late: lateAt(DAY) }, { waitMs: 60000 });
    expect(out.score).toMatchObject({ correct: 45 });
    const row = rowOf(ex.ct);
    expect(row).toMatchObject({ status: 'scored', record: true, passage_id: passage, score: { correct: 45 } });
    expect(row.wcpm).toBeGreaterThan(0);
    expect(row.meta.late).toEqual({ played_at: iso(T0 + DAY), received_at: iso(T0 + 3 * DAY), age_s: 3 * 24 * 3600, record: 'restored' });
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
    restart();
    expect(await errOf(Ch.presignUpload({ ct: ex.ct, type: 'audio/webm', size: 500000, late: lateAt(DAY) }))).toEqual(DONE);
  });
});

describe('listening: the answers given with no network', () => {
  test('today: an answer with a lapsed token is refused', async () => {
    on(...SERVED);
    const ex = await Ch.exercise(hub(), 'listen', D);
    const qs = (await Ch.questions({ ct: ex.ct })).questions;
    await later(3 * DAY);
    restart();
    expect(await errOf(Ch.answer({ ct: ex.ct, q: qs[0].id, pick: 0, late: lateAt(DAY) }))).toEqual(BAD_TOKEN);
  });

  test('on: the answers go to the run whose questions the child was given (the sweep had failed it): scored, still the record', async () => {
    on(...SERVED, LATE, LATE_RECORD);
    const ex = await Ch.exercise(hub(), 'listen', D);
    const qs = (await Ch.questions({ ct: ex.ct })).questions;   // kept on the Chromebook when it got ready
    expect(qs.length).toBeGreaterThan(0);
    expect(await later(3 * DAY)).toMatchObject({ swept: 1 });
    expect(rowOf(ex.ct)).toMatchObject({ status: 'failed', record: true });
    restart();
    // the questions asked again late are the same, in the run's own order of choices
    expect((await Ch.questions({ ct: ex.ct, late: lateAt(DAY) })).questions.map((q) => q.options)).toEqual(qs.map((q) => q.options));
    for (const q of qs) await Ch.answer({ ct: ex.ct, q: q.id, pick: 0, late: lateAt(DAY) });
    const row = rowOf(ex.ct);
    expect(row).toMatchObject({ status: 'scored', record: true, score: { n: qs.length } });
    expect(row.meta.late).toEqual({ played_at: iso(T0 + DAY), received_at: iso(T0 + 3 * DAY), age_s: 3 * 24 * 3600 });
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
  });
});
