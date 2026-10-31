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

/** Flag cache: how long a row is held, and the cap on holding a failed read. See readFlagRow. */
const FLAG_CACHE_TTL_MS_DEFAULT = 30_000;
const FLAG_FAILURE_TTL_MS = 5_000;
const flagCaches = new WeakMap();

/** FLAG_CACHE_TTL_MS when it is a number >= 0 (0 turns the cache off), else 30 s. Read per fill, so a test can set it. */
function flagCacheTtlMs() {
  const raw = process.env.FLAG_CACHE_TTL_MS;
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : FLAG_CACHE_TTL_MS_DEFAULT;
}

/** One uncached read of app_settings.key, as { data, error }; a thrown read comes back as an error. */
async function fetchFlagRow(supabase, key) {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    return { data: data || null, error: error || null };
  } catch (err) {
    return { data: null, error: { message: (err && err.message) || String(err) } };
  }
}

/**
 * The app_settings row for one key, from an in-process cache. GET /api/portal/config asks 13 keys on every
 * request, and uncached each one was a PostgREST GET: about half of all prod API traffic.
 *
 *   - A row (or no row) is held for FLAG_CACHE_TTL_MS, default 30 s, so a flag change shows within that.
 *   - A failed read is held for at most 5 s, so a DB blip cannot pin a flag off.
 *   - One read in flight per key: a burst of requests shares it.
 *   - It holds the ROW, never an answer, so every caller below keeps its own rule (lists, "teachers", strict).
 *
 * Keyed by client as well as key, so two clients never share an entry.
 *
 * @param {object} supabase
 * @param {string} key app_settings.key
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
function readFlagRow(supabase, key) {
  if (!supabase || (typeof supabase !== 'object' && typeof supabase !== 'function')) {
    return fetchFlagRow(supabase, key);
  }
  let cache = flagCaches.get(supabase);
  if (!cache) {
    cache = new Map();
    flagCaches.set(supabase, cache);
  }
  const hit = cache.get(key);
  if (hit && (hit.pending || Date.now() - hit.at < hit.ttl)) return hit.promise;

  const entry = { pending: true, at: 0, ttl: 0, promise: null };
  entry.promise = fetchFlagRow(supabase, key).then((row) => {
    const ttl = flagCacheTtlMs();
    entry.pending = false;
    entry.at = Date.now();
    entry.ttl = row.error ? Math.min(FLAG_FAILURE_TTL_MS, ttl) : ttl;
    return row;
  });
  cache.set(key, entry);
  return entry.promise;
}

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
    const { data, error } = await readFlagRow(supabase, key);
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
 * The coach School Card: the coach Home, a school's card for a period, the by-teacher grids, her Teacher page, her
 * lists, Her coaching reports and the coach's view of one DC report (dashboard/services/coach-school-card.service.js).
 * Same shape and rule as the keys above: true = everyone, a list of users.id = a pilot, absent = off. Its routes also
 * need portal_coach_v2; off for her, every one of them is a 404 and /config says schoolCard: false. The bot reads
 * the same key for its WhatsApp door.
 */
const PORTAL_COACH_SCHOOL_CARD_KEY = 'portal_coach_school_card';

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
    const { data, error } = await readFlagRow(supabase, key);
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
  const { data, error } = await readFlagRow(supabase, key);
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
 * bd-97daxo.3 — app_settings key: which ORGANIZATION each analytics-only account belongs to, a JSON object
 * {"<users.id>": "<organization>"} (region_features.organization values: 'niete', 'moawin'). An account on
 * portal_analytics_only and absent from this map is FDE's ('niete'), so FDE's accounts need no row here.
 */
const PORTAL_ANALYTICS_ORGANIZATIONS_KEY = 'portal_analytics_organizations';

/**
 * The {users.id → value} map a MAP flag holds, as stored (a JSON object, or its JSON string). No row is an empty
 * map. Unlike readUserListFlag, a malformed value (a list, true, a number, unparseable JSON) THROWS rather than
 * reading as empty: an empty organization map makes every analytics account FDE's, which would show FDE's numbers
 * to another organization's account. A failed read throws too. The caller validates the entry it reads.
 *
 * @param {object} supabase
 * @param {string} key app_settings.key
 * @returns {Promise<Record<string, unknown>>}
 */
async function readUserMapFlag(supabase, key) {
  const { data, error } = await readFlagRow(supabase, key);
  if (error) throw new Error(`app_settings read failed for ${key}: ${error.message || error}`);
  if (!data) return {};
  let value = data.value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { throw new Error(`app_settings ${key} is malformed: not JSON`); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`app_settings ${key} is malformed: not a JSON object`);
  }
  return value;
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
    const { data, error } = await readFlagRow(supabase, PORTAL_ASSESSMENT_EDITING_KEY);
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

module.exports = {
  PORTAL_ANALYTICS_ONLY_KEY,
  readUserListFlag,
  PORTAL_ANALYTICS_ORGANIZATIONS_KEY,
  readUserMapFlag,
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
  PORTAL_COACH_SCHOOL_CARD_KEY,
  PORTAL_TEACHER_V2_KEY,
  COACH_DISAGREEMENT_CARD_KEY,
  PORTAL_TEACHER_HOME_CARD_KEY,
  PORTAL_TEACHER_HOME_ORDER_KEY,
  PORTAL_TEACHER_HOME_QUIZ_TILE_KEY,
  PORTAL_TEACHER_HOME_LOOK_KEY,
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
