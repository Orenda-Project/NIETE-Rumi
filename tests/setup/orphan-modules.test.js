/**
 * Orphan-module audit (Wave 3 PR α / α.1).
 *
 * Asserts every .js file under the audited dirs (services / handlers / storage
 * / utils / config) is reachable via static `require()` from at least one
 * entry point (web + workers + scripts + tests), OR is explicitly allowlisted
 * with a documented reason.
 *
 * An orphan that wasn't allowlisted = dead code a cloner sees but can't trace
 * back to anywhere live. Either delete it or document why it stays.
 *
 * The allowlist lives at `tests/setup/orphan-modules.allowlist.json`.
 */

const fs = require('fs');
const path = require('path');
const { getGraph, auditedFiles, relPath, ROOT } = require('./_audit-helpers/require-graph');

const ALLOWLIST = require('./orphan-modules.allowlist.json');

describe('Orphan-module audit', () => {
  const graph = getGraph();
  const reachable = graph.reachable;
  const allowedSet = new Set(ALLOWLIST.map((a) => path.resolve(ROOT, a.file)));

  it('every audited .js file is reachable from an entry point (or allowlisted)', () => {
    const orphans = auditedFiles()
      .filter((f) => !reachable.has(f) && !allowedSet.has(f))
      .map(relPath);
    expect(orphans).toEqual([]);
  });

  it('every allowlist entry still exists on disk', () => {
    const missing = ALLOWLIST.filter((a) => !fs.existsSync(path.resolve(ROOT, a.file)));
    expect(missing).toEqual([]);
  });

  it('every allowlist entry carries a non-trivial reason (>= 10 chars)', () => {
    const thin = ALLOWLIST.filter((a) => !a.reason || a.reason.trim().length < 10);
    expect(thin).toEqual([]);
  });

  it('every allowlisted file is genuinely orphaned right now (else clean up the allowlist)', () => {
    const stale = ALLOWLIST
      .filter((a) => reachable.has(path.resolve(ROOT, a.file)))
      .map((a) => a.file);
    expect(stale).toEqual([]);
  });
});
