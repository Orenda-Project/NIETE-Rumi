'use strict';
/**
 * meta.counted on a run row under challenge v2 (RULING #116): meta.counted = (mode === 'check' && record === true).
 * A round row (mode 'class_round'), a practice replay and a Story Time row carry counted=false whatever their
 * attempt number; a check record row carries true. Rows without the v2 fields (switch off) keep today's stamp,
 * counted = (attempt_no === 1), byte-identical (the golden). The Book, stickers, lamps and the record follow the
 * child's VOLUNTARY counted stops only (SAMPLING_RULING NC4); readers of the row key on mode + record, never on
 * meta.counted (m-measure-5 045547) — this makes the stamp say the same thing.
 * Faked boundaries only (Supabase, R2, speech, the LLM client); the service and the draw are real.
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
const missingAnswers = (items) => items.map((it, i) => ({ i, value: String(it.answer), ms: 3000, first_key_ms: 1200, keys: String(it.answer).length }));
const biggerTaps = (items) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2500 }));

describe('meta.counted under challenge v2 = (mode === \'check\' && record) (RULING #116)', () => {
  test('a round row has meta.counted=false (its attempt_no is 1)', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const ex = await Ch.exercise(hub(), 'bigger', { ...D, mode: 'class_round' });
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'class_round', record: false });
    await Ch.submit({ ct: ex.ct, taps: biggerTaps(ex.items), ms: 25000 });
    expect(rowOf(ex.ct)).toMatchObject({ status: 'scored', mode: 'class_round' });
    expect(rowOf(ex.ct).meta).toMatchObject({ attempt_no: 1, counted: false });
  });

  test('a check record row has meta.counted=true; the child\'s practice replay of the same stop has false', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const a = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(a.ct)).toMatchObject({ mode: 'check', record: true });
    await Ch.submit({ ct: a.ct, taps: biggerTaps(a.items), ms: 25000 });
    expect(rowOf(a.ct).meta).toMatchObject({ attempt_no: 1, counted: true });
    const b = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(b.ct)).toMatchObject({ mode: 'practice', record: false });
    await Ch.submit({ ct: b.ct, taps: biggerTaps(b.items), ms: 25000 });
    expect(rowOf(b.ct).meta).toMatchObject({ attempt_no: 2, counted: false });
  });

  test('the warm-up (missing, anchor block A1) in the teacher\'s round: counted=false; the same child\'s own check later: true', async () => {
    on(V2, ...CANON_ON, PERIOD, POOL);
    const round = await Ch.exercise(hub(), 'missing', { ...D, mode: 'class_round' });
    expect(rowOf(round.ct)).toMatchObject({ mode: 'class_round', anchor_block: 'A1' });
    await Ch.submit({ ct: round.ct, answers: missingAnswers(round.items), ms: 30000 });
    expect(rowOf(round.ct).meta).toMatchObject({ counted: false });
    const own = await Ch.exercise(hub(), 'missing', D);
    expect(rowOf(own.ct)).toMatchObject({ mode: 'check', record: true });
    await Ch.submit({ ct: own.ct, answers: missingAnswers(own.items), ms: 30000 });
    expect(rowOf(own.ct).meta).toMatchObject({ counted: true });
  });

  test('golden: v2 off, today\'s stamp — the first scored attempt counted=true, the second false (attempt_no), byte-identical meta keys', async () => {
    const a = await Ch.exercise(hub(), 'bigger', D);
    await Ch.submit({ ct: a.ct, taps: biggerTaps(a.items), ms: 25000 });
    const b = await Ch.exercise(hub(), 'bigger', D);
    await Ch.submit({ ct: b.ct, taps: biggerTaps(b.items), ms: 25000 });
    const rows = db.web_quiz_challenge_runs;
    expect(rows.map((r) => r.mode)).toEqual([undefined, undefined]);
    expect(rows[0].meta).toMatchObject({ attempt_no: 1, counted: true });
    expect(rows[1].meta).toMatchObject({ attempt_no: 2, counted: false });
    // the stamp's keys as today (web_quiz_challenge_items is off here, so no items/none_n/rapid/abandoned)
    expect(Object.keys(rows[0].meta).sort()).toEqual(['attempt_no', 'counted', 'elapsed_s', 'exposure_no', 'grade_source', 'helped', 'ms', 'sequence_n', 'test', 'too_fast'].sort());
  });
});
