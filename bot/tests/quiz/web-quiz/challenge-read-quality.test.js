'use strict';
/**
 * The quality of a counted row where the serve writes it (the speed and noise floors; EVENTS §11 m_result.quality):
 *   rapid_perfect  a record warm-up (anchor block A1) with all 10 right and a median per-item ms under 1500 — a scripted
 *                  fast 10/10, kept on the row, excluded from the headline; lamps N3–N5 never light on it (BADGES §1.2)
 *   implausible    a counted read whose numbers cannot be believed: the STT heard no word (no_speech), or the story
 *                  confidence is under the floor while the count credits nearly every token (low_story_confidence —
 *                  a 220 Hz tone once scored 60/60 at confidence 0.44). Written record=false (an exposure, like
 *                  abandoned), score zeroed, wcpm null, the raw counts in meta.raw, no items; it earns nothing.
 * Every other row carries no quality key (today's rows, byte-identical). Faked boundaries only (Supabase, R2, speech,
 * the LLM client); the service, the scorer, the draw and the rung rules are real.
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
  return { passage_id: id, lang, kind, band: Number(band), pool: 'check', status: 'calibrated', is_reference: false, released_at: REL, withdrawn_at: null, twin_of: null, provenance: 'published_calibrated', ...extra };   // sourced: the counted draw admits only sourced passages
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
const R = require('../../../shared/services/quiz/web-quiz-rungs');
// a transcript of n words that are NOT the story's (noise the speech service turned into words)
const garbled = (n, gap = 1.0) => ({ text: '', tokens: Array.from({ length: n }, (_, k) => ({ text: ' xq', start_ms: Math.round((0.4 + k * gap) * 1000), end_ms: Math.round((0.4 + k * gap + 0.5) * 1000), speaker: 1 })) });
const readWith = async (ct, transcript, right, tried) => {
  const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
  r2.downloadFromR2.mockResolvedValue(clip(61));
  AudioService.transcribe.mockResolvedValue(transcript);
  llm.__create.mockResolvedValue(marks(right, tried));
  return Ch.submit({ ct, key, ms: 61000, lang: 'en', ended: 'timer', mic_check: 'pass', read_s: 61 }, { waitMs: 60000 });
};

describe('the noise floor: a counted read with no believable speech is implausible', () => {
  test('the pure floor: no STT word → no_speech; confidence under 0.5 with ≥ 90% credited → low_story_confidence; else null', () => {
    expect(Ch.readQuality({ stt_words: 0, story_confidence: 0.9 }, { correct: 3, attempted: 5 }, 60)).toBe('no_speech');
    expect(Ch.readQuality({ stt_words: 60, align_correct: 0, story_confidence: 0.9 }, { correct: 60, attempted: 60 }, 60)).toBe('no_aligned_words');
    expect(Ch.readQuality({ stt_words: 60, align_correct: 0, story_confidence: 0.9 }, { correct: 40, attempted: 60 }, 60)).toBeNull();   // 67% credited: not the hallucination's shape
    expect(Ch.readQuality({ stt_words: 60, align_correct: 12, story_confidence: 0.44 }, { correct: 60, attempted: 60 }, 60)).toBe('low_story_confidence');
    expect(Ch.readQuality({ stt_words: 60, story_confidence: 0.44 }, { correct: 50, attempted: 60 }, 60)).toBeNull();   // 83%: a weak reader, believed
    expect(Ch.readQuality({ stt_words: 60, story_confidence: 0.69 }, { correct: 58, attempted: 60 }, 60)).toBeNull();
    expect(Ch.readQuality({ story_confidence: null }, { correct: 60, attempted: 60 }, 60)).toBeNull();   // no doubt fields: believed, as today
  });

  test('the fourth reason, independent of the passage: the speech service heard a quarter or less of what the count credits', () => {
    // the two fixture rows' shapes, no child's voice: a tone credited 60/60 and white noise credited 36/60
    expect(Ch.readQuality({ stt_words: 0, story_confidence: 0.44 }, { correct: 60, attempted: 60 }, 60)).toBe('no_speech');
    expect(Ch.readQuality({ stt_words: 0, story_confidence: 0.44 }, { correct: 36, attempted: 60 }, 60)).toBe('no_speech');
    expect(Ch.readQuality({ stt_words: 1, align_correct: 0, story_confidence: 0.44 }, { correct: 36, attempted: 60 }, 60)).toBe('low_stt_support');
    expect(Ch.readQuality({ stt_words: 9, align_correct: 8, story_confidence: 0.8 }, { correct: 10, attempted: 12 }, 60)).toBeNull();   // a 10-word read with 9 heard
    expect(Ch.readQuality({ stt_words: 6, align_correct: 4, story_confidence: 0.6 }, { correct: 20, attempted: 25 }, 60)).toBeNull();   // a weak reader: 6 heard ≥ 5
    expect(Ch.readQuality({ stt_words: 4, align_correct: 4, story_confidence: 0.6 }, { correct: 20, attempted: 25 }, 60)).toBe('low_stt_support');   // 4 heard < 5
  });

  test('a noise-shaped read through the real scorer: one garbled word heard, the model credits 36/60 → implausible, named by the floor (no_aligned_words)', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K5), 'read', D);
    await readWith(ex.ct, garbled(1), 36, 60);
    const row = rowOf(ex.ct);
    expect(row.status).toBe('scored');
    expect(row.meta.quality).toBe('implausible');
    expect(row.meta.flags).toEqual(expect.arrayContaining(['no_aligned_words']));   // one heard word is under the floor, which runs first
    expect(row).toMatchObject({ record: false, wcpm: null });
    expect(row.meta).toMatchObject({ stt_words: 1, record_lost: 'implausible', raw: { correct: 36 } });
  });

  test('a tone-shaped read (60 garbled words, the model credits 60/60): quality implausible, record as served, wcpm null, raw counts kept, no items', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true });
    const r = await readWith(ex.ct, garbled(60), 60, 60);
    const row = rowOf(ex.ct);
    expect(row.status).toBe('scored');
    expect(row.meta.quality).toBe('implausible');
    expect(row.meta.flags.some((f) => ['no_aligned_words', 'low_story_confidence'].includes(f))).toBe(true);
    expect(row.record).toBe(false);   // cleared after the serve, as the sweeper's abandoned row (record_lost says why); the month stays open
    expect(row.meta.record_lost).toBe('implausible');
    expect(row.meta.counted).toBe(false);
    expect(row.wcpm).toBeNull();
    expect(row.score).toMatchObject({ correct: 0, attempted: 0 });
    expect(row.meta.raw).toMatchObject({ correct: 60, attempted: 60, wcpm: expect.any(Number) });
    expect(row.meta.items).toBeUndefined();
    expect(row.meta).toMatchObject({ stt_words: 60, align_correct: 0 });
    expect(r).toMatchObject({ wcpm: null });
    // the child's next read this period is a clean check again (the month is not burnt by noise)
    const again = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(again.ct)).toMatchObject({ mode: 'check', record: true });
  });

  test('a read where the speech service heard nothing but the model still credits the text: no_speech', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K5), 'read', D);
    await readWith(ex.ct, { text: '', tokens: [] }, 60, 60);
    const row = rowOf(ex.ct);
    expect(['scored', 'failed']).toContain(row.status);
    if (row.status === 'scored') {
      expect(row.meta.quality).toBe('implausible');
      expect(row.meta.flags).toEqual(expect.arrayContaining(['no_speech']));
      expect(row.record).toBe(false);
      expect(row.meta.record_lost).toBe('implausible');
    } else {
      expect(row.meta.reason).toBe('unheard');   // the scorer's own "not one word was heard" path, as today
    }
  });

  test('golden: real speech reading the WRONG passage (words heard, none credited) is failed/unheard as today, no quality key; it is the period\'s attempted record', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true });
    // a voice reading another text: the speech service hears 50 real words, the model credits none and marks none attempted
    const other = { text: '', tokens: Array.from({ length: 50 }, (_, k) => ({ text: ` other${k}`, start_ms: Math.round((0.9 + k * 1.1) * 1000), end_ms: Math.round((0.9 + k * 1.1 + 0.8) * 1000), speaker: 1 })) };
    await readWith(ex.ct, other, 0, 0);
    const row = rowOf(ex.ct);
    expect(row.status).toBe('failed');
    expect(row.meta.reason).toBe('unheard');
    expect(row.meta).not.toHaveProperty('quality');
    expect(row.meta).not.toHaveProperty('record_lost');
    expect(row.wcpm == null).toBe(true);
    // the child tried: a 0-word read is in the sample (the bottom of the distribution), so it holds the period's record and the
    // next read this period is a practice round — unlike an implausible row, which gives the slot back
    expect(row.record).toBe(true);
    const again = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(again.ct)).toMatchObject({ mode: 'practice', record: false });
  });

  test('golden: an ordinary read carries no quality key and stays the record', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL, 'web_quiz_challenge_items');
    const ex = await Ch.exercise(hub(K5), 'read', D);
    await readAloud(ex.ct);
    const row = rowOf(ex.ct);
    expect(row).toMatchObject({ status: 'scored', record: true });
    expect(row.meta.quality).toBeUndefined();
    expect(row.meta.raw).toBeUndefined();
    expect(Array.isArray(row.meta.items)).toBe(true);
    expect(row.wcpm).toBeGreaterThan(0);
  });
});

// the server's clock: Date.now moved forward by `secs` (cumulative within a test), so the submit sees that much time since the serve
const REAL_NOW = Date.now;
let shiftMs = 0;
const later = (secs) => {
  shiftMs += secs * 1000;
  if (!jest.isMockFunction(Date.now)) jest.spyOn(Date, 'now').mockImplementation(() => REAL_NOW() + shiftMs);
};
afterEach(() => { shiftMs = 0; if (jest.isMockFunction(Date.now)) Date.now.mockRestore(); });

describe('the speed floor: a perfect warm-up needs a floor', () => {
  const fastRight = (items, ms) => items.map((it, i) => ({ i, value: String(it.answer), ms, first_key_ms: Math.min(ms - 100, 400), keys: String(it.answer).length }));
  test('a record A1 warm-up, 10/10 with median item ms 900: meta.quality rapid_perfect (the row keeps its score)', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL, 'web_quiz_challenge_items');
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true, anchor_block: 'A1' });
    await Ch.submit({ ct: ex.ct, answers: fastRight(ex.items, 900), ms: 9000 });
    const row = rowOf(ex.ct);
    expect(row.status).toBe('scored');
    expect(row.score.correct).toBe(10);
    expect(row.meta.quality).toBe('rapid_perfect');
    expect(row.meta.rapid).toBe(false);   // #122's floor is not itemFlags' rapid (fast AND wrong)
  });

  test('the same 10/10 at 3000 ms an item, and a 9/10 at 900 ms: no quality key (today\'s rows)', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL, 'web_quiz_challenge_items');
    const a = await Ch.exercise(hub(K5), 'missing', D);
    later(40);
    await Ch.submit({ ct: a.ct, answers: fastRight(a.items, 3000), ms: 30000 });
    expect(rowOf(a.ct).meta.quality).toBeUndefined();
    const b = await Ch.exercise(hub(K3), 'missing', D);
    const nine = fastRight(b.items, 900); nine[0].value = String(Number(nine[0].value) + 1);
    await Ch.submit({ ct: b.ct, answers: nine, ms: 9000 });
    expect(rowOf(b.ct).score.correct).toBe(9);
    expect(rowOf(b.ct).meta.quality).toBeUndefined();
  });

  test('a practice replay of the warm-up, 10/10 fast: no quality key (only a record row is measured)', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL, 'web_quiz_challenge_items');
    const a = await Ch.exercise(hub(K5), 'missing', D);
    await Ch.submit({ ct: a.ct, answers: fastRight(a.items, 3000), ms: 30000 });
    const b = await Ch.exercise(hub(K5), 'missing', D);
    expect(rowOf(b.ct)).toMatchObject({ mode: 'practice', record: false });
    await Ch.submit({ ct: b.ct, answers: fastRight(b.items, 900), ms: 9000 });
    expect(rowOf(b.ct).meta.quality).toBeUndefined();
  });
});

describe('the speed floor on the server clock', () => {
  const rightAt = (items, ms) => items.map((it, i) => ({ i, value: String(it.answer), ms, first_key_ms: Math.min(ms - 100, 400), keys: String(it.answer).length }));
  const flags = () => on(V2, ...CANON_ON, PERIOD, POOL, 'web_quiz_challenge_items');
  test('a record A1 warm-up, 10/10 at 1600 ms an item, submitted 18 s after the serve: rapid_perfect (the page pacing alone is ~10 s)', async () => {
    flags();
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true, anchor_block: 'A1' });
    later(18);
    await Ch.submit({ ct: ex.ct, answers: rightAt(ex.items, 1600), ms: 16000 });
    const row = rowOf(ex.ct);
    expect(row.status).toBe('scored');
    expect(row.score.correct).toBe(10);
    expect(row.meta.elapsed_s).toBeGreaterThanOrEqual(18);
    expect(row.meta.elapsed_s).toBeLessThan(19.5);
    expect(row.meta.quality).toBe('rapid_perfect');
    expect(R.computeRung('numbers', [row])).toBeLessThanOrEqual(2);
  });

  test('the forged-clock shape: 10/10 at 1600 ms an item, submitted 23.8 s after the serve: rapid_perfect', async () => {
    flags();
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    later(23.8);
    await Ch.submit({ ct: ex.ct, answers: rightAt(ex.items, 1600), ms: 16000 });
    const row = rowOf(ex.ct);
    expect(row.score.correct).toBe(10);
    expect(row.meta.elapsed_s).toBeGreaterThanOrEqual(23.8);
    expect(row.meta.elapsed_s).toBeLessThan(25);
    expect(row.meta.quality).toBe('rapid_perfect');
  });

  test('golden: the same 10/10 at 1600 ms, submitted 40 s after the serve: no quality key', async () => {
    flags();
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    later(40);
    await Ch.submit({ ct: ex.ct, answers: rightAt(ex.items, 1600), ms: 16000 });
    const row = rowOf(ex.ct);
    expect(row.score.correct).toBe(10);
    expect(row.meta.elapsed_s).toBeGreaterThanOrEqual(40);
    expect(row.meta).not.toHaveProperty('quality');
  });

  test('a 10/10 at 900 ms an item, submitted 40 s after the serve: rapid_perfect (the page floor alone still marks)', async () => {
    flags();
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    later(40);
    await Ch.submit({ ct: ex.ct, answers: rightAt(ex.items, 900), ms: 9000 });
    expect(rowOf(ex.ct).meta.quality).toBe('rapid_perfect');
  });

  test('a 9/10 at 1600 ms, submitted 18 s after the serve: no quality key', async () => {
    flags();
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    const nine = rightAt(ex.items, 1600); nine[0].value = String(Number(nine[0].value) + 1);
    later(18);
    await Ch.submit({ ct: ex.ct, answers: nine, ms: 16000 });
    expect(rowOf(ex.ct).score.correct).toBe(9);
    expect(rowOf(ex.ct).meta).not.toHaveProperty('quality');
  });

  test('a practice replay, 10/10 submitted 18 s after its serve: no quality key (only a record row is measured)', async () => {
    flags();
    const a = await Ch.exercise(hub(K5), 'missing', D);
    later(40);
    await Ch.submit({ ct: a.ct, answers: rightAt(a.items, 3000), ms: 30000 });
    const b = await Ch.exercise(hub(K5), 'missing', D);
    expect(rowOf(b.ct)).toMatchObject({ mode: 'practice', record: false });
    later(18);
    await Ch.submit({ ct: b.ct, answers: rightAt(b.items, 1600), ms: 16000 });
    expect(rowOf(b.ct).score.correct).toBe(10);
    expect(rowOf(b.ct).meta).not.toHaveProperty('quality');
  });
});

describe('the silent-ended read: the floor runs before the door', () => {
  // the page ended the reading on silence after 10 s; the microphone check measured a level (not speech)
  const readSilent = async (ct, transcript, right, tried) => {
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.downloadFromR2.mockResolvedValue(clip(10));
    AudioService.transcribe.mockResolvedValue(transcript);
    llm.__create.mockResolvedValue(marks(right, tried));
    return Ch.submit({ ct, key, ms: 10000, lang: 'en', ended: 'silent', mic_check: 'level_ok', read_s: 10 }, { waitMs: 60000 });
  };
  const UR = ['ایک', 'دن', 'ہم', 'سکول', 'گئے', 'وہاں', 'بہت', 'بچے', 'تھے', 'اور'];
  const urdu = (n) => ({ text: '', tokens: Array.from({ length: n }, (_, k) => ({ text: ` ${UR[k % UR.length]}`, start_ms: Math.round((0.4 + k * 0.33) * 1000), end_ms: Math.round((0.4 + k * 0.33 + 0.28) * 1000), speaker: 1 })) });
  const serve = async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true });
    return ex;
  };

  test('29 Urdu words heard on an English passage, none credited: failed/unheard, no quality key, the record kept (the next read is practice)', async () => {
    const ex = await serve();
    await readSilent(ex.ct, urdu(29), 0, 0);
    const row = rowOf(ex.ct);
    expect(row.meta.stt_words).toBe(29);
    expect(row.status).toBe('failed');
    expect(row.meta.reason).toBe('unheard');
    expect(row.meta).not.toHaveProperty('quality');
    expect(row.meta).not.toHaveProperty('record_lost');
    expect(row.record).toBe(true);
    const again = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(again.ct)).toMatchObject({ mode: 'practice', record: false });
  });

  test('nothing heard at all: implausible (no_speech), record cleared, wcpm null; the next read is a fresh check', async () => {
    const ex = await serve();
    await readSilent(ex.ct, { text: '', tokens: [] }, 0, 0);
    const row = rowOf(ex.ct);
    expect(row.status).toBe('scored');
    expect(row.meta.quality).toBe('implausible');
    expect(row.meta.flags).toEqual(expect.arrayContaining(['no_speech']));
    expect(row.record).toBe(false);
    expect(row.meta.record_lost).toBe('implausible');
    expect(row.wcpm).toBeNull();
    expect(row.score.correct).toBe(0);
    const again = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(again.ct)).toMatchObject({ mode: 'check', record: true });
  });

  test('one garbled word then silence, none credited: implausible (no_aligned_words), record cleared, no reading rung', async () => {
    const ex = await serve();
    await readSilent(ex.ct, garbled(1), 0, 0);
    const row = rowOf(ex.ct);
    expect(row.meta.stt_words).toBe(1);
    expect(row.status).toBe('scored');
    expect(row.meta.quality).toBe('implausible');
    expect(row.meta.flags).toEqual(expect.arrayContaining(['no_aligned_words']));
    expect(row.record).toBe(false);
    expect(row.meta.record_lost).toBe('implausible');
    expect(row.wcpm).toBeNull();
    expect(R.computeRung('reading', [row])).toBe(0);
  });

  test('golden: a timer-ended read that stops on the first line stays scored, stopped, no quality key', async () => {
    const ex = await serve();
    await readWith(ex.ct, heard(50, 1.1), 0, 50);
    const row = rowOf(ex.ct);
    expect(row.status).toBe('scored');
    expect(row.score.stopped).toBe(true);
    expect(row.wcpm).toBe(0);
    expect(row.meta).not.toHaveProperty('quality');
    expect(row.record).toBe(true);
  });
});

describe('speech that aligns to nothing is never a scored read', () => {
  const UR = ['ایک', 'دن', 'ہم', 'سکول', 'گئے', 'وہاں', 'بہت', 'بچے', 'تھے', 'اور'];
  const urdu = (n) => ({ text: '', tokens: Array.from({ length: n }, (_, k) => ({ text: ` ${UR[k % UR.length]}`, start_ms: Math.round((0.9 + k * 1.1) * 1000), end_ms: Math.round((0.9 + k * 1.1 + 0.8) * 1000), speaker: 1 })) });
  const serve = async (...more) => {
    on(V2, ...CANON_ON, PERIOD, POOL, ...more);
    const ex = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true });
    return ex;
  };

  test('50 Urdu words on an English passage, the marker credits 5 of 50: failed/unheard, no quality key, the record kept (the next read is practice)', async () => {
    const ex = await serve();
    await readWith(ex.ct, urdu(50), 5, 50);
    const row = rowOf(ex.ct);
    expect(row.meta).toMatchObject({ stt_words: 50, align_correct: 0 });
    expect(row.status).toBe('failed');
    expect(row.meta.reason).toBe('unheard');
    expect(row.meta).not.toHaveProperty('quality');
    expect(row.meta).not.toHaveProperty('record_lost');
    expect(row.wcpm == null).toBe(true);
    expect(row.record).toBe(true);
    const again = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(again.ct)).toMatchObject({ mode: 'practice', record: false });
  });

  test('golden: the same transcript credited 90% or more stays implausible (no_aligned_words), record cleared', async () => {
    const ex = await serve();
    const n = enTokens().length;
    await readWith(ex.ct, urdu(50), n, n);
    const row = rowOf(ex.ct);
    expect(row.status).toBe('scored');
    expect(row.meta.quality).toBe('implausible');
    expect(row.meta.flags).toEqual(expect.arrayContaining(['no_aligned_words']));
    expect(row.record).toBe(false);
    expect(row.meta.record_lost).toBe('implausible');
  });

  test('golden: an ordinary read with words aligned stays scored with its rate', async () => {
    const ex = await serve();
    await readAloud(ex.ct);
    const row = rowOf(ex.ct);
    expect(row.meta.align_correct).toBeGreaterThan(0);
    expect(row).toMatchObject({ status: 'scored', record: true });
    expect(row.wcpm).toBeGreaterThan(0);
    expect(row.meta).not.toHaveProperty('quality');
  });

  test('3 Urdu words heard (under the floor), nothing aligned, the marker credits 2, ended by the timer: implausible (no_aligned_words), record cleared', async () => {
    const ex = await serve();
    await readWith(ex.ct, urdu(3), 2, 3);
    const row = rowOf(ex.ct);
    expect(row.meta).toMatchObject({ stt_words: 3, align_correct: 0 });
    expect(row.status).toBe('scored');
    expect(row.meta.quality).toBe('implausible');
    expect(row.meta.flags).toEqual(expect.arrayContaining(['no_aligned_words']));
    expect(row.meta.raw).toMatchObject({ correct: 2, attempted: 3 });
    expect(row.wcpm).toBeNull();
    expect(row.record).toBe(false);
  });
});

describe('the floor runs on every record read, however it ended', () => {
  // the three live probe shapes the floor missed while it ran only on silent-ended reads with nothing attempted
  const readEnded = async (ct, { secs, ended, transcript, right, tried }) => {
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    r2.downloadFromR2.mockResolvedValue(clip(secs));
    AudioService.transcribe.mockResolvedValue(transcript);
    llm.__create.mockResolvedValue(marks(right, tried));
    return Ch.submit({ ct, key, ms: secs * 1000, lang: 'en', ended, mic_check: 'level_ok', read_s: secs }, { waitMs: 60000 });
  };
  const serve = async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true });
    return ex;
  };
  const expectImplausible = (row, reason) => {
    expect(row.status).toBe('scored');
    expect(row.meta.quality).toBe('implausible');
    expect(row.meta.flags).toEqual(expect.arrayContaining([reason]));
    expect(row.record).toBe(false);
    expect(row.meta.record_lost).toBe('implausible');
    expect(row.meta.counted).toBe(false);
    expect(row.wcpm).toBeNull();
    expect(R.computeRung('reading', [row])).toBe(0);
  };

  test('white noise ended by the timer, nothing heard, nothing attempted: implausible (no_speech), not unheard', async () => {
    const ex = await serve();
    await readEnded(ex.ct, { secs: 61, ended: 'timer', transcript: { text: '', tokens: [] }, right: 0, tried: 0 });
    const row = rowOf(ex.ct);
    expect(row.meta).toMatchObject({ stt_words: 0, ended: 'timer' });
    expectImplausible(row, 'no_speech');
    const again = await Ch.exercise(hub(K5), 'read', D);
    expect(rowOf(again.ct)).toMatchObject({ mode: 'check', record: true });
  });

  test('one word then silence: nothing heard, the marker credits the one word (not a first-line stop), 10 s: implausible (no_speech), not abandoned', async () => {
    const ex = await serve();
    await readEnded(ex.ct, { secs: 10, ended: 'silent', transcript: { text: '', tokens: [] }, right: 1, tried: 1 });
    const row = rowOf(ex.ct);
    expect(row.meta).toMatchObject({ stt_words: 0, ended: 'silent' });
    expect(row.meta.raw).toMatchObject({ correct: 1, attempted: 1 });
    expectImplausible(row, 'no_speech');
  });

  test('noise with a 0.7-s voice slice ended by the timer: one word heard (under the floor), nothing attempted: implausible (no_aligned_words)', async () => {
    const ex = await serve();
    await readEnded(ex.ct, { secs: 61, ended: 'timer', transcript: garbled(1), right: 0, tried: 0 });
    const row = rowOf(ex.ct);
    expect(row.meta).toMatchObject({ stt_words: 1, ended: 'timer' });
    expectImplausible(row, 'no_aligned_words');
  });

  test('a first-line stop with one word heard (under the floor): implausible, not a reader of 0', async () => {
    const ex = await serve();
    await readEnded(ex.ct, { secs: 61, ended: 'timer', transcript: garbled(1), right: 0, tried: 50 });
    const row = rowOf(ex.ct);
    expect(row.meta).toMatchObject({ stt_words: 1 });
    expectImplausible(row, 'no_aligned_words');
  });

  test('golden: one word under the floor on a read the child ended ("too hard"): implausible, the record given back', async () => {
    const ex = await serve();
    await readEnded(ex.ct, { secs: 20, ended: 'stuck', transcript: garbled(1), right: 1, tried: 1 });
    expectImplausible(rowOf(ex.ct), 'no_aligned_words');
  });

  test('golden: enough words heard, the child ended it at 20 s: incomplete as today (the words read kept), no quality key', async () => {
    const ex = await serve();
    await readEnded(ex.ct, { secs: 20, ended: 'stuck', transcript: heard(15, 1.1), right: 12, tried: 15 });
    const row = rowOf(ex.ct);
    expect(row.status).toBe('failed');
    expect(row.meta.reason).toBe('incomplete');
    expect(row.meta).not.toHaveProperty('quality');
    expect(row.record).toBe(true);
  });
});

describe('the lamps (web-quiz-rungs): rapid_perfect never lights N3–N5; implausible lights nothing', () => {
  const base = (over) => ({ id: 'r', canonical_id: K5, exercise: 'missing', status: 'scored', mode: 'check', record: true, period_id: '2026-11', form: 'G3', grade: 3, lang: 'en', band: null, anchor_block: 'A1', exposure_no: 1, created_at: '2026-11-03T10:00:00Z', ...over });
  const items = (oks) => oks.map((ok, i) => ({ i: i + 1, ok, ms: 900 }));
  test('a rapid_perfect 10/10 anchor row: N2 at most; the same row without the key: N5', () => {
    const perfect = base({ meta: { items: items(Array(10).fill(true)) } });
    expect(R.computeRung('numbers', [perfect])).toBe(5);
    expect(R.computeRung('numbers', [base({ meta: { ...perfect.meta, quality: 'rapid_perfect' } })])).toBeLessThanOrEqual(2);
  });
  test('an implausible read row is not an eligible record row; the same row without the key is', () => {
    const read = { id: 'x', canonical_id: K5, exercise: 'read', status: 'scored', mode: 'check', record: true, period_id: '2026-11', form: 'G3', grade: 3, lang: 'en', band: 1, wcpm: 60, meta: { stop_line: 2 } };
    expect(R.eligible(read)).toBe(true);
    expect(R.eligible({ ...read, meta: { ...read.meta, quality: 'implausible' } })).toBe(false);
    expect(R.computeRung('reading', [{ ...read, meta: { ...read.meta, quality: 'implausible' } }])).toBe(0);
  });
});
