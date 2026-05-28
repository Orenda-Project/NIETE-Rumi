/**
 * Circular-dependency audit (Wave 3 PR α / α.3).
 *
 * Tarjan's SCC on the static require graph. Any SCC of size > 1 is a cycle.
 * CommonJS tolerates cycles but the second import returns `{}` until the first
 * finishes evaluating — producing surprising `undefined` exports at runtime,
 * usually only on cold start.
 *
 * Allowlisted cycles are still detected; the guard just doesn't fail on them.
 * A NEW cycle (one not in the allowlist) fails the build, naming the files.
 */

const path = require('path');
const { getGraph, ROOT } = require('./_audit-helpers/require-graph');
const ALLOWLIST = require('./circular-deps.allowlist.json');

function cycleKey(scc) {
  return scc.slice().sort().join('|');
}

describe('Circular-dependency audit', () => {
  const graph = getGraph();

  it('no circular requires (or every cycle is allowlisted with a reason)', () => {
    const cycles = graph.findCycles();
    const allowedKeys = new Set(
      ALLOWLIST.map((a) => a.cycle.map((f) => path.resolve(ROOT, f)).slice().sort().join('|'))
    );
    const newCycles = cycles
      .filter((scc) => !allowedKeys.has(cycleKey(scc)))
      .map((scc) => scc.map((n) => n.replace(ROOT + '/', '')));
    expect(newCycles).toEqual([]);
  });

  it('every allowlist entry is still actually a live cycle', () => {
    const cycles = graph.findCycles();
    const liveCycleKeys = new Set(cycles.map(cycleKey));
    const stale = ALLOWLIST.filter((a) => {
      const k = a.cycle.map((f) => path.resolve(ROOT, f)).slice().sort().join('|');
      return !liveCycleKeys.has(k);
    }).map((a) => a.cycle.join(' ↔ '));
    expect(stale).toEqual([]);
  });

  it('every allowlist entry has a non-trivial reason (>= 10 chars)', () => {
    const thin = ALLOWLIST.filter((a) => !a.reason || a.reason.trim().length < 10);
    expect(thin).toEqual([]);
  });
});
