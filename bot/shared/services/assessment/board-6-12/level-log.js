'use strict';
/**
 * bd-qyi45h.1 option (c). D12's level-mix check stays hard; this module makes each run of it readable from the logs
 * and makes a failed paper say which hard rules held it. Pure apart from the `d.logToFile` it is handed.
 *
 * logSplit: one '[assessment] board level split' line per check run of a G6-12 board paper: the attempt number,
 * per-level have/target/reach, the tolerance, the split status and pass. `meta` must hold no person ids.
 * hardDetail: "hard rules: D12 LEVEL_OVER x4; checks: blueprint-qa=4" for the error detail (not the teacher's text).
 */
const { levelShares } = require('../board-checks/_level-quota');

function logSplit(d, examJson, variant, meta) {
  const got = levelShares(examJson, variant && variant.cognitive_split);
  if (got) d.logToFile('[assessment] board level split', { ...meta, ...got });
  return got;
}

/** A logSplit bound to one paper's request, numbering its check runs from 1: `(examJson) => shares|null`. */
function splitLogger(d, variant, meta) {
  let attempt = 0;
  return (examJson) => logSplit(d, examJson, variant, { ...meta, attempt: (attempt += 1) });
}

function hardDetail(record) {
  if (!record || !(record.hard > 0)) return null;
  const rules = Object.entries(record.hard_rules || {}).map(([k, n]) => `${k} x${n}`);
  const checks = Object.entries(record.per_check || {}).filter(([, v]) => v && v.hard > 0).map(([k, v]) => `${k}=${v.hard}`);
  const parts = [];
  if (rules.length) parts.push(`hard rules: ${rules.join(', ')}`);
  if (checks.length) parts.push(`checks: ${checks.join(', ')}`);
  return parts.length ? parts.join('; ') : `hard issues: ${record.hard}`;
}

module.exports = { logSplit, splitLogger, hardDetail };
