'use strict';
/**
 * The counted pool admits only sourced passages (ITEMS §1.1 provenance, §8.1): under web_quiz_challenge_sourced_only
 * (parent web_quiz_challenge_pool, itself under web_quiz_challenge_v2) the CHECK draw keeps only passages with
 * provenance published_calibrated or reviewer_levelled; generated passages stay practice and Story Time stock.
 *   (a) on: a cell of generated passages only → on its way, no run row, a draw row with eligible_n 0
 *   (b) on: one reviewer_levelled + one generated → the reviewer_levelled one, eligible_n 1
 *   (c) on: the practice replay serves a generated record passage again, as today
 *   (d) on: a Story Time (practice) serve of a generated story still serves it
 *   (e) off: deep-equal to today's serve, generated passages eligible (the golden)
 *   (f) on, the registry without the provenance column (42703): on its way, nothing written
 * Plus the pure filter, and the migration on a real throwaway Postgres (skipped without the server binaries).
 * Faked boundaries only (Supabase, R2, speech, the LLM client); the service, the draw and the loader are real.
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
const { guardColumns, COLUMNS } = require('./registry-columns');   // a select naming a column the table lacks is 42703
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const Draw = require('../../../shared/services/quiz/web-quiz-challenge-draw');

const K3 = '44444444-4444-4444-8444-444444444444';
const L3 = 'a0000000-0000-4000-8000-000000000003';

const BASE_FLAGS = ['web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_listen', 'web_quiz_challenge_questions'];
const V2 = 'web_quiz_challenge_v2';
const PERIOD = 'web_quiz_challenge_period';
const POOL = 'web_quiz_challenge_pool';
const SOURCED = 'web_quiz_challenge_sourced_only';
const STORY = 'web_quiz_challenge_story';
const CANON_ON = ['web_quiz_hub', 'web_quiz_identity_canon'];
const on = (...keys) => keys.forEach((key) => db.app_settings.push({ key, value: true }));

const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();
const periodsNow = () => [
  { period_id: '2026-10', starts_at: iso(Date.now() - 40 * DAY), ends_at: iso(Date.now() - DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
  { period_id: '2026-11', starts_at: iso(Date.now() - DAY), ends_at: iso(Date.now() + 29 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
];
const REL = '2026-10-01T00:00:00Z';
// A registry row as the table reads after the migration: provenance 'generated' unless the test says otherwise.
const reg = (id, extra = {}) => {
  const [lang, kind, band] = id.split('.');
  return { passage_id: id, lang, kind, band: Number(band), pool: 'check', status: 'calibrated', is_reference: false, released_at: REL, withdrawn_at: null, twin_of: null, provenance: 'generated', ...extra };
};
// A grade-3 child draws in band 1 (the floor: no lower band). The band-1 read cell: a reference and a provisional.
const REGISTRY = () => [
  reg('en.read.2.setA', { is_reference: true }), reg('ur.read.2.setA', { is_reference: true }),
  reg('en.listen.2.setA', { is_reference: true, twin_of: 'en.read.2.setA' }), reg('ur.listen.2.setA', { is_reference: true, twin_of: 'ur.read.2.setA' }),
  reg('en.read.1.ref01', { is_reference: true }), reg('en.read.1.kite', { status: 'provisional' }),
  reg('en.read.1.pstory', { pool: 'practice', status: 'reviewed' }),   // a practice (Story Time) story
];
// Today's registry shape: no provenance key at all.
const TODAY = () => REGISTRY().map(({ provenance, ...r }) => r);

const PDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wqprov-'));
const passage = (id, words, questions, pool = 'check') => {
  const [lang, kind, band] = id.split('.');
  fs.writeFileSync(path.join(PDIR, `${id}.json`), JSON.stringify({
    passage_id: id, lang, kind, band: Number(band), pool, status_at_authoring: 'reviewed', is_reference: false,
    text: words.join(' '), lines: [{ n: 1, from: 0, to: 4 }, { n: 2, from: 5, to: 9 }, { n: 3, from: 10, to: words.length - 1 }],
    tokens: words, questions, twin_of: null, bank_version: 'child-test-items-v4',
  }));
};
const Q = (id, needs, tap = true) => ({ id, prompt: `Who is ${id}?`, type: 'literal', needs_line: needs, tap_ok: tap, accept: ['the girl'], reject: ['the dog', 'the cat', 'the tree'], rubric: '' });
const W12 = ['Hina', 'saw', 'a', 'red', 'kite', 'It', 'flew', 'over', 'the', 'school', 'She', 'smiled', 'and', 'ran', 'home'];
passage('en.read.1.ref01', W12, [Q('en.read.1.ref01.q1', 1), Q('en.read.1.ref01.q2', 2)]);
passage('en.read.1.kite', ['A', 'kite', 'tale', ...W12.slice(3)], [Q('en.read.1.kite.q1', 1), Q('en.read.1.kite.q2', 2)]);
passage('en.read.1.pstory', ['A', 'boat', 'story', ...W12.slice(3)], [Q('en.read.1.pstory.q1', 1), Q('en.read.1.pstory.q2', 2)], 'practice');

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; Bank._loadPassagesFrom(PDIR); });
afterAll(() => { Bank._loadPassagesFrom(); });
const fresh = (registry = REGISTRY()) => {
  db = {
    app_settings: BASE_FLAGS.map((key) => ({ key, value: true })),
    student_lists: [{ id: L3, class_name: '3', is_active: true }],
    students: [{ id: K3, list_id: L3, student_name: 'Sana Testwala' }],
    web_quiz_challenge_runs: [],
    challenge_periods: periodsNow(),
    challenge_passages: registry,
    challenge_draws: [],
  };
  Object.assign(supabase, guardColumns(makeFake(db)));
  Ch.__reset();
  for (const m of ['web-quiz-hub-flags', 'web-quiz-identity-flags']) require(`../../../shared/services/quiz/${m}`)._resetCache();
};
beforeEach(() => { fresh(); jest.clearAllMocks(); });

const D = { device: 'FamilyPhoneDeviceRef_1', lang: 'en' };
const hub = () => T.sign({ k: 'h', ids: [K3], exp: Math.floor(Date.now() / 1000) + 3600 });
const runOf = (ct) => T.verify(ct, 'c').r;
const rowOf = (ct) => db.web_quiz_challenge_runs.find((r) => r.id === runOf(ct));
const setProv = (id, provenance) => { db.challenge_passages.find((r) => r.passage_id === id).provenance = provenance; };
const ON_ITS_WAY = { ex: 'read', on_its_way: true, draw: { outcome: 'on_its_way' }, copy: { en: 'A new story is on its way.', ur: 'ایک نئی کہانی آنے والی ہے۔' } };

describe('the counted-pool filter (pure)', () => {
  const rows = [reg('en.read.1.a', { provenance: 'published_calibrated' }), reg('en.read.1.b', { provenance: 'reviewer_levelled' }), reg('en.read.1.c'), reg('en.read.1.d', { provenance: undefined })];
  const ids = (E) => E.map((r) => r.passage_id);
  test('counted keeps only published_calibrated and reviewer_levelled; without it every passage stays eligible', () => {
    expect(ids(Draw.eligible({ rows, kind: 'read', lang: 'en', band: 1, counted: true }))).toEqual(['en.read.1.a', 'en.read.1.b']);
    expect(ids(Draw.eligible({ rows, kind: 'read', lang: 'en', band: 1 }))).toEqual(['en.read.1.a', 'en.read.1.b', 'en.read.1.c', 'en.read.1.d']);
  });
  test('drawPassage passes counted through; nothing sourced → on its way', () => {
    expect(Draw.drawPassage({ rows: rows.slice(2), kind: 'read', lang: 'en', band: 1, band_reason: 'entry_grade', seed: '0'.repeat(32), counted: true })).toMatchObject({ outcome: 'on_its_way', eligible_n: 0 });
    expect(Draw.drawPassage({ rows, kind: 'read', lang: 'en', band: 1, band_reason: 'entry_grade', seed: '0'.repeat(32), counted: true }).eligible.map((e) => e.id)).toEqual(['en.read.1.a', 'en.read.1.b']);
  });
});

describe('web_quiz_challenge_sourced_only on', () => {
  beforeEach(() => on(V2, ...CANON_ON, PERIOD, POOL, SOURCED));

  test('(a) a cell of generated passages only → on its way: no run row, no token, a draw row with eligible_n 0', async () => {
    const out = await Ch.exercise(hub(), 'read', D);
    expect(out).toEqual(ON_ITS_WAY);
    expect(db.web_quiz_challenge_runs).toHaveLength(0);
    expect(db.challenge_draws).toHaveLength(1);
    expect(db.challenge_draws[0]).toMatchObject({ run_id: null, outcome: 'on_its_way', eligible: [], eligible_n: 0, served_id: null, band: 1 });
  });

  test('(b) one reviewer_levelled + one generated → the reviewer_levelled one is drawn, eligible_n 1', async () => {
    setProv('en.read.1.kite', 'reviewer_levelled');
    for (let k = 0; k < 4; k += 1) {
      fresh(db.challenge_passages); on(V2, ...CANON_ON, PERIOD, POOL, SOURCED);
      const ex = await Ch.exercise(hub(), 'read', D);
      expect(rowOf(ex.ct)).toMatchObject({ passage_id: 'en.read.1.kite', mode: 'check', record: true, band: 1 });
      expect(db.challenge_draws).toHaveLength(1);
      expect(db.challenge_draws[0]).toMatchObject({ outcome: 'served', served_id: 'en.read.1.kite', eligible_n: 1, ref_eligible: false, eligible: [{ id: 'en.read.1.kite', w: 1 }] });
    }
  });

  test('(c) the practice replay serves a generated record passage again, as today', async () => {
    db.web_quiz_challenge_runs.push({ id: 'rec-1', student_id: K3, canonical_id: K3, exercise: 'read', lang: 'en', status: 'scored', mode: 'check', record: true,
      passage_id: 'en.read.1.ref01', period_id: '2026-11', band: 1, created_at: iso(Date.now() - 3600 * 1000) });
    const ex = await Ch.exercise(hub(), 'read', D);
    expect(ex).toMatchObject({ mode: 'practice', practice_round: true });
    expect(rowOf(ex.ct)).toMatchObject({ passage_id: 'en.read.1.ref01', mode: 'practice', record: false });
    expect(db.challenge_draws).toHaveLength(0);
  });

  test('(d) Story Time: a generated practice story is still served (practice, never a record)', async () => {
    on(STORY);
    // met once on the shelf before: the practice replay (sandbox) and the Story Time arm (room/pid) both serve it
    db.web_quiz_challenge_runs.push({ id: 'st-1', student_id: K3, canonical_id: K3, exercise: 'read', lang: 'en', status: 'scored', mode: 'practice', record: false,
      passage_id: 'en.read.1.pstory', band: 1, created_at: iso(Date.now() - 3600 * 1000) });
    const ex = await Ch.exercise(hub(), 'read', { ...D, mode: 'practice', room: 'story', passageId: 'en.read.1.pstory' });
    expect(ex.on_its_way).toBeUndefined();
    expect(rowOf(ex.ct)).toMatchObject({ passage_id: 'en.read.1.pstory', mode: 'practice', record: false });
    expect(ex.story.text).toBe(['A', 'boat', 'story', ...W12.slice(3)].join(' '));
  });

  test('(f) the registry without the provenance column (42703) → on its way, nothing written', async () => {
    COLUMNS.challenge_passages.delete('provenance');
    try {
      const out = await Ch.exercise(hub(), 'read', D);
      expect(out).toEqual(ON_ITS_WAY);
      expect(db.web_quiz_challenge_runs).toHaveLength(0);
      expect(db.challenge_draws).toHaveLength(0);
      expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.ch_start')).toEqual([]);
    } finally { COLUMNS.challenge_passages.add('provenance'); }
  });
});

describe('web_quiz_challenge_sourced_only off (or its parent off)', () => {
  // Everything one read serve returns and writes, with ids, tokens and clocks taken out; the seed fixed.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => {
    if (k === 'ct' || k === 'created_at' || k === 'started_at' || k === 'drawn_at') return undefined;
    return typeof v === 'string' && UUID.test(v) ? 'U' : v;
  }));
  const serveOnce = async (registry, flags, offKeys = []) => {
    fresh(registry); on(...flags);
    offKeys.forEach((key) => db.app_settings.push({ key, value: false }));
    const ex = await Ch.exercise(hub(), 'read', D);
    return norm({ ex, rows: db.web_quiz_challenge_runs, draws: db.challenge_draws, events: logEvent.mock.calls.filter(([n]) => /^web_quiz\.ch_/.test(n)) });
  };
  let spy;
  beforeEach(() => { spy = jest.spyOn(crypto, 'randomBytes').mockImplementation((n) => Buffer.alloc(n, 7)); });
  afterEach(() => spy.mockRestore());

  test('(e) golden: off, the serve deep-equals today\'s with generated passages eligible', async () => {
    const today = await serveOnce(TODAY(), [V2, ...CANON_ON, PERIOD, POOL]);
    jest.clearAllMocks();
    const off = await serveOnce(REGISTRY(), [V2, ...CANON_ON, PERIOD, POOL]);
    jest.clearAllMocks();
    const offFalse = await serveOnce(REGISTRY(), [V2, ...CANON_ON, PERIOD, POOL], [SOURCED]);
    expect(today.draws[0]).toMatchObject({ outcome: 'served', eligible_n: 2 });
    expect(['en.read.1.ref01', 'en.read.1.kite']).toContain(today.rows[0].passage_id);
    expect(off).toEqual(today);
    expect(offFalse).toEqual(today);
  });

  test('on with _pool off: the switch has no effect (today\'s serve)', async () => {
    const today = await serveOnce(TODAY(), [V2, ...CANON_ON, PERIOD]);
    jest.clearAllMocks();
    const child = await serveOnce(REGISTRY(), [V2, ...CANON_ON, PERIOD, SOURCED]);
    expect(child).toEqual(today);
  });

  test('off, the registry without the provenance column: today\'s serve still', async () => {
    const today = await serveOnce(TODAY(), [V2, ...CANON_ON, PERIOD, POOL]);
    jest.clearAllMocks();
    COLUMNS.challenge_passages.delete('provenance');
    try {
      expect(await serveOnce(REGISTRY(), [V2, ...CANON_ON, PERIOD, POOL])).toEqual(today);
    } finally { COLUMNS.challenge_passages.add('provenance'); }
  });

  test('the switch key is exported beside the pool switch', () => {
    expect(Ch.SOURCED_ONLY_FLAG_KEY).toBe(SOURCED);
  });
});

// ── the migration on a real, throwaway Postgres ─────────────────────────────────────────────────────────────

const MIG = path.join(__dirname, '..', '..', '..', 'database', 'migrations');
const binDir = (() => {
  const cands = [process.env.PG_BIN];
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* none */ }
  cands.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/bin');
  return cands.find((c) => c && ['postgres', 'initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(c, b)))) || null;
})();
const pgd = binDir ? describe : describe.skip;
if (!binDir) console.warn('challenge-provenance: no Postgres server binaries found (set PG_BIN) — the migration block is skipped');

pgd('web_quiz_challenge_passages_provenance.sql on a real Postgres', () => {
  const bin = (b) => path.join(binDir, b);
  let dir; let sock;
  const PORT = String(56000 + (process.pid % 900));
  const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
    '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
    ...(file ? ['-f', file] : ['-c', sql]),
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const fails = (sql) => { try { psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
  const apply = (f) => psql(null, { file: path.join(MIG, f) });
  const ins = (id, extra = '') => `insert into challenge_passages (passage_id, lang, kind, pool, band, bank_version${extra ? `, ${extra.split('=')[0]}` : ''}) values ('${id}', 'en', 'read', 'check', 1, 'v4'${extra ? `, '${extra.split('=')[1]}'` : ''})`;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqprv-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqprs-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create table public.students (id uuid primary key)');
    apply('web_quiz_challenge.sql');
    apply('web_quiz_challenge_registry.sql');
    psql(ins('en.read.1.old1', 'licence=textbook'));
    psql(ins('en.read.1.old2'));
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; existing rows become generated; the named CHECKs exist once each', () => {
    const cols = 'passage_id, lang, kind, pool, band, status, licence, source_ref, bank_version';
    const before = psql(`select json_agg(t order by passage_id) from (select ${cols} from challenge_passages) t`);
    apply('web_quiz_challenge_passages_provenance.sql');
    apply('web_quiz_challenge_passages_provenance.sql');
    expect(psql(`select json_agg(t order by passage_id) from (select ${cols} from challenge_passages) t`)).toBe(before);
    expect(psql("select string_agg(provenance, ',' order by passage_id) from challenge_passages")).toBe('generated,generated');
    expect(psql("select string_agg(conname, ',' order by conname) from pg_constraint where conrelid = 'challenge_passages'::regclass and conname in ('challenge_passages_provenance_check', 'challenge_passages_licence_check')"))
      .toBe('challenge_passages_licence_check,challenge_passages_provenance_check');
  });

  test('provenance: the three values pass, anything else and NULL are refused; licence admits published_instrument', () => {
    for (const p of ['published_calibrated', 'reviewer_levelled', 'generated']) expect(fails(ins(`en.read.1.${p}`, `provenance=${p}`))).toBeNull();
    expect(fails(ins('en.read.1.bad', 'provenance=invented'))).toMatch(/challenge_passages_provenance_check/);
    expect(fails("update challenge_passages set provenance = null where passage_id = 'en.read.1.old1'")).toMatch(/null value/);
    expect(fails(ins('en.read.1.pub', 'licence=published_instrument'))).toBeNull();
    expect(fails(ins('en.read.1.lic', 'licence=stolen'))).toMatch(/challenge_passages_licence_check/);
  });

  test('the rollback removes the column and narrows the licence CHECK back (after the widened rows go)', () => {
    psql("delete from challenge_passages where licence = 'published_instrument'");
    apply('web_quiz_challenge_passages_provenance_rollback.sql');
    expect(psql("select count(*) from information_schema.columns where table_name = 'challenge_passages' and column_name = 'provenance'")).toBe('0');
    expect(fails(ins('en.read.1.pub2', 'licence=published_instrument'))).toMatch(/challenge_passages_licence_check/);
    expect(fails(ins('en.read.1.tb', 'licence=textbook'))).toBeNull();
  });
});
