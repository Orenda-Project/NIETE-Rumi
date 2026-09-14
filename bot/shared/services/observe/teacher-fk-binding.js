/**
 * May this observation_schedules row be bound to this user?
 *
 * `teacher_ext_id` holds a phone number, and a phone number identifies a person
 * TODAY. Resolving it to a user is therefore a guess about the past: if the
 * teacher already changed SIM, her old number may now belong to a stranger.
 * 5,364 of 14,566 NIETE accounts (36.8%) carry irreplaceable history, so that
 * stranger is quite likely to be a real teacher with real records — and binding
 * one teacher's visit to another teacher's identity is both silent and nasty to
 * unpick.
 *
 * So the phone match is necessary and NOT sufficient: the stored `teacher_name`
 * has to corroborate it. This module is the rule, mirrored by the WHERE clause
 * in scripts/migrations/2026-09-14-observation-schedules-teacher-fk.sql. Keep
 * the two in step — the SQL is what runs, this is what is tested.
 *
 * Measured on production 2026-09-14 (2,102 rows): 2,037 names agree exactly, 8
 * agree on the first token, 16 differ, 31 have a blank side. The rule accepts
 * the 2,045 and abstains on the rest. We would rather leave 47 rows NULL than
 * mislabel one visit — a NULL is visibly missing, a wrong FK is not.
 */

const HONORIFIC = /^(ms|mr|mrs|miss|madam|sir)\.?\s+/i;

/**
 * The name, reduced to the part worth comparing.
 *
 * Honorifics are the single biggest source of benign disagreement in the data
 * ('Ms Amina Farooq' vs 'Amina Farooq'), so they come off before comparison.
 * Case and surrounding whitespace go the same way. Nothing else is normalised:
 * stripping punctuation or collapsing diacritics would start merging names that
 * are genuinely different, which is the failure this whole module exists to
 * avoid.
 */
function simplifyName(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .replace(HONORIFIC, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the schedule's teacher_name corroborates the matched user's name.
 *
 * Blank on either side is a refusal, not a pass — 'we have no name' is not
 * evidence of agreement, and the placeholder 'Teacher' (which appears on real
 * production rows against a named account) is exactly the shape a recycled SIM
 * would present.
 *
 * KNOWN LIMIT, accepted deliberately: first-token agreement will accept two
 * different people who share a first name and whose surnames differ. That is
 * tolerated because the phone is UNIQUE on users (14,566 rows, 14,566 distinct
 * — asserted again by the migration's guard), so the pair has already survived
 * an exact-identity match; the name is a second opinion, not the primary key.
 * Tightening to exact-only would abstain on 8 real teachers to defend against a
 * collision that also requires the phone to have been recycled.
 */
function mayBind(scheduleTeacherName, userName) {
  const s = simplifyName(scheduleTeacherName);
  const u = simplifyName(userName);
  if (!s || !u) return false;
  if (s === u) return true;
  return s.split(' ')[0] === u.split(' ')[0];
}

module.exports = { mayBind, simplifyName };
