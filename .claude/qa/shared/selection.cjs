/* selection.cjs — which scenarios a feature-runner child drives and reports (bd-r09cmx).
 *
 * Two maps, both "feature=ids;feature=ids":
 *   E2E_ONLY_MAP  run and report ONLY these ids (select_scenarios.py for a commit; a shard's cluster)
 *   E2E_SKIP_MAP  run and report everything EXCEPT these ids (the other shard of a sharded feature)
 *
 * The drivers gate their blocks with want(...ids): a block runs when ANY of its ids is wanted. With a
 * skip set a block is dropped only when ALL of its ids are skipped — so a cluster that is one block
 * (training's quiz generation, want('T25', …, 'T84')) lands whole in the --only child and is skipped
 * whole in the --skip child. Harness rows (COA-preflight, RUNNER) always report.
 */
'use strict';

/** The Set of ids this feature's entry names, or null when the map has no entry for it. */
function parseMap(raw, feature) {
  const s = String(raw || '').trim();
  if (!s) return null;
  for (const part of s.split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    if (part.slice(0, i).trim() === feature) {
      const ids = part.slice(i + 1).split(',').map((x) => x.trim()).filter(Boolean);
      return ids.length ? new Set(ids) : null;
    }
  }
  return null;
}

/** "T25-T27,T696" → ['T25','T26','T27','T696']; a range keeps its prefix and zero-padding. */
function expandIds(spec) {
  const out = [];
  for (const tok of String(spec || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z]+)(\d+)-(?:[A-Za-z]+)?(\d+)$/.exec(tok);
    if (!m) { out.push(tok); continue; }
    const [, prefix, a, b] = m; const width = a.length;
    for (let n = Number(a); n <= Number(b); n++) out.push(prefix + String(n).padStart(width, '0'));
  }
  return out;
}

function makeWant(only, skip) {
  return (...ids) => {
    const flat = ids.flat();
    if (skip && flat.length && flat.every((x) => skip.has(x))) return false;
    if (only && !flat.some((x) => only.has(x))) return false;
    return true;
  };
}

function recAllowed(id, only, skip, scenarioIdRx) {
  const s = String(id);
  if (scenarioIdRx && !scenarioIdRx.test(s)) return true;   // harness rows always report
  if (only && !only.has(s)) return false;
  if (skip && skip.has(s)) return false;
  return true;
}

module.exports = { parseMap, expandIds, makeWant, recAllowed };
