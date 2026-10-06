'use strict';
/**
 * A coach edits a teacher she already holds: her name, her level, her number.
 *
 * Sits beside observe-teacher-admin (add/remove) and follows the same shape —
 * plan (reads only) → a confirm screen naming the person → commit that RE-PLANS
 * → an audit row. The confirm is a separate data_exchange round trip, so the
 * world can move between the two; committing on a stale plan is how the wrong
 * person gets edited.
 *
 * WHY THE PHONE CHANGE IS THE HARD ONE
 * A teacher's identity is keyed to her handset. `getOrCreateUser`
 * (bot-helpers.js) looks her up by phone and CREATES on a miss, so a new SIM
 * mints an empty account and strands her history on a number she no longer
 * carries. Reported twice on the ICT feedback sheet by the same coach in a day.
 *
 * Moving her is therefore a merge, and the only question that matters is what
 * already sits on the destination number. Measured on production: 5,364 of
 * 14,566 accounts (36.8%) hold irreplaceable history, so a recycled Pakistani
 * SIM landing on a REAL teacher is a live possibility. Fusing two teachers'
 * certificates is silent and very hard to unpick, so the classifier abstains
 * rather than guesses — see classifyTarget.
 */

const { teacherLevelOf, VALID_LEVELS } = require('../../utils/teacher-level');
const { softDeletePatch } = require('../../utils/soft-delete');

const CASE_FREE = 'free';     // no account on the new number
const CASE_SHELL = 'shell';   // an account, but nothing irreplaceable
const CASE_TAKEN = 'taken';   // a real person's history — refuse, escalate

/** Hours a teacher's own level choice is protected for. Mirrors band-selection. */
const COOLDOWN_HOURS = 48;

/**
 * What makes an account irreplaceable.
 *
 * NOT "is it empty". The account that triggered this feature looked fully set
 * up — registered, school set, grades set, five lesson plans, 27 conversations
 * — and was still safe to fold, because none of that is unrecoverable: she can
 * ask for another lesson plan. What she cannot redo is a certificate, an exam
 * attempt, her training progress, or an observed coaching session.
 */
const IDENTITY_BEARING = ['certificates', 'attempts', 'progress', 'coaching'];

/**
 * Which case is the destination number in?
 *
 * @param {?object} target the users row on the NEW number, carrying a `counts`
 *   block of the identity-bearing tables. Null/undefined means no account.
 * @returns {'free'|'shell'|'taken'}
 */
function classifyTarget(target) {
  if (!target) return CASE_FREE;

  // No counts means we could not read the history — which is not the same as
  // knowing it is empty. Fail closed: an unnecessary escalation costs a coach a
  // message, a wrong merge costs a teacher her record.
  const counts = target.counts;
  if (!counts || typeof counts !== 'object') return CASE_TAKEN;

  const total = IDENTITY_BEARING.reduce((n, k) => n + (Number(counts[k]) || 0), 0);
  return total > 0 ? CASE_TAKEN : CASE_SHELL;
}

// ── name ───────────────────────────────────────────────────────────────

/** Collapse whitespace and title-case, leaving the rest of the string alone. */
function _cleanName(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Plan a name edit. Writes `users.name` and nothing else — `first_name` and
 * `last_name` were dropped, and the first name is derived at render.
 */
function planNameEdit(user, rawName) {
  const name = _cleanName(rawName);
  // Blanking the record is never what a coach meant; it is a mistyped screen.
  if (!name) return { ok: false, reason: 'empty_name' };
  if (name === String((user && user.name) || '').trim()) {
    return { ok: true, unchanged: true, name };
  }
  return { ok: true, name, patch: { name } };
}

// ── level ──────────────────────────────────────────────────────────────

/**
 * Plan a level edit.
 *
 * The 48-hour cooldown applies to a COACH's edit exactly as it applies to the
 * teacher's own: it protects her programme from being flipped repeatedly, and a
 * coach-side editor must not become the way around it. The actual write goes
 * through applyBandSelection(), which also reconciles
 * teacher_training_assignments — this only decides whether it may proceed.
 */
function planLevelEdit(user, rawBands, now = Date.now()) {
  const wanted = (Array.isArray(rawBands) ? rawBands : [])
    .map((b) => String(b == null ? '' : b).trim().toUpperCase())
    .filter((b) => VALID_LEVELS.includes(b));
  const bands = VALID_LEVELS.filter((b) => wanted.includes(b));

  // An empty selection is a rejected input, not an instruction to revoke every
  // programme the teacher has.
  if (bands.length === 0) return { ok: false, reason: 'empty_selection', bands };

  const stamp = user && user.teacher_level_updated_at;
  if (stamp) {
    const elapsedH = (now - Date.parse(stamp)) / 3600000;
    if (elapsedH < COOLDOWN_HOURS) {
      return {
        ok: false,
        reason: 'cooldown',
        bands,
        hoursRemaining: Math.ceil(COOLDOWN_HOURS - elapsedH),
      };
    }
  }

  const current = teacherLevelOf(user);
  const same = current.length === bands.length && current.every((b, i) => b === bands[i]);
  return { ok: true, bands, unchanged: same };
}

// ── role ──────────────────────────────────────────────────

/**
 * The only two roles this screen may write. Deliberately NOT every role in
 * the system: `role` is the input to role-features.js, where `coach`, `aeo`,
 * `supervisor` and `school_leader` all carry `observe: true` AND `dc: false`.
 * Writing one of those from a coach-facing picker would hand a teacher the
 * right to observe OTHER teachers and silently take away her own Classroom
 * Coaching. The patch itself only ever contains these two (PATCH_ROLES in
 * patch-resolver.service.js), so this is the same set, stated where it is
 * enforced.
 */
const EDITABLE_ROLES = Object.freeze(['teacher', 'principal']);

/**
 * Plan a role edit (Teacher <-> Principal).
 *
 * THIS IS A PRIVILEGE CHANGE, not a label. `principal` is the one role that
 * gets both features, so promoting someone opens /observe for them and makes
 * observe-audio-router treat their next voice note as an observation of
 * someone else. That is exactly what row 122 of the DC review sheet cost a
 * teacher, so the caller must name the consequence on the confirm screen
 * rather than saving silently.
 *
 * A NULL role reads as `teacher`: the column is nullable, bulk-seeded rows
 * carry NULL, and role-features.js already defaults those to DC-only. Reading
 * it the same way here keeps "no change" honest for the 233-odd rows that
 * never had the column set.
 */
function planRoleEdit(user, rawRole) {
  const role = String(rawRole == null ? '' : rawRole).trim().toLowerCase();
  if (!EDITABLE_ROLES.includes(role)) return { ok: false, reason: 'invalid_role' };

  const current = String((user && user.role) || 'teacher').trim().toLowerCase();
  if (current === role) return { ok: true, unchanged: true, role };

  return { ok: true, role, patch: { role } };
}

/**
 * The patch that retires the old record after its history has moved.
 *
 * Soft, not hard: the classifier that green-lit the merge reads counts from
 * four tables, and if that is ever wrong the original row is the only way back.
 * Uses the shared convention (bot/shared/utils/soft-delete.js) rather than a
 * merge-specific column, so the next feature that needs to retire a row finds
 * one spelling instead of inventing a fifth.
 *
 * The survivor's id goes in the AUDIT row, not in the tombstone — "retired" and
 * "replaced by that one" are different facts.
 */
function retireMergedPatch(actorUserId, now = Date.now()) {
  return softDeletePatch({ reason: 'phone_change_merge', by: actorUserId, now });
}

module.exports = {
  retireMergedPatch,
  CASE_FREE,
  CASE_SHELL,
  CASE_TAKEN,
  COOLDOWN_HOURS,
  IDENTITY_BEARING,
  classifyTarget,
  planNameEdit,
  planLevelEdit,
  planRoleEdit,
  EDITABLE_ROLES,
};
