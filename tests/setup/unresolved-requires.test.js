/**
 * Unresolved-require audit (Wave 3 PR α / α.2).
 *
 * Every literal `require('./x')` in reachable code resolves to a real file,
 * OR is wrapped in a try/catch (intentional OSS-strip pattern) AND is listed
 * in the allowlist with a documented reason.
 *
 * A non-allowlisted, non-try-catch require to a missing file is a real bug
 * that would crash at runtime when the code path executes.
 */

const path = require('path');
const { getGraph, ROOT } = require('./_audit-helpers/require-graph');
const ALLOWLIST = require('./unresolved-requires.allowlist.json');

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
