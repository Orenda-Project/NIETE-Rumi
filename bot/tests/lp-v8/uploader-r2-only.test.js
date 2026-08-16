/**
 * FEAT-059 — staging the upload BEFORE migration 018 is applied.
 *
 * The objects can go to R2 today: the prefix is new, nothing reads from it, and
 * the endpoint only serves what niete_lp_assets says is current — which is
 * nothing, because the table does not exist yet. Applying 018 to production is a
 * gated operator action, so --r2-only uploads the bytes and PREPARES the rows as
 * SQL instead of writing them.
 *
 * The SQL has to be safe to apply late, twice, or out of order:
 *   - supersede-then-insert, because idx_lp_assets_one_current is a PARTIAL
 *     unique index on (lesson_id, asset_kind) WHERE is_current — a second
 *     current row for the same lesson is a constraint violation, not a dupe;
 *   - ON CONFLICT on the identity index, so re-applying is a no-op;
 *   - one transaction, so a half-applied file cannot leave two current rows.
 */

const U = require('../../scripts/upload-lp-v8-to-r2');

const ROWS = [{
  lesson_id: 'grade_1_english_ch1_seg1',
  asset_kind: 'lesson',
  content_hash: '418c32010a5f',
  r2_key: 'lp-cache/v8/grade_1_english_ch1_seg1/418c32010a5f.pdf',
  bytes: 1807727,
  source_bytes: 14771000,
  source_sha1: 'abc123',
  prompt_layer_sha: '4d09a4f0',
  rendered_at: '2026-08-16T16:50:00.000Z',
  version_stamp: 'v8-20260816T1650',
}];

describe('--r2-only prepares SQL instead of writing rows', () => {
  test('the flag exists and is off by default', () => {
    expect(U.parseArgs([]).r2Only).toBe(false);
    expect(U.parseArgs(['--r2-only']).r2Only).toBe(true);
  });

  test('--r2-only implies writing to R2 without implying --commit to the DB', () => {
    const a = U.parseArgs(['--r2-only']);
    expect(a.r2Only).toBe(true);
    expect(a.commit).toBe(false);
  });

  test('every row supersedes any OTHER current asset before inserting', () => {
    const sql = U.buildInsertSql(ROWS);
    const update = sql.match(/UPDATE niete_lp_assets[\s\S]*?;/)[0];
    expect(update).toContain("is_current = false");
    expect(update).toContain("lesson_id = 'grade_1_english_ch1_seg1'");
    expect(update).toContain("content_hash <> '418c32010a5f'");
    // the supersede must come before the insert, or the partial unique index bites
    expect(sql.indexOf('UPDATE niete_lp_assets')).toBeLessThan(sql.indexOf('INSERT INTO niete_lp_assets'));
  });

  test('re-applying the file is a no-op', () => {
    const sql = U.buildInsertSql(ROWS);
    expect(sql).toContain('ON CONFLICT (lesson_id, asset_kind, content_hash) DO NOTHING');
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
  });

  test('every provenance column the uploader would have written is in the SQL', () => {
    const sql = U.buildInsertSql(ROWS);
    for (const col of ['lesson_id', 'catalog_version', 'version_stamp', 'content_hash', 'r2_key',
      'bytes', 'source_bytes', 'source_sha1', 'prompt_layer_sha', 'rendered_at', 'asset_kind', 'is_current']) {
      expect(sql).toContain(col);
    }
    expect(sql).toContain("'lp-cache/v8/grade_1_english_ch1_seg1/418c32010a5f.pdf'");
  });

  test('a NULL stays NULL rather than becoming the string "null"', () => {
    const sql = U.buildInsertSql([{ ...ROWS[0], source_sha1: null, rendered_at: null, source_bytes: null }]);
    expect(sql).not.toMatch(/'null'/);
    expect(sql).toMatch(/NULL/);
  });

  test("a quote in a value cannot break out of the literal", () => {
    const sql = U.buildInsertSql([{ ...ROWS[0], version_stamp: "v8-'; DROP TABLE users; --" }]);
    expect(sql).toContain("''; DROP TABLE users; --");   // doubled, still a literal
    expect(sql).not.toMatch(/\)\s*;\s*DROP TABLE/i);
  });

  test('an empty set produces no statements at all, not an empty transaction', () => {
    expect(U.buildInsertSql([])).toBe('');
  });
});

describe('verifying an --r2-only upload, which has no DB rows to read', () => {
  const V = require('../../scripts/verify-lp-v8-r2');

  const REPORT = {
    mode: 'r2-only',
    items: [
      { lesson_id: 'a', action: 'first', r2_key: 'lp-cache/v8/a/h1.pdf', content_hash: 'h1', bytes: 10 },
      { lesson_id: 'b', action: 'failed', r2_key: 'lp-cache/v8/b/h2.pdf', content_hash: 'h2', bytes: 20 },
      { lesson_id: 'c', action: 'missing', r2_key: null, content_hash: null, bytes: null },
    ],
  };

  test('only the items that actually went up are verifiable', () => {
    const rows = V.rowsFromReport(REPORT);
    expect(rows.map((r) => r.lesson_id)).toEqual(['a']);
    expect(rows[0]).toMatchObject({ r2_key: 'lp-cache/v8/a/h1.pdf', content_hash: 'h1', bytes: 10 });
  });

  test('the sample spreads across the corpus rather than taking the first N', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ lesson_id: `l${String(i).padStart(3, '0')}` }));
    const picked = V.pickSample(rows, 4).map((r) => r.lesson_id);
    expect(picked).toEqual(['l000', 'l025', 'l050', 'l075']);
  });

  test('a fetched PDF is checked on all four counts', () => {
    const good = Buffer.from('%PDF-1.5 hello');
    const crypto = require('crypto');
    const hash = crypto.createHash('sha1').update(good).digest('hex').slice(0, 12);
    expect(V.checkFetched(good, { bytes: good.length, content_hash: hash }, 200).ok).toBe(true);

    expect(V.checkFetched(good, { bytes: good.length, content_hash: hash }, 400).problems).toContain('HTTP 400');
    expect(V.checkFetched(Buffer.from('<html>nope'), { bytes: 10, content_hash: hash }, 200).problems)
      .toContain('not a PDF (no %PDF magic)');
    expect(V.checkFetched(good, { bytes: 999, content_hash: hash }, 200).problems.join(' ')).toMatch(/length/);
    expect(V.checkFetched(good, { bytes: good.length, content_hash: 'deadbeefcafe' }, 200).problems.join(' '))
      .toMatch(/content_hash/);
  });
});
