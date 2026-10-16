'use strict';
/**
 * The first-touch door's keys — the ONE module that names them.
 *
 * Store: `user_feature_first_use` (UNIQUE user_id × feature; columns video_shown_at, feature_used_at,
 * intro_shown_count), the row's user_id = the unknown phone's users row. Keys:
 *
 *   quiz_door_teacher   the phone answered "teacher" (a Make-quiz tap, the menu row with no key, the claim phrase,
 *                       /register, the family door's "I'm a teacher" link, the typed teacher word)
 *   quiz_door_child     the phone answered "child" (a Play tap, the typed child word, "Change my choice" on the maker)
 *   quiz_door_asked     the chooser was SHOWN; intro_shown_count counts the shows (one per PKT day), capped at 2
 *   quiz_tour           the maker page's one banner: video_shown_at = shown, feature_used_at = dismissed
 *
 * Every write goes through the existing FeatureIntroService statics with no change to that file, in the order
 * markVideoShown (the upsert) THEN markFeatureUsed (an UPDATE that writes 0 rows when no row exists and swallows its
 * errors) — so the row always exists before feature_used_at is set. Every door write ends in
 * forgetDoorVerdict(raw, norm) (the sister's helper, both phone forms), so a cached verdict never outlives a key.
 *
 * The read is ONE select, indexed on the UNIQUE key, of the three door rows. It THROWS on a read error: the caller
 * (door.service) fails towards today's path; nothing here guesses "no key".
 *
 * Nothing in this module writes name, role, registration_*, preferred_language, a students row or a binding.
 */
const supabase = require('../../config/supabase');
const FeatureIntro = require('../feature-intro.service');

const TABLE = 'user_feature_first_use';
const KEYS = Object.freeze({
  TEACHER: 'quiz_door_teacher',
  CHILD: 'quiz_door_child',
  ASKED: 'quiz_door_asked',
  TOUR: 'quiz_tour',
});
const DOOR_KEYS = Object.freeze([KEYS.TEACHER, KEYS.CHILD, KEYS.ASKED]);
/** A door key older than this (by feature_used_at) is read as absent; never deleted. quiz_door_asked never expires. */
const KEY_TTL_DAYS = 90;

/**
 * The three door rows this user holds, keyed by feature: { [feature]: { count, usedAt: Date|null } }.
 * One indexed read. Throws on a read error.
 */
async function readDoorKeys(userId) {
  const { data, error } = await supabase.from(TABLE)
    .select('feature, intro_shown_count, feature_used_at')
    .eq('user_id', userId)
    .in('feature', DOOR_KEYS);
  if (error) throw new Error(error.message || `${TABLE} read failed`);
  const by = {};
  for (const r of data || []) {
    by[r.feature] = { count: Number(r.intro_shown_count) || 0, usedAt: r.feature_used_at ? new Date(r.feature_used_at) : null };
  }
  return by;
}

/** Drop the door's cached verdict for this phone, raw and normalised (IDENTITY §5). Never throws. */
async function forgetVerdict(phone) {
  if (!phone) return;
  const StudentIdentity = require('../quiz/student-identity.service');
  await StudentIdentity.forgetDoorVerdict(String(phone), StudentIdentity.normalisePhone(phone));
}

/** The one write shape: the upsert first, then feature_used_at, then the cache forget. */
async function write(userId, feature, phone, { incrementIntroCount = false } = {}) {
  await FeatureIntro.markVideoShown(userId, feature, { incrementIntroCount });
  await FeatureIntro.markFeatureUsed(userId, feature);
  await forgetVerdict(phone);
}

const markTeacher = (userId, phone) => write(userId, KEYS.TEACHER, phone);
const markChild = (userId, phone) => write(userId, KEYS.CHILD, phone);
/** The chooser SHOW: `increment` is true only when the row's feature_used_at is not today (PKT) — the caller decides. */
const markAsked = (userId, phone, { increment = true } = {}) => write(userId, KEYS.ASKED, phone, { incrementIntroCount: increment });

/** The banner was shown: the row with video_shown_at and intro_shown_count + 1 (a page action: no phone to forget). */
const markTourShown = (userId) => FeatureIntro.markVideoShown(userId, KEYS.TOUR, { incrementIntroCount: true });
/** The banner was dismissed (the OK, the first grade chip): feature_used_at set; the row is created first if absent. */
async function markTourDismissed(userId) {
  await FeatureIntro.markVideoShown(userId, KEYS.TOUR);
  await FeatureIntro.markFeatureUsed(userId, KEYS.TOUR);
}
/** Has this user met the banner (shown or dismissed)? true when unsure: no banner on a read error. */
async function tourSeen(userId) {
  try {
    const { data, error } = await supabase.from(TABLE).select('id').eq('user_id', userId).eq('feature', KEYS.TOUR).limit(1);
    if (error) return true;
    return (data || []).length > 0;
  } catch (_) {
    return true;
  }
}

module.exports = {
  TABLE, KEYS, DOOR_KEYS, KEY_TTL_DAYS,
  readDoorKeys, forgetVerdict,
  markTeacher, markChild, markAsked,
  markTourShown, markTourDismissed, tourSeen,
};
