/**
 * Phone-shaped fixtures ratchet.
 *
 * The repo is public: no test file may carry a phone-shaped digit string
 * (`+?92` followed by 9+ digits, or an 11-digit `03…` number). A synthetic
 * fixture uses the letters form `+92300FIXTURE<n>`; where the code under test
 * needs digits, the test builds them at runtime from parts (see
 * bot/tests/quiz/web-quiz/fixture-phone.js).
 *
 * Directories whose test files held such strings before this guard are listed,
 * with their total hit counts, in `phone-shaped-fixtures.allowlist.json` (keyed
 * by directory so the list names no test file). The list only shrinks: a new
 * directory, or a higher count, fails; a lower count, or a listed directory
 * not in the tree, prints a DOWN:/CLEAN:/GONE: warning and passes (the entry
 * is lowered on the branch that owns the list). A directory not on the list
 * (bot/tests/quiz/web-quiz among them) allows none.
 *
 * The rule itself (lib) is exercised on in-memory strings below, so the
 * pattern is executed, not just grepped.
 */

const fs = require('fs');
const path = require('path');
const { report } = require('./ratchet-verdict-lib');

const ALLOWLIST = require('./phone-shaped-fixtures.allowlist.json');
const { countPhoneShaped, findPhoneShaped, scanTree, checkAgainstAllowlist, byDirectory } = require('./phone-shaped-fixtures-lib');

const REPO_ROOT = path.resolve(__dirname, '../..');
const ROOTS = ['bot/tests', 'dashboard/tests'].map((d) => path.join(REPO_ROOT, d));

// Digit strings for the rule's own tests are built from parts, so this file holds no phone-shaped literal.
const D = (...parts) => parts.join('');

describe('the phone-shaped rule (executed on in-memory strings)', () => {
  test('an international number with +, without +, and a local 03 number are hits', () => {
    expect(countPhoneShaped(D('+92', '300', '1234567'))).toBe(1);
    expect(countPhoneShaped(D('92', '300', '1234567'))).toBe(1);
    expect(countPhoneShaped(D('03', '00', '1234567'))).toBe(1);
    expect(countPhoneShaped(`phone: '${D('92', '300', '1234567')}', to: '${D('03', '00', '7654321')}'`)).toBe(2);
  });

  test('the letters form, a 10-digit id, and a uuid are not hits', () => {
    expect(countPhoneShaped('+92300FIXTURE1')).toBe(0);
    expect(countPhoneShaped(D('92', '00000008'))).toBe(0);
    expect(countPhoneShaped('44444444-4444-4444-8444-0000000000c1')).toBe(0);
    expect(findPhoneShaped('id e0000000-0000-4000-8000-000000000001, phone +92300FIXTURE12')).toEqual([]);
  });

  test('a local number inside a longer digit run is not a separate 03 hit', () => {
    expect(countPhoneShaped(D('1', '03', '00', '1234567', '1'))).toBe(0);
  });
});

describe('the shrink-only allowlist check: fail above, warn below', () => {
  test('clean when hits match the list exactly', () => {
    expect(checkAgainstAllowlist({ 'a/b': 2 }, { 'a/b': 2 })).toEqual({ failures: [], warnings: [] });
  });

  test('a hit in a directory not on the list fails and names it', () => {
    const v = checkAgainstAllowlist({ 'new/dir': 1 }, {});
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toMatch(/^NEW: new\/dir has 1/);
  });

  test('a listed directory whose count went up fails', () => {
    expect(checkAgainstAllowlist({ 'a/b': 3 }, { 'a/b': 2 }).failures[0]).toMatch(/^UP: a\/b has 3/);
  });

  test('a listed directory whose count went down warns and passes', () => {
    const v = checkAgainstAllowlist({ 'a/b': 1 }, { 'a/b': 2 });
    expect(v.failures).toEqual([]);
    expect(v.warnings).toEqual(['DOWN: a/b has 1, phone-shaped-fixtures.allowlist.json says 2. Lower it to 1.']);
  });

  test('a listed directory at 0 warns CLEAN and passes', () => {
    const v = checkAgainstAllowlist({}, { 'a/b': 2 }, () => true);
    expect(v.failures).toEqual([]);
    expect(v.warnings[0]).toMatch(/^CLEAN: a\/b has none now/);
  });

  test('a listed directory absent from the tree warns GONE and passes', () => {
    const v = checkAgainstAllowlist({}, { 'not/here': 4 }, (d) => d !== 'not/here');
    expect(v.failures).toEqual([]);
    expect(v.warnings).toEqual(['GONE: not/here is not in this tree. Remove its entry from phone-shaped-fixtures.allowlist.json.']);
  });

  test('a seeded tree: below and absent pass, above and new fail', () => {
    const v = checkAgainstAllowlist({ below: 1, above: 5, fresh: 1 }, { below: 3, above: 2, absent: 7 }, (d) => d !== 'absent');
    expect(v.failures.map((l) => l.split(':')[0] + ':' + l.split(' ')[1])).toEqual(['UP:above', 'NEW:fresh']);
    expect(v.warnings.map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['GONE: absent', 'DOWN: below']);
  });
});

describe('the tree (bot/tests, dashboard/tests) against the allowlist', () => {
  test('no new phone-shaped fixtures; no directory above its entry (below or gone: a warning)', () => {
    const hits = byDirectory(scanTree(ROOTS, { relativeTo: REPO_ROOT }));
    const exists = (dir) => fs.existsSync(path.join(REPO_ROOT, dir));
    expect(report(checkAgainstAllowlist(hits, ALLOWLIST, exists))).toEqual([]);
  });

  test('byDirectory sums a directory\'s files; the web quiz suites have no entry (they allow none)', () => {
    expect(byDirectory({ 'a/b/x.test.js': 2, 'a/b/y.test.js': 1, 'a/c/z.test.js': 4 })).toEqual({ 'a/b': 3, 'a/c': 4 });
    expect(Object.keys(ALLOWLIST)).not.toContain('bot/tests/quiz/web-quiz');
  });
});
