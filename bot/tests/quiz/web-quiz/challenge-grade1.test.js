'use strict';
/**
 * The grade-1 number identification form ("how many dots?"), behind `web_quiz_challenge_g1` under
 * `web_quiz_challenge_v2`, both OFF by default.
 *
 * Golden first: with either switch off a grade-1 child is `not_eligible` exactly as today, and the menu and
 * exercise payloads of grades 2-5 do not move when the switches are on. Then the form itself: ten dot items
 * (block G1A, fixed order 3 7 1 9 4 10 2 6 0 8, the same in both languages), three numeral tiles each, no
 * clip needed; scored tap by tap with no stop; the run row inserted at serve with form G1, anchor block G1A and
 * no band, never among the G3/G5 rows; `anchor_exposure_no` counts counted Trails only.
 * Faked boundaries only (Supabase, R2, speech, the LLM client, Redis); the service, tokens and bank run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}?X-Amz-Signature=x`),
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

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const seed = () => require('../../../scripts/challenge-registry-seed');
const G1Mod = () => require('../../../shared/services/quiz/web-quiz-challenge-grade1');

const KID = '44444444-4444-4444-8444-444444444444';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SESSION = '66666666-6666-4666-8666-666666666666';
const SC = '33333333-3333-4333-8333-333333333333';
const V2 = { key: 'web_quiz_challenge_v2', value: true };
const G1 = { key: 'web_quiz_challenge_g1', value: true };
const PERIOD = { key: 'web_quiz_challenge_period', value: true };
const ITEMS = { key: 'web_quiz_challenge_items', value: true };
const ORDER = [3, 7, 1, 9, 4, 10, 2, 6, 0, 8];
const NOV = Date.parse('2026-11-10T06:00:00Z');
const DEC = Date.parse('2026-12-10T06:00:00Z');
const NO_TEST_WORDS = /\b(test|tests|testing|egra|egma|assessment|exam)\b|ٹیسٹ|امتحان|جائزہ/i;

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
beforeEach(() => {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '1', section: 'A', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST, student_name: 'Zara Testwala' }],
    quiz_share_codes: [{ id: SC, language: 'en' }],
    quiz_sessions: [{ id: SESSION, student_id: KID, share_code_id: SC, quiz_id: 'q1' }],
    challenge_periods: Bank.periodsV4().map((p) => ({ period_id: p.period_id, starts_at: p.starts_at, ends_at: p.ends_at })),
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOV);
});
afterEach(() => { jest.restoreAllMocks(); });
// Every run row a test leaves behind holds the runs CHECKs (web_quiz_challenge_runs_v2.sql, _sampling.sql); NULL passes.
const RUN_CHECKS = {
  wqcr_sample_arm_chk: (r) => r.sample_arm == null || ['class_round', 'class_week', 'coach', 'ping'].includes(r.sample_arm),
  wqcr_admin_mode_chk: (r) => r.admin_mode == null || ['self_run', 'teacher_present', 'coach_present'].includes(r.admin_mode),
  wqcr_arm_needs_admin_chk: (r) => r.sample_arm == null || r.admin_mode != null,
  wqcr_serves_any_chk: (r) => r.anchor_serves_any == null || r.anchor_serves_any >= 1,
  wqcr_record_is_check_chk: (r) => r.record !== true || r.mode === 'check',
  wqcr_record_first_exposure_chk: (r) => r.record !== true || r.anchor_block != null || r.exposure_no == null || r.exposure_no === 1,
  wqcr_mode_chk: (r) => r.mode == null || ['check', 'practice', 'class_round'].includes(r.mode),
};
afterEach(() => {
  const broken = (db.web_quiz_challenge_runs || []).flatMap((r) => Object.keys(RUN_CHECKS).filter((k) => !RUN_CHECKS[k](r)).map((k) => `${r.id}: ${k}`));
  expect(broken).toEqual([]);
});

const D = { device: 'FamilyPhoneDeviceRef_1' };
const hub = () => T.sign({ k: 'h', ids: [KID], exp: Math.floor(Date.now() / 1000) + 3600 });
const on = (...flags) => flags.forEach((f) => db.app_settings.push(f));
const errOf = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected a refusal'); };
const shape = (e) => ({ ctor: e.constructor.name, status: e.status, body: e.body, message: e.message });
const grade = (g) => { db.student_lists[0].class_name = String(g); };
const runs = () => db.web_quiz_challenge_runs;
const allRight = (items, ms = 2000) => items.map((it, i) => ({ i, pick: it.n, ms, first_tap_ms: ms }));
const play = async (taps = allRight, lang = 'en') => {
  const ex = await Ch.exercise(hub(), 'numbers', { ...D, lang });
  const r = await Ch.submit({ ct: ex.ct, taps: taps(ex.items), ms: 30000 });
  return { ex, r, row: runs().find((x) => x.id === T.verify(ex.ct, 'c').r) };
};

describe('golden: either switch off ⇒ a grade-1 child is not_eligible, exactly as today', () => {
  test('the refusal has the same shape as an out-of-range grade today, for menu and exercise', async () => {
    grade(7);
    const today = shape(await errOf(Ch.menu(hub(), D)));
    expect(today).toMatchObject({ status: 403, body: { error: 'not_eligible' } });
    grade(1);
    for (const flags of [[], [G1], [V2], [PERIOD, G1]]) {
      db.app_settings = [{ key: 'web_quiz_challenge', value: true }, ...flags];
      Ch.__reset();
      expect(shape(await errOf(Ch.menu(hub(), D)))).toEqual(today);
      expect(shape(await errOf(Ch.exercise(hub(), 'bigger', D)))).toEqual(today);
      // 'numbers' is no exercise today: refused before anyone is looked up, as before
      expect(shape(await errOf(Ch.exercise(hub(), 'numbers', D)))).toMatchObject({ status: 404, body: { error: 'not_found' } });
    }
    expect(runs()).toEqual([]);
  });

  test('formFor: grade 1 is a form only when asked with the switch on', () => {
    expect(Ch.formFor(1)).toBeNull();
    expect(Ch.formFor(1, { g1: false })).toBeNull();
    expect(Ch.formFor(1, { g1: true })).toBe('1');
    expect([2, 3, 4, 5, 6].map((g) => Ch.formFor(g, { g1: true }))).toEqual(['3', '3', '5', '5', null]);
  });

  test('grades 2-5: the grade-1 switch never moves a menu, an exercise payload or ch_start', async () => {
    const snap = async (flags) => {
      db.app_settings = [{ key: 'web_quiz_challenge', value: true }, ...flags];
      const out = {};
      for (const g of [2, 3, 4, 5]) {
        grade(g);
        db.web_quiz_challenge_runs = [];
        Ch.__reset();
        logEvent.mockClear();
        const m = await Ch.menu(hub(), D);
        const { ct, ...ex } = await Ch.exercise(hub(), 'bigger', D);
        const start = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.ch_start').map(([, f]) => Object.keys(f).sort());
        const numbers = shape(await errOf(Ch.exercise(hub(), 'numbers', D)));
        out[g] = { m, ex, start, numbers, hasCt: typeof ct === 'string' };
      }
      return out;
    };
    const off = await snap([]);
    expect(await snap([G1])).toEqual(off);
    expect(await snap([V2, G1, PERIOD])).toEqual(await snap([V2, PERIOD]));
    expect(off[3].m.form).toBe('G3');
    expect(off[5].m.form).toBe('G5');
    expect(off[3].start).toEqual([['grade', 'run', 'step']]);
    expect(off[3].numbers).toMatchObject({ status: 404, body: { error: 'not_found' } });
  });
});

describe('the form, switches on: dots to a numeral, tap only', () => {
  beforeEach(() => on(V2, G1));

  test('the menu lists one stop, numbers, for form G1', async () => {
    const m = await Ch.menu(hub(), D);
    expect(m.form).toBe('G1');
    expect(m.exercises.map((e) => e.id)).toEqual(['numbers']);
    expect(m.exercises[0]).toMatchObject({ id: 'numbers', done: false, anchor_block: 'G1A' });
    expect(NO_TEST_WORDS.test(JSON.stringify(m))).toBe(false);
  });

  test('each item: a layout, n in 0..10, three numeric tiles holding n; nothing audio-only; no read, no mic, no typing', async () => {
    const ex = await Ch.exercise(hub(), 'numbers', D);
    expect(ex).toMatchObject({ ex: 'numbers', form: 'G1', anchor_block: 'G1A', stop_after: 0, per_item_s: 10, sound_off_safe: true });
    expect(ex.items).toHaveLength(10);
    for (const it of ex.items) {
      expect(Object.keys(it).sort()).toEqual(['item_id', 'layout', 'n', 'tiles']);
      expect(it.layout).toBe('tenframe');
      expect(Number.isInteger(it.n) && it.n >= 0 && it.n <= 10).toBe(true);
      expect(it.tiles).toHaveLength(3);
      expect(it.tiles.every((t) => typeof t === 'number' && Number.isInteger(t))).toBe(true);
      expect(new Set(it.tiles).size).toBe(3);
      expect(it.tiles).toContain(it.n);
      const allowed = [it.n - 1, it.n + 1, it.n - 2, it.n + 2, 0, 10].filter((k) => k >= 0 && k <= 10 && k !== it.n);
      for (const t of it.tiles.filter((x) => x !== it.n)) expect(allowed).toContain(t);
    }
    for (const k of ['story', 'secs', 'live', 'questions_on', 'story_clip', 'read_times', 'first_key_s', 'practice', 'mic']) expect(ex).not.toHaveProperty(k);
    expect(ex.clips).toBeUndefined();
    expect(NO_TEST_WORDS.test(JSON.stringify(ex))).toBe(false);
  });

  test('fixed order 3 7 1 9 4 10 2 6 0 8, the same items in English and Urdu', async () => {
    const en = await Ch.exercise(hub(), 'numbers', { ...D, lang: 'en' });
    const ur = await Ch.exercise(hub(), 'numbers', { ...D, lang: 'ur' });
    expect(en.items.map((i) => i.n)).toEqual(ORDER);
    expect(ur.items).toEqual(en.items);
    expect([en.lang, ur.lang]).toEqual(['en', 'ur']);
    expect(en.items.map((i) => i.item_id)).toEqual(ORDER.map((n) => `numid.G1.A.${String(n).padStart(2, '0')}`));
  });

  test('a grade-1 child gets only numbers; an older child never gets numbers', async () => {
    await expect(Ch.exercise(hub(), 'bigger', D)).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    await expect(Ch.exercise(hub(), 'read', D)).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    grade(3);
    Ch.__reset();
    await expect(Ch.exercise(hub(), 'numbers', D)).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
  });
});

describe('scoring: a tap per item, no stop', () => {
  const items = ORDER.map((n) => ({ n }));
  test('scoreNumberId: all right 10/10; no tap wrong; a tap after per_item_s wrong; never a stop', () => {
    const { scoreNumberId } = G1Mod();
    expect(scoreNumberId(items, allRight(items)).score).toEqual({ correct: 10, n: 10, stopped: false });
    expect(scoreNumberId(items, []).score).toEqual({ correct: 0, n: 10, stopped: false });
    const late = allRight(items).map((t, i) => (i === 0 ? { ...t, ms: 10001 } : t));
    expect(scoreNumberId(items, late).score.correct).toBe(9);
    const wrong = items.map((it, i) => ({ i, pick: it.n === 10 ? 9 : it.n + 1, ms: 1500 }));
    const r = scoreNumberId(items, wrong);
    expect(r.score).toEqual({ correct: 0, n: 10, stopped: false });
    expect(r.rows).toHaveLength(10);
    expect(r.rows[0]).toEqual({ i: 1, item_id: null, pick: 4, ok: false, ms: 1500, first_tap_ms: null });
    const missing = scoreNumberId(items, allRight(items).filter((t) => t.i !== 4));
    expect(missing.score.correct).toBe(9);
    expect(missing.rows[4]).toMatchObject({ i: 5, ok: null, pick: null, ms: null });
  });

  test('submit scores the served row; the child gets the score only; timings land in meta.items', async () => {
    on(V2, G1, ITEMS);
    const { r, row } = await play();
    expect(r).toEqual({ score: { correct: 10, n: 10, stopped: false } });
    expect(row).toMatchObject({ status: 'scored', score: { correct: 10, n: 10, stopped: false } });
    expect(row.meta.items).toHaveLength(10);
    expect(row.meta.items[0]).toEqual({ i: 1, item_id: 'numid.G1.A.03', pick: 3, ok: true, ms: 2000, first_tap_ms: 2000 });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.ch_done', expect.objectContaining({ step: 'numbers', count: 10, n: 10, stopped: false }));
  });

  test('a run is scored once', async () => {
    on(V2, G1);
    const { ex } = await play();
    await expect(Ch.submit({ ct: ex.ct, taps: [] })).rejects.toMatchObject({ status: 409, body: { error: 'already_done' } });
  });
});

describe('its own statement row, never pooled with G2-5', () => {
  test('the served row: form G1, block G1A, band NULL, record and mode decided at serve', async () => {
    on(V2, G1, PERIOD);
    const ex = await Ch.exercise(hub(), 'numbers', D);
    const row = runs()[0];
    expect(row).toMatchObject({
      id: T.verify(ex.ct, 'c').r, student_id: KID, exercise: 'numbers', grade: 1, lang: 'en', status: 'served',
      form: 'G1', anchor_block: 'G1A', anchor_exposure_no: 1, band: null, mode: 'check', record: true, period_id: '2026-11',
      exposure_no: 1, bank_version: 'child-test-items-v4', set: 'A', canonical_id: KID, passage_id: null, item_set_id: null,
    });
    expect(row).toMatchObject({ via: 'hub', id_src: null, id_confidence: null, homonym_in_list: null, draw_seed: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(row.meta).toMatchObject({ fixed_band: 'G1', grade_fixed_src: 'visit_grade', pick_src: 'absent', anchor_serves_any: 1 });
    expect(ex).toMatchObject({ mode: 'check', record: true, period_id: '2026-11', anchor_exposure_no: 1, exposure_no: 1, passage_id: null, item_set_id: null, draw: { outcome: 'served' } });
    const start = logEvent.mock.calls.find(([n]) => n === 'web_quiz.ch_start')[1];
    expect(start).toEqual({
      step: 'numbers', grade: 1, run: row.id, w: 's', mode: 'check', period_id: '2026-11', form: 'G1', band: null, rung: null, item_set_id: null,
      exposure_no: 1, anchor_exposure_no: 1, anchor_serves_any: 1, anchor_block: 'G1A', record: true, via: 'hub',
    });
    const { data } = await supabase.from('web_quiz_challenge_runs').select('*').in('form', ['G3', 'G5']);
    expect(data).toEqual([]);
    const { data: g1 } = await supabase.from('web_quiz_challenge_runs').select('*').eq('form', 'G1');
    expect(g1).toHaveLength(1);
  });
});

describe('anchor_exposure_no counts counted Trails; practice never increments', () => {
  test('1 on the first counted Trail, 2 on the second; a replay in the period is practice', async () => {
    on(V2, G1, PERIOD);
    const first = await play();
    expect(first.row).toMatchObject({ mode: 'check', record: true, anchor_exposure_no: 1, period_id: '2026-11' });
    expect((await Ch.menu(hub(), D)).exercises[0].done).toBe(true);

    const replay = await play();
    expect(replay.row).toMatchObject({ mode: 'practice', record: false, period_id: '2026-11', exposure_no: 2 });
    expect(replay.ex).toMatchObject({ mode: 'practice', record: false });

    Date.now.mockReturnValue(DEC);
    expect((await Ch.menu(hub(), D)).exercises[0].done).toBe(false);
    const second = await play();
    expect(second.row).toMatchObject({ mode: 'check', record: true, anchor_exposure_no: 2, period_id: '2026-12', exposure_no: 3 });
    const again = await play();
    expect(again.row).toMatchObject({ mode: 'practice', record: false, anchor_exposure_no: 3 });
  });

  test('a served row left unfinished still holds the period record', async () => {
    on(V2, G1, PERIOD);
    await Ch.exercise(hub(), 'numbers', D);
    const next = await Ch.exercise(hub(), 'numbers', D);
    expect(next).toMatchObject({ mode: 'practice', record: false, anchor_exposure_no: 2 });
  });

  test('period rule off (or no period holds now): record NULL, period_id NULL, practice once a run is scored', async () => {
    on(V2, G1);
    const a = await play();
    Date.now.mockReturnValue(DEC);
    const b = await play();
    expect(a.row).toMatchObject({ mode: 'check', record: null, period_id: null, anchor_exposure_no: 1 });
    expect(b.row).toMatchObject({ mode: 'practice', record: null, period_id: null, anchor_exposure_no: 2 });
    expect((await Ch.menu(hub(), D)).exercises[0].done).toBe(true);
    on(PERIOD);
    db.challenge_periods = [];
    Ch.__reset();
    const c = await play();
    expect(c.row).toMatchObject({ mode: 'practice', record: null, period_id: null });
  });

  test('rows written under the raw student id before canonical_id count too', async () => {
    on(V2, G1, PERIOD);
    runs().push({ id: 'r-old', student_id: KID, canonical_id: null, exercise: 'numbers', status: 'scored', mode: 'check', record: true,
      period_id: '2026-11', anchor_block: 'G1A', created_at: '2026-11-02T06:00:00Z' });
    const ex = await Ch.exercise(hub(), 'numbers', D);
    expect(ex).toMatchObject({ mode: 'practice', record: false, anchor_exposure_no: 2, exposure_no: 2 });
  });
});

describe('the sampling fields and a class round turn, as the v2 serve writes them', () => {
  test('a home serve: self_run, no arm, anchor_serves_any 1 on the first G1A row and 2 on a replay (columns and meta)', async () => {
    on(V2, G1, PERIOD);
    const first = await play();
    expect(first.row).toMatchObject({ admin_mode: 'self_run', sample_arm: null, anchor_serves_any: 1 });
    expect(first.row.meta).toMatchObject({ admin_mode: 'self_run', sample_arm: null, anchor_serves_any: 1 });
    const replay = await play();
    expect(replay.row).toMatchObject({ mode: 'practice', admin_mode: 'self_run', sample_arm: null, anchor_serves_any: 2 });
  });

  test('a class round turn (mode class_round): teacher_present in the class_round arm, never a record', async () => {
    on(V2, G1, PERIOD);
    const ex = await Ch.exercise(hub(), 'numbers', { ...D, mode: 'class_round' });
    const row = runs().find((x) => x.id === T.verify(ex.ct, 'c').r);
    expect(row).toMatchObject({ mode: 'class_round', record: false, admin_mode: 'teacher_present', sample_arm: 'class_round', anchor_serves_any: 1 });
    expect(row.meta).toMatchObject({ admin_mode: 'teacher_present', sample_arm: 'class_round' });
  });

  test('period rule off: a scored class round turn or practice play of numbers never makes the next home serve practice', async () => {
    on(V2, G1);
    const prior = { student_id: KID, canonical_id: KID, exercise: 'numbers', status: 'scored', record: null, period_id: null, anchor_block: 'G1A' };
    runs().push({ ...prior, id: 'r-round', mode: 'class_round', via: 'class_round', created_at: '2026-11-02T06:00:00Z' },
      { ...prior, id: 'r-turn', mode: 'practice', via: 'class_round', created_at: '2026-11-03T06:00:00Z' },
      { ...prior, id: 'r-story', mode: 'practice', via: 'hub', created_at: '2026-11-04T06:00:00Z' });
    const ex = await Ch.exercise(hub(), 'numbers', D);
    expect(ex).toMatchObject({ mode: 'check', record: null, period_id: null });
    expect(runs().find((x) => x.id === T.verify(ex.ct, 'c').r)).toMatchObject({ mode: 'check', admin_mode: 'self_run' });
  });
});

describe('bank and registry: the G1A block and its practice layouts', () => {
  test('G1A: ten operational check anchors in the fixed order; .05 authored but not in the block', () => {
    const block = Bank.anchorBlock('G1A');
    expect(block.map((i) => i.n)).toEqual(ORDER);
    expect(block.map((i) => i.anchor_pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(block.every((i) => i.task === 'number_id' && i.layout === 'tenframe' && i.answer === i.n && i.band === 1)).toBe(true);
    for (const { item_id } of block) {
      expect(Bank.getItemV4(item_id)).toMatchObject({ form: 'G1', pool: 'check', status: 'operational', anchor: true, anchor_block: 'G1A' });
    }
    expect(Bank.getItemV4('numid.G1.A.05')).toMatchObject({ task: 'number_id', form: 'G1', pool: 'check', status: 'operational', anchor: false, anchor_block: null, params: { n: 5, layout: 'tenframe' } });
    expect(Bank.anchorBlocksFor('2026-11')).toEqual(['A1']);
  });

  test('the seed carries the eleven numid.G1.A rows', () => {
    const rows = seed().itemRows().filter((r) => r.item_id.startsWith('numid.G1.A.'));
    expect(rows.map((r) => r.item_id).sort()).toEqual(Array.from({ length: 11 }, (_, k) => `numid.G1.A.${String(k).padStart(2, '0')}`));
    for (const r of rows) {
      expect([r.task, r.form, r.pool, r.status]).toEqual(['number_id', 'G1', 'check', 'operational']);
      expect([r.anchor, r.anchor_block]).toEqual(r.item_id === 'numid.G1.A.05' ? [false, null] : [true, 'G1A']);
    }
  });

  test('practice layouts: scatter and line, numerals 0-10, practice pool, hashes disjoint from the check items', () => {
    const p = Bank.numberIdPractice();
    expect(p).toHaveLength(22);
    expect([...new Set(p.map((i) => i.layout))].sort()).toEqual(['line', 'scatter']);
    expect(p.map((i) => i.n).sort((a, b) => a - b)).toEqual(Array.from({ length: 11 }, (_, k) => [k, k]).flat());
    const check = new Set(seed().itemRows().map((r) => r.params_hash));
    for (const it of p) {
      expect(it.pool).toBe('practice');
      expect(it.item_id).toBe(`numid.practice.${Bank.paramsHash(it.params).slice(0, 8)}`);
      expect(check.has(Bank.paramsHash(it.params))).toBe(false);
      expect(it.params.tiles).toContain(it.n);
    }
  });
});

describe('as the v2 serve does: identity, class, light, the draw log, one event writer, no unstored counted run', () => {
  const CLS = 'c1a55000-0000-4000-8000-000000000011';
  const HUB = { key: 'web_quiz_hub', value: true };
  const CANON = { key: 'web_quiz_identity_canon', value: true };
  const EV2 = { key: 'web_quiz_events_v2', value: true };
  const FLAG_MODS = ['../../../shared/services/quiz/web-quiz-identity-flags', '../../../shared/services/quiz/web-quiz-hub-flags'];
  const resetFlags = () => { for (const m of FLAG_MODS) { const x = require(m); if (x._resetCache) x._resetCache(); } };
  const Draw = require('../../../shared/services/quiz/web-quiz-challenge-draw');
  const named = (n) => logEvent.mock.calls.filter(([e]) => e === n).map(([, d]) => d);
  beforeEach(resetFlags);
  afterEach(resetFlags);

  test('child_identity is written at the first counted play (fixed grade 1), never by a practice play', async () => {
    on(V2, G1, PERIOD, HUB, CANON);
    db.child_identity = [];
    await Ch.exercise(hub(), 'numbers', D);
    expect(db.child_identity).toEqual([expect.objectContaining({ canonical_id: KID, year_code: Draw.yearCode(new Date(NOV)), fixed_grade: 1, grade_source: 'roster_class' })]);
    const again = await Ch.exercise(hub(), 'numbers', D);
    expect(again.mode).toBe('practice');
    expect(db.child_identity).toHaveLength(1);
  });

  test('class_id on the row from the active enrolment; one light_lit at the finished first exposure, none on exposure 2', async () => {
    on(V2, G1, PERIOD);
    db.classes = [{ id: CLS, grade_code: 'grade_1', is_active: true }];
    db.class_enrollments = [{ id: 'e1', class_id: CLS, student_id: KID, is_active: true }];
    const first = await play();
    expect(first.row).toMatchObject({ class_id: CLS, exposure_no: 1, status: 'scored' });
    expect(named('web_quiz.light_lit')).toHaveLength(1);
    expect(JSON.stringify(named('web_quiz.light_lit'))).not.toContain(CLS);
    const second = await play();
    expect(second.row).toMatchObject({ class_id: CLS, exposure_no: 2 });
    expect(named('web_quiz.light_lit')).toHaveLength(1);
  });

  test('the G1A serve logs its challenge_draws row (anchor, p 1), and the row and meta.draw carry it', async () => {
    on(V2, G1, PERIOD);
    db.challenge_draws = [];
    const ex = await Ch.exercise(hub(), 'numbers', D);
    const row = runs()[0];
    expect(db.challenge_draws).toEqual([expect.objectContaining({
      run_id: row.id, canonical_id: KID, period_id: '2026-11', stop: 'numbers', lang: 'en', fixed_grade_band: 'G1', open_band: null, band: null,
      band_reason: 'anchor', eligible: [{ id: 'G1A', w: 1 }], eligible_n: 1, ref_eligible: false, p: 1, weights_v: 'w1', served_id: 'G1A', outcome: 'served',
    })]);
    const d = db.challenge_draws[0];
    expect(row.draw_seed).toBe(d.seed);
    expect(row.meta.draw).toMatchObject({ draw_id: d.draw_id, band_reason: 'anchor', p: 1, seed: d.seed });
    expect(ex.draw).toEqual({ outcome: 'served' });
  });

  test('one ch_open and one ch_start each, and with events v2 on ch_start goes through the measurement envelope (kid rides)', async () => {
    process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(48);
    process.env.WEB_QUIZ_KID_KEY_V = '1';
    on(V2, G1, PERIOD, HUB, EV2);
    await Ch.menu(hub(), D);
    expect(named('web_quiz.ch_open')).toHaveLength(1);
    await Ch.exercise(hub(), 'numbers', D);
    const starts = named('web_quiz.ch_start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ step: 'numbers', kid: require('../../../shared/services/quiz/web-quiz-kid').kid(KID), form: 'G1', anchor_block: 'G1A', mode: 'check', record: true, period_id: '2026-11' });
    expect(typeof starts[0].kid).toBe('string');
    expect(JSON.stringify(starts[0])).not.toContain(KID);
    delete process.env.WEB_QUIZ_KID_KEY;
    delete process.env.WEB_QUIZ_KID_KEY_V;
  });

  test('a serve whose row is not stored is refused: no token, no second first exposure', async () => {
    on(V2, G1, PERIOD);
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'web_quiz_challenge_runs') b.insert = () => ({ then: (res, rej) => Promise.resolve({ data: null, error: { code: '42703', message: 'column "form" does not exist' } }).then(res, rej) });
      return b;
    };
    await expect(Ch.exercise(hub(), 'numbers', D)).rejects.toMatchObject({ status: 503, body: { error: 'unavailable' } });
    expect(runs()).toEqual([]);
  });
});

describe('the finished grade-1 row: m_result and the phone bindings, as every stop', () => {
  const FLAG_MODS = ['../../../shared/services/quiz/web-quiz-identity-flags', '../../../shared/services/quiz/web-quiz-hub-flags'];
  const resetFlags = () => { for (const m of FLAG_MODS) { const x = require(m); if (x._resetCache) x._resetCache(); } };
  const named = (n) => logEvent.mock.calls.filter(([e]) => e === n).map(([, d]) => d);
  const OLD_EXPIRY = '2026-12-01T00:00:00.000Z';
  // WQ_TOMB_SALT is web_quiz_phone_bind's hard parent (web-quiz-identity-flags): a test-only value, so the switch can be on
  beforeEach(() => { resetFlags(); process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(48); process.env.WEB_QUIZ_KID_KEY_V = '1'; process.env.WQ_TOMB_SALT = 'test-only-salt'; });
  afterEach(() => { resetFlags(); delete process.env.WEB_QUIZ_KID_KEY; delete process.env.WEB_QUIZ_KID_KEY_V; delete process.env.WQ_TOMB_SALT; });

  test('one m_result with form G1 and fixed_band G1; a bound child\'s expires_at moves', async () => {
    on(V2, G1, PERIOD, ...['web_quiz_hub', 'web_quiz_events_v2', 'web_quiz_identity_canon', 'web_quiz_phone_bind'].map((key) => ({ key, value: true })));
    db.child_phone_bindings = [{ id: 'b1', canonical_id: KID, phone_norm: '923001234567', via: 'save', bound_at: '2026-11-01T00:00:00.000Z',
      last_played_at: null, expires_at: OLD_EXPIRY, revoked_at: null }];
    const { row } = await play();
    const results = named('web_quiz.m_result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ run: row.id, form: 'G1', fixed_band: 'G1', band: null, exercise: 'numbers', anchor_block: 'G1A', mode: 'check', ok_n: 10, n: 10 });
    expect(db.child_phone_bindings[0].expires_at).not.toBe(OLD_EXPIRY);
    expect(db.child_phone_bindings[0].last_played_at).not.toBeNull();
  });
});
