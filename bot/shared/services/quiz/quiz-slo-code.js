'use strict';
/**
 * The curriculum SLO code for a quiz question (bd-v0toag.9), shown in place of the digest's
 * S1/S2 label. Pure: no I/O.
 *
 * The only source is the lesson plan's slide script `sloCode` (a comma-joined list on v9 plans,
 * one code on lp612). Exactly one distinct code → every digest SLO carries it. None, several
 * (which S-id is which code is design pending), or a transcript quiz → no codes, and the caller
 * logs the status and keeps the old label. A code is never invented.
 */

function splitCodes(sloCode) {
  if (sloCode === undefined || sloCode === null) return [];
  return [...new Set(String(sloCode).split(',').map((s) => s.trim()).filter(Boolean))];
}

function codesFor({ sloCode, digest } = {}) {
  const ids = ((digest && digest.slos) || []).map((s) => s && s.id).filter(Boolean);
  const list = splitCodes(sloCode);
  if (!ids.length || !list.length) return { status: 'missing', codes: {} };
  if (list.length > 1) return { status: 'several_codes', codes: {} };
  const codes = {};
  ids.forEach((id) => { codes[id] = list[0]; });
  return { status: 'one_code', codes };
}

// `tq:<quizId>:<sloId>:<n>` → sloId (the external id format is fixed; readers depend on it).
function sloIdOf(externalId) {
  const parts = String(externalId || '').split(':');
  return parts[0] === 'tq' && parts.length >= 4 && parts[2] ? parts[2] : null;
}

function codeOf(meta, externalId) {
  const codes = meta && meta.slo_codes;
  const id = sloIdOf(externalId);
  return (codes && id && typeof codes[id] === 'string' && codes[id]) || null;
}

module.exports = { codesFor, sloIdOf, codeOf, splitCodes };
