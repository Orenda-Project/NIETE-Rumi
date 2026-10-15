'use strict';
/**
 * The Challenge served under web_quiz_challenge_v2 (parent), web_quiz_challenge_period (the record rule per PKT month)
 * and web_quiz_challenge_pool (the child-visible draw): the run row inserted at serve with its provenance, the draw
 * logged twice, "on its way", the A1 warm-up and the silent try-out item, the menu per period, questions by stop line.
 * Every new switch off (or only the children on): today's payloads, rows and events, byte for byte.
 * Faked boundaries only (Supabase, R2, speech, the LLM client); the service, the draw, the loader and the scorer are real.
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
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const AudioService = require('../../../shared/services/audio.service');
const llm = require('../../../shared/services/llm-client');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const K3 = '44444444-4444-4444-8444-444444444444';
const K5 = '55555555-5555-4555-8555-555555555555';
const K2 = '77777777-7777-4777-8777-777777777777';
const L3 = 'a0000000-0000-4000-8000-000000000003';
const L5 = 'a0000000-0000-4000-8000-000000000005';
const L2 = 'a0000000-0000-4000-8000-000000000002';
const SC = '33333333-3333-4333-8333-333333333333';
const SESSION = '66666666-6666-4666-8666-666666666666';

const BASE_FLAGS = ['web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_listen', 'web_quiz_challenge_questions'];
const V2 = 'web_quiz_challenge_v2';
const PERIOD = 'web_quiz_challenge_period';
const POOL = 'web_quiz_challenge_pool';
const on = (...keys) => keys.forEach((key) => db.app_settings.push({ key, value: true }));

const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();
// The current period always holds "now"; the previous one is the month before.
const periodsNow = () => [
  { period_id: '2026-10', starts_at: iso(Date.now() - 40 * DAY), ends_at: iso(Date.now() - DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
  { period_id: '2026-11', starts_at: iso(Date.now() - DAY), ends_at: iso(Date.now() + 29 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
];
const REL = '2026-10-01T00:00:00Z';
const reg = (id, extra = {}) => {
  const [lang, kind, band] = id.split('.');
  return { passage_id: id, lang, kind, band: Number(band), pool: 'check', status: 'calibrated', is_reference: false, released_at: REL, withdrawn_at: null, twin_of: null, ...extra };
};
const REGISTRY = () => [
  reg('en.read.2.setA', { is_reference: true }), reg('ur.read.2.setA', { is_reference: true }),
  reg('en.listen.2.setA', { is_reference: true, twin_of: 'en.read.2.setA' }), reg('ur.listen.2.setA', { is_reference: true, twin_of: 'ur.read.2.setA' }),
  reg('en.read.1.ref01', { is_reference: true }), reg('en.read.1.kite', { status: 'provisional' }),
  reg('en.read.3.ref01', { is_reference: true }),
];

// Authored passages for the draw, loaded from a fixture directory (the shipped directory has none yet).
const PDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wqpass-'));
const passage = (id, words, questions) => {
  const [lang, kind, band] = id.split('.');
  const text = words.join(' ');
  fs.writeFileSync(path.join(PDIR, `${id}.json`), JSON.stringify({
    passage_id: id, lang, kind, band: Number(band), pool: 'check', status_at_authoring: 'reviewed', is_reference: false,
    text, lines: [{ n: 1, from: 0, to: 4 }, { n: 2, from: 5, to: 9 }, { n: 3, from: 10, to: words.length - 1 }],
    tokens: words, questions, twin_of: null, bank_version: 'child-test-items-v4',
  }));
};
const Q = (id, needs, tap = true) => ({ id, prompt: `Who is ${id}?`, type: 'literal', needs_line: needs, tap_ok: tap, accept: ['the girl'], reject: ['the dog', 'the cat', 'the tree'], rubric: '' });
const W12 = ['Hina', 'saw', 'a', 'red', 'kite', 'It', 'flew', 'over', 'the', 'school', 'She', 'smiled', 'and', 'ran', 'home'];
passage('en.read.1.ref01', W12, [Q('en.read.1.ref01.q1', 1), Q('en.read.1.ref01.q2', 1), Q('en.read.1.ref01.q3', 2), Q('en.read.1.ref01.q4', 3)]);
passage('en.read.1.kite', W12, [Q('en.read.1.kite.q1', 1), Q('en.read.1.kite.q2', 2, false), Q('en.read.1.kite.q3', 2)]);
passage('en.read.3.ref01', W12, [Q('en.read.3.ref01.q1', 1)]);

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; Bank._loadPassagesFrom(PDIR); });
afterAll(() => { Bank._loadPassagesFrom(); });
beforeEach(() => {
  db = {
    app_settings: BASE_FLAGS.map((key) => ({ key, value: true })),
    student_lists: [{ id: L3, class_name: '3', is_active: true }, { id: L5, class_name: '5', is_active: true }, { id: L2, class_name: '2', is_active: true }],
    students: [{ id: K3, list_id: L3, student_name: 'Sana Testwala' }, { id: K5, list_id: L5, student_name: 'Bilal Testwala' }, { id: K2, list_id: L2, student_name: 'Ayesha Testwala' }],
    quiz_share_codes: [{ id: SC, language: 'en' }],
    quiz_sessions: [{ id: SESSION, student_id: K3, share_code_id: SC, quiz_id: 'q1' }],
    web_quiz_challenge_runs: [],
    challenge_periods: periodsNow(),
    challenge_passages: REGISTRY(),
    challenge_draws: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  jest.clearAllMocks();
  r2.headObject.mockImplementation(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' }));
});

const D = { device: 'FamilyPhoneDeviceRef_1', lang: 'en' };
const hub = (id = K3) => T.sign({ k: 'h', ids: [id], exp: Math.floor(Date.now() / 1000) + 3600 });
const runOf = (ct) => T.verify(ct, 'c').r;
const rowOf = (ct) => db.web_quiz_challenge_runs.find((r) => r.id === runOf(ct));
const starts = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.ch_start').map(([, d]) => d);
const V2_COLS = ['bank_version', 'set', 'form', 'passage_id', 'item_set_id', 'mode', 'period_id', 'exposure_no', 'band', 'anchor_exposure_no', 'anchor_block', 'draw_seed', 'canonical_id', 'id_src', 'id_confidence', 'homonym_in_list', 'via', 'share_code_id', 'record', 'started_at'];

// Read aloud: a silent clip of `secs` seconds, the speech service heard `n` words, the LLM marked `right` of `tried`.
const FF = require('@ffmpeg-installer/ffmpeg').path;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqv2-'));
const clip = (secs) => {
  const f = path.join(dir, `s${secs}.webm`);
  if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(secs), '-c:a', 'libopus', f]);
  return fs.readFileSync(f);
};
const enTokens = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.tokens;
const heard = (n, gap) => ({ text: '', tokens: enTokens().slice(0, n).map((w, k) => ({ text: ` ${w}`, start_ms: Math.round(k * gap * 1000), end_ms: Math.round((k * gap + gap * 0.8) * 1000), speaker: 1 })) });
const marks = (right, tried) => ({ usage: { cost: 0.0021 }, choices: [{ message: { content: JSON.stringify({
  words: enTokens().map((w, k) => ({ i: k + 1, w, v: k < right ? 'correct' : k < tried ? 'wrong' : 'skipped' })), words_correct: 0, words_attempted: 0, notes: '' }) } }] });
const readAloud = async (ct) => {
  const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
  r2.downloadFromR2.mockResolvedValue(clip(61));
  AudioService.transcribe.mockResolvedValue(heard(50, 1.1));
  llm.__create.mockResolvedValue(marks(45, 50));
  return Ch.submit({ ct, key, ms: 61000, lang: 'en', ended: 'timer', mic_check: 'pass', read_s: 61 }, { waitMs: 60000 });
};
const missingAnswers = (items, wrongFirst = 0) => items.map((it, i) => ({ i, value: String(i < wrongFirst ? it.answer + 1 : it.answer), ms: 3000, first_key_ms: 1200, keys: String(it.answer).length }));
const biggerTaps = (items) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2500 }));

// ── 1 · golden ────────────────────────────────────────────────────────────────────────────────────────────

// Everything a child-facing call returns and writes, with run ids, tokens, times and clocks taken out.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => {
  if (k === 'ct' || k === 'created_at' || k === 'scored_at' || k === 'elapsed_s' || k === 'too_fast' || k === 'seconds') return undefined;
  return typeof v === 'string' && UUID.test(v) ? 'U' : v;
}));
async function trailOnce() {
  const out = {};
  out.menu = await Ch.menu(hub(), D);
  const ex = {};
  for (const id of ['missing', 'bigger', 'read', 'listen']) ex[id] = await Ch.exercise(hub(), id, D);
  out.exercises = ex;
  out.missing = await Ch.submit({ ct: ex.missing.ct, answers: missingAnswers(ex.missing.items), ms: 30000, helped: false });
  out.bigger = await Ch.submit({ ct: ex.bigger.ct, taps: biggerTaps(ex.bigger.items), ms: 25000, helped: false });
  out.read = await readAloud(ex.read.ct);
  out.rows = db.web_quiz_challenge_runs.map((r) => ({ ...r }));
  out.events = logEvent.mock.calls.filter(([n]) => /^web_quiz\.ch_(start|open|done)$/.test(n));
  out.draws = db.challenge_draws.length;
  return out;
}

describe('1 · golden: every new switch off, or only the children on — today, byte for byte', () => {
  test('off: Set A in bank order, stop after 4, no draw keys, ch_start exactly {step, grade, run}, rows without provenance', async () => {
    const out = await trailOnce();
    const m3 = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.missing' });
    expect(out.exercises.missing.items).toEqual(m3.items.map((i) => ({ seq: i.seq.slice(), answer: i.answer })));
    expect(out.exercises.missing.stop_after).toBe(4);
    expect(out.exercises.read.story.text).toBe(Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.text);
    for (const ex of Object.values(out.exercises)) {
      expect(ex.record).toBe(true);   // today's rule flag (the record switch is on), not a record decision
      for (const k of ['mode', 'period_id', 'passage_id', 'item_set_id', 'exposure_no', 'band', 'draw', 'v2', 'anchor_block', 'tryout', 'on_its_way']) expect(ex).not.toHaveProperty(k);
    }
    expect(out.menu.exercises.map((e) => e.id)).toEqual(['bigger', 'missing', 'read', 'listen']);
    expect(starts().map((d) => Object.keys(d).sort())).toEqual(Array(4).fill(['grade', 'run', 'step']));
    for (const r of out.rows) for (const c of V2_COLS) expect(r).not.toHaveProperty(c);
    expect(out.rows.map((r) => r.status)).toEqual(['scored', 'scored', 'scored']);
    expect(out.draws).toBe(0);
  });

  test('_period and _pool on with _v2 off: deep-equal to every switch off', async () => {
    const off = norm(await trailOnce());
    db.web_quiz_challenge_runs.length = 0;
    Ch.__reset(); jest.clearAllMocks();
    on(PERIOD, POOL);
    const kids = norm(await trailOnce());
    expect(kids).toEqual(off);
  });
});

// ── 3–6 · the draw: logged twice, never re-served, one band lower, then on its way ─────────────────────────

describe('3 · every draw is logged in challenge_draws AND meta.draw', () => {
  beforeEach(() => on(V2, PERIOD, POOL));

  test('served: a grade-3 child draws in band 1 (entry_grade); the row is inserted at serve with the draw', async () => {
    const ex = await Ch.exercise(hub(K3), 'read', D);
    const row = rowOf(ex.ct);
    expect(row).toMatchObject({ status: 'served', exercise: 'read', band: 1, mode: 'check', record: true, period_id: '2026-11', exposure_no: 1, form: 'G3', canonical_id: K3, via: 'hub', bank_version: 'child-test-items-v4' });
    expect(['en.read.1.ref01', 'en.read.1.kite']).toContain(row.passage_id);
    const log = db.challenge_draws[0];
    expect(db.challenge_draws).toHaveLength(1);
    expect(log).toMatchObject({ run_id: row.id, canonical_id: K3, period_id: '2026-11', stop: 'read', lang: 'en', fixed_grade_band: 'G23', open_band: 1, band: 1,
      band_reason: 'entry_grade', eligible_n: 2, ref_eligible: true, weights_v: 'w1', served_id: row.passage_id, outcome: 'served', seed: row.draw_seed });
    expect(log.eligible.map((e) => e.id)).toEqual(['en.read.1.ref01', 'en.read.1.kite']);
    expect(log.eligible.map((e) => e.w)).toEqual([expect.closeTo(0.85, 12), expect.closeTo(0.15, 12)]);
    expect(log.p).toBeCloseTo(log.eligible.find((e) => e.id === row.passage_id).w, 12);
    expect(row.draw_seed).toMatch(/^[0-9a-f]{32}$/);
    expect(row.meta.draw).toEqual({ draw_id: log.draw_id, outcome: 'served', eligible: log.eligible, eligible_n: 2, ref_eligible: true, p: log.p, band_reason: 'entry_grade', weights_v: 'w1', seed: row.draw_seed });
    // the page gets the draw-result shape and the drawn passage's text
    expect(ex).toMatchObject({ mode: 'check', record: true, period_id: '2026-11', passage_id: row.passage_id, item_set_id: null, exposure_no: 1, band: 1, anchor_block: null, anchor_exposure_no: null,
      draw: { draw_id: log.draw_id, outcome: 'served', eligible_n: 2, p: log.p, band_reason: 'entry_grade', weights_v: 'w1', seed: row.draw_seed } });
    expect(ex.story.text).toBe(W12.join(' '));
  });

  test('lower band: band 2 exhausted for a grade-5 child (Set A read before the provenance columns) → band 1, never band 3', async () => {
    db.web_quiz_challenge_runs.push({ id: 'old-1', student_id: K5, exercise: 'read', grade: 5, lang: 'en', status: 'scored', score: { correct: 50 }, meta: { counted: true }, created_at: '2026-09-01T00:00:00Z' });
    for (let k = 0; k < 6; k += 1) {
      const ex = await Ch.exercise(hub(K5), 'read', D);
      const row = rowOf(ex.ct);
      expect(row.band).toBe(1);
      expect(row.passage_id).not.toBe('en.read.3.ref01');
      expect(ex.draw).toMatchObject({ outcome: 'lower_band', band_reason: 'fallback_exhausted' });
      Object.assign(row, { status: 'abandoned', period_id: '2026-10' });   // seen (never drawn again), last month
      if (k === 1) break;
    }
    expect(db.challenge_draws.map((d) => d.outcome)).toEqual(['lower_band', 'lower_band']);
    expect(new Set(db.challenge_draws.map((d) => d.served_id))).toEqual(new Set(['en.read.1.ref01', 'en.read.1.kite']));
  });

  test('on its way: nothing unseen at band 1 → no run row, no token, no ch_start, a draw row with run_id null; a second call the same', async () => {
    for (const id of ['en.read.1.ref01', 'en.read.1.kite']) {
      db.web_quiz_challenge_runs.push({ id: `seen-${id}`, student_id: K3, canonical_id: K3, exercise: 'read', lang: 'en', status: 'scored', mode: 'practice', record: false, passage_id: id, created_at: '2026-10-20T00:00:00Z' });
    }
    const a = await Ch.exercise(hub(K3), 'read', D);
    const b = await Ch.exercise(hub(K3), 'read', D);
    expect(a).toEqual({ ex: 'read', on_its_way: true, copy: { en: 'A new story is on its way.', ur: 'ایک نئی کہانی آنے والی ہے۔' } });
    expect(b).toEqual(a);
    expect(db.web_quiz_challenge_runs).toHaveLength(2);
    expect(starts()).toEqual([]);
    expect(db.challenge_draws).toHaveLength(2);
    expect(db.challenge_draws[0]).toMatchObject({ run_id: null, outcome: 'on_its_way', eligible: [], eligible_n: 0, p: null, served_id: null, band: 1 });
  });
});

describe('4 · never re-serve (any status, any mode; twins both ways)', () => {
  beforeEach(() => on(V2, PERIOD, POOL));

  test('a row on ur.read.2.setA (abandoned practice) → never drawn; a row on its listening twin → the read is gone too', async () => {
    db.challenge_passages.push(reg('ur.read.2.kite', { status: 'provisional' }));
    passage('ur.read.2.kite', W12, [Q('ur.read.2.kite.q1', 1)]);
    Bank._loadPassagesFrom(PDIR);
    db.web_quiz_challenge_runs.push({ id: 'x1', student_id: K5, canonical_id: K5, exercise: 'read', lang: 'ur', status: 'abandoned', mode: 'practice', record: false, passage_id: 'ur.read.2.setA', created_at: '2026-10-20T00:00:00Z' });
    const a = await Ch.exercise(hub(K5), 'read', { ...D, lang: 'ur' });
    expect(a.passage_id).toBe('ur.read.2.kite');
    db.web_quiz_challenge_runs.length = 0;
    db.web_quiz_challenge_runs.push({ id: 'x2', student_id: K5, canonical_id: K5, exercise: 'listen', lang: 'ur', status: 'scored', mode: 'check', record: true, passage_id: 'ur.listen.2.setA', period_id: '2026-10', created_at: '2026-10-20T00:00:00Z' });
    const b = await Ch.exercise(hub(K5), 'read', { ...D, lang: 'ur' });
    expect(b.passage_id).toBe('ur.read.2.kite');
  });

  test('a read of en.read.2.setA removes its listening twin: the listen stop is on its way', async () => {
    db.web_quiz_challenge_runs.push({ id: 'x3', student_id: K5, canonical_id: K5, exercise: 'read', lang: 'en', status: 'scored', mode: 'check', record: true, passage_id: 'en.read.2.setA', period_id: '2026-10', created_at: '2026-10-20T00:00:00Z' });
    const l = await Ch.exercise(hub(K5), 'listen', D);
    expect(l).toMatchObject({ ex: 'listen', on_its_way: true });
  });
});

// ── 7–9 · record decided at serve ──────────────────────────────────────────────────────────────────────

describe('7 · record decided at serve: one per child × stop × period', () => {
  test('first serve record=true before any submit; the second in the period record=false practice; next period record=true again', async () => {
    on(V2, PERIOD);
    const a = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(a.ct)).toMatchObject({ status: 'served', record: true, mode: 'check', period_id: '2026-11', passage_id: 'en.read.2.setA', band: 2, set: 'A', bank_version: 'child-test-items-v3', exposure_no: 1 });
    const b = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(b.ct)).toMatchObject({ status: 'served', record: false, mode: 'practice', exposure_no: 2 });
    expect(b).toMatchObject({ practice_round: true, mode: 'practice', record: false });
    db.web_quiz_challenge_runs.forEach((r) => { r.period_id = '2026-10'; });
    const c = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(c.ct)).toMatchObject({ record: true, mode: 'check', period_id: '2026-11', exposure_no: 3 });
  });

  test('_period off with _v2 on: record and period_id NULL; the provenance is still written', async () => {
    on(V2);
    const a = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(a.ct)).toMatchObject({ status: 'served', record: null, period_id: null, mode: 'check', item_set_id: 'bigger.G3.A', set: 'A', form: 'G3', exposure_no: 1 });
  });

  test('the submit UPDATES the served row (one row per run), keeps the provenance and meta.draw, and a second submit is refused', async () => {
    on(V2, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K5), 'read', D);
    expect(ex.passage_id).toBe('en.read.2.setA');
    const draw = rowOf(ex.ct).meta.draw;
    const r = await readAloud(ex.ct);
    expect(r.score).toMatchObject({ correct: 45 });
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
    expect(rowOf(ex.ct)).toMatchObject({ status: 'scored', record: true, passage_id: 'en.read.2.setA', band: 2 });
    expect(rowOf(ex.ct).meta.draw).toEqual(draw);
    const b = await Ch.exercise(hub(K5), 'bigger', D);
    await Ch.submit({ ct: b.ct, taps: biggerTaps(b.items), ms: 25000 });
    await expect(Ch.submit({ ct: b.ct, taps: biggerTaps(b.items), ms: 25000 })).rejects.toMatchObject({ status: 409 });
    expect(db.web_quiz_challenge_runs.filter((x) => x.exercise === 'bigger')).toHaveLength(1);
  });

  test('another process scores the served row (memory gone): the warm-up is scored on its A1 items, no stop', async () => {
    on(V2, PERIOD, POOL);
    const ex = await Ch.exercise(hub(), 'missing', D);
    Ch.__reset();
    const r = await Ch.submit({ ct: ex.ct, answers: missingAnswers(ex.items, 5), ms: 40000 });
    expect(r.score).toMatchObject({ correct: 5, n: 10, stopped: false, reached: 10 });
    expect(rowOf(ex.ct)).toMatchObject({ status: 'scored', anchor_block: 'A1' });
  });

  test('listen under _v2: the served row becomes scoring when the questions are served, then scored', async () => {
    on(V2, PERIOD);
    const { ct } = await Ch.exercise(hub(), 'listen', D);
    expect(rowOf(ct)).toMatchObject({ status: 'served', passage_id: 'en.listen.2.setA', record: true });
    const qs = (await Ch.questions({ ct })).questions;
    expect(rowOf(ct)).toMatchObject({ status: 'scoring', meta: expect.objectContaining({ phase: 'listen', n: qs.length, pick_src: 'absent' }) });
    for (const q of qs) await Ch.answer({ ct, q: q.id, pick: 0 });
    expect(rowOf(ct).status).toBe('scored');
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
  });
});

describe('8 · exposure 2 never counted', () => {
  test('the bigger set a second time (next period) is exposure 2, record=false', async () => {
    on(V2, PERIOD, POOL);
    const a = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(a.ct)).toMatchObject({ item_set_id: 'bigger.G3.A', exposure_no: 1, record: true, mode: 'check' });
    expect(rowOf(a.ct).meta.draw).toMatchObject({ outcome: 'served', band_reason: 'set', p: 1, period_set: 'bigger.G3.2026-11' });
    db.web_quiz_challenge_runs.forEach((r) => { r.period_id = '2026-10'; r.status = 'scored'; });
    const b = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(b.ct)).toMatchObject({ item_set_id: 'bigger.G3.A', exposure_no: 2, record: false, mode: 'practice' });
  });
});

describe('9 · practice is never a record, whatever the switches', () => {
  test('all three on, the caller asks for practice → record=false', async () => {
    on(V2, PERIOD, POOL);
    const a = await Ch.exercise(hub(), 'missing', { ...D, mode: 'practice' });
    expect(rowOf(a.ct)).toMatchObject({ mode: 'practice', record: false });
  });
});

// ── 10 · entry band per fixed grade ─────────────────────────────────────────────────────────────────────

describe('10 · the draw band per fixed grade', () => {
  beforeEach(() => on(V2, PERIOD, POOL));

  test('grade 2 → band 1; grade 5 → band 2', async () => {
    expect(rowOf((await Ch.exercise(hub(K2), 'read', D)).ct)).toMatchObject({ band: 1 });
    expect(rowOf((await Ch.exercise(hub(K5), 'read', D)).ct)).toMatchObject({ band: 2 });
  });

  test('grade 5 after a line-1 stop on the last counted read → band 1 (line1_drop); grade 2 after one → band 1 (floor)', async () => {
    db.web_quiz_challenge_runs.push({ id: 's5', student_id: K5, canonical_id: K5, exercise: 'read', lang: 'ur', status: 'scored', score: { stopped: true }, meta: {}, mode: 'check', record: true, passage_id: 'ur.read.2.setA', period_id: '2026-10', created_at: '2026-10-20T00:00:00Z' });
    await Ch.exercise(hub(K5), 'read', D);
    expect(db.challenge_draws.pop()).toMatchObject({ band: 1, band_reason: 'line1_drop', open_band: 2 });
    db.web_quiz_challenge_runs.push({ id: 's2', student_id: K2, canonical_id: K2, exercise: 'read', lang: 'ur', status: 'failed', meta: { reason: 'unheard' }, mode: 'check', record: true, passage_id: 'ur.read.1.x', period_id: '2026-10', created_at: '2026-10-20T00:00:00Z' });
    await Ch.exercise(hub(K2), 'read', D);
    expect(db.challenge_draws.pop()).toMatchObject({ band: 1, band_reason: 'floor', open_band: 1 });
  });

  test('promoted: reading rung R3 opens band 2 for a grade-3 child; the fixed grade comes from child_identity when it has the child', async () => {
    db.child_rungs = [{ canonical_id: K3, ladder: 'reading', rung: 3, set_at: '2026-10-20T00:00:00Z' }];
    const a = await Ch.exercise(hub(K3), 'read', D);
    expect(db.challenge_draws.pop()).toMatchObject({ band: 2, band_reason: 'promoted', open_band: 2 });
    expect(rowOf(a.ct).meta).toMatchObject({ open_band_src: 'child_rungs', grade_fixed_src: 'visit_grade' });
    db.child_identity = [{ canonical_id: K3, fixed_grade: 5 }];
    db.child_rungs = [];
    db.web_quiz_challenge_runs.length = 0;
    const b = await Ch.exercise(hub(K3), 'read', D);
    expect(rowOf(b.ct)).toMatchObject({ band: 2 });
    expect(rowOf(b.ct).meta).toMatchObject({ grade_fixed_src: 'child_identity' });
    expect(db.challenge_draws.pop()).toMatchObject({ fixed_grade_band: 'G45', band_reason: 'entry_grade' });
  });
});

// ── 11 · the A1 warm-up and the silent try-out item ───────────────────────────────────────────────────────

describe('11 · the A1 warm-up', () => {
  beforeEach(() => on(V2, PERIOD, POOL));
  const A1 = () => Bank.anchorBlock('A1').map((i) => ({ item_id: i.item_id, seq: i.seq.slice(), answer: i.answer }));

  test('10 items, identical for G3 and G5, stop_after 0, anchor_block A1; anchor_exposure_no 1, a practice warm-up does not move it, 2 next period', async () => {
    const g3 = await Ch.exercise(hub(K3), 'missing', D);
    const g5 = await Ch.exercise(hub(K5), 'missing', D);
    expect(g3.items).toEqual(A1());
    expect(g5.items).toEqual(g3.items);
    expect(g3.practice).toEqual(g5.practice);
    expect(g3).toMatchObject({ stop_after: 0, anchor_block: 'A1', anchor_exposure_no: 1, item_set_id: null, passage_id: null });
    expect(rowOf(g3.ct)).toMatchObject({ anchor_block: 'A1', anchor_exposure_no: 1, mode: 'check', record: true, band: null });
    const again = await Ch.exercise(hub(K3), 'missing', D);       // same period: practice
    expect(rowOf(again.ct)).toMatchObject({ mode: 'practice', record: false, anchor_exposure_no: 2 });
    db.web_quiz_challenge_runs.forEach((r) => { r.period_id = '2026-10'; });
    const next = await Ch.exercise(hub(K3), 'missing', D);
    expect(rowOf(next.ct)).toMatchObject({ mode: 'check', record: true, anchor_exposure_no: 2 });
  });

  test('anchor_serves_any counts every serve of the block (any mode, any status): a practice warm-up then a counted one → 1 and 2', async () => {
    const p = await Ch.exercise(hub(K3), 'missing', { ...D, mode: 'practice' });
    expect(rowOf(p.ct)).toMatchObject({ mode: 'practice', anchor_exposure_no: 1, meta: expect.objectContaining({ anchor_serves_any: 1 }) });
    rowOf(p.ct).status = 'abandoned';
    const c = await Ch.exercise(hub(K3), 'missing', D);
    expect(rowOf(c.ct)).toMatchObject({ mode: 'check', record: true, anchor_exposure_no: 1, meta: expect.objectContaining({ anchor_serves_any: 2 }) });
    expect(rowOf(c.ct)).not.toHaveProperty('anchor_serves_any');   // no such column on the runs table: meta only
    expect(starts()[1]).toMatchObject({ anchor_exposure_no: 1, anchor_serves_any: 2 });
  });

  test('the try-out after item 10 is a provisional A2 candidate; its answer lands in meta.tryout, never in score; score.reached = 10', async () => {
    const ex = await Ch.exercise(hub(), 'missing', D);
    expect(ex.tryout.item_id).toMatch(/^anchor\.A2\.0[1-4]$/);
    expect(Bank.getItemV4(ex.tryout.item_id).status).toBe('provisional');
    expect(ex.tryout).not.toHaveProperty('answer');
    expect(rowOf(ex.ct).meta.tryout).toEqual({ item_id: ex.tryout.item_id });
    const it = Bank.getItemV4(ex.tryout.item_id).params;
    const right = it.ans === 'a' ? it.a : it.ans === 'b' ? it.b : it.ans;
    const r = await Ch.submit({ ct: ex.ct, answers: missingAnswers(ex.items, 4), ms: 40000, tryout: { pick: right, ms: 2000 } });
    expect(r.score).toEqual({ correct: 6, correct_5s: 6, n: 10, stopped: false, reached: 10 });
    expect(r).not.toHaveProperty('tryout');
    const row = rowOf(ex.ct);
    expect(row.score).toEqual(r.score);
    expect(row.meta.tryout).toEqual({ item_id: ex.tryout.item_id, resp: { pick: right, ms: 2000 }, ok: true });
  });
});

// ── 12 · ch_start ──────────────────────────────────────────────────────────────────────────────────────

describe('12 · ch_start server fields', () => {
  test('_v2 on: EVENTS row 4 (no kid); anchor fields only on the warm-up', async () => {
    on(V2, PERIOD, POOL);
    const r = await Ch.exercise(hub(K5), 'read', D);
    const m = await Ch.exercise(hub(K5), 'missing', D);
    const [sr, sm] = starts();
    expect(sr).toEqual({ step: 'read', grade: 5, run: runOf(r.ct), w: 's', mode: 'check', period_id: '2026-11', form: 'G5', band: 2, rung: null, passage_id: 'en.read.2.setA', exposure_no: 1, record: true, via: 'hub' });
    expect(sm).toEqual({ step: 'missing', grade: 5, run: runOf(m.ct), w: 's', mode: 'check', period_id: '2026-11', form: 'G5', band: null, rung: null, item_set_id: null, exposure_no: 1, anchor_exposure_no: 1, anchor_serves_any: 1, anchor_block: 'A1', record: true, via: 'hub' });
    expect(sr).not.toHaveProperty('kid');
  });

  test('_v2 off: exactly {step, grade, run}', async () => {
    const r = await Ch.exercise(hub(), 'read', D);
    expect(starts()).toEqual([{ step: 'read', grade: 3, run: runOf(r.ct) }]);
  });
});

// ── the menu per period and in Trail order ─────────────────────────────────────────────────────────────

describe('the menu under _period and _pool', () => {
  test('_pool: warm-up → read → listen → bigger, the warm-up carries anchor_block A1; _period: done from this period\'s record rows', async () => {
    on(V2, PERIOD, POOL);
    db.web_quiz_challenge_runs.push(
      { id: 'm1', student_id: K3, canonical_id: K3, exercise: 'bigger', status: 'scored', score: { correct: 9, n: 10 }, mode: 'check', record: true, period_id: '2026-11', item_set_id: 'bigger.G3.A', created_at: iso(Date.now() - 1000) },
      { id: 'm2', student_id: K3, canonical_id: K3, exercise: 'read', lang: 'en', status: 'scored', score: { correct: 40 }, meta: {}, mode: 'check', record: true, period_id: '2026-10', passage_id: 'en.read.2.setA', created_at: '2026-10-05T00:00:00Z' },
    );
    const m = await Ch.menu(hub(), D);
    expect(m.exercises.map((e) => e.id)).toEqual(['missing', 'read', 'listen', 'bigger']);
    expect(m.exercises[0]).toMatchObject({ id: 'missing', anchor_block: 'A1', done: false, badge: false });
    expect(m.exercises.find((e) => e.id === 'bigger')).toMatchObject({ done: true, badge: true });
    expect(m.exercises.find((e) => e.id === 'read')).toMatchObject({ done: false, badge: false });
  });
});

// ── questions by stop line (v4 passages) ───────────────────────────────────────────────────────────────

describe('questions reached by the stop line', () => {
  const scoredStop = (ct, attempted) => Object.assign(rowOf(ct), { status: 'scored', score: { correct: 0, attempted, stopped: true }, wcpm: 0 });

  test('_v2 + _pool: a reader stopped in line 1 gets the line-1 tap questions, in needs_line order, at most 3; tap_ok governs', async () => {
    on(V2, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K3), 'read', D);
    scoredStop(ex.ct, 3);
    const qs = (await Ch.questions({ ct: ex.ct })).questions;
    const want = ex.passage_id === 'en.read.1.ref01' ? ['en.read.1.ref01.q1', 'en.read.1.ref01.q2'] : ['en.read.1.kite.q1'];
    expect(qs.map((q) => q.id)).toEqual(want);
    // a tap is checked against the drawn passage's question
    const right = qs[0].options.indexOf('the girl');
    expect(await Ch.answer({ ct: ex.ct, q: qs[0].id, pick: right })).toMatchObject({ ok: true, answer: 'the girl' });
  });

  test('every new switch off: a stopped reader gets no questions (today)', async () => {
    const ex = await Ch.exercise(hub(K3), 'read', D);
    db.web_quiz_challenge_runs.push({ id: runOf(ex.ct), student_id: K3, exercise: 'read', lang: 'en', status: 'scored', score: { correct: 0, attempted: 3, stopped: true }, wcpm: 0, meta: {} });
    expect(await Ch.questions({ ct: ex.ct })).toEqual({ questions: [] });
  });
});

// ── the sampling fields: admin_mode and sample_arm (no runs columns for them on this base: meta) ─────────────

describe('admin_mode and sample_arm under _v2', () => {
  test('an ordinary home run: meta.admin_mode self_run, meta.sample_arm null', async () => {
    on(V2, PERIOD);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(ex.ct).meta).toMatchObject({ admin_mode: 'self_run', sample_arm: null });
    expect(rowOf(ex.ct)).not.toHaveProperty('admin_mode');
  });

  test('the class round (mode from the caller): mode class_round, admin_mode teacher_present, never a record', async () => {
    on(V2, PERIOD, POOL);
    const ex = await Ch.exercise(hub(), 'missing', { ...D, mode: 'class_round' });
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'class_round', record: false, meta: expect.objectContaining({ admin_mode: 'teacher_present', sample_arm: null }) });
  });

  test('web_quiz_class_week on but the class-week module absent: nothing more is written, the serve goes on', async () => {
    on(V2, PERIOD, 'web_quiz_class_week');
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(ex.ct).meta).toMatchObject({ admin_mode: 'self_run', sample_arm: null });
  });
});

describe('the class-week sample arm (web-quiz-challenge-draw.adminFields)', () => {
  const Draw = require('../../../shared/services/quiz/web-quiz-challenge-draw');
  const CW = '../../../shared/services/quiz/web-quiz-class-week';
  afterEach(() => { jest.dontMock(CW); jest.resetModules(); });

  test('via class_link inside an open class-week window, switch on → sample_arm class_week, admin_mode self_run', async () => {
    const openWindowFor = jest.fn(async () => ({ id: 'w1' }));
    jest.doMock(CW, () => ({ openWindowFor }), { virtual: true });
    expect(await Draw.adminFields({ mode: 'check', via: 'class_link', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'self_run', sample_arm: 'class_week' });
    expect(openWindowFor).toHaveBeenCalledWith(expect.objectContaining({ canonicalId: 'c1' }));
  });

  test('no open window, another door, or the switch off → no sample arm and no lookup', async () => {
    const openWindowFor = jest.fn(async () => null);
    jest.doMock(CW, () => ({ openWindowFor }), { virtual: true });
    expect(await Draw.adminFields({ mode: 'check', via: 'class_link', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'self_run', sample_arm: null });
    openWindowFor.mockClear();
    expect(await Draw.adminFields({ mode: 'check', via: 'hub', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'self_run', sample_arm: null });
    expect(await Draw.adminFields({ mode: 'check', via: 'class_link', canonicalId: 'c1', classWeekOn: false })).toEqual({ admin_mode: 'self_run', sample_arm: null });
    expect(openWindowFor).not.toHaveBeenCalled();
  });

  test('the module absent → no sample arm, nothing thrown', async () => {
    jest.doMock(CW, () => { throw new Error("Cannot find module './web-quiz-class-week'"); }, { virtual: true });
    expect(await Draw.adminFields({ mode: 'check', via: 'class_link', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'self_run', sample_arm: null });
  });
});
