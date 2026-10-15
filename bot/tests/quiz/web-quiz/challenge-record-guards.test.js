'use strict';
/**
 * The Challenge record guards (web_quiz_challenge_v2 and its children): one pick per visit when a hub remembers more
 * than one child, a served-and-left row never consumes the month's record, a duplicate record is kept as practice,
 * the identity switch as the record's parent and the class round as the class week's, and one "on its way" draw log
 * per child, stop and period an hour. Faked boundaries only (Supabase with the column guard, R2, speech, the LLM client).
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
let fake;
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
  fake = guardColumns(makeFake(db));
  Object.assign(supabase, fake);
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
// the identity store's switches (web_quiz_identity_canon has web_quiz_hub as its parent)
const CANON = ['web_quiz_hub', 'web_quiz_identity_canon'];

describe('a served-and-left row never consumes the month\'s record', () => {
  test('one served record row this period: the next open is a check and the record, on another passage', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    const first = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(first.ct)).toMatchObject({ status: 'served', mode: 'check', record: true });
    const again = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(again.ct)).toMatchObject({ mode: 'check', record: true });
    expect(rowOf(again.ct).passage_id).not.toBe(rowOf(first.ct).passage_id);
  });

  test('an abandoned record row this period: the same', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    const first = await Ch.exercise(hub(), 'read', D);
    rowOf(first.ct).status = 'abandoned';
    const again = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(again.ct)).toMatchObject({ mode: 'check', record: true });
    expect(rowOf(again.ct).passage_id).not.toBe(rowOf(first.ct).passage_id);
  });

  test('a scored record row this period: practice on the record passage, as today', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    const first = await Ch.exercise(hub(), 'read', D);
    rowOf(first.ct).status = 'scored';
    const again = await Ch.exercise(hub(), 'read', D);
    expect(rowOf(again.ct)).toMatchObject({ mode: 'practice', record: false, passage_id: rowOf(first.ct).passage_id });
  });
});

describe('a second record of the same stop this period (a concurrent serve, the record unique index) is kept as practice', () => {
  // the runs table answers a record insert with a unique violation once, as the partial unique index would
  const duplicateOnce = () => {
    let left = 1;
    const from = fake.from;
    fake.from = (t) => {
      const b = from(t);
      if (t !== 'web_quiz_challenge_runs') return b;
      const insert = b.insert;
      b.insert = (row) => {
        if (left > 0 && row && row.record === true) {
          left -= 1;
          return { then: (ok, no) => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }).then(ok, no) };
        }
        return insert(row);
      };
      return b;
    };
    supabase.from = fake.from;
  };
  const dupEvents = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.ch_record_duplicate');

  test('the record insert answers 23505: the same row is stored as practice, no throw, one event', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    duplicateOnce();
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
    expect(rowOf(ex.ct)).toMatchObject({ status: 'served', mode: 'practice', record: false, meta: expect.objectContaining({ record_lost: 'duplicate' }) });
    expect(ex).toMatchObject({ mode: 'practice', practice_round: true });
    expect(starts()[0]).toMatchObject({ mode: 'practice', record: false });
    expect(dupEvents()).toEqual([['web_quiz.ch_record_duplicate', expect.objectContaining({ w: 's' })]]);
    expect(db.challenge_draws.map((d) => d.run_id)).toEqual([runOf(ex.ct)]);
  });

  test('no duplicate: the record as today, no event', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true });
    expect(rowOf(ex.ct).meta).not.toHaveProperty('record_lost');
    expect(dupEvents()).toEqual([]);
  });
});

describe('web_quiz_identity_canon is the record\'s parent; web_quiz_class_round the class week\'s', () => {
  test('_v2, _period and _pool on, canon off: the Trail serves, a practice row, no record, meta.record_blocked', async () => {
    on(V2, PERIOD, POOL);
    const ex = await Ch.exercise(hub(), 'missing', D);
    expect(ex.items).toHaveLength(10);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'practice', record: false, meta: expect.objectContaining({ record_blocked: 'identity_canon_off' }) });
    expect(starts()[0]).toMatchObject({ mode: 'practice', record: false });
  });

  test('canon on: the record as today, nothing blocked', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    const ex = await Ch.exercise(hub(), 'missing', D);
    expect(rowOf(ex.ct)).toMatchObject({ mode: 'check', record: true });
    expect(rowOf(ex.ct).meta).not.toHaveProperty('record_blocked');
  });

  test('the class-week arm is read only with web_quiz_class_round on as well (its parent), and only by the class link', async () => {
    on('web_quiz_class_week');
    expect(await Ch.classWeekOpen('class_link')).toBe(false);
    on('web_quiz_class_round');
    Ch.__reset();
    expect(await Ch.classWeekOpen('class_link')).toBe(true);
    expect(await Ch.classWeekOpen('hub')).toBe(false);
  });
});

describe('swap two children: a hub that remembers more than one child serves ?kid= only for this visit\'s pick', () => {
  const BP = require('../../../shared/services/quiz/web-quiz-bind-page');
  const two = () => T.sign({ k: 'h', ids: [K3, K5], exp: Math.floor(Date.now() / 1000) + 3600 });
  let spy;
  afterEach(() => { if (spy) spy.mockRestore(); spy = null; });

  test('two remembered ids, ?kid= the second child, no pick on this phone: 400 pick_kid and no run row', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    spy = jest.spyOn(BP, 'pickFor').mockResolvedValue(null);
    await expect(Ch.exercise(two(), 'bigger', { ...D, kid: Ch.kidChip(K5) })).rejects.toMatchObject({ status: 400, body: { error: 'pick_kid' } });
    expect(db.web_quiz_challenge_runs).toEqual([]);
  });

  test('the chip tapped on this phone (a pick for that child): served as that child', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    spy = jest.spyOn(BP, 'pickFor').mockResolvedValue({ id_src: 'hub_chip', id_confidence: 'high', homonym_in_list: false });
    const ex = await Ch.exercise(two(), 'bigger', { ...D, kid: Ch.kidChip(K5) });
    expect(rowOf(ex.ct)).toMatchObject({ student_id: K5 });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ canonicalId: K5, device: D.device }));
  });

  test('one remembered id: today (no pick needed)', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    spy = jest.spyOn(BP, 'pickFor').mockResolvedValue(null);
    const ex = await Ch.exercise(hub(K3), 'bigger', { ...D, kid: Ch.kidChip(K3) });
    expect(rowOf(ex.ct)).toMatchObject({ student_id: K3 });
  });

  test('the identity switch off (no pick store): two ids and ?kid= serve as today', async () => {
    on(V2);
    spy = jest.spyOn(BP, 'pickFor').mockResolvedValue(null);
    const ex = await Ch.exercise(two(), 'bigger', { ...D, kid: Ch.kidChip(K5) });
    expect(rowOf(ex.ct)).toMatchObject({ student_id: K5 });
  });
});

describe('one "on its way" draw log per child, stop and period an hour', () => {
  const seenBand1 = () => {
    for (const id of ['en.read.1.ref01', 'en.read.1.kite']) {
      db.web_quiz_challenge_runs.push({ id: crypto.randomUUID(), student_id: K3, canonical_id: K3, exercise: 'read', lang: 'en', status: 'scored', mode: 'practice', record: false, passage_id: id, created_at: '2026-10-20T00:00:00Z' });
    }
  };

  test('a second on-its-way open within the hour writes no second draw row; after the hour it is logged again', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    seenBand1();
    const a = await Ch.exercise(hub(K3), 'read', D);
    const b = await Ch.exercise(hub(K3), 'read', D);
    expect(a).toMatchObject({ on_its_way: true });
    expect(b).toEqual(a);
    expect(db.challenge_draws).toHaveLength(1);
    expect(db.challenge_draws[0]).toMatchObject({ outcome: 'on_its_way', run_id: null, stop: 'read', canonical_id: K3 });
    db.challenge_draws[0].drawn_at = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    await Ch.exercise(hub(K3), 'read', D);
    expect(db.challenge_draws).toHaveLength(2);
  });

  test('another stop on its way is its own log', async () => {
    on(V2, PERIOD, POOL, ...CANON);
    seenBand1();
    await Ch.exercise(hub(K3), 'read', D);
    db.challenge_draws.push({ draw_id: crypto.randomUUID(), canonical_id: K3, period_id: '2026-11', stop: 'listen', lang: 'en', fixed_grade_band: 'G23', band_reason: 'entry_grade', outcome: 'on_its_way', weights_v: 'w1', drawn_at: new Date().toISOString() });
    await Ch.exercise(hub(K3), 'read', D);
    expect(db.challenge_draws.filter((d) => d.stop === 'read')).toHaveLength(1);
  });
});
