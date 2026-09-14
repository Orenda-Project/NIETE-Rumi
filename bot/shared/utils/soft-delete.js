'use strict';
/**
 * Soft delete — one convention, every table that needs it.
 *
 * Retiring a row without destroying it is a recurring need: a merged duplicate,
 * a school that closed, a roster entry added by mistake. Left to each feature,
 * it gets a new spelling every time, and "is this row live?" stops having one
 * answer. This schema is already drifting that way — `is_active` on 32 tables,
 * `deleted_at` on 10 (all inherited from the migrated source system), plus a
 * one-off `superseded_at` and a `superseded_by`.
 *
 * An earlier draft of the coach Edit feature was about to add one more:
 * `users.merged_into`, a merge-specific column doubling as a tombstone. Three
 * shared columns instead, and this module to read and write them:
 *
 *   deleted_at      WHEN it was retired. NULL = live. THE predicate.
 *   deleted_reason  WHY, as a short machine token — 'phone_change_merge'.
 *   deleted_by      WHO, as an actor id, or WHAT, as a process name.
 *
 * WHY A TIMESTAMP AND NOT is_active
 * A boolean answers "is it live" and nothing else. A timestamp answers that
 * (NULL or not) and also "since when", which is the question every
 * investigation actually asks. `is_active` stays where it already means
 * something domain-specific — an assignment that was deactivated is not a
 * deleted row — and this is for retirement.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * No `superseded_by`. "Replaced by that row" is a different fact from "retired",
 * only some retirements have a successor, and the feature that needs a
 * forwarding pointer should say so in its own terms rather than overloading the
 * tombstone. A merge records its survivor in its audit row.
 */

const SOFT_DELETE_COLUMNS = Object.freeze(['deleted_at', 'deleted_reason', 'deleted_by']);

/**
 * The patch that retires a row.
 *
 * `reason` is REQUIRED and throws when missing. An unexplained tombstone is
 * unauditable — the point of keeping the row is being able to answer "why is
 * this dead?" long after whoever did it has forgotten.
 *
 * @param {{reason: string, by?: string, now?: Date|number}} opts
 * @returns {{deleted_at: string, deleted_reason: string, deleted_by: string}}
 */
function softDeletePatch({ reason, by, now = Date.now() } = {}) {
  const r = String(reason == null ? '' : reason).trim();
  if (!r) throw new Error('softDeletePatch: a reason is required');
  const at = now instanceof Date ? now : new Date(now);
  return {
    deleted_at: at.toISOString(),
    deleted_reason: r,
    // 'unknown' rather than null: a row retired by nobody-knows-what is a fact
    // worth recording, and a null here reads as "we forgot to set it".
    deleted_by: String(by == null ? '' : by).trim() || 'unknown',
  };
}

/** The patch that brings a row back, leaving no trace it was ever retired. */
function restorePatch() {
  return { deleted_at: null, deleted_reason: null, deleted_by: null };
}

/**
 * Is this row retired?
 *
 * Keys on `deleted_at` ALONE. A reason or an actor left behind without a
 * timestamp is a half-written tombstone, and the row is live until the
 * timestamp says otherwise.
 */
function isDeleted(row) {
  return Boolean(row && row.deleted_at);
}

/** Drop retired rows. Safe on null so a failed fetch cannot throw mid-render. */
function liveOnly(rows) {
  return Array.isArray(rows) ? rows.filter((r) => !isDeleted(r)) : [];
}

module.exports = {
  SOFT_DELETE_COLUMNS,
  softDeletePatch,
  restorePatch,
  isDeleted,
  liveOnly,
};
