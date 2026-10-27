/**
 * bd-2460 — shared, fail-closed feature flags backed by `app_settings`.
 *
 * Why the database and not an env var: the bot and the dashboard are separate
 * Railway services with separate environments. An env var would have to be set
 * twice and could drift, which is exactly the "two surfaces, two answers"
 * problem this exists to prevent. They share one Supabase, so one row is one
 * answer for both.
 *
 * `app_settings` is already the home for config flags (pic_lp_backend_ab) —
 * no new table.
 *
 * FAIL CLOSED, always. An absent row, a malformed value, or a failed lookup
 * all read as OFF. Turning a feature on has to be a deliberate act, and a
 * database hiccup must never expose something unfinished to teachers.
 */

// bd-fmf24g.46 — "teachers" (every users.role teacher) is read through the bot's module, so the portal and the
// WhatsApp app link give one answer to "is she on the teacher app?". The portal service deploys the whole repo.
const { isTeachersValue, isTeacherRole, isCoachRole } = require('../../bot/shared/services/teacher-audience');
// bd-sex15q.13 — the six ICT sectors an RM row may name (one list, the analytics gate's).
const { SECTORS } = require('./analytics-lists');

/** app_settings key for the UG_EG-backed Assessment Generator. */
const ASSESSMENT_GENERATOR_KEY = 'assessment_generator_enabled';

/** app_settings key for editing a generated paper (bd-hb8qs). */
const ASSESSMENT_EDITING_KEY = 'assessment_editing_enabled';

/**
 * What every surface says while the Assessment Generator is off. Kept
 * character-identical to the bot's /assessment fallback
 * (bot/shared/handlers/text-message.handler.js) so a teacher who tries
 * WhatsApp and then the portal gets one consistent answer.
 */
const ASSESSMENT_GENERATOR_OFF_MESSAGE =
  "The assessment generator is being prepared for you. We'll notify you when it's live.";

/**
 * Read a boolean flag from app_settings.
 *
 * Only a real `true` (JSON boolean, or the string "true") counts as on.
 * Anything else — including 1, "yes", an object, or no row at all — is off.
 * Guessing at intent is how a half-configured flag turns a feature on by
 * accident.
 *
 * @param {object} supabase client for whichever service is asking
 * @param {string} key app_settings.key
 * @returns {Promise<boolean>}
 */
async function isFlagEnabled(supabase, key) {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return false;

    let value = data.value;
    if (typeof value === 'string') {
      // JSONB can round-trip as a quoted string; tolerate both '"true"' and 'true'.
      try { value = JSON.parse(value); } catch (_) { /* fall through to the raw string */ }
    }
    if (value === true) return true;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * @param {object} supabase
 * @returns {Promise<boolean>} whether the Assessment Generator is live
 */
function isAssessmentGeneratorEnabled(supabase) {
  return isFlagEnabled(supabase, ASSESSMENT_GENERATOR_KEY);
}

/** bd-3bvfj — app_settings key for teacher self-observation from the portal. */
const PORTAL_SELF_OBSERVATION_KEY = 'portal_self_observation';

/** bd-s1oo0.7 — app_settings key for the child test in the coach app (true or a pilot list). */
const PORTAL_CHILD_TEST_KEY = 'portal_child_test';

/** The coach's Learning assessment (the child takes the battery alone on the coach's phone): true or a pilot list. */
const PORTAL_CHILD_TEST_SA_KEY = 'portal_child_test_sa';

/**
 * The coach's per-session Results page for the Learning assessment (per task: how the child answered, the SA scale,
 * the recording's state; read only, no names). Same shape and rule as the keys above: true = everyone, a list of
 * users.id = a pilot, absent = off. Off, GET …/sa/session/:id/results is 404 and the page says "not available".
 */
const SA_RESULTS_VIEW_KEY = 'sa_results_view';

/**
 * Who reads ANY coach's session on that Results page (the admin view). Same shape and rule as the keys above: true =
 * everyone, a list of users.id = those users, absent = nobody. Checked for the portal SESSION user only; the bot then
 * skips its own-session check for that one read.
 */
const SA_RESULTS_ADMINS_KEY = 'sa_results_admins';

/**
 * The results dashboard on REAL sessions (GET …/sa/sessions): a coach's own sessions, a results admin's every coach's,
 * in the example dashboard's layout. Same shape and rule as the keys above: true = everyone, a list of users.id = a
 * pilot, absent = off. Off, the route is 404 and the page stays the example (or "not available").
 */
const SA_REAL_DASHBOARD_KEY = 'sa_real_dashboard';

/**
 * The visit review page (GET …/sa/session/:id/review, POST …/review/mark): one session item by item, with the
 * recordings, the app's and the scoring agents' marks, and a reviewer's own mark per item. Same shape and rule as the
 * keys above. Off, both routes are 404.
 */
const SA_REVIEW_PAGE_KEY = 'sa_review_page';

/**
 * bd-5rz1v.6 — app_settings key for a COACH running an /observe observation from
 * the portal (record or send the lesson, check the draft, the talk with the
 * teacher, send her the report). Same shape and rule as the key above.
 */
const PORTAL_COACH_OBSERVATION_KEY = 'portal_coach_observation';

/**
 * bd-5rz1v.12 — app_settings key for the portal's NEW UI (Direction B: light
 * screens, big rows, one bottom button, an indigo menu bar). It is designed and
 * shipped screen by screen behind this one row. Same shape and rule as the keys
 * above: true = everyone, a list of users.id = a pilot, absent = off.
 */
const PORTAL_NEW_UI_KEY = 'portal_new_ui';

/**
 * bd-o15qnr — app_settings key for the coach app v2 (the v18 coach design: Home
 * with today's visits, Scheduling, Observe, Schools & teachers). Same shape and
 * rule as the keys above: true = everyone, a list of users.id = a pilot,
 * absent = off. The portal shows it only to role=coach.
 */
const PORTAL_COACH_V2_KEY = 'portal_coach_v2';

/**
 * bd-fmf24g.1 — app_settings key for the TEACHER app v2 (the v28 teacher design:
 * Home with illustrated feature tiles, Lesson Plans, Digital Coaching, Training…).
 * Same shape and rule as the keys above: true = everyone, a list of users.id =
 * a pilot, absent = off. The portal shows it to teachers only (never the leader family).
 */
const PORTAL_TEACHER_V2_KEY = 'portal_teacher_v2';

/**
 * bd-tbprit.1 — app_settings key for the coach's disagreements card in the portal (the C/D teachers who
 * answered "Not accurate" to their coaching report, v10 coaching test). Same rule as the keys above:
 * true = everyone, a list of users.id = a pilot, absent = off. Off, /cv/:token keeps the v1 card.
 */
const COACH_DISAGREEMENT_CARD_KEY = 'coach_disagreement_card';

/**
 * Teacher Home card — app_settings key for the teacher Home's ONE card (the next thing to do: a class send few children
 * finished, a fresh coach report, a lesson to quiz, an observation, the first plan), the scores row under it, and the
 * card's tap log. Same shape and rule as the keys above: true = everyone, a list of users.id = a pilot,
 * "teachers" = every teacher, absent = off. Off, the Home is today's tree and GET /me/home is 404.
 */
const PORTAL_TEACHER_HOME_CARD_KEY = 'portal_teacher_home_card';

/**
 * Teacher Home card — app_settings key for the PER-TEACHER tile order on the Home (most-used first, by distinct days in 28;
 * services/teacher-home-order.service.js). Read only when portal_teacher_home_card is on too: the order is an
 * experiment measured against the card's cohort, so it never runs alone. Same shape and rule as the keys above.
 */
const PORTAL_TEACHER_HOME_ORDER_KEY = 'portal_teacher_home_order';

/**
 * Teacher Home "Quizzes" tile — app_settings key for one more tile under the eight (full width, so they still fill four
 * rows): the teacher's quiz home, opened signed from GET /me/home's `quizHome`. Read with portal_teacher_home_card on (its
 * route's own guard); the tile is drawn only when there IS a quiz home (the bot answered; never for a coach). Same shape
 * and rule as the keys above: true = everyone, a list of users.id = a pilot, "teachers" = every teacher, absent = off.
 */
const PORTAL_TEACHER_HOME_QUIZ_TILE_KEY = 'portal_teacher_home_quiz_tile';

/**
 * Teacher Home look — app_settings key for the teacher Home's new LOOK (the band, the tinted card, the progress strip,
 * the 2-up rows and the phone menu). Read only when portal_teacher_home_card is on too: the look redraws the card's
 * Home, so it never runs alone. Same shape and rule as the keys above; absent = off, and off is today's Home.
 */
const PORTAL_TEACHER_HOME_LOOK_KEY = 'portal_teacher_home_look';

/**
 * bd-sex15q.13 — COACHIP, the coach and RM insight portal (SPEC v2 §2, API.md §5). Three switches, every one off with
 * no row; turning one on is one app_settings upsert, and it takes effect on the next request (nothing here caches).
 *
 *   portal_coachip         list of users.id (or true)            the coach routes answer; S1 is the coach's home
 *   portal_coachip_rm      OBJECT {"<users.id>": "<sector>"}       the RM routes answer for that sector (rmSectorFor)
 *   portal_coachip_decode  list of users.id                      POST /coachip/teacher-name answers for own codes
 *
 * portal_coachip_rm is an object on purpose: isFlagEnabledForUser reads an object as OFF, so the RM row can never
 * switch on a coach route by accident.
 */
const PORTAL_COACHIP_KEY = 'portal_coachip';
const PORTAL_COACHIP_RM_KEY = 'portal_coachip_rm';
const PORTAL_COACHIP_DECODE_KEY = 'portal_coachip_decode';

/**
 * bd-3bvfj — a flag that can be on for EVERYONE or for a PILOT.
 *
 *   true (or "true")            → on for every user
 *   ["<user id>", …] (or JSON)  → on only for those users.id values
 *   "teachers"                  → on for every user whose users.role is teacher (bd-fmf24g.46; one more read,
 *                                 of her users row, and only for this value). The leader family and role
 *                                 'unregistered' are off. Code before bd-fmf24g.46 reads it as OFF.
 *   anything else, no row, or a failed read → OFF
 *
 * Same fail-closed rule as isFlagEnabled: the only way on is a deliberate,
 * well-formed value. An object, a number or an empty list is OFF, and a pilot
 * list never matches a missing user.
 *
 * `strict` (bd-4joiqz): a READ that fails throws instead of answering OFF, for the one caller whose safe answer
 * to "unknown" is not "off" (lp-reader: a principal ON the teacher app is a teacher, so a switch it cannot read
 * must not class her as a leader). No row, and every value above, answer exactly as without it. Default off:
 * every other caller is unchanged.
 *
 * @param {object} supabase
 * @param {string} key app_settings.key
 * @param {string|null} userId the SESSION user
 * @param {{ strict?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function isFlagEnabledForUser(supabase, key, userId, { strict = false } = {}) {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error && strict) throw new Error(error.message || 'app_settings read failed');
    if (error || !data) return false;

    let value = data.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { /* fall through to the raw string */ }
    }
    if (value === true) return true;
    // `await` so a failed read lands in the catch below (OFF), never in the caller.
    if (isTeachersValue(value)) return await isTeacherUser(supabase, userId, { strict });
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    if (Array.isArray(value)) return value.some((id) => typeof id === 'string' && id === userId);
    return false;
  } catch (error) {
    if (strict) throw error;
    return false;
  }
}

/**
 * bd-fmf24g.52 — is this user on the COACH app? What CoachGate (frontend) and requireLeaderRole + requireCoachV2 (API)
 * let through: portal_coach_v2 on for them (isFlagEnabledForUser) AND users.role coach. The WhatsApp coach link asks
 * the same question (bot/shared/services/app-redirect.service.js), and /go asks it before landing a coach token on a
 * coach page. No user, no row, or a failed read is no.
 *
 * @param {object} supabase
 * @param {string|null} userId
 * @returns {Promise<boolean>}
 */
async function isCoachAppUser(supabase, userId) {
  if (!userId) return false;
  try {
    if (!(await isFlagEnabledForUser(supabase, PORTAL_COACH_V2_KEY, userId))) return false;
    const { data, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return false;
    return isCoachRole(data.role);
  } catch (_) {
    return false;
  }
}

/**
 * bd-sex15q.13 — the RM's sector, or null. app_settings.portal_coachip_rm must be a JSON OBJECT (stored as jsonb or
 * as a JSON string) whose key is exactly this users.id and whose value is one of the six ICT sectors. A list, a
 * number, true, bad JSON, another user's key, a sector that is not one of the six, no user, or a failed read → null.
 * Fail closed, like isFlagEnabledForUser: the only way on is a deliberate, well-formed row.
 *
 * @param {object} supabase
 * @param {string|null} userId the SESSION user
 * @returns {Promise<string|null>}
 */
async function rmSectorFor(supabase, userId) {
  if (!userId || typeof userId !== 'string') return null;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', PORTAL_COACHIP_RM_KEY)
      .maybeSingle();
    if (error || !data) return null;
    let value = data.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { return null; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!Object.prototype.hasOwnProperty.call(value, userId)) return null;
    const sector = value[userId];
    return typeof sector === 'string' && SECTORS.includes(sector) ? sector : null;
  } catch (_) {
    return null;
  }
}

/** bd-fmf24g.46 — is this user a teacher (users.role)? No row or a failed read is no (`strict`: a failed read throws). */
async function isTeacherUser(supabase, userId, { strict = false } = {}) {
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error && strict) throw new Error(error.message || 'users read failed');
  if (error || !data) return false;
  return isTeacherRole(data.role);
}

/**
 * bd-o15qnr — the /leader/observe pipeline's gate. Coach v2's Take observation
 * runs on that pipeline, so a coach in the v2 pilot can use it without also
 * being in the portal_coach_observation pilot. Either flag opens it; neither,
 * or no session user, keeps it closed (fail-closed, like each flag alone).
 *
 * @param {object} supabase
 * @param {string|null} userId the SESSION user
 * @returns {Promise<boolean>}
 */
async function isCoachObservationOn(supabase, userId) {
  if (await isFlagEnabledForUser(supabase, PORTAL_COACH_OBSERVATION_KEY, userId)) return true;
  return isFlagEnabledForUser(supabase, PORTAL_COACH_V2_KEY, userId);
}

function isAssessmentEditingEnabled(supabase) {
  return isFlagEnabled(supabase, ASSESSMENT_EDITING_KEY);
}

/**
 * app_settings key: the accounts that see ONLY the schools analytics page (federal
 * and sector officials). The value is a JSON array of users.id — nothing else.
 */
const PORTAL_ANALYTICS_ONLY_KEY = 'portal_analytics_only';

/**
 * The users.id list a LIST-ONLY flag names.
 *
 * Unlike isFlagEnabledForUser, a broadcast value (true, "true", "teachers") is NOT
 * "everyone" here — it is nobody. For portal_analytics_only "everyone" would lock every
 * teacher out of her own portal and show every teacher every school's numbers, so the
 * only way onto the list is to be named on it. An object, a number, unparseable JSON or
 * a non-string entry is ignored the same way.
 *
 * An absent row is an empty list. A failed READ throws, so a gate can tell "you are not
 * on the list" (403) from "we could not check" (500); both deny.
 *
 * @param {object} supabase
 * @param {string} key app_settings.key
 * @returns {Promise<string[]>}
 */
async function readUserListFlag(supabase, key) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`app_settings read failed for ${key}: ${error.message || error}`);
  if (!data) return [];
  let value = data.value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((id) => typeof id === 'string' && id.trim() !== '');
}

/**
 * Is this user named on a list-only flag? Fail-closed: no user, no row, a broadcast or
 * malformed value, or a failed read are all "no".
 */
async function isUserListedInFlag(supabase, key, userId) {
  if (!userId) return false;
  try {
    return (await readUserListFlag(supabase, key)).includes(userId);
  } catch (_) {
    return false;
  }
}

/** Is this an analytics-only account? What the portal routes by (user.analyticsOnly). */
function isAnalyticsOnlyUser(supabase, userId) {
  return isUserListedInFlag(supabase, PORTAL_ANALYTICS_ONLY_KEY, userId);
}

/** bd-6faz8m — app_settings key for editing a generated paper from the PORTAL only. */
const PORTAL_ASSESSMENT_EDITING_KEY = 'portal_assessment_editing_enabled';

/**
 * Portal paper editing. Row absent -> follow assessment_editing_enabled (so
 * nothing changes until the row is written); present -> only true / "true" is
 * on; a failed read is off. Boolean only, no pilot list.
 */
async function isPortalAssessmentEditingEnabled(supabase) {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', PORTAL_ASSESSMENT_EDITING_KEY)
      .maybeSingle();
    if (error) return false;
    if (!data) return isAssessmentEditingEnabled(supabase);
    let value = data.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { /* fall through to the raw string */ }
    }
    if (value === true) return true;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * The teacher sign-in page takes a non-PK mobile written with its country code (the server already accepts 10-15
 * digits). One switch for everyone: it is read before anyone is signed in. Off unless set.
 */
const PORTAL_LOGIN_INTL_NUMBERS_KEY = 'portal_login_intl_numbers';

/** @returns {Promise<boolean>} whether portal_login_intl_numbers is on */
function isLoginIntlNumbersEnabled(supabase) {
  return isFlagEnabled(supabase, PORTAL_LOGIN_INTL_NUMBERS_KEY);
}

module.exports = {
  PORTAL_LOGIN_INTL_NUMBERS_KEY,
  isLoginIntlNumbersEnabled,
  PORTAL_ANALYTICS_ONLY_KEY,
  readUserListFlag,
  isAnalyticsOnlyUser,
  PORTAL_ASSESSMENT_EDITING_KEY,
  isPortalAssessmentEditingEnabled,
  PORTAL_SELF_OBSERVATION_KEY,
  PORTAL_CHILD_TEST_KEY,
  PORTAL_CHILD_TEST_SA_KEY,
  SA_RESULTS_VIEW_KEY,
  SA_RESULTS_ADMINS_KEY,
  SA_REAL_DASHBOARD_KEY,
  SA_REVIEW_PAGE_KEY,
  PORTAL_COACH_OBSERVATION_KEY,
  PORTAL_NEW_UI_KEY,
  PORTAL_COACH_V2_KEY,
  PORTAL_TEACHER_V2_KEY,
  COACH_DISAGREEMENT_CARD_KEY,
  PORTAL_TEACHER_HOME_CARD_KEY,
  PORTAL_TEACHER_HOME_ORDER_KEY,
  PORTAL_TEACHER_HOME_QUIZ_TILE_KEY,
  PORTAL_TEACHER_HOME_LOOK_KEY,
  PORTAL_COACHIP_KEY,
  PORTAL_COACHIP_RM_KEY,
  PORTAL_COACHIP_DECODE_KEY,
  rmSectorFor,
  isFlagEnabledForUser,
  isCoachAppUser,
  isCoachObservationOn,
  ASSESSMENT_GENERATOR_KEY,
  ASSESSMENT_EDITING_KEY,
  ASSESSMENT_GENERATOR_OFF_MESSAGE,
  isFlagEnabled,
  isAssessmentGeneratorEnabled,
  isAssessmentEditingEnabled,
};
