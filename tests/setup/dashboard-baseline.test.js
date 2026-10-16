/**
 * The dashboard baseline (dashboard-baseline.json + dashboard-baseline-lib.js): a full dashboard Jest run's failures
 * read as "N new" mechanically, counting only failures outside the four known suites' named tests.
 */
const fs = require('fs');
const path = require('path');
const D = require('./dashboard-baseline-lib');

const ROOT = '/x/repo/dashboard/';
const suite = (rel, asserts, status) => ({
  name: `${ROOT}${rel}`,
  status: status || (asserts.some((a) => a.status === 'failed') ? 'failed' : 'passed'),
  assertionResults: asserts,
});
const t = (fullName, status) => ({ fullName, status });

const BASE = { suites: {
  'tests/a.test.js': { reason: 'live network', tests: ['A one', 'A two'] },
  'tests/q/empty.test.js': { reason: 'no test', tests: ['(suite failed to run)'] },
  'tests/enc.test.js': { reason: 'x', tests: ['rot13:Rapbqrq anzr'] },
} };

describe('newFailures, on a seeded jest --json result', () => {
  test('baseline failures only: "0 new"', () => {
    const r = { testResults: [
      suite('tests/a.test.js', [t('A one', 'failed'), t('A two', 'failed'), t('A three', 'passed')]),
      suite('tests/q/empty.test.js', [], 'failed'),
      suite('tests/enc.test.js', [t('Encoded name', 'failed')]),
      suite('tests/b.test.js', [t('B one', 'passed')]),
    ] };
    const v = D.newFailures(r, BASE);
    expect(v.new).toEqual([]);
    expect(D.summary(v)).toBe('2/6 passed; 4 failed: 4 baseline, 0 new');
  });

  test('a failure outside the baseline, in a known suite or another, is new', () => {
    const r = { testResults: [
      suite('tests/a.test.js', [t('A one', 'failed'), t('A three', 'failed')]),
      suite('tests/b.test.js', [t('B one', 'failed')]),
      suite('tests/c.test.js', [], 'failed'),
    ] };
    const v = D.newFailures(r, BASE);
    expect(v.new).toEqual(['tests/a.test.js › A three', 'tests/b.test.js › B one', 'tests/c.test.js › (suite failed to run)']);
    expect(D.summary(v)).toBe('0/4 passed; 4 failed: 1 baseline, 3 new');
  });

  test('a baseline test that now passes is FIXED, not a failure', () => {
    const v = D.newFailures({ testResults: [suite('tests/a.test.js', [t('A one', 'passed'), t('A two', 'failed')])] }, BASE);
    expect(v.new).toEqual([]);
    expect(v.fixed).toEqual(['tests/a.test.js › A one']);
  });
});

describe('the committed baseline', () => {
  test('four suites, nine named tests, each with a reason, each suite a file in dashboard/tests', () => {
    const suites = Object.entries(D.BASELINE.suites);
    expect(suites).toHaveLength(4);
    expect(suites.reduce((n, [, e]) => n + e.tests.filter((x) => x !== '(suite failed to run)').length, 0)).toBe(9);
    for (const [rel, e] of suites) {
      expect(e.reason).toEqual(expect.any(String));
      expect(fs.existsSync(path.join(__dirname, '../../dashboard', rel))).toBe(true);
    }
  });
});
