'use strict';
/**
 * The registry's licence, attribution, calibration and review columns (ITEMS §1.1 amendment A, B2), and the Set A rows
 * labelled by data as a published, calibrated partner instrument:
 *   (i)   web_quiz_challenge_passages_licence_calib.sql on a real throwaway Postgres (skipped without the server
 *         binaries): applies twice cleanly, five columns, adapted defaults false, the licence CHECK widened by
 *         partner_instrument and public_domain, the provenance CHECK untouched; the rollback narrows and drops
 *   (ii)  pure, the real draw: a Set A row (published_calibrated, partner_instrument) is drawable in the counted pool
 *   (iii) pure: a band-2 cell of Set A + two generated check rows → the counted draw sees Set A only (eligible_n 1)
 *   (iv)  the seed script's four Set A rows carry the labels and the per-grade calib numbers; the committed SQL equals
 *         the script output
 * Plus the registry fake's column set and the passage gate's licence list. Faked boundary: Supabase config only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { COLUMNS } = require('./registry-columns');
const Draw = require('../../../shared/services/quiz/web-quiz-challenge-draw');
const Bank = require('../../../shared/services/child-test/item-bank');
const Gate = require('../../../shared/services/child-test/passage-gate');

const MIG = path.join(__dirname, '..', '..', '..', 'database', 'migrations');
const FWD = 'web_quiz_challenge_passages_licence_calib.sql';
const BACK = 'web_quiz_challenge_passages_licence_calib_rollback.sql';
const SEED_FILE = path.join(MIG, 'web_quiz_challenge_registry_seed.sql');
const NEW_COLS = ['attribution', 'adapted', 'adaptation_note', 'calib', 'review'];
const seed = () => require('../../../scripts/challenge-registry-seed');

const REL = '2026-10-01T00:00:00Z';
const reg = (id, extra = {}) => {
  const [lang, kind, band] = id.split('.');
  return { passage_id: id, lang, kind, band: Number(band), pool: 'check', status: 'calibrated', is_reference: false, released_at: REL, withdrawn_at: null, twin_of: null, provenance: 'generated', licence: 'generated', ...extra };
};
const SET_A = (extra = {}) => reg('en.read.2.setA', { is_reference: true, provenance: 'published_calibrated', licence: 'partner_instrument', source_ref: 'rwp2026:orf_reading_eng', ...extra });

describe('the migration files and the readers of the new columns', () => {
  test('the forward migration requires the provenance migration; the rollback exists', () => {
    const sql = fs.readFileSync(path.join(MIG, FWD), 'utf8');
    expect(sql.split('\n')[0]).toBe('-- requires: web_quiz_challenge_passages_provenance.sql');
    for (const c of NEW_COLS) expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`));
    expect(fs.existsSync(path.join(MIG, BACK))).toBe(true);
  });

  test('the registry fake knows the five columns (a select naming them is not 42703)', () => {
    for (const c of NEW_COLS) expect(COLUMNS.challenge_passages.has(c)).toBe(true);
  });

  test('the passage gate accepts partner_instrument and public_domain, still refuses an unknown licence', () => {
    const lic = (licence) => Gate.checkPassage({ passage_id: 'en.read.1.x', lang: 'en', kind: 'read', pool: 'check', band: 1, licence }).problems.filter((p) => p.startsWith('field: licence'));
    expect(lic('partner_instrument')).toEqual([]);
    expect(lic('public_domain')).toEqual([]);
    expect(lic('stolen')).toEqual(['field: licence stolen']);
  });
});

describe('the counted draw over Set A (pure, the real draw)', () => {
  const ids = (E) => E.map((r) => r.passage_id);

  test('(ii) Set A drawable: a published_calibrated partner_instrument row stays eligible in the counted pool', () => {
    expect(ids(Draw.eligible({ rows: [SET_A()], kind: 'read', lang: 'en', band: 2, counted: true }))).toEqual(['en.read.2.setA']);
  });

  test('(iii) band-2 mixed cell → only Set A: two generated check rows drop out, eligible_n 1', () => {
    const rows = [SET_A(), reg('en.read.2.gen1'), reg('en.read.2.gen2', { status: 'provisional' })];
    expect(ids(Draw.eligible({ rows, kind: 'read', lang: 'en', band: 2, counted: true }))).toEqual(['en.read.2.setA']);
    const d = Draw.drawPassage({ rows, kind: 'read', lang: 'en', band: 2, band_reason: 'entry_grade', seed: 'f'.repeat(32), counted: true });
    expect(d).toMatchObject({ outcome: 'served', served_id: 'en.read.2.setA', eligible_n: 1, ref_eligible: true });
    // without the counted filter all three stay eligible (practice draws are unchanged)
    expect(ids(Draw.eligible({ rows, kind: 'read', lang: 'en', band: 2 }))).toEqual(['en.read.2.setA', 'en.read.2.gen1', 'en.read.2.gen2']);
  });
});

describe('(iv) the seed: Set A labelled by data', () => {
  const STAT_KEYS = ['grade', 'n', 'mean_wcpm', 'sd', 'median', 'zero_share', 'firstline_stop_share', 'comp_mean', 'comp_n'];
  const WANT = {
    'en.read.2.setA': { source_ref: 'rwp2026:orf_reading_eng', label: 'RWP/ICT May 2026 EGRA ORF' },
    'ur.read.2.setA': { source_ref: 'rwp2026:orf_reading_urd', label: 'RWP/ICT May 2026 EGRA ORF' },
    'en.listen.2.setA': { source_ref: 'rwp2026:listcomp_passage_eng', label: 'RWP/ICT May 2026 EGRA listening comprehension' },
    'ur.listen.2.setA': { source_ref: 'rwp2026:listcomp_passage_urd', label: 'RWP/ICT May 2026 EGRA listening comprehension' },
  };

  test('the four Set A rows carry exactly the labels', () => {
    const rows = seed().passageRows();
    expect(rows.map((r) => r.passage_id)).toEqual(Object.keys(WANT));
    for (const r of rows) {
      expect(r).toMatchObject({ provenance: 'published_calibrated', licence: 'partner_instrument', source_ref: WANT[r.passage_id].source_ref, adapted: false });
      expect(Bank.bankV3().sources[r.source_ref.split(':')[0]]).toBeTruthy();
      const { stats, ...rest } = r.calib;
      expect(rest).toEqual({ instrument: 'rwp2026', text_verbatim: true, grades_targeted: [2, 3], level_label: WANT[r.passage_id].label, band_rule: 'A', retrieved_at: '2026-10-16' });
      expect(stats.map((s) => s.grade)).toEqual([1, 2, 3, 4, 5]);
      for (const s of stats) {
        expect(Object.keys(s)).toEqual(STAT_KEYS);
        for (const k of STAT_KEYS) expect(Number.isFinite(s[k])).toBe(true);   // numbers only, never text
      }
    }
  });

  test('the numbers are the export\'s per grade and language; listen rows carry the listening score as comp', () => {
    const by = Object.fromEntries(seed().passageRows().map((r) => [r.passage_id, r.calib.stats]));
    expect(by['en.read.2.setA'][1]).toEqual({ grade: 2, n: 459, mean_wcpm: 9.8, sd: 20, median: 0.3, zero_share: 0.492, firstline_stop_share: 0.705, comp_mean: 1.03, comp_n: 117 });
    expect(by['ur.read.2.setA'][2]).toEqual({ grade: 3, n: 443, mean_wcpm: 38.7, sd: 38.6, median: 29, zero_share: 0.195, firstline_stop_share: 0.265, comp_mean: 2.99, comp_n: 314 });
    expect(by['en.listen.2.setA'][1]).toMatchObject({ grade: 2, comp_mean: 0.61, comp_n: 459 });
    expect(by['ur.listen.2.setA'][4]).toMatchObject({ grade: 5, mean_wcpm: 85.7, comp_mean: 4.08, comp_n: 431 });
  });

  test('the script refuses to label Set A when the bank has no rwp2026 source', () => {
    const real = Bank.bankV3();
    const spy = jest.spyOn(Bank, 'bankV3').mockImplementation(() => ({ ...real, sources: { ...real.sources, rwp2026: undefined } }));
    try { expect(() => seed().passageRows()).toThrow(/rwp2026/); } finally { spy.mockRestore(); }
  });

  test('the committed seed SQL equals the script output', () => {
    expect(fs.readFileSync(SEED_FILE, 'utf8')).toBe(seed().buildSeedSql());
  });
});

// ── (i) the migration on a real, throwaway Postgres ─────────────────────────────────────────────────────────

const binDir = (() => {
  const cands = [process.env.PG_BIN];
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* none */ }
  cands.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/bin');
  return cands.find((c) => c && ['postgres', 'initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(c, b)))) || null;
})();
const pgd = binDir ? describe : describe.skip;
if (!binDir) console.warn('challenge-passage-licence: no Postgres server binaries found (set PG_BIN) — the migration block is skipped');

pgd('(i) web_quiz_challenge_passages_licence_calib.sql on a real Postgres', () => {
  const bin = (b) => path.join(binDir, b);
  let dir; let sock;
  const PORT = String(57000 + (process.pid % 900));
  const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
    '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
    ...(file ? ['-f', file] : ['-c', sql]),
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const fails = (sql) => { try { psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
  const apply = (f) => psql(null, { file: path.join(MIG, f) });
  const ins = (id, licence) => `insert into challenge_passages (passage_id, lang, kind, pool, band, bank_version, licence) values ('${id}', 'en', 'read', 'check', 1, 'v4', '${licence}')`;
  const colsOf = () => psql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name = 'challenge_passages' and column_name in (${NEW_COLS.map((c) => `'${c}'`).join(', ')})`);
  const conDef = (name) => psql(`select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'challenge_passages'::regclass and conname = '${name}'`);
  let provDef;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqlic-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqlis-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create table public.students (id uuid primary key)');
    apply('web_quiz_challenge.sql');
    apply('web_quiz_challenge_registry.sql');
    apply('web_quiz_challenge_passages_provenance.sql');
    psql(ins('en.read.1.old1', 'textbook'));
    psql(ins('en.read.1.old2', 'published_instrument'));
    provDef = conDef('challenge_passages_provenance_check');
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly; existing rows unchanged, adapted false; five columns; the provenance CHECK untouched', () => {
    const cols = 'passage_id, lang, kind, pool, band, status, licence, source_ref, provenance, bank_version';
    const before = psql(`select json_agg(t order by passage_id) from (select ${cols} from challenge_passages) t`);
    apply(FWD);
    apply(FWD);
    expect(psql(`select json_agg(t order by passage_id) from (select ${cols} from challenge_passages) t`)).toBe(before);
    expect(colsOf()).toBe([...NEW_COLS].sort().join(','));
    expect(psql("select string_agg(adapted::text || ':' || coalesce(calib::text, 'null') || ':' || coalesce(review::text, 'null'), ',' order by passage_id) from challenge_passages")).toBe('false:null:null,false:null:null');
    expect(psql("select data_type || ':' || is_nullable from information_schema.columns where table_name = 'challenge_passages' and column_name = 'adapted'")).toBe('boolean:NO');
    expect(psql("select string_agg(data_type, ',' order by column_name) from information_schema.columns where table_name = 'challenge_passages' and column_name in ('calib', 'review')")).toBe('jsonb,jsonb');
    expect(conDef('challenge_passages_provenance_check')).toBe(provDef);
    expect(psql("select count(*) from pg_constraint where conrelid = 'challenge_passages'::regclass and conname = 'challenge_passages_licence_check'")).toBe('1');
  });

  test('licence admits partner_instrument and public_domain, keeps the old values, refuses stolen; adapted refuses NULL', () => {
    expect(fails(ins('en.read.1.pi', 'partner_instrument'))).toBeNull();
    expect(fails(ins('en.read.1.pd', 'public_domain'))).toBeNull();
    for (const l of ['textbook', 'cc_by', 'cc_by_sa', 'generated', 'published_instrument']) expect(fails(ins(`en.read.1.k${l.replace(/_/g, '')}`, l))).toBeNull();
    expect(fails(ins('en.read.1.bad', 'stolen'))).toMatch(/challenge_passages_licence_check/);
    expect(fails("update challenge_passages set adapted = null where passage_id = 'en.read.1.old1'")).toMatch(/null value/);
    expect(fails("update challenge_passages set calib = '{\"instrument\":\"rwp2026\"}'::jsonb, review = '{}'::jsonb, attribution = 'x', adaptation_note = 'y' where passage_id = 'en.read.1.pi'")).toBeNull();
  });

  test('the registry seed applies on top (the Set A rows land labelled), twice', () => {
    apply('web_quiz_challenge_registry_seed.sql');
    apply('web_quiz_challenge_registry_seed.sql');
    expect(psql("select string_agg(passage_id || ':' || provenance || ':' || licence || ':' || source_ref || ':' || adapted::text || ':' || jsonb_array_length(calib->'stats'), ',' order by passage_id) from challenge_passages where passage_id like '%.setA'"))
      .toBe([
        'en.listen.2.setA:published_calibrated:partner_instrument:rwp2026:listcomp_passage_eng:false:5',
        'en.read.2.setA:published_calibrated:partner_instrument:rwp2026:orf_reading_eng:false:5',
        'ur.listen.2.setA:published_calibrated:partner_instrument:rwp2026:listcomp_passage_urd:false:5',
        'ur.read.2.setA:published_calibrated:partner_instrument:rwp2026:orf_reading_urd:false:5',
      ].join(','));
  });

  test('the rollback narrows the licence CHECK back and drops the five columns (after the widened rows go)', () => {
    psql("delete from challenge_passages where licence in ('partner_instrument', 'public_domain')");
    apply(BACK);
    apply(BACK);
    expect(colsOf()).toBe('');
    expect(fails(ins('en.read.1.pi2', 'partner_instrument'))).toMatch(/challenge_passages_licence_check/);
    expect(fails(ins('en.read.1.pd2', 'public_domain'))).toMatch(/challenge_passages_licence_check/);
    expect(fails(ins('en.read.1.pub2', 'published_instrument'))).toBeNull();
    expect(conDef('challenge_passages_provenance_check')).toBe(provDef);
  });
});
