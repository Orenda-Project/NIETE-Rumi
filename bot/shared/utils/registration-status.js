/**
 * "Is this account registered?" — ONE definition, read everywhere.
 *
 * There are two truths on the users row and both are real:
 *
 *   registration_completed   set when a registration path RUNS TO COMPLETION.
 *   first_name               set the moment a name is known — by the Flow's first
 *                            screen, by the conversational name question,
 *                            or by a coach adding a teacher from WhatsApp.
 *
 * Keying on `registration_completed` alone was correct on staging, where every user
 * registered through the current Flow. It is wrong on production. Counted read-only on
 * NIETE prod (`ihzciabopbttygxxgrkm`) 2026-09-06: of 7,685 users with a first_name only
 * 440 have `registration_completed = true`; 7,245 have it FALSE (none NULL), and 4,145
 * of those messaged the bot in the last 30 days — 3,951 of them teachers. Most are the
 * July NIETE roster migration, which set names and never set the flag.
 *
 * `registration_state` is not a fallback either: it reads 'unregistered' for 7,684 of
 * those 7,685 rows, INCLUDING 439 of the 440 whose flag is true. Exactly one row on the
 * whole database says 'completed'. It is kept in the union only because it costs nothing
 * and a deployment that does write it should be believed.
 *
 * So: a completed run OR a name we already know. An empty-string first_name is not a
 * name (212 prod rows carry one) — `!!''` is false, which is the behaviour we want and
 * the reason this is a truthiness check rather than a null check.
 *
 * This does NOT make `registration_completed` redundant. The flag still says whether she
 * finished, which is what the /register copy, the analytics and the coach portal count.
 * It says "we know who she is", which is what a conversational gate needs.
 */
function isRegistered(user) {
  return !!(
    user
    && (user.registration_completed === true
      || user.registration_state === 'completed'
      || user.name)
  );
}

const { formRole, isAdminRole } = require('../config/registration-roles');

const hasName = (user) => typeof user.name === 'string' && user.name.trim() !== '';

/**
 * Does this adult still need the registration FORM? — the question every unprompted door asks
 * (the after-reply offer, the after-feature trigger, the once-only claim).
 *
 * isRegistered() above answers "do we know who she is" — a name is enough, which is right for a
 * conversational gate and wrong here. Production, 2026-10-16: ~1,007 adults who have messaged the
 * bot carry a roster or coach-entered name but no school or no real role, and anyone who quits
 * the v5 form after its first screen keeps the name that screen saved. Keyed on isRegistered(),
 * none of them was ever offered the form.
 *
 * The operator's rule: an adult who is not a child, whose role was not set by an admin (coach,
 * AEO — the form never touches those), who has not completed the form, and who is missing any of
 * a name, a school (users.school_id), or a role the form gives (teacher/principal). A roster row
 * carrying all three is complete even with the flag false — offering it the form is noise.
 *
 * @param {object|null} user a users row (persona as set by student-ingress, when known)
 * @returns {boolean}
 */
function needsRegistrationForm(user) {
  if (!user) return false;
  if (user.persona === 'student') return false;
  if (isAdminRole(user.role)) return false;
  if (user.registration_completed === true) return false;
  return !hasName(user) || !user.school_id || !formRole(user.role);
}

/**
 * Does a feature that needs her school have to ask for it first? A class, a register and an
 * attendance roll all belong to a school (users.school_id). Any adult without one — registered
 * or not, completed or not — gets the form's "first, your school" invite instead of a dead end.
 * Never a child, and never an admin-set coach/AEO: their schools are allocated (leader_schools),
 * not chosen on the form.
 */
function needsSchoolForFeature(user) {
  if (!user || user.persona === 'student' || isAdminRole(user.role)) return false;
  return !user.school_id;
}

module.exports = { isRegistered, needsRegistrationForm, needsSchoolForFeature };
