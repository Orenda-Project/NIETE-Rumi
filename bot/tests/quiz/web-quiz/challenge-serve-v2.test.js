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
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { makeFake } = require('./fake-supabase');
const { guardColumns } = require('./registry-columns');   // a select naming a column the table lacks is 42703
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
// the record's parent switch (web_quiz_identity_canon, under web_quiz_hub): a record needs it on
const CANON_ON = ['web_quiz_hub', 'web_quiz_identity_canon'];
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
  Object.assign(supabase, guardColumns(makeFake(db)));
  Ch.__reset();
  // the hub and identity switches are cached 30 s: each test reads its own
  for (const m of ['web-quiz-hub-flags', 'web-quiz-identity-flags']) require(`../../../shared/services/quiz/${m}`)._resetCache();
  jest.clearAllMocks();
  r2.headObject.mockImplementation(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' }));
});

const D = { device: 'FamilyPhoneDeviceRef_1', lang: 'en' };
const hub = (id = K3) => T.sign({ k: 'h', ids: [id], exp: Math.floor(Date.now() / 1000) + 3600 });
const runOf = (ct) => T.verify(ct, 'c').r;
const rowOf = (ct) => db.web_quiz_challenge_runs.find((r) => r.id === runOf(ct));
const starts = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.ch_start').map(([, d]) => d);
const V2_COLS = ['bank_version', 'set', 'form', 'passage_id', 'item_set_id', 'mode', 'period_id', 'exposure_no', 'band', 'anchor_exposure_no', 'anchor_block', 'draw_seed', 'canonical_id', 'id_src', 'id_confidence', 'homonym_in_list', 'via', 'share_code_id', 'record', 'started_at', 'admin_mode', 'sample_arm', 'anchor_serves_any'];

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
  beforeEach(() => on(V2, ...CANON_ON, PERIOD, POOL));

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
    // the page gets only what it renders (ruling #43); the provenance stays on the row and in meta.draw
    expect(ex).toMatchObject({ mode: 'check', draw: { outcome: 'served' } });
    expect(ex.story.text).toBe(W12.join(' '));
  });

  test('lower band: band 2 exhausted for a grade-5 child (Set A read before the provenance columns) → band 1, never band 3', async () => {
    db.web_quiz_challenge_runs.push({ id: 'old-1', student_id: K5, exercise: 'read', grade: 5, lang: 'en', status: 'scored', score: { correct: 50 }, meta: { counted: true }, created_at: '2026-09-01T00:00:00Z' });
    for (let k = 0; k < 6; k += 1) {
      const ex = await Ch.exercise(hub(K5), 'read', D);
      const row = rowOf(ex.ct);
      expect(row.band).toBe(1);
      expect(row.passage_id).not.toBe('en.read.3.ref01');
      expect(row.meta.draw).toMatchObject({ outcome: 'lower_band', band_reason: 'fallback_exhausted' });
      expect(ex.draw).toEqual({ outcome: 'served' });
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
    expect(a).toEqual({ ex: 'read', on_its_way: true, draw: { outcome: 'on_its_way' }, copy: { en: 'A new story is on its way.', ur: 'ایک نئی کہانی آنے والی ہے۔' } });
    expect(b).toEqual(a);
    expect(db.web_quiz_challenge_runs).toHaveLength(2);
    expect(starts()).toEqual([]);
    expect(db.challenge_draws).toHaveLength(1);   // one on-its-way log per child × stop × period an hour
    expect(db.challenge_draws[0]).toMatchObject({ run_id: null, outcome: 'on_its_way', eligible: [], eligible_n: 0, p: null, served_id: null, band: 1 });
  });
});

describe('4 · never re-serve (any status, any mode; twins both ways)', () => {
  beforeEach(() => on(V2, ...CANON_ON, PERIOD, POOL));

  test('a row on ur.read.2.setA (abandoned practice) → never drawn; a row on its listening twin → the read is gone too', async () => {
    db.challenge_passages.push(reg('ur.read.2.kite', { status: 'provisional' }));
    passage('ur.read.2.kite', W12, [Q('ur.read.2.kite.q1', 1)]);
    Bank._loadPassagesFrom(PDIR);
    db.web_quiz_challenge_runs.push({ id: 'x1', student_id: K5, canonical_id: K5, exercise: 'read', lang: 'ur', status: 'abandoned', mode: 'practice', record: false, passage_id: 'ur.read.2.setA', created_at: '2026-10-20T00:00:00Z' });
    const a = await Ch.exercise(hub(K5), 'read', { ...D, lang: 'ur' });
    expect(rowOf(a.ct).passage_id).toBe('ur.read.2.kite');
    db.web_quiz_challenge_runs.length = 0;
    db.web_quiz_challenge_runs.push({ id: 'x2', student_id: K5, canonical_id: K5, exercise: 'listen', lang: 'ur', status: 'scored', mode: 'check', record: true, passage_id: 'ur.listen.2.setA', period_id: '2026-10', created_at: '2026-10-20T00:00:00Z' });
    const b = await Ch.exercise(hub(K5), 'read', { ...D, lang: 'ur' });
    expect(rowOf(b.ct).passage_id).toBe('ur.read.2.kite');
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
    on(V2, ...CANON_ON, PERIOD);
    const a = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(a.ct)).toMatchObject({ status: 'served', record: true, mode: 'check', period_id: '2026-11', passage_id: 'en.read.2.setA', band: 2, set: 'A', bank_version: 'child-test-items-v3', exposure_no: 1 });
    rowOf(a.ct).status = 'scored';   // played: a served-and-left row would leave the record open
    const b = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(b.ct)).toMatchObject({ status: 'served', record: false, mode: 'practice', exposure_no: 2 });
    expect(b).toMatchObject({ practice_round: true, mode: 'practice' });
    db.web_quiz_challenge_runs.forEach((r) => { r.period_id = '2026-10'; });
    const c = await Ch.exercise(hub(), 'read', D);
    // a passage already met is never a record (M7), even in a new period with the pool off
    expect(rowOf(c.ct)).toMatchObject({ record: false, mode: 'check', period_id: '2026-11', exposure_no: 3 });
  });

  test('_period off with _v2 on: record and period_id NULL; the provenance is still written', async () => {
    on(V2);
    const a = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(a.ct)).toMatchObject({ status: 'served', record: null, period_id: null, mode: 'check', item_set_id: 'bigger.G3.A', set: 'A', form: 'G3', exposure_no: 1 });
  });

  test('the submit UPDATES the served row (one row per run), keeps the provenance and meta.draw, and a second submit is refused', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(ex.ct).passage_id).toBe('en.read.2.setA');
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
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(), 'missing', D);
    Ch.__reset();
    const r = await Ch.submit({ ct: ex.ct, answers: missingAnswers(ex.items, 5), ms: 40000 });
    expect(r.score).toMatchObject({ correct: 5, n: 10, stopped: false, reached: 10 });
    expect(rowOf(ex.ct)).toMatchObject({ status: 'scored', anchor_block: 'A1' });
  });

  test('listen under _v2: the served row becomes scoring when the questions are served, then scored', async () => {
    on(V2, ...CANON_ON, PERIOD);
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
    on(V2, ...CANON_ON, PERIOD, POOL);
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
    on(V2, ...CANON_ON, PERIOD, POOL);
    const a = await Ch.exercise(hub(), 'missing', { ...D, mode: 'practice' });
    expect(rowOf(a.ct)).toMatchObject({ mode: 'practice', record: false });
  });
});

// ── 10 · entry band per fixed grade ─────────────────────────────────────────────────────────────────────

describe('10 · the draw band per fixed grade', () => {
  beforeEach(() => on(V2, ...CANON_ON, PERIOD, POOL));

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
    db.child_identity = [{ canonical_id: K3, year_code: require('../../../shared/services/quiz/web-quiz-challenge-draw').yearCode(new Date()), fixed_grade: 5 }];
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
  beforeEach(() => on(V2, ...CANON_ON, PERIOD, POOL));
  const A1 = () => Bank.anchorBlock('A1').map((i) => ({ item_id: i.item_id, seq: i.seq.slice(), answer: i.answer }));

  test('10 items, identical for G3 and G5, stop_after 0, anchor_block A1; anchor_exposure_no 1, a practice warm-up does not move it, 2 next period', async () => {
    const g3 = await Ch.exercise(hub(K3), 'missing', D);
    const g5 = await Ch.exercise(hub(K5), 'missing', D);
    expect(g3.items).toEqual(A1());
    expect(g5.items).toEqual(g3.items);
    expect(g3.practice).toEqual(g5.practice);
    expect(g3).toMatchObject({ stop_after: 0, mode: 'check', anchor_block: 'A1' });
    expect(rowOf(g3.ct)).toMatchObject({ anchor_block: 'A1', anchor_exposure_no: 1, mode: 'check', record: true, band: null });
    rowOf(g3.ct).status = 'scored';
    const again = await Ch.exercise(hub(K3), 'missing', D);       // same period, the record played: practice
    expect(rowOf(again.ct)).toMatchObject({ mode: 'practice', record: false, anchor_exposure_no: 2 });
    db.web_quiz_challenge_runs.forEach((r) => { r.period_id = '2026-10'; });
    const next = await Ch.exercise(hub(K3), 'missing', D);
    expect(rowOf(next.ct)).toMatchObject({ mode: 'check', record: true, anchor_exposure_no: 2 });
  });

  test('anchor_serves_any counts every serve of the block (any mode, any status): a practice warm-up then a counted one → 1 and 2', async () => {
    const p = await Ch.exercise(hub(K3), 'missing', { ...D, mode: 'practice' });
    expect(rowOf(p.ct)).toMatchObject({ mode: 'practice', anchor_exposure_no: 1, anchor_serves_any: 1, meta: expect.objectContaining({ anchor_serves_any: 1 }) });
    rowOf(p.ct).status = 'abandoned';
    const c = await Ch.exercise(hub(K3), 'missing', D);
    expect(rowOf(c.ct)).toMatchObject({ mode: 'check', record: true, anchor_exposure_no: 1, meta: expect.objectContaining({ anchor_serves_any: 2 }) });
    expect(rowOf(c.ct)).toMatchObject({ anchor_serves_any: 2, admin_mode: 'self_run', sample_arm: null });   // the column, and meta kept one period
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
    on(V2, ...CANON_ON, PERIOD, POOL);
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
    on(V2, ...CANON_ON, PERIOD, POOL);
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
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K3), 'read', D);
    scoredStop(ex.ct, 3);
    const qs = (await Ch.questions({ ct: ex.ct })).questions;
    const want = rowOf(ex.ct).passage_id === 'en.read.1.ref01' ? ['en.read.1.ref01.q1', 'en.read.1.ref01.q2'] : ['en.read.1.kite.q1'];
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

// ── the sampling fields: admin_mode, sample_arm, anchor_serves_any (the columns, and meta kept one period) ─────────────

describe('admin_mode and sample_arm under _v2', () => {
  test('an ordinary home run: admin_mode self_run, sample_arm null, no anchor_serves_any off the anchor block (columns and meta)', async () => {
    on(V2, ...CANON_ON, PERIOD);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(ex.ct).meta).toMatchObject({ admin_mode: 'self_run', sample_arm: null });
    expect(rowOf(ex.ct)).toMatchObject({ admin_mode: 'self_run', sample_arm: null, anchor_serves_any: null });
  });

  test('the class round (mode from the caller): mode class_round, admin_mode teacher_present, sample_arm class_round, never a record', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(), 'missing', { ...D, mode: 'class_round' });
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'class_round', record: false, meta: expect.objectContaining({ admin_mode: 'teacher_present', sample_arm: 'class_round' }) });
    expect(rowOf(ex.ct)).toMatchObject({ admin_mode: 'teacher_present', sample_arm: 'class_round', anchor_serves_any: 1 });
  });

  test('web_quiz_class_week on but the class-week module absent: nothing more is written, the serve goes on', async () => {
    on(V2, ...CANON_ON, PERIOD, 'web_quiz_class_week');
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(ex.ct).meta).toMatchObject({ admin_mode: 'self_run', sample_arm: null });
  });
});

describe('the class-week sample arm (web-quiz-challenge-draw.adminFields)', () => {
  const Draw = require('../../../shared/services/quiz/web-quiz-challenge-draw');
  const CW = '../../../shared/services/quiz/web-quiz-class-week';
  // jest keeps the first mock it builds: the absent module is tried first (a throwing factory is never kept), then one
  // stand-in whose answer each test sets
  let openWindowFor = jest.fn();

  test('the module absent → no sample arm, nothing thrown', async () => {
    jest.doMock(CW, () => { throw new Error("Cannot find module './web-quiz-class-week'"); }, { virtual: true });
    expect(await Draw.adminFields({ mode: 'check', via: 'class_link', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'self_run', sample_arm: null });
    jest.doMock(CW, () => ({ openWindowFor: (...a) => openWindowFor(...a) }), { virtual: true });
  });

  test('via class_link inside an open class-week window, switch on → sample_arm class_week, admin_mode self_run', async () => {
    openWindowFor = jest.fn(async () => ({ id: 'w1' }));
    expect(await Draw.adminFields({ mode: 'check', via: 'class_link', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'self_run', sample_arm: 'class_week' });
    expect(openWindowFor).toHaveBeenCalledWith(expect.objectContaining({ canonicalId: 'c1' }));
  });

  test('no open window, another door, or the switch off → no sample arm and no lookup', async () => {
    openWindowFor = jest.fn(async () => null);
    expect(await Draw.adminFields({ mode: 'check', via: 'class_link', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'self_run', sample_arm: null });
    openWindowFor.mockClear();
    expect(await Draw.adminFields({ mode: 'check', via: 'hub', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'self_run', sample_arm: null });
    expect(await Draw.adminFields({ mode: 'check', via: 'class_link', canonicalId: 'c1', classWeekOn: false })).toEqual({ admin_mode: 'self_run', sample_arm: null });
    expect(openWindowFor).not.toHaveBeenCalled();
  });

  test('a class round turn (mode class_round) is teacher_present in the class_round arm', async () => {
    expect(await Draw.adminFields({ mode: 'class_round', via: 'class_link', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'teacher_present', sample_arm: 'class_round' });
  });

  test('a round turn at position 11+ (mode practice, via the round) writes admin_mode teacher_present and sample_arm null', async () => {
    openWindowFor = jest.fn(async () => ({ id: 'w1' }));
    expect(await Draw.adminFields({ mode: 'practice', via: 'class_round', canonicalId: 'c1', classWeekOn: true })).toEqual({ admin_mode: 'teacher_present', sample_arm: null });
    expect(openWindowFor).not.toHaveBeenCalled();
  });

  test('an ordinary home run (mode check or practice, via hub): self_run, null', async () => {
    expect(await Draw.adminFields({ mode: 'check', via: 'hub', canonicalId: 'c1' })).toEqual({ admin_mode: 'self_run', sample_arm: null });
    expect(await Draw.adminFields({ mode: 'practice', via: 'hub', canonicalId: 'c1' })).toEqual({ admin_mode: 'self_run', sample_arm: null });
  });
});

// ── review: exposure gates the record, the fixed grade's form, the event key, helped, the record per language, child_identity

describe('M7: only a first exposure is a record (anchors excepted)', () => {
  test('_pool: a fresh passage in the next period IS a record; the A1 warm-up is a record every period', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const a = await Ch.exercise(hub(K3), 'read', D);
    expect(rowOf(a.ct)).toMatchObject({ record: true, exposure_no: 1 });
    const w1 = await Ch.exercise(hub(K3), 'missing', D);
    db.web_quiz_challenge_runs.forEach((r) => { r.period_id = '2026-10'; });
    const b = await Ch.exercise(hub(K3), 'read', D);
    expect(rowOf(b.ct).passage_id).not.toBe(rowOf(a.ct).passage_id);
    expect(rowOf(b.ct)).toMatchObject({ record: true, exposure_no: 1, mode: 'check' });
    const w2 = await Ch.exercise(hub(K3), 'missing', D);
    expect(rowOf(w2.ct)).toMatchObject({ record: true, exposure_no: 2, anchor_exposure_no: 2 });
    expect(rowOf(w1.ct).record).toBe(true);
  });
});

describe('M8: the form and the items come from the FIXED grade', () => {
  test('fixed grade 5 on a grade-3 visit: row form G5, the G5 items served and scored', async () => {
    on(V2, ...CANON_ON, PERIOD);
    db.child_identity = [{ canonical_id: K3, year_code: require('../../../shared/services/quiz/web-quiz-challenge-draw').yearCode(new Date()), fixed_grade: 5 }];
    const ex = await Ch.exercise(hub(K3), 'missing', D);
    const g5 = Bank.getTaskSpec({ grade: 5, set: 'A', task: 'ma.missing' });
    expect(ex.items).toEqual(g5.items.map((i) => ({ seq: i.seq.slice(), answer: i.answer })));
    expect(rowOf(ex.ct)).toMatchObject({ form: 'G5', item_set_id: 'missing.G5.A', grade: 3 });
    Ch.__reset();   // scored by another process: the form comes from the row
    const r = await Ch.submit({ ct: ex.ct, answers: missingAnswers(ex.items), ms: 30000 });
    expect(r.score.correct).toBe(10);
  });
});

describe('the measurement events with _v2 (web_quiz_events_v2 on)', () => {
  const Kid = require('../../../shared/services/quiz/web-quiz-kid');
  const Roster = require('../../../shared/services/quiz/web-quiz-identity-roster');
  const CANON = '88888888-8888-4888-8888-888888888888';
  let spy;
  beforeEach(() => {
    process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(48);
    process.env.WEB_QUIZ_KID_KEY_V = '1';
    on(V2, ...CANON_ON, PERIOD, 'web_quiz_hub', 'web_quiz_events_v2');
    require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache();
    spy = jest.spyOn(Roster, 'canonicalStudentId').mockResolvedValue(CANON);
  });
  afterEach(() => { spy.mockRestore(); delete process.env.WEB_QUIZ_KID_KEY; delete process.env.WEB_QUIZ_KID_KEY_V; });

  test('ch_start: kid from the canonical id (not the raw id), period_id and the fixed form kept', async () => {
    const ex = await Ch.exercise(hub(K3), 'bigger', D);
    const [st] = starts();
    expect(st.kid).toBe(Kid.kid(CANON));
    expect(st.kid).not.toBe(Kid.kid(K3));
    expect(st).toMatchObject({ run: runOf(ex.ct), period_id: '2026-11', form: 'G3', mode: 'check', record: true, item_set_id: 'bigger.G3.A' });
  });

  test('every finish point logs the outcome after the row is written (m_result of the scored row)', async () => {
    const results = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.m_result').length;
    const m = await Ch.exercise(hub(K3), 'missing', D);
    await Ch.submit({ ct: m.ct, answers: missingAnswers(m.items), ms: 30000 });
    expect(results()).toBe(1);
    const b = await Ch.exercise(hub(K3), 'bigger', D);
    await Ch.submit({ ct: b.ct, taps: biggerTaps(b.items), ms: 25000 });
    expect(results()).toBe(2);
    const r = await Ch.exercise(hub(K3), 'read', D);
    await readAloud(r.ct);
    expect(results()).toBe(3);
    const l = await Ch.exercise(hub(K3), 'listen', D);
    for (const q of (await Ch.questions({ ct: l.ct })).questions) await Ch.answer({ ct: l.ct, q: q.id, pick: 0 });
    expect(results()).toBe(4);
  });
});

describe('M6: the helped column at finish', () => {
  test('a warm-up submitted with helped:true → helped; none sent → not_asked; false → self', async () => {
    on(V2, ...CANON_ON, PERIOD);
    const a = await Ch.exercise(hub(), 'missing', D);
    await Ch.submit({ ct: a.ct, answers: missingAnswers(a.items), ms: 30000, helped: true });
    expect(rowOf(a.ct)).toMatchObject({ status: 'scored', helped: 'helped', meta: expect.objectContaining({ helped: true }) });
    const b = await Ch.exercise(hub(), 'bigger', D);
    await Ch.submit({ ct: b.ct, taps: biggerTaps(b.items), ms: 25000 });
    expect(rowOf(b.ct).helped).toBe('not_asked');
    const r = await Ch.exercise(hub(), 'read', D);
    await readAloud(r.ct);
    expect(rowOf(r.ct).helped).toBe('not_asked');
    const l = await Ch.exercise(hub(), 'listen', D);
    for (const q of (await Ch.questions({ ct: l.ct })).questions) await Ch.answer({ ct: l.ct, q: q.id, pick: 0, helped: false });
    expect(rowOf(l.ct)).toMatchObject({ status: 'scored', helped: 'self' });
  });

  test('the Trail page sends strings: helped:"helped" → helped, helped:"self" → self', async () => {
    on(V2, ...CANON_ON, PERIOD);
    const a = await Ch.exercise(hub(), 'missing', D);
    await Ch.submit({ ct: a.ct, answers: missingAnswers(a.items), ms: 30000, helped: 'helped' });
    expect(rowOf(a.ct)).toMatchObject({ status: 'scored', helped: 'helped' });
    const b = await Ch.exercise(hub(), 'bigger', D);
    await Ch.submit({ ct: b.ct, taps: biggerTaps(b.items), ms: 25000, helped: 'self' });
    expect(rowOf(b.ct)).toMatchObject({ status: 'scored', helped: 'self' });
    const c = await Ch.exercise(hub(K5), 'bigger', D);
    await Ch.submit({ ct: c.ct, taps: biggerTaps(c.items), ms: 25000, helped: 'maybe' });
    expect(rowOf(c.ct).helped).toBe('not_asked');
  });

  test('every new switch off: no helped column', async () => {
    const a = await Ch.exercise(hub(), 'missing', D);
    await Ch.submit({ ct: a.ct, answers: missingAnswers(a.items), ms: 30000, helped: true });
    expect(db.web_quiz_challenge_runs[0]).not.toHaveProperty('helped');
  });
});

describe('ITEMS §5.6 (item 14): the record per (stop, language) for read and listen', () => {
  test('EN read then UR read in one month → two records; EN twice → one', async () => {
    on(V2, ...CANON_ON, PERIOD);
    const en = await Ch.exercise(hub(), 'read', D);
    const ur = await Ch.exercise(hub(), 'read', { ...D, lang: 'ur' });
    rowOf(en.ct).status = 'scored';
    const en2 = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(en.ct)).toMatchObject({ lang: 'en', record: true });
    expect(rowOf(ur.ct)).toMatchObject({ lang: 'ur', record: true });
    expect(rowOf(en2.ct)).toMatchObject({ lang: 'en', record: false, mode: 'practice' });
  });

  test('bigger stays one record per stop whatever the language', async () => {
    on(V2, ...CANON_ON, PERIOD);
    const a = await Ch.exercise(hub(), 'bigger', D);
    rowOf(a.ct).status = 'scored';
    const b = await Ch.exercise(hub(), 'bigger', { ...D, lang: 'ur' });
    expect(rowOf(b.ct)).toMatchObject({ record: false, mode: 'practice' });
  });
});

describe('child_identity: the fixed grade written at the first counted play of the academic year', () => {
  // the identity change's real switch reader (web_quiz_identity_canon under web_quiz_hub), seeded through app_settings;
  // where that module is not on the tree the tests that need it skip themselves
  const ID_FLAGS = '../../../shared/services/quiz/web-quiz-identity-flags';
  const HUB_FLAGS = '../../../shared/services/quiz/web-quiz-hub-flags';
  const hasFlags = (() => { try { require.resolve(ID_FLAGS); return true; } catch (_) { return false; } })();
  const itFlags = hasFlags ? test : test.skip;
  const Draw = require('../../../shared/services/quiz/web-quiz-challenge-draw');
  const resetFlags = () => { for (const m of [ID_FLAGS, HUB_FLAGS]) { try { const x = require(m); if (x._resetCache) x._resetCache(); } catch (_) { /* absent */ } } };
  beforeEach(resetFlags);
  afterEach(resetFlags);

  itFlags('two visits with different grades in one year → one row with the first grade; a new year → a new row', async () => {
    on(V2, ...CANON_ON, PERIOD, 'web_quiz_hub', 'web_quiz_identity_canon');
    db.child_identity = [];
    await Ch.exercise(hub(K3), 'bigger', D);
    expect(db.child_identity).toEqual([expect.objectContaining({ canonical_id: K3, year_code: Draw.yearCode(new Date()), fixed_grade: 3, grade_source: 'roster_class' })]);
    db.student_lists.find((l) => l.id === L3).class_name = '4';
    await Ch.exercise(hub(K3), 'missing', D);
    expect(db.child_identity).toHaveLength(1);
    expect(db.child_identity[0].fixed_grade).toBe(3);
    db.child_identity[0].year_code = '2025-26';
    db.web_quiz_challenge_runs.forEach((r) => { r.period_id = '2026-10'; });
    await Ch.exercise(hub(K3), 'read', D);
    expect(db.child_identity.map((r) => r.year_code).sort()).toEqual(['2025-26', Draw.yearCode(new Date())]);
  });

  itFlags('a practice play writes nothing', async () => {
    on(V2, ...CANON_ON, PERIOD, 'web_quiz_hub', 'web_quiz_identity_canon');
    db.child_identity = [];
    await Ch.exercise(hub(K3), 'bigger', { ...D, mode: 'practice' });
    expect(db.child_identity).toEqual([]);
  });

  test('the switch off (or the identity module absent): no write', async () => {
    on(V2, PERIOD, 'web_quiz_hub');
    db.child_identity = [];
    await Ch.exercise(hub(K3), 'bigger', D);
    expect(db.child_identity).toEqual([]);
  });

  test('year_code is the PKT academic year (1 April – 31 March)', () => {
    expect(Draw.yearCode(new Date('2026-03-31T18:59:59Z'))).toBe('2025-26');
    expect(Draw.yearCode(new Date('2026-03-31T19:00:00Z'))).toBe('2026-27');
    expect(Draw.yearCode(new Date('2026-11-03T00:00:00Z'))).toBe('2026-27');
  });
});

describe('class_id at serve and the class light at the first finished exposure', () => {
  const CLS = 'c1a55000-0000-4000-8000-000000000001';
  const lights = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.light_lit').map(([, d]) => d);
  beforeEach(() => { process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(48); process.env.WEB_QUIZ_KID_KEY_V = '1'; });
  afterEach(() => { delete process.env.WEB_QUIZ_KID_KEY; delete process.env.WEB_QUIZ_KID_KEY_V; });

  test('an enrolled child served from /q/ carries the enrolment\'s class; a loose child NULL; a share code never gives one', async () => {
    on(V2, ...CANON_ON, PERIOD);
    db.class_enrollments = [{ id: 'e1', student_id: K3, class_id: CLS, is_active: true }];
    db.classes = [{ id: CLS, grade_code: 'grade_3' }];
    const a = await Ch.exercise(T.signSession({ sessionId: SESSION, deviceRef: 'd'.repeat(22), shareCodeId: SC }), 'bigger', D);
    expect(rowOf(a.ct)).toMatchObject({ class_id: CLS, via: 'quiz_card', share_code_id: SC });
    const b = await Ch.exercise(hub(K5), 'bigger', D);
    expect(rowOf(b.ct).class_id).toBeNull();
  });

  test('a caller\'s class (the class link) is taken as given', async () => {
    on(V2, ...CANON_ON, PERIOD);
    const a = await Ch.exercise(hub(K5), 'bigger', { ...D, classId: CLS });
    expect(rowOf(a.ct).class_id).toBe(CLS);
  });

  test('one light_lit per first finished exposure (hashed class, kid), none on exposure 2 or practice; no raw class id', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    db.class_enrollments = [{ id: 'e1', student_id: K3, class_id: CLS, is_active: true }];
    db.classes = [{ id: CLS, grade_code: 'grade_3' }];
    const w = await Ch.exercise(hub(K3), 'missing', D);
    await Ch.submit({ ct: w.ct, answers: missingAnswers(w.items), ms: 30000 });
    const b = await Ch.exercise(hub(K3), 'bigger', D);
    await Ch.submit({ ct: b.ct, taps: biggerTaps(b.items), ms: 25000 });
    const Kid = require('../../../shared/services/quiz/web-quiz-kid');
    expect(lights()).toEqual([
      expect.objectContaining({ key_kind: 'stop', week: expect.stringMatching(/^\d{4}-W\d{2}$/), cls: Kid.cls(CLS), kid: Kid.kid(K3) }),
      expect.objectContaining({ key_kind: 'item_set', cls: Kid.cls(CLS) }),
    ]);
    expect(JSON.stringify(lights())).not.toContain(CLS);
    const p = await Ch.exercise(hub(K3), 'bigger', D);              // same period: practice, exposure 2
    await Ch.submit({ ct: p.ct, taps: biggerTaps(p.items), ms: 25000 });
    expect(lights()).toHaveLength(2);
  });

  test('ISO week in PKT', () => {
    const Draw = require('../../../shared/services/quiz/web-quiz-challenge-draw');
    expect(Draw.isoWeekPkt(new Date('2026-11-02T00:00:00Z'))).toBe('2026-W45');
    expect(Draw.isoWeekPkt(new Date('2026-11-01T19:00:00Z'))).toBe('2026-W45');   // Monday 00:00 PKT
    expect(Draw.isoWeekPkt(new Date('2026-11-01T18:59:59Z'))).toBe('2026-W44');
  });
});

describe('ruling #43: the exercise payload under _v2 carries only what the page renders', () => {
  const DROPPED = ['band', 'exposure_no', 'rung', 'period_id', 'passage_id', 'item_set_id', 'anchor_block', 'anchor_exposure_no'];
  test('read, missing and bigger under _v2 + _pool: the exact key sets; record is today\'s rule flag only', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const read = await Ch.exercise(hub(K5), 'read', D);
    const miss = await Ch.exercise(hub(K5), 'missing', D);
    const big = await Ch.exercise(hub(K5), 'bigger', D);
    const common = ['ex', 'name', 'lang', 'ct', 'clips', 'record', 'v2', 'trail', 'trail_copy', 'mode', 'draw'];
    expect(Object.keys(read).sort()).toEqual([...common, 'secs', 'live', 'questions_on', 'story'].sort());
    expect(Object.keys(miss).sort()).toEqual([...common, 'anchor_block', 'items', 'practice', 'stop_after', 'first_key_s', 'tryout'].sort());
    expect(miss.anchor_block).toBe('A1');   // the warm-up says which block it is (ruling #43 as amended)
    expect(Object.keys(big).sort()).toEqual([...common, 'items', 'practice', 'per_item_s', 'stop_after'].sort());
    for (const p of [read, miss, big]) {
      expect(p.draw).toEqual({ outcome: 'served' });
      expect(p.record).toBe(true);   // the record switch's flag, as today
      for (const k of DROPPED) if (!(p === miss && k === 'anchor_block')) expect(p).not.toHaveProperty(k);
    }
    // a practice serve says so (the record played: a served-and-left record row is served again instead)
    rowOf(big.ct).status = 'scored';
    const again = await Ch.exercise(hub(K5), 'bigger', D);
    expect(again).toMatchObject({ mode: 'practice', practice_round: true, draw: { outcome: 'served' } });
    // every field stays on the row and in meta.draw
    expect(rowOf(read.ct)).toMatchObject({ band: 2, exposure_no: 1, passage_id: 'en.read.2.setA', period_id: '2026-11', record: true });
    expect(rowOf(read.ct).meta.draw).toMatchObject({ seed: expect.any(String), p: expect.any(Number), eligible_n: 1, band_reason: 'entry_grade', weights_v: 'w1' });
  });

  test('the menu keeps anchor_block A1 on the warm-up', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    expect((await Ch.menu(hub(K5), D)).exercises[0]).toMatchObject({ id: 'missing', anchor_block: 'A1' });
  });
});

// ── RULING #100(a)(2): the child-facing title rides the listen and read payloads and the Trail menu (the page renders it)
describe('the passage title on the listen/read payload and the menu (title_ur|title_en of the registry passage; absent when the passage has none)', () => {
  const TITLE = { en: 'The Little Boat', ur: 'چھوٹی کشتی' };
  beforeEach(() => {
    // a band-1 listening passage with titles, the only listening passage a G3 child can draw; a read twin without titles stays as is
    fs.writeFileSync(path.join(PDIR, 'en.listen.1.boat01.json'), JSON.stringify({
      passage_id: 'en.listen.1.boat01', lang: 'en', kind: 'listen', band: 1, pool: 'check', status_at_authoring: 'reviewed', is_reference: true,
      title_en: TITLE.en, title_ur: TITLE.ur, text: 'A little boat sat on the lake. It waited for the wind.', tokens: ['A', 'little', 'boat', 'sat', 'on', 'the', 'lake', 'It', 'waited', 'for', 'the', 'wind'],
      lines: [{ n: 1, from: 0, to: 6 }, { n: 2, from: 7, to: 11 }], questions: [Q('en.listen.1.boat01.q1', 1), Q('en.listen.1.boat01.q2', 2)], twin_of: null, bank_version: 'child-test-items-v4',
    }));
    Bank._loadPassagesFrom(PDIR);
    db.challenge_passages = db.challenge_passages.filter((r) => r.passage_id !== 'en.listen.2.setA');
    db.challenge_passages.push(reg('en.listen.1.boat01', { is_reference: true }));
  });
  afterEach(() => { fs.rmSync(path.join(PDIR, 'en.listen.1.boat01.json'), { force: true }); Bank._loadPassagesFrom(PDIR); });

  test('under _v2 + _pool the listen payload carries title {en, ur}; the read payload of a title-less passage carries no title key', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const l = await Ch.exercise(hub(K3), 'listen', D);
    expect(rowOf(l.ct)).toMatchObject({ passage_id: 'en.listen.1.boat01', status: 'served' });
    expect(l.title).toEqual(TITLE);
    const r = await Ch.exercise(hub(K3), 'read', D);
    expect(['en.read.1.ref01', 'en.read.1.kite']).toContain(rowOf(r.ct).passage_id);   // the random band-1 draw; neither fixture has a title
    expect(r).not.toHaveProperty('title');
  });

  test('the menu names the served passage on its stop (after the serve; never before the draw)', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const before = (await Ch.menu(hub(K3), D)).exercises.find((e) => e.id === 'listen');
    expect(before).not.toHaveProperty('title');
    await Ch.exercise(hub(K3), 'listen', D);
    const after = (await Ch.menu(hub(K3), D)).exercises.find((e) => e.id === 'listen');
    expect(after.title).toEqual(TITLE);
  });

  test('the re-served record row (served and left, opened again) carries the same title', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const first = await Ch.exercise(hub(K3), 'listen', D);
    const again = await Ch.exercise(hub(K3), 'listen', D);
    expect(runOf(again.ct)).toBe(runOf(first.ct));
    expect(again.title).toEqual(TITLE);
    // the page is told it is a re-open (r5-redteam-4 025824); a first serve never says so
    expect(again.reopened).toBe(true);
    expect(first).not.toHaveProperty('reopened');
  });

  test('golden: with the new switches off the listen payload has no title key (today\'s payload)', async () => {
    const l = await Ch.exercise(hub(K3), 'listen', D);
    expect(l).not.toHaveProperty('title');
    const m = await Ch.menu(hub(K3), D);
    for (const e of m.exercises) expect(e).not.toHaveProperty('title');
  });

  test('one home for the shelf: passageTitle(id) gives {en, ur} or null', () => {
    expect(Ch.passageTitle('en.listen.1.boat01')).toEqual(TITLE);
    expect(Ch.passageTitle('en.read.1.ref01')).toBeNull();
    expect(Ch.passageTitle('no.such.passage')).toBeNull();
  });
});

// ── EVENTS §0.1 (r5-redteam-4 row 25): the server ch_open carries the writer's mark under events v2; today's event off
describe('the server ch_open under web_quiz_events_v2', () => {
  const opens = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.ch_open').map(([, d]) => d);
  test('events v2 on: ch_open carries w:\'s\' beside via and grade', async () => {
    on(V2, ...CANON_ON, PERIOD, 'web_quiz_hub', 'web_quiz_events_v2');
    require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache();
    await Ch.menu(hub(K3), D);
    expect(opens()).toEqual([{ via: 'hub', grade: 3, w: 's' }]);
  });
  test('golden: events v2 off (the parent on or off): ch_open is today\'s {via, grade}, no w', async () => {
    on(V2, ...CANON_ON, PERIOD, 'web_quiz_hub');
    require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache();
    await Ch.menu(hub(K3), D);
    expect(opens()).toEqual([{ via: 'hub', grade: 3 }]);
    expect(Object.keys(opens()[0])).toEqual(['via', 'grade']);
  });
});

// ── a class round turn or a practice play never uses up the child's home attempt (rows before the provenance columns count)

describe('a round run or a practice run does not consume the home attempt', () => {
  const scoredBigger = (extra = {}) => db.web_quiz_challenge_runs.push({ id: crypto.randomUUID(), student_id: K3, exercise: 'bigger', grade: 3, lang: 'en', status: 'scored',
    score: { correct: 8, n: 10, stopped: false }, meta: {}, created_at: new Date(Date.now() - 3600 * 1000).toISOString(), scored_at: new Date(Date.now() - 3500 * 1000).toISOString(), ...extra });
  const scoredRead = (extra = {}) => db.web_quiz_challenge_runs.push({ id: crypto.randomUUID(), student_id: K3, exercise: 'read', grade: 3, lang: 'en', status: 'scored',
    score: { correct: 40, attempted: 45, stopped: false }, wcpm: 40, meta: {}, created_at: new Date(Date.now() - 3600 * 1000).toISOString(), ...extra });

  test('(a) one scored bigger row with mode class_round: the home menu shows that stop not done, no badge', async () => {
    on(V2);
    scoredBigger({ mode: 'class_round', via: 'class_round', record: false });
    const stop = (await Ch.menu(hub(), D)).exercises.find((e) => e.id === 'bigger');
    expect(stop).toMatchObject({ id: 'bigger', done: false, badge: false });
  });

  test('(b) the next home bigger serve after a round turn: attempt_no 1, record true, no practice round', async () => {
    on(V2, ...CANON_ON, PERIOD);
    scoredBigger({ mode: 'class_round', via: 'class_round', record: false, period_id: null });
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(ex.practice_round).toBeUndefined();
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true });
    await Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000 });
    expect(rowOf(ex.ct).meta).toMatchObject({ attempt_no: 1, counted: true });
  });

  test('(b2) a round turn served mode practice (via the round, position 11+) does not count either', async () => {
    on(V2);
    scoredBigger({ mode: 'practice', via: 'class_round' });
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check' });
    expect(ex.practice_round).toBeUndefined();
  });

  test('(c) a scored practice read row does not raise attempt_no', async () => {
    on(V2);
    scoredRead({ mode: 'practice', via: 'hub' });
    const ex = await Ch.exercise(hub(), 'read', D);
    expect(ex.practice_round).toBeUndefined();
    await readAloud(ex.ct);
    expect(rowOf(ex.ct).meta).toMatchObject({ attempt_no: 1, counted: true });
  });

  test('(d) golden: a scored row written before the provenance columns (no mode, no via) still counts: attempt 2, practice', async () => {
    on(V2);
    scoredBigger();
    expect((await Ch.menu(hub(), D)).exercises.find((e) => e.id === 'bigger')).toMatchObject({ done: true, badge: true });
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(ex.practice_round).toBe(true);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'practice' });
    await Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000 });
    expect(rowOf(ex.ct).meta).toMatchObject({ attempt_no: 2, counted: false });
  });

  test('(d) golden, every new switch off: the same pre-provenance row gives attempt 2 and a practice round', async () => {
    scoredBigger();
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(ex.practice_round).toBe(true);
    await Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000 });
    expect(db.web_quiz_challenge_runs[db.web_quiz_challenge_runs.length - 1].meta).toMatchObject({ attempt_no: 2, counted: false });
  });
});

// ── anchor serves before the provenance columns: October's missing rows served A1's items (ITEMS §3.1, §4) ─────

describe('anchor_serves_any counts a pre-v2 missing row as an A1 serve', () => {
  const preV2Missing = (kid, grade) => db.web_quiz_challenge_runs.push({ id: crypto.randomUUID(), student_id: kid, exercise: 'missing', grade, lang: 'en', status: 'scored',
    score: { correct: 9, n: 10, stopped: false }, meta: { attempt_no: 1, counted: true }, created_at: new Date(Date.now() - 20 * DAY).toISOString() });

  test('a G5 child with one pre-v2 missing row, then the Trail warm-up: serves_any 2, exposure 1, prev2 {full 1, partial 0}', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    preV2Missing(K5, 5);
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    expect(rowOf(ex.ct)).toMatchObject({ anchor_block: 'A1', anchor_exposure_no: 1, anchor_serves_any: 2, meta: expect.objectContaining({ anchor_serves_any: 2 }) });
    expect(rowOf(ex.ct).meta.draw.anchor_prev2).toEqual({ full: 1, partial: 0 });
    expect(starts()[0]).toMatchObject({ anchor_serves_any: 2, anchor_exposure_no: 1 });
  });

  test('a G3 pre-v2 missing row is a partial serve: prev2 {full 0, partial 1}, serves_any 2', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    preV2Missing(K3, 3);
    const ex = await Ch.exercise(hub(K3), 'missing', D);
    expect(rowOf(ex.ct)).toMatchObject({ anchor_exposure_no: 1, meta: expect.objectContaining({ anchor_serves_any: 2 }) });
    expect(rowOf(ex.ct).meta.draw.anchor_prev2).toEqual({ full: 0, partial: 1 });
  });

  test('no pre-v2 row: serves_any 1, prev2 {full 0, partial 0}', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    expect(rowOf(ex.ct)).toMatchObject({ anchor_exposure_no: 1, anchor_serves_any: 1, admin_mode: 'self_run', sample_arm: null, meta: expect.objectContaining({ anchor_serves_any: 1 }) });
    expect(rowOf(ex.ct).meta.draw.anchor_prev2).toEqual({ full: 0, partial: 0 });
  });
});
