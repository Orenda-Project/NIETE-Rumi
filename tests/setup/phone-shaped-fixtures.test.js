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
 * directory, or a higher count, fails; a lower count also fails until the
 * entry is lowered (or removed at 0), so a cleanup is locked in. A directory
 * not on the list (bot/tests/quiz/web-quiz among them) allows none.
 *
 * The rule itself (lib) is exercised on in-memory strings below, so the
 * pattern is executed, not just grepped.
 */

const path = require('path');

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

describe('the shrink-only allowlist check', () => {
  test('clean when hits match the list exactly', () => {
    expect(checkAgainstAllowlist({ 'a.test.js': 2 }, { 'a.test.js': 2 })).toEqual([]);
  });

  test('a hit in a file not on the list fails and names the file', () => {
    const p = checkAgainstAllowlist({ 'new.test.js': 1 }, {});
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^NEW: new\.test\.js/);
  });

  test('a listed file whose count went up fails', () => {
    expect(checkAgainstAllowlist({ 'a.test.js': 3 }, { 'a.test.js': 2 })[0]).toMatch(/^UP: a\.test\.js has 3/);
  });

  test('a listed file whose count went down fails until the entry is lowered', () => {
    expect(checkAgainstAllowlist({ 'a.test.js': 1 }, { 'a.test.js': 2 })[0]).toMatch(/^DOWN: .*Lower its entry .* to 1/);
  });

  test('a listed file that reached 0 fails until the entry is removed', () => {
    expect(checkAgainstAllowlist({}, { 'a.test.js': 2 })[0]).toMatch(/^CLEAN: a\.test\.js .*Remove its entry/);
  });
});

describe('the tree (bot/tests, dashboard/tests) against the allowlist', () => {
  test('no new phone-shaped fixtures; no allowlist entry above or below its directory', () => {
    const hits = byDirectory(scanTree(ROOTS, { relativeTo: REPO_ROOT }));
    expect(checkAgainstAllowlist(hits, ALLOWLIST)).toEqual([]);
  });

  test('byDirectory sums a directory\'s files; the web quiz suites have no entry (they allow none)', () => {
    expect(byDirectory({ 'a/b/x.test.js': 2, 'a/b/y.test.js': 1, 'a/c/z.test.js': 4 })).toEqual({ 'a/b': 3, 'a/c': 4 });
    expect(Object.keys(ALLOWLIST)).not.toContain('bot/tests/quiz/web-quiz');
  });
});
