/**
 * No reader keys on the old `meta.counted` stamp.
 *
 * A Challenge row is counted by its own columns: `mode = 'check' AND record` (and `quality` beside it). The record
 * rule's `counted` stamp in `meta` stays on the row for the reads written before those columns existed, and the one
 * place that still reads it does so only for a row with no `mode`. Any other read of it (SQL `meta->>'counted'`, a
 * PostgREST `meta->>counted` filter, `meta.counted` / `meta['counted']` in code, a `.contains('meta', { counted })`)
 * would select by a key that new rows do not carry the same way.
 *
 * Scans every non-test .js/.sql/.py file under bot/ and dashboard/. Writers are not readers: `counted: true` in an
 * object literal and `meta.counted = x` are not matched. The readers when this gate landed are in
 * counted-readers.allowlist.json, per file with a line count; shrink-only, warn-on-less (ratchet-verdict-lib.js).
 */
const fs = require('fs');
const path = require('path');
const L = require('./challenge-data-gates-lib');
const { countVerdict, report } = require('./ratchet-verdict-lib');
const ALLOW = require('./counted-readers.allowlist.json');

const verdict = (hits, allow, exists) => countVerdict(hits, allow, {
  what: "read(s) of meta.counted: key on mode = 'check' AND record instead",
  list: 'counted-readers.allowlist.json',
  exists,
});

describe('the reader rule, on in-memory sources', () => {
  test('SQL, PostgREST, property and contains reads are readers', () => {
    const src = [
      "select count(*) from web_quiz_challenge_runs where (meta->>'counted')::boolean;",
      "q.eq('meta->>counted', 'true');",
      "const c = r.meta.counted;",
      "const c2 = r.meta?.counted;",
      "const c3 = (r.meta || {}).counted;",
      "const c4 = row.meta['counted'];",
      "q.contains('meta', { counted: true });",
    ].join('\n');
    expect(L.countedReaders(src).map((r) => r.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('writers and other uses of the word are not', () => {
    const src = [
      "meta: { ...stamp, counted: false },",
      "return { ...a, counted, grade_source: null };",
      "const keep = (({ attempt_no, counted, ...rest }) => rest)(prov);",
      "row.meta.counted = true;",
      "const counted = rows.filter((r) => r.mode === 'check' && r.record === true);",
      "// a counted read: mode and record",
    ].join('\n');
    expect(L.countedReaders(src)).toEqual([]);
  });

  test('test paths are not product code', () => {
    expect(L.isTestPath('bot/tests/quiz/x.test.js')).toBe(true);
    expect(L.isTestPath('dashboard/tests/x.js')).toBe(true);
    expect(L.isTestPath('bot/shared/services/quiz/web-quiz-challenge.js')).toBe(false);
  });
});

describe('the verdict, on a seeded tree and allowlist', () => {
  test('a new reader file or more reads fail; fewer, none or a missing file warn and pass', () => {
    const v = verdict({ 'new.js': 1, 'up.js': 3, 'down.js': 1 }, { 'up.js': 1, 'down.js': 2, 'clean.js': 1, 'gone.js': 1 }, (f) => f !== 'gone.js');
    expect(v.failures.map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['NEW: new.js', 'UP: up.js']);
    expect(v.warnings.map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['CLEAN: clean.js', 'DOWN: down.js', 'GONE: gone.js']);
  });
});

describe('this tree', () => {
  test('no new reader of meta.counted in bot/ or dashboard/ product code', () => {
    const hits = {};
    for (const f of L.productSources()) {
      const n = L.countedReaders(fs.readFileSync(path.join(L.REPO, f), 'utf8')).length;
      if (n) hits[f] = n;
    }
    expect(report(verdict(hits, ALLOW.files, (f) => fs.existsSync(path.join(L.REPO, f))))).toEqual([]);
  });
});
