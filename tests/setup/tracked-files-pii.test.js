/**
 * Tracked files carry no phone number and no machine path (bd-5gyspy.3). Rule and list: tracked-files-pii-lib.js.
 * The rule is executed on in-memory strings first; digit strings are built from parts so this file holds none.
 */

const fs = require('fs');
const path = require('path');
const { report } = require('./ratchet-verdict-lib');
const { LEDGER, isTestPath, countPii, scanTracked, checkTracked } = require('./tracked-files-pii-lib');

const ALLOWLIST = require('./tracked-files-pii.allowlist.json');
const REPO_ROOT = path.resolve(__dirname, '../..');
const D = (...parts) => parts.join('');

describe('the rule (executed on in-memory strings)', () => {
  test('a phone and a home directory are hits; their masked forms are not', () => {
    expect(countPii(`"driver": "${D('92', '321', '5554321')}"`)).toBe(1);
    expect(countPii(`"worktree": "${D('/Us', 'ers/')}someone/Desktop/x"`)).toBe(1);
    expect(countPii('"driver": "92•••••4321", "worktree": ".claude/worktrees/NIETE-x/src"')).toBe(0);
    expect(countPii('"evidence_dir": "~/…/niete/14f2/"')).toBe(0);
    expect(countPii(`pulse requests: [${D('17921', '62000123')}]`)).toBe(0);
    expect(countPii(`local ${D('03', '21', '5554321')}, +${D('92', '321', '5554321')}`)).toBe(2);
  });

  test('test and fixture paths are out of scope; code, docs and the ledger are in', () => {
    for (const p of ['tests/setup/x.test.js', 'bot/tests/a.js', 'bot/x/fixtures/y.json', 'a/b.spec.ts', '.claude/qa/shared/test_ledger.py', '.claude/qa/shared/test_mock_api.js', 'portal/src/x/tests/h.tsx', 'bot/shared/database/__mocks__/m.js', 'scripts/qa/e2e-web.test.sh']) {
      expect(isTestPath(p)).toBe(true);
    }
    for (const p of [LEDGER, 'bot/shared/services/x.js', 'docs/a.md', '.github/workflows/ci.yml']) {
      expect(isTestPath(p)).toBe(false);
    }
  });

  test('the ledger can never be allowlisted, and a new file with a hit fails', () => {
    expect(checkTracked({}, { [LEDGER]: 1 }).failures.join('\n')).toMatch(/may not be on/);
    expect(checkTracked({ 'docs/new.md': 1 }, {}).failures.join('\n')).toMatch(/NEW: docs\/new\.md/);
  });
});

describe('the tree', () => {
  const hits = scanTracked(REPO_ROOT);

  test('the QA ledger holds no phone and no machine path', () => {
    expect(hits[LEDGER] || 0).toBe(0);
  });

  test('no tracked file holds more than tracked-files-pii.allowlist.json allows (shrink-only)', () => {
    const verdict = checkTracked(hits, ALLOWLIST, (k) => fs.existsSync(path.join(REPO_ROOT, k)));
    report(verdict);
    expect(verdict.failures).toEqual([]);
  });
});
