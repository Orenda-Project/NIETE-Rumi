/**
 * A content file's `changes` trace is whole and points at a text that is gone.
 *
 * A passage or item file under bot/shared/data that was edited after review carries
 * `changes: [{ at, field, what, why, text_hash_before }]`. The rule (the exact rule is changesTraceProblems in
 * test-seam-gates-lib.js), for every object in such a file that holds a `changes` array:
 *   - every entry has the five fields, each a non-empty string;
 *   - `at` is an ISO time (2026-10-16T10:52:26Z, with or without milliseconds, Z or ±hh:mm);
 *   - `text_hash_before` has the format of the files' own text_hash (32 lowercase hex: sha256, first 32);
 *   - when the object records a `text_hash` (the passage files do, held to the recomputed hash by
 *     bot/tests/quiz/web-quiz/challenge-passage-gate.test.js), `text_hash_before` differs from it;
 *   - a file that records no `text_hash` anywhere (the three item banks, the four Set A pointer files) carries no
 *     trace at all: the pre-serve carve-out is for the authored passage files only, so a fix there is a new id or a
 *     new bank_version (ITEMS item 18, m-content-7 20261016T120706).
 * No file carries a trace when this gate lands; the tree test holds the first one that does.
 */
const fs = require('fs');
const path = require('path');
const { REPO, rel, walk, changesTraceProblems } = require('./test-seam-gates-lib');

describe('the rule, on in-memory files', () => {
  const H1 = 'a'.repeat(32);
  const H2 = 'b'.repeat(32);
  const entry = (over = {}) => ({ at: '2026-10-16T10:52:26Z', field: 'text', what: 'one word', why: 'review', text_hash_before: H1, ...over });

  test('a whole trace whose hash before is not the current one: no problem; no trace: no problem', () => {
    expect(changesTraceProblems({ text_hash: H2, changes: [entry(), entry({ at: '2026-10-16T10:52:26.120+05:00' })] })).toEqual([]);
    expect(changesTraceProblems({ text_hash: H2 })).toEqual([]);
    expect(changesTraceProblems({ items: [{ id: 'i1', text_hash: H2, changes: [entry()] }] })).toEqual([]);
  });

  test('a trace in a file that records no text_hash at all (an item bank, a Set A pointer file) fails: a fix there is a new id', () => {
    const NO_HASH = 'a changes trace in a file with no text_hash (an item bank or a Set A pointer file): a fix there is a new id or a new bank_version, never a same-id edit (ITEMS item 18)';
    expect(changesTraceProblems({ items: [{ id: 'i1', changes: [entry()] }] })).toEqual([NO_HASH]);
    expect(changesTraceProblems({ id: 'en.read.2.setA', v3_ref: 'x', changes: [entry(), entry()] })).toEqual([NO_HASH]);
    expect(changesTraceProblems({ id: 'en.read.2.setA', v3_ref: 'x' })).toEqual([]);
  });

  test('a missing field, a time that is not ISO, a hash in another format, a hash before equal to the current one', () => {
    const { why, ...noWhy } = entry();
    expect(changesTraceProblems({ text_hash: H2, changes: [noWhy] })).toEqual(['changes[0]: why is missing or empty']);
    expect(changesTraceProblems({ text_hash: H2, changes: [entry({ at: '16 Oct 2026' })] })).toEqual(['changes[0]: at is not an ISO time']);
    expect(changesTraceProblems({ text_hash: H2, changes: [entry({ text_hash_before: 'A'.repeat(64) })] })).toEqual(['changes[0]: text_hash_before is not 32 lowercase hex']);
    expect(changesTraceProblems({ text_hash: H1, changes: [entry()] })).toEqual(['changes[0]: text_hash_before is the current text_hash']);
    expect(changesTraceProblems({ items: [{ text_hash: H2, changes: 'none' }] })).toEqual(['items[0].changes: not an array']);
  });
});

describe('the tree', () => {
  test('every changes trace under bot/shared/data is whole', () => {
    const files = walk(path.join(REPO, 'bot/shared/data'), (n) => n.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((f) => changesTraceProblems(JSON.parse(fs.readFileSync(f, 'utf8'))).map((p) => `${rel(f)}: ${p}`));
    expect(problems).toEqual([]);
  });
});
