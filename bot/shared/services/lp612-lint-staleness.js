/**
 * IS THIS CACHED LESSON'S LINT VERDICT STILL THE CURRENT ONE? — bd-2cbwr.
 *
 * The lint gate — RELIGIOUS_MARKS above all, the mechanical half of brief §4c — runs ONLY inside
 * fresh authoring. The serving path answers a cache hit straight out of `r2_key` without going
 * near a linter, so `lint_clean` / `lint_fails` on the row are whatever the gate said ON THE DAY
 * THAT DOCUMENT WAS AUTHORED.
 *
 * That was survivable while the gate stood still. It changed twice in three days — bd-qzitp
 * (2026-09-14) and bd-kpqu6 (2026-09-16) — and neither shipped with a backfill, because there was
 * no way to NAME the population needing one. Every `ready` row kept serving under a superseded
 * ruling and nothing in the schema recorded which ruling that was. An undated verdict cannot be
 * audited, re-checked, or even counted.
 *
 * So the row carries `lint_version`, and this module is the one place that reads it.
 *
 * WHY A STAMP RATHER THAN A RE-LINT ON THE HOT PATH. The verdict is already on the row; re-running
 * the gate would mean fetching the stored `.lp.json` from R2 on a path a teacher is waiting on, to
 * recompute something we wrote down at authoring time. The stamp answers the real question — is
 * this verdict current? — for the cost of a column.
 *
 * WHAT THIS DOES NOT DO. It does not withhold anything. Those documents are serving today; holding
 * one on a version mismatch would take a lesson off a teacher over bookkeeping. And brief §4c/G5c
 * is explicit that an automated check is not what CLEARS religious content — the native-speaker
 * review is the hard hold. This module's job is to make the population findable and loud, never to
 * arbitrate it.
 */

/**
 * THE GATE RULESET, AS WE RUN IT.
 *
 * Bump this whenever a change could move a verdict — a new gate, a widened or narrowed matcher, a
 * changed field scope. It is a code fact, not an operator knob, so it is deliberately NOT
 * env-overridable: a stamp an operator can set is a stamp that can lie about which code ran.
 *
 * Dated rather than numbered so a row's value is legible in a query without a lookup table.
 *
 * History:
 *   2026-09-16 — bd-kpqu6: RELIGIOUS_MARKS gained word boundaries on PROPHET_RE, Urdu-only
 *                scoping on the transliteration check, a detection/enforcement split that stops
 *                internal fields refusing a lesson, and the companion-honorific fixes (bd-j335i).
 *                Verdicts from before this date can differ, and on the 6-12 corpus they did: all
 *                15 flagged renders were false positives.
 */
const LP612_LINT_VERSION = '2026-09-16';

/** The gate this bead exists for. `lint_fails` entries are `"CODE: message"` strings. */
const RELIGIOUS_CODE = 'RELIGIOUS_MARKS';

/**
 * Classify one `niete_lp612_renders` row's stored lint verdict.
 *
 * Runs on EVERY cache hit, so it never throws: a malformed or absent row is classified, not
 * rejected. A throw here is a lesson a teacher does not receive.
 *
 * `reason` is one of:
 *   `current`      — judged by the gate running now. The only non-stale answer.
 *   `version_moved`— judged by a named, older ruleset.
 *   `unstamped`    — no stamp: authored before the column existed, or the column was not selected.
 *                    Every row on production is this until the backfill runs.
 *   `never_looked` — the gate never ran on this document at all. A reused render writes
 *                    `lint_clean: null` / `lint_fails: null` for exactly this reason (bd-oak77.12),
 *                    and "we did not look" is a different fact from "we looked and it was clean".
 *                    Kept separate so reused documents are not hidden inside the pre-migration
 *                    backlog, which is the bigger and much more benign population.
 *
 * @param {object|null} row
 * @returns {{stale: boolean, reason: string, stampedVersion: string|null, religiousFails: string[]}}
 */
function cachedLintStatus(row) {
  const hasRow = row !== null && typeof row === 'object';
  const r = hasRow ? row : {};
  const stamp = typeof r.lint_version === 'string' && r.lint_version ? r.lint_version : null;

  // A reused render is recognised by the gate's own "we did not look" signature, and is checked
  // BEFORE the stamp: an unstamped reuse is a reuse, not part of the migration backlog.
  //
  // It requires an actual row. `never_looked` asserts a positive fact about a document — the gate
  // ran on it zero times — and a missing row supports no such claim; all it supports is the weaker
  // `unstamped`. Inferring the stronger one from nothing is how a degenerate input becomes a
  // confident wrong answer in a query someone later trusts.
  const neverLooked = hasRow
    && stamp === null
    && (r.lint_clean === null || r.lint_clean === undefined)
    && (r.lint_fails === null || r.lint_fails === undefined);

  let reason;
  if (neverLooked) reason = 'never_looked';
  else if (stamp === null) reason = 'unstamped';
  else if (stamp === LP612_LINT_VERSION) reason = 'current';
  else reason = 'version_moved';

  // Defensive on both the array and its entries: `lint_fails` is JSON out of Postgres, so a
  // non-array or a non-string entry is a shape this path must survive rather than trust.
  const fails = Array.isArray(r.lint_fails) ? r.lint_fails : [];
  const religiousFails = fails.filter(
    (f) => typeof f === 'string' && f.startsWith(`${RELIGIOUS_CODE}:`),
  );

  return {
    stale: reason !== 'current',
    reason,
    stampedVersion: stamp,
    religiousFails,
  };
}

module.exports = { LP612_LINT_VERSION, RELIGIOUS_CODE, cachedLintStatus };
