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
      || user.first_name)
  );
}

module.exports = { isRegistered };
