/**
 * Unresolved-require audit (Wave 3 PR α / α.2).
 *
 * Every literal `require('./x')` in reachable code resolves to a real file,
 * OR is wrapped in a try/catch (intentional OSS-strip pattern) AND is listed
 * in the allowlist with a documented reason.
 *
 * A non-allowlisted, non-try-catch require to a missing file is a real bug
 * that would crash at runtime when the code path executes.
 *
 * An entry whose reason says the module ships in a later merge (a later PR, a follow-up, lands later) must name
 * its provider in a `provider` field: the module that will satisfy the require, in product words (its path or what
 * it does), never a PR number or a branch. Without it nobody can tell when the entry may go.
 */

const path = require('path');
const { getGraph, ROOT } = require('./_audit-helpers/require-graph');
const ALLOWLIST = require('./unresolved-requires.allowlist.json');
const { laterMergeWithoutProvider } = require('./test-seam-gates-lib');

function key(from, spec) {
  return `${from}|${spec}`;
}

describe('Unresolved-require audit', () => {
  const graph = getGraph();
  const allowedSet = new Set(
    ALLOWLIST.map((a) => key(path.resolve(ROOT, a.from), a.spec))
  );

  it('no literal require() in reachable code points at a missing file', () => {
    const failures = graph.unresolvedRequired.map((u) => ({
      from: u.from.replace(ROOT + '/', ''),
      spec: u.spec,
    }));
    expect(failures).toEqual([]);
  });

  it('every try-catch-wrapped unresolved require is allowlisted', () => {
    const unwhitelisted = graph.unresolvedOptional
      .filter((u) => !allowedSet.has(key(u.from, u.spec)))
      .map((u) => ({ from: u.from.replace(ROOT + '/', ''), spec: u.spec }));
    expect(unwhitelisted).toEqual([]);
  });

  it('every allowlist entry is still actually unresolved (else clean it up)', () => {
    const actualUnresolved = new Set(
      [...graph.unresolvedOptional, ...graph.unresolvedRequired].map((u) =>
        key(u.from, u.spec)
      )
    );
    const stale = ALLOWLIST.filter(
      (a) => !actualUnresolved.has(key(path.resolve(ROOT, a.from), a.spec))
    ).map((a) => `${a.from} → ${a.spec}`);
    expect(stale).toEqual([]);
  });

  it('every allowlist entry has a non-trivial reason (>= 10 chars)', () => {
    const thin = ALLOWLIST.filter((a) => !a.reason || a.reason.trim().length < 10);
    expect(thin).toEqual([]);
  });
});

describe('a later-merge allowlist entry names its provider', () => {
  const entry = (reason, provider) => ({ from: 'bot/shared/services/quiz/a.js', spec: './b', reason, ...(provider === undefined ? {} : { provider }) });

  test('a later-merge reason without a provider, or with a PR number or branch for one, is a hit; other entries are not', () => {
    expect(laterMergeWithoutProvider([
      entry('the window module ships in a later merge; the require is try/catch'),
      entry('lands later with the class week work'),
      entry('a follow-up PR adds it', 'see #2400'),
      entry('ships in a later merge', 'branch feature-week'),
      entry('ships in a later merge', 'b'),
      entry('ships in a later merge', 'the class-week window module (bot/shared/services/quiz/b.js)'),
      entry('OSS-stripped path; the require is inside a try/catch'),
    ]).map((x) => x.reason)).toEqual([
      'the window module ships in a later merge; the require is try/catch',
      'lands later with the class week work',
      'a follow-up PR adds it',
      'ships in a later merge',
      'ships in a later merge',
    ]);
  });

  test('every later-merge entry in the allowlist names its provider', () => {
    expect(laterMergeWithoutProvider(ALLOWLIST).map((a) => `${a.from} → ${a.spec}`)).toEqual([]);
  });
});
