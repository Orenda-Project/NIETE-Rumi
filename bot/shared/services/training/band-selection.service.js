'use strict';
/**
 * bd-43478 — the teacher's own statement of which grade bands they teach, and
 * the training programs that follow from it.
 *
 * WHY THIS EXISTS
 * ICT sheet Row 6: a teacher teaching primary AND middle saw only the 4 NIETE
 * levels — no Oxbridge, no Beacon House. Nothing was wrong with the visibility
 * code. She registered with grades_taught=["grade_4"], which correctly derives
 * to PRIMARY -> niete_primary, and that program scopes to the NIETE vendor
 * alone; Oxbridge and Beacon House exist only under niete_middle_high. Her
 * access was frozen at a one-time signup answer with no way to correct it.
 *
 * Before this, NO code path in bot/, dashboard/ or portal/ ever inserted into
 * teacher_training_assignments — every row came from a migration, a backfill,
 * or hand-typed console SQL (bd-2672). This module is the first one that lets
 * the teacher decide, and it is the shared write path for both surfaces: the
 * bot Flow and the portal both gate on
 * teacher_training_assignments -> training_program_scopes, so one write lights
 * up both.
 *
 * ISOLATION (operator, 2026-08-20)
 * The choice lands in users.training_bands, NOT users.levels. It is scoped to
 * teacher training and must never gate lesson plans or any other feature — a
 * teacher picking "Middle" to reach the Beacon House training must not thereby
 * change their lesson-plan content. users.levels is left untouched so the
 * role-backfill heuristics and older migrations keep working unchanged.
 * See migration V1.1.8.
 *
 * This file is pure logic — no DB calls, no I/O — so the rules are testable
 * without a database. The persistence half lives in applyBandSelection().
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const PROGRAM_PRIMARY = 'niete_primary';
const PROGRAM_MIDDLE_HIGH = 'niete_middle_high';

/** Hours a teacher must wait between band changes (operator, 2026-08-20). */
const COOLDOWN_HOURS = 48;

/**
 * The vocabulary offered to the teacher, in display order.
 *
 * The label carries the grade range because "level" is dangerously overloaded
 * in this schema: training_levels holds CPD career stages for NIETE (Aspiring
 * Teacher … Teacher Leader) and SUBJECTS for Beacon House (English, Maths, …).
 * ICT sheet Row 5 is a teacher confused by exactly that collision, so the
 * picker never says a bare "Level N".
 */
const BANDS = Object.freeze([
  Object.freeze({ key: 'PRIMARY', label: 'Primary (Grades 1-5)' }),
  Object.freeze({ key: 'MIDDLE', label: 'Middle (Grades 6-8)' }),
  Object.freeze({ key: 'HIGH', label: 'High (Grades 9-10)' }),
]);

const VALID_BANDS = new Set(BANDS.map(b => b.key));

/**
 * Normalise a raw selection into known band keys.
 * Unknown tokens are dropped rather than defaulted — an unrecognised band must
 * never silently become PRIMARY.
 */
function normalizeBands(selection) {
  if (!Array.isArray(selection)) return [];
  const out = [];
  for (const raw of selection) {
    const key = String(raw || '').trim().toUpperCase();
    if (VALID_BANDS.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Bands -> training program keys.
 *
 * Deliberately mirrors programsForUser() in
 * scripts/lib/training-band-derivation.js: MIDDLE and HIGH share one program,
 * so both collapse to a single row. An empty or unrecognised selection yields
 * NO programs — never a default (the bd-2672 rule: no access beats wrong-band
 * access, because a wrong band is invisible once written).
 *
 * @param {string[]} selection band keys chosen by the teacher
 * @returns {string[]} program keys to assign
 */
function bandsToPrograms(selection) {
  const bands = normalizeBands(selection);
  if (bands.length === 0) return [];

  const programs = [];
  if (bands.includes('PRIMARY')) programs.push(PROGRAM_PRIMARY);
  if (bands.includes('MIDDLE') || bands.includes('HIGH')) programs.push(PROGRAM_MIDDLE_HIGH);
  return programs;
}

/**
 * May this teacher change their bands right now?
 *
 * The first-ever selection is always allowed: there is no previous choice to
 * protect, and a teacher who has never chosen is exactly the teacher this
 * feature exists to unblock. After a change, the next one waits 48 hours.
 *
 * A NULL timestamp means "never self-selected" — including teachers whose
 * training_bands were seeded from the import, because an inherited value was
 * never their own edit and must not start them in a cooldown (V1.1.8).
 *
 * Fails OPEN on an unparseable timestamp: a corrupt value must not lock a
 * teacher out of the only surface that can fix their access.
 *
 * @param {object} user row carrying training_bands_updated_at
 * @param {Date|number} [now] injectable clock for tests
 * @returns {{allowed: boolean, isFirstSelection: boolean, hoursRemaining: number, message: string|null}}
 */
function canChangeBands(user, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const raw = user ? user.training_bands_updated_at : null;

  if (!raw) {
    return { allowed: true, isFirstSelection: true, hoursRemaining: 0, message: null };
  }

  const lastMs = new Date(raw).getTime();
  if (!Number.isFinite(lastMs)) {
    // Unparseable — treat as never changed rather than as permanently blocked.
    return { allowed: true, isFirstSelection: true, hoursRemaining: 0, message: null };
  }

  const elapsedH = (nowMs - lastMs) / 3_600_000;
  if (elapsedH >= COOLDOWN_HOURS) {
    return { allowed: true, isFirstSelection: false, hoursRemaining: 0, message: null };
  }

  // A future timestamp (clock skew) reads as a change that just happened, not
  // as an expired cooldown — clamp rather than hand out a free change.
  const remaining = Math.min(COOLDOWN_HOURS, Math.max(1, Math.ceil(COOLDOWN_HOURS - elapsedH)));

  return {
    allowed: false,
    isFirstSelection: false,
    hoursRemaining: remaining,
    message:
      'You changed the grades you teach less than 48 hours ago, so this cannot be ' +
      'changed again just yet. If you need it changed sooner, please reach out to ' +
      'NIETE Support.',
  };
}

/**
 * The warning shown BEFORE a teacher confirms a change (operator, 2026-08-20).
 * Not shown on a first-ever selection — there is nothing to lose yet.
 */
function changeWarning() {
  return `Once you save this, it cannot be changed again for ${COOLDOWN_HOURS} hours.`;
}

/**
 * Stamped on every row this module writes.
 *
 * Load-bearing: scripts/backfill-training-assignments.js recomputes assignments
 * from grades_taught on every run, so without a marker it would silently
 * overwrite a teacher's own choice with an inference. The backfill skips rows
 * carrying this tag — a teacher's explicit statement outranks a script's guess,
 * permanently (operator, 2026-08-20).
 */
const SELF_SELECT_TAG = 'teacher_self_select';

/**
 * Persist a band selection and reconcile the teacher's program assignments.
 *
 * The single write path behind both surfaces (bot Flow + portal), because both
 * read teacher_training_assignments -> training_program_scopes.
 *
 * Writes users.training_bands only — never users.levels (so the role-backfill
 * heuristics keep their meaning) and never grades_taught (the record of what
 * the teacher said at signup stays intact).
 *
 * @param {string} userId
 * @param {string[]} selection band keys
 * @param {Date|number} [now] injectable clock
 * @returns {Promise<{ok: boolean, reason?: string, message?: string, unchanged?: boolean, programs?: string[]}>}
 */
async function applyBandSelection(userId, selection, now = Date.now()) {
  const bands = normalizeBands(selection);

  // An empty selection is a rejected input, NOT an instruction to revoke
  // access. Writing it would deactivate everything and strand the teacher on
  // the same dead end this feature exists to remove.
  if (bands.length === 0) {
    return { ok: false, reason: 'empty_selection', message: 'Please choose at least one option.' };
  }

  const { data: user, error: uErr } = await supabase
    .from('users')
    .select('id, training_bands, training_bands_updated_at')
    .eq('id', userId)
    .single();
  if (uErr || !user) {
    logToFile('⚠️ Band selection: user not found', { userId, error: uErr && uErr.message });
    return { ok: false, reason: 'user_not_found', message: 'We could not find your profile. Please contact NIETE support.' };
  }

  // Cooldown is checked BEFORE any write, so a blocked attempt leaves the
  // database untouched.
  const gate = canChangeBands(user, now);
  if (!gate.allowed) {
    return { ok: false, reason: 'cooldown', message: gate.message, hoursRemaining: gate.hoursRemaining };
  }

  const wantedKeys = bandsToPrograms(bands);
  const { data: programs, error: pErr } = await supabase
    .from('training_programs')
    .select('id, key')
    .in('key', wantedKeys);
  if (pErr || !programs || programs.length === 0) {
    logToFile('⚠️ Band selection: programs not resolvable', { userId, wantedKeys, error: pErr && pErr.message });
    return { ok: false, reason: 'programs_not_found', message: 'We could not set up your training just now. Please contact NIETE support.' };
  }
  const wantedIds = programs.map(p => p.id);

  const { data: existing } = await supabase
    .from('teacher_training_assignments')
    .select('program_id')
    .eq('user_id', userId)
    .eq('is_active', true);
  const activeIds = [...new Set((existing || []).map(r => r.program_id))];

  const toAdd = wantedIds.filter(id => !activeIds.includes(id));
  const toDrop = activeIds.filter(id => !wantedIds.includes(id));

  // Nothing to reconcile — do not stamp a new timestamp, or re-saving an
  // unchanged selection would start a 48h cooldown for no reason.
  if (toAdd.length === 0 && toDrop.length === 0) {
    return { ok: true, unchanged: true, programs: wantedKeys };
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map(program_id => ({
      user_id: userId,
      program_id,
      is_active: true,
      assigned_by: SELF_SELECT_TAG,
      assigned_at: new Date(now instanceof Date ? now.getTime() : now).toISOString(),
    }));
    const { error } = await supabase.from('teacher_training_assignments').insert(rows);
    if (error) {
      logToFile('❌ Band selection: insert failed', { userId, error: error.message });
      return { ok: false, reason: 'write_failed', message: 'We could not save that just now. Please try again.' };
    }
  }

  if (toDrop.length > 0) {
    const { error } = await supabase
      .from('teacher_training_assignments')
      .update({ is_active: false })
      .eq('user_id', userId)
      .in('program_id', toDrop);
    if (error) {
      // The teacher already has everything they asked for; a failed cleanup
      // leaves stale extra access, which is not worth failing the whole save.
      logToFile('⚠️ Band selection: deactivate failed, extra access left active', { userId, toDrop, error: error.message });
    }
  }

  const stamp = new Date(now instanceof Date ? now.getTime() : now).toISOString();
  const { error: wErr } = await supabase
    .from('users')
    .update({ training_bands: bands, training_bands_updated_at: stamp })
    .eq('id', userId);
  if (wErr) {
    // Assignments are already correct, so the teacher can train; only the
    // cooldown stamp is missing. Surface it rather than claiming a clean save.
    logToFile('⚠️ Band selection: assignments written but training_bands update failed', { userId, error: wErr.message });
  }

  logToFile('🎓 Band selection saved', { userId, bands, added: toAdd.length, dropped: toDrop.length });
  return { ok: true, programs: wantedKeys, added: toAdd.length, dropped: toDrop.length };
}

module.exports = {
  applyBandSelection,
  SELF_SELECT_TAG,
  bandsToPrograms,
  canChangeBands,
  changeWarning,
  normalizeBands,
  BANDS,
  COOLDOWN_HOURS,
  PROGRAM_PRIMARY,
  PROGRAM_MIDDLE_HIGH,
};
