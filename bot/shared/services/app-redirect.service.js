'use strict';
/**
 * App redirect — send a teacher to the NIETE app instead of serving a feature
 * on WhatsApp.
 *
 * Every feature a teacher can reach by a slash command, a typed trigger, a
 * quick-reply chip, a menu row, the intent classifier or a media upload has ONE
 * switch here. A switch is a row in `app_settings` (the table the assessment
 * flags already use — the bot and the portal share it, so a flip is one write,
 * not an env var on several Railway services).
 *
 * Contract:
 *   1. FAIL CLOSED. Absent row, malformed value, or a failed lookup mean OFF,
 *      and OFF is today's behaviour exactly. Redirecting must be deliberate.
 *   2. ON (true) → the teacher gets ONE notice with the Play Store link, in her
 *      language, and the feature does not run.
 *   2a. THE APP LINK (bd-fmf24g.35/.46), for the seven features with a teacher-app
 *      page (app-login-link.js LANDINGS): a LIST of users.id → those teachers (a
 *      pilot); "teachers" → every REGISTERED TEACHER (users.role teacher, and
 *      registration-status isRegistered). Either way only for a teacher on the
 *      teacher app (portal_teacher_v2, read with the portal's own rule), and the
 *      answer is ONE message with a button that opens the app signed in, on the
 *      feature's page — no Play Store notice, no quiet hour. Anyone a "teachers"
 *      switch does not cover (a principal, a coach, a number that never
 *      registered, a child's handset, an account that cannot be read) keeps
 *      today's WhatsApp flow — except a leader's lesson-plan request, which 2d
 *      may send to the app. "teachers" on a feature with no page is OFF.
 *   2b. THE COACH APP LINK (bd-fmf24g.52), for /menu and /observe only (COACH_LINKS): a coach gets ONE message with a
 *      button that opens the COACH app signed in — /menu on coach Home, /observe on the coach app's Observe page —
 *      when ALL hold: users.role is coach; they are on the coach app (portal_coach_v2, the portal's rule: true or a
 *      list holding them); and they are on `coach_app_link`, a JSON LIST of users.id that is SEPARATE from
 *      portal_coach_v2 (more coaches on the coach app never changes WhatsApp by itself). Any other value of
 *      coach_app_link — true, "teachers", an object, no row — is OFF, and so is a failed read. It is asked before the
 *      teacher link and only decides for someone on the list; everyone else goes on exactly as below. Old code never
 *      reads coach_app_link, so a rollback reads it as OFF: no notice, no link, for anyone.
 *   2c. COACH /training (bd-s42dye.3): a third COACH_LINKS request with its OWN switch, `coach_app_training` (see
 *      COACH_LINK_FLAGS), so it never moves /menu or /observe and they never move it. It takes `true` (every coach), "coaches"
 *      (every users.role = coach) or a JSON list of users.id; no row, any other value, or a failed read is OFF. The same
 *      two conditions as 2b still hold: role coach, on the coach app (portal_coach_v2). It lands the coach app's Training
 *      Library (/portal/coach/training) and only for the doors that mean "open training" (COACH_LINK_DOORS) — typed
 *      /training, the chip, the menu row and openTrainingFlow — never /certificates or an exam/capstone button. Old
 *      code never reads the key, so a rollback reads it as OFF.
 *   2d. LEADER LESSON PLANS (bd-zcgpkx, bd-a73p5m): a leader's lesson-plan request opens the Lesson Plans tab
 *      (/portal/teacher/lessons, target `leader_lessons`, app-login-link.js LEADER_LANDINGS) under its OWN switch,
 *      `leader_app_lesson_plan`: true (every leader), "coaches" (users.role coach only — in ICT a principal also
 *      teaches, and the WhatsApp catalogue holds their own class's plans), or a JSON list of users.id; no row, any
 *      other value, or a failed read is OFF. Only when users.role is in the leader family (observe-gate LEADER_ROLES)
 *      and they are not an analytics-only account (portal_analytics_only; the portal sends those to analytics). Only
 *      from LEADER_LINK_DOORS: the plain "open lesson plans" doors and, since bd-l6424d, the doors where a leader names
 *      a topic, typed or spoken (the operator, 23 Oct: "yes to topic requests too"; the tab has every plan, and no
 *      path carries the topic into the app). The operator, 19 Oct: "Send leaders straight into the app, the same as
 *      teachers"; until 23 Oct it opened Send
 *      a lesson plan (the FLN builder) and asked for FLN share. The operator, 23 Oct: "A coach who types 'lesson plan'
 *      on WhatsApp still gets 'Send a lesson plan', not the new tab -- they can get new tab". The tab (bd-4joiqz)
 *      needs no FLN share. The builder (/portal/fln/send) is not linked from the tab (LeaderHome and the coach
 *      Training Library link it); inside the tab a leader can send only from a Reading Hour / Numeracy plan's own page
 *      ("Send to teacher"), which shows only with FLN share. Old code never reads the key: a rollback is OFF.
 *   3. QUIET HOUR, per teacher, shared by every switch. A second redirect
 *      inside 60 minutes sends NOTHING — and still reports "handled", so the
 *      caller does not fall through to the feature or to AI chat. After the
 *      hour the next redirect sends the notice again and restarts the clock.
 *
 * The quiet-hour clock is a row in `user_feature_first_use` with
 * feature = 'app_redirect_notice': `video_shown_at` is when the notice was last
 * sent (the table's "intro shown" timestamp — the notice is the app's intro) and
 * `intro_shown_count` how many times. The table already carries the
 * (user_id, feature) unique key this upserts on, so no schema change.
 */

const supabase = require('../config/supabase');
const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');
const { appStoreUrl } = require('../config/branding');
const { signAppLink, LANDINGS } = require('./app-login-link');
const { portalUrl } = require('../config/branding');
const { isTeachersValue, isTeacherRole, isCoachRole } = require('./teacher-audience');
const { isRegistered } = require('../utils/registration-status');
const { newJourneyId } = require('./app-journey');
const { LEADER_ROLES } = require('./observe/observe-gate');

/** feature → app_settings key. The keys are the contract with whoever flips them. */
const APP_REDIRECT_FLAGS = Object.freeze({
  teacher_training: 'app_redirect_teacher_training',
  lesson_plan: 'app_redirect_lesson_plan',
  assessment_generator: 'app_redirect_assessment_generator',
  ai_coaching: 'app_redirect_ai_coaching',
  observe: 'app_redirect_observe',
  remark: 'app_redirect_remark',
  reading_test: 'app_redirect_reading_test',
  quiz: 'app_redirect_quiz',
  video: 'app_redirect_video',
  homework: 'app_redirect_homework',
  exam_checker: 'app_redirect_exam_checker',
  attendance: 'app_redirect_attendance',
  classes: 'app_redirect_classes',
  presentation: 'app_redirect_presentation',
  general_chat: 'app_redirect_general_chat',
  menu: 'app_redirect_menu', // bd-fmf24g.35 — /menu; only ever a pilot link (no Play Store notice exists for it)
});

/**
 * bd-fmf24g.42 — the app link's words, per feature: [body key, button key] in ux-strings. One short line per command,
 * nothing else. /menu IS the generic line; a linkable feature (LANDINGS) missing here gets it too, never older copy.
 */
const APP_LINK_COPY = Object.freeze({
  menu: ['appLinkBody', 'appLinkButton'],
  coach_menu: ['appLinkBodyCoachHome', 'appLinkButtonCoachHome'], // bd-fmf24g.52
  coach_observe: ['appLinkBodyCoachObserve', 'appLinkButtonCoachObserve'], // bd-fmf24g.52
  coach_training: ['appLinkBodyCoachTraining', 'appLinkButtonCoachTraining'], // bd-s42dye.3
  leader_lessons: ['appLinkBodyLeaderLessonPlan', 'appLinkButtonLeaderLessonPlan'], // bd-zcgpkx, bd-a73p5m — the tab
  lesson_plan: ['appLinkBodyLessonPlan', 'appLinkButtonLessonPlan'],
  assessment_generator: ['appLinkBodyAssessment', 'appLinkButtonAssessment'],
  ai_coaching: ['appLinkBodyCoaching', 'appLinkButtonCoaching'],
  ai_coaching_recording: ['appLinkBodyCoachingSaved', 'appLinkButtonCoachingSaved'], // bd-c5reix — her recording kept
  teacher_training: ['appLinkBodyTraining', 'appLinkButtonTraining'],
  attendance: ['appLinkBodyAttendance', 'appLinkButtonAttendance'],
  classes: ['appLinkBodyClasses', 'appLinkButtonClasses'],
});
const APP_LINK_GENERIC = APP_LINK_COPY.menu;

/**
 * bd-4r3rei — the funnel's bot rows. Each is a semantic event (the `event` column) carrying the journey id (a core
 * Axiom column, structured-logger AXIOM_CORE_FIELDS), so one query joins them to the portal's page rows:
 *   app_funnel.command      she asked, and the app link is in play for her: feature, door, verdict (link | whatsapp), why
 *   app_funnel.link_sent    the link went out: via cta_url (the button) or text (Meta refused the button)
 *   app_funnel.link_failed  it did not, and why — she is on the WhatsApp flow instead
 * No phone, no name, no token: ids only (the user id is the key the portal logs too). Never throws — a log line must
 * not decide what a teacher receives.
 */
function funnelEvent(name, props) {
  try { logToFile(name, { event: name, ...props }); } catch (_) { /* logging never decides the answer */ }
}

/** Mint the journey and log what she asked for. `verdict` is 'link' (a link goes out) or 'whatsapp' (she keeps the flow). */
function startJourney({ userId, feature, door, verdict, why, audience = 'teacher' }) {
  const journeyId = newJourneyId();
  funnelEvent('app_funnel.command', { journeyId, userId, feature, door, verdict, ...(why ? { why } : {}), audience });
  return { journeyId, feature, door, userId, audience };
}

/**
 * bd-fmf24g.52 — the coach app link. Request → the coach-app page it lands on (app-login-link.js COACH_LANDINGS).
 * Only these two; any other request a coach makes is today's path.
 */
const COACH_LINKS = Object.freeze({ menu: 'coach_menu', observe: 'coach_observe', teacher_training: 'coach_training' });
/** Who gets it: a JSON list of users.id, and nothing else. Not an app_redirect_* key — old code never reads it. */
const COACH_LINK_KEY = 'coach_app_link';
/**
 * bd-s42dye.3 — which switch each coach request rides. /menu and /observe stay on `coach_app_link` (a LIST only);
 * /training has its own, `coach_app_training`, so the three never move each other. Not app_redirect_* keys.
 */
const COACH_TRAINING_KEY = 'coach_app_training';
const COACH_LINK_FLAGS = Object.freeze({ menu: COACH_LINK_KEY, observe: COACH_LINK_KEY, teacher_training: COACH_TRAINING_KEY });
/** The requests whose switch also takes `true` and "coaches" (everyone), not only a list. */
const COACH_LINK_EVERYONE = Object.freeze(['teacher_training']);
/**
 * A request listed here goes to the coach app only from these doors (the `reason` the caller gives). /training reaches
 * teacher_training from /certificates and the exam and capstone buttons too; those are not "open training" and keep
 * their WhatsApp behaviour. A request not listed has no door restriction (menu, observe: as before).
 */
const COACH_LINK_DOORS = Object.freeze({ teacher_training: ['command', 'chip', 'menu', 'training_door'] });
/** The coach app's own switch (dashboard/lib/feature-flags.js PORTAL_COACH_V2_KEY): true or a list of users.id. */
const COACH_APP_KEY = 'portal_coach_v2';

/** The teacher app's own switch (dashboard/lib/feature-flags.js PORTAL_TEACHER_V2_KEY): true, "teachers", or a list of users.id. */
const TEACHER_APP_KEY = 'portal_teacher_v2';

/** bd-a73p5m — request → the page a leader's link lands on (app-login-link.js LEADER_LANDINGS), behind LEADER_LP_KEY. */
const LEADER_LINKS = Object.freeze({ lesson_plan: 'leader_lessons' });
const LEADER_LP_KEY = 'leader_app_lesson_plan';
/** The doors that mean "open lesson plans": typed "lesson plan", the chip, the menu row and its number. */
const LEADER_PLAIN_DOORS = Object.freeze(['bare_command', 'chip', 'menu', 'menu_choice']);
/**
 * bd-l6424d — the doors where a leader NAMES A TOPIC, which open the same tab (the operator, 23 Oct: "yes to topic
 * requests too"). Typed: the lesson_plan intent (`intent`, before the catalogue), then `lesson_plan_intent` (the
 * catalogue door inside handleLessonPlanRequest, which that intent, a topic typed after the menu asked for one, and
 * the Oxbridge picker's "Generate" tap reach). Spoken: `voice_intent` (before the spoken answer), then
 * `voice_lesson_plan_intent`. (Sandbox also has the lesson-plan worker's in-flight rescue, `cutover_inflight_gamma`;
 * this branch has no such rescue, so it is not listed.) Each path asks its first door first and returns once a link is
 * sent, so a leader receives the tab at most once. The later door decides only when the first did not send: if the
 * switch said no, it says no again and the catalogue goes; if the switch said yes but Meta refused the button and its
 * plain-text link, it tries the link once more (a second app_funnel.command and link_failed row) before the catalogue.
 * Under the cutover gate handleLessonPlanRequest sends the "lessons come from your textbook" line BEFORE it asks, so the
 * two doors that reach it directly (the menu's topic prompt, the Oxbridge tap) answer with that line and then the tab,
 * as they do for a covered teacher. `ft_fallback` (the first-touch "Lesson plan" button) and `pic_lp_book_page` (a
 * textbook-page photo) are in neither list: a covered coach there keeps today's path.
 */
const LEADER_TOPIC_DOORS = Object.freeze(['intent', 'lesson_plan_intent', 'voice_intent', 'voice_lesson_plan_intent']);
const LEADER_LINK_DOORS = Object.freeze([...LEADER_PLAIN_DOORS, ...LEADER_TOPIC_DOORS]);
/** dashboard/lib/feature-flags.js PORTAL_ANALYTICS_ONLY_KEY: a JSON list of users.id the portal routes to analytics. */
const ANALYTICS_ONLY_KEY = 'portal_analytics_only';

const NOTICE_FEATURE = 'app_redirect_notice';
const QUIET_MS = 60 * 60 * 1000;

/**
 * The switches are read on EVERY open message (general_chat), so they are read
 * together, once, and held for a short while. 30 s is the longest a flip waits
 * to take effect on a running replica.
 */
// APP_SETTINGS_FLAG_TTL_MS: the E2E mock lane sets 1000 so a flipped switch is seen in a second instead of
// 31 (bd-k5gjje); one value for every switch cache (config/app-settings-ttl.js, bd-0vaqcg).
const FLAG_TTL_MS = require('../config/app-settings-ttl').APP_SETTINGS_FLAG_TTL_MS;
let flagCache = null; // { at, values: Map<key, raw value> }

function parseValue(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* keep the raw string */ }
  }
  return v;
}

function isOn(value) {
  const v = parseValue(value);
  if (v === true) return true;
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
  return false;
}

/** "coaches" — the value that means every users.role = coach (bd-s42dye.3). Trimmed and case-folded, as "teachers" is. */
function isCoachesValue(value) {
  const v = parseValue(value);
  return typeof v === 'string' && v.trim().toLowerCase() === 'coaches';
}

/** A pilot list: a JSON array of users.id strings holding this teacher (bd-fmf24g.35). Anything else is not a pilot. */
function listHas(value, userId) {
  const v = parseValue(value);
  return Array.isArray(v) && Boolean(userId) && v.some((id) => typeof id === 'string' && id === String(userId));
}

/** key → parsed app_settings value, for every switch plus the teacher-app flag. Empty on a failed read (fail closed). */
async function settingValues(now) {
  if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.values;
  const values = new Map();
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key,value')
      .in('key', [...Object.values(APP_REDIRECT_FLAGS), TEACHER_APP_KEY, COACH_LINK_KEY, COACH_TRAINING_KEY, COACH_APP_KEY,
        LEADER_LP_KEY, ANALYTICS_ONLY_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    for (const row of data || []) values.set(row.key, row.value);
  } catch (err) {
    // Fail closed, and do not cache the failure — the next message retries.
    logToFile('⚠️ App-redirect flag lookup failed — treating all as off', { error: err?.message });
    return values;
  }
  flagCache = { at: now, values };
  return values;
}

/** Is the redirect switch for `feature` on for everyone (the Play Store notice)? A pilot list is NOT this. */
async function isRedirectEnabled(feature, { now = Date.now() } = {}) {
  const key = APP_REDIRECT_FLAGS[feature];
  if (!key) throw new Error(`app-redirect: unknown feature "${feature}"`);
  return isOn((await settingValues(now)).get(key));
}

/** Her users row — only the columns the link decision reads. Throws on a failed read; null when there is none. */
async function loadAccount(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, role, name, registration_completed, registration_state')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message || 'users read failed');
  return data || null;
}

/**
 * Is she on the teacher app? portal_teacher_v2 read with the portal's rule (dashboard/lib/feature-flags.js
 * isFlagEnabledForUser): a list holding her, true, or "teachers" and her role is teacher. `account` is read only
 * for "teachers".
 */
async function onTeacherApp(appValue, userId, account) {
  if (listHas(appValue, userId) || isOn(appValue)) return true;
  if (!isTeachersValue(appValue)) return false;
  const a = await account();
  return Boolean(a) && isTeacherRole(a.role);
}

/**
 * bd-6clakk Task 9 — is this user on the teacher app (the portal's rule)? The gate for an offer that lands in the app
 * outside a redirect (the assessment door's "paper on topics"): off the app the link would land on the old dashboard.
 * Fails closed: an unreadable switch or account is false.
 */
async function isOnTeacherApp(userId) {
  try {
    const values = await settingValues(Date.now());
    let read = null;
    return await onTeacherApp(values.get(TEACHER_APP_KEY), userId, () => { if (!read) read = loadAccount(userId); return read; });
  } catch (err) {
    logToFile('⚠️ teacher-app check failed — treated as off', { userId, error: err?.message }, 'warn');
    return false;
  }
}

/**
 * bd-fmf24g.35/.46 — the one-tap link. For a feature with a v2 page:
 *   'link'      her switch is a LIST holding her (a pilot), or "teachers" and she is a registered teacher —
 *               and, either way, she is on the teacher app. The pilot gate and the v2 flag must agree, so a
 *               teacher who would land on a page she cannot open never gets the link.
 *   'whatsapp'  the switch is "teachers" but it does not cover her: today's flow, never the Play Store notice.
 *   null        not a link matter (off, a list without her, plain true): the notice path decides.
 * Her users row is read only when the answer depends on it, so general_chat (every open message) never reads it.
 * `note.why` is filled with the reason when the answer is 'whatsapp' (the funnel's command row says why).
 */
async function linkVerdict(feature, userId, now, note = {}, sharedAccount = null) {
  const key = APP_REDIRECT_FLAGS[feature];
  if (!key) throw new Error(`app-redirect: unknown feature "${feature}"`);
  if (!Object.prototype.hasOwnProperty.call(LANDINGS, feature)) return null;
  const values = await settingValues(now);
  const flag = values.get(key);
  const pilot = listHas(flag, userId);
  if (!pilot && !isTeachersValue(flag)) return null;

  let read = null;
  const account = sharedAccount || (() => { if (!read) read = loadAccount(userId); return read; });
  const app = values.get(TEACHER_APP_KEY);
  try {
    if (pilot) return (await onTeacherApp(app, userId, account)) ? 'link' : null;
    const a = await account();
    let why = null;
    if (!a) why = 'no_account';
    else if (!isTeacherRole(a.role)) why = 'not_a_teacher';
    else if (!isRegistered(a)) why = 'not_registered';
    else if (!(await onTeacherApp(app, userId, account))) why = 'not_on_teacher_app';
    if (!why) return 'link';
    note.why = why;
    logToFile('↩️ App link: not for her — the WhatsApp flow runs', { userId, feature, why });
    return 'whatsapp';
  } catch (err) {
    logToFile('⚠️ App link: her account could not be read — the WhatsApp flow runs', { userId, feature, error: err?.message }, 'warn');
    note.why = 'account_unreadable';
    return pilot ? null : 'whatsapp';
  }
}

/**
 * bd-fmf24g.52 — the coach app link: the coach-app page to land on (COACH_LINKS), or null for today's path. The list
 * is checked first, so nobody off it pays a users read. On it: their role must be coach and they must be on the coach
 * app, as the portal reads portal_coach_v2 (isFlagEnabledForUser: true or a list holding them; "teachers" never
 * covers a coach). A failed read is null — today's flow, never silence.
 * bd-s42dye.3: each request has its own switch (COACH_LINK_FLAGS), and /training's also takes true and "coaches"
 * (COACH_LINK_EVERYONE) and only from its own doors (COACH_LINK_DOORS). Those are still the same two role/app checks.
 */
async function coachLink(feature, userId, now, reason) {
  if (!Object.prototype.hasOwnProperty.call(COACH_LINKS, feature)) return null;
  const doors = COACH_LINK_DOORS[feature];
  if (doors && !doors.includes(reason)) return null;
  const values = await settingValues(now);
  const flag = values.get(COACH_LINK_FLAGS[feature]);
  const everyone = COACH_LINK_EVERYONE.includes(feature) && (isOn(flag) || isCoachesValue(flag));
  if (!everyone && !listHas(flag, userId)) return null;
  let why = null;
  try {
    const a = await loadAccount(userId);
    const app = values.get(COACH_APP_KEY);
    if (!a) why = 'no_account';
    else if (!isCoachRole(a.role)) why = 'not_a_coach';
    else if (!(listHas(app, userId) || isOn(app))) why = 'not_on_coach_app';
  } catch (err) {
    logToFile('⚠️ Coach app link: the account could not be read — the WhatsApp flow runs', { userId, feature, error: err?.message }, 'warn');
    return null;
  }
  if (why) {
    logToFile('↩️ Coach app link: not for this user — the WhatsApp flow runs', { userId, feature, why });
    return null;
  }
  return COACH_LINKS[feature];
}

/** Is this users.role in the leader family? Trim + lowercase, as the portal's isLeaderRole does. */
function isLeaderRole(role) {
  return typeof role === 'string' && LEADER_ROLES.includes(role.trim().toLowerCase());
}

/**
 * bd-zcgpkx — the leader link: the page to land on (LEADER_LINKS), or null for the next path. Asked only from
 * LEADER_LINK_DOORS and only when the switch covers them, so nobody pays a users read while it is off. `account` is
 * the caller's memoised users read, shared with the teacher link. Someone who is not a leader (or, on "coaches", not a
 * coach) is not this link's audience and goes on, unlogged, to the teacher link; an analytics-only account or an
 * unreadable account keeps today's flow. bd-a73p5m: FLN share is not asked — the Lesson Plans tab does not need it.
 */
async function leaderLink(feature, userId, now, reason, account) {
  if (!Object.prototype.hasOwnProperty.call(LEADER_LINKS, feature)) return null;
  if (!LEADER_LINK_DOORS.includes(reason)) return null;
  const values = await settingValues(now);
  const flag = values.get(LEADER_LP_KEY);
  const coachesOnly = isCoachesValue(flag);
  if (!isOn(flag) && !coachesOnly && !listHas(flag, userId)) return null;
  let a;
  try {
    a = await account();
  } catch (err) {
    logToFile('⚠️ Leader app link: the account could not be read — the WhatsApp flow runs', { userId, feature, error: err?.message }, 'warn');
    return null;
  }
  if (!a || !isLeaderRole(a.role) || (coachesOnly && !isCoachRole(a.role))) return null;
  if (listHas(values.get(ANALYTICS_ONLY_KEY), userId)) {
    logToFile('↩️ Leader app link: not for this user — the WhatsApp flow runs', { userId, feature, why: 'analytics_only' });
    return null;
  }
  return LEADER_LINKS[feature];
}

async function lastNotice(userId) {
  try {
    const { data, error } = await supabase
      .from('user_feature_first_use')
      .select('video_shown_at,intro_shown_count')
      .eq('user_id', userId)
      .eq('feature', NOTICE_FEATURE)
      .maybeSingle();
    if (error) throw new Error(error.message || 'user_feature_first_use read failed');
    return data || null;
  } catch (err) {
    // Unknown → send. A duplicate notice is a smaller harm than a teacher who
    // is silently ignored because the clock could not be read.
    logToFile('⚠️ App-redirect quiet-hour lookup failed — sending', { userId, error: err?.message });
    return null;
  }
}

async function recordNotice(userId, previous, now) {
  try {
    // Built first, then upserted — the same shape feature-intro.service writes
    // this table with. intro_shown_count is added by an ALTER in the schema.
    const fields = {
      user_id: userId,
      feature: NOTICE_FEATURE,
      video_shown_at: new Date(now).toISOString(),
    };
    fields.intro_shown_count = (previous?.intro_shown_count || 0) + 1;
    const { error } = await supabase
      .from('user_feature_first_use')
      .upsert(fields, {
        onConflict: 'user_id,feature'
      });
    if (error) throw new Error(error.message || 'upsert failed');
  } catch (err) {
    logToFile('⚠️ App-redirect notice not recorded — the quiet hour will not hold', { userId, error: err?.message });
  }
}

/**
 * If `feature`'s switch is on, redirect this teacher to the app and report it
 * handled. The caller returns on `true` and runs the feature on `false`.
 *
 * @param {string} feature  a key of APP_REDIRECT_FLAGS
 * @param {object} args
 * @param {string} args.userId   users.id — no id (an unregistered sender) is never redirected
 * @param {string} args.from     WhatsApp number
 * @param {string} [args.language] her resolved language
 * @param {string} [args.reason] which door — log line only
 * @param {number} [args.now]    clock, for tests
 * @returns {Promise<boolean>} true = handled (notice sent, or silenced by the quiet hour)
 */
/**
 * The pilot's answer: ONE message — a line and a button that opens the app signed in on the right page.
 * No quiet hour: she asked for this, and each ask (menu, then lessons) is a different page. Failing closed means
 * false — the caller runs the WhatsApp flow — never silence.
 */
async function sendAppLink(feature, { userId, from, language, reason, journey, copy = null }) {
  const base = String(portalUrl() || '').replace(/\/+$/, '');
  const token = base ? signAppLink(userId, feature, journey && journey.journeyId) : null;
  // The funnel names the request she made (menu, observe…), not the page the token lands on (coach_menu…).
  const fx = { journeyId: journey && journey.journeyId, userId, feature: (journey && journey.feature) || feature, door: reason };
  // bd-s42dye.3 / bd-zcgpkx — a coach's or a leader's funnel rows say so; a teacher's carry no audience, as before.
  if (journey && (journey.audience === 'coach' || journey.audience === 'leader')) fx.audience = journey.audience;
  if (!token) {
    logToFile('⚠️ App link: no portal url or signing key on this deployment — the flow runs', { userId, feature }, 'warn');
    funnelEvent('app_funnel.link_failed', { ...fx, reason: 'no_portal_or_key' });
    return false;
  }
  const url = `${base}/go/${token}`;
  // bd-c5reix: `copy` (from onLink) names another pair of catalog keys for this one link.
  const [bodyKey, buttonKey] = copy || (Object.prototype.hasOwnProperty.call(APP_LINK_COPY, feature)
    ? APP_LINK_COPY[feature]
    : APP_LINK_GENERIC);
  const body = resolveUx(bodyKey, { language });
  const buttonText = resolveUx(buttonKey, { language });
  let sent = false;
  let via = 'cta_url';
  let threw = false;
  try {
    sent = await WhatsAppService.sendCtaUrl(from, { body, buttonText, url });
    // The button is the nicer form; if Meta refuses it the same link goes as plain text.
    if (!sent) { via = 'text'; sent = await WhatsAppService.sendMessage(from, `${body}\n${url}`); }
  } catch (err) {
    threw = true;
    logToFile('❌ App link: send threw', { userId, feature, error: err?.message }, 'error');
  }
  // The token is the credential: it is never logged.
  if (sent) {
    logToFile('🔗 App link sent', { userId, feature, reason, ...(fx.audience ? { audience: fx.audience } : {}) });
    funnelEvent('app_funnel.link_sent', { ...fx, via });
  } else {
    logToFile('❌ App link not delivered — the flow runs', { userId, feature, reason, ...(fx.audience ? { audience: fx.audience } : {}) }, 'error');
    funnelEvent('app_funnel.link_failed', { ...fx, reason: threw ? 'send_threw' : 'send_refused' });
  }
  return Boolean(sent);
}

/**
 * bd-c5reix — what a caller's onLink may change about the teacher link, checked: a teacher-app landing (LANDINGS)
 * and a pair of catalog keys for the line and the button. Anything else — a throw, null, a landing that is not one,
 * keys that are not a pair of strings — is today's link. The classroom-recording door saves her recording here.
 */
async function shapeLink(onLink, journey) {
  if (typeof onLink !== 'function') return {};
  let shape = null;
  try {
    shape = await onLink({ journey });
  } catch (err) {
    logToFile('⚠️ App link: the caller\'s onLink threw — today\'s link goes', { feature: journey && journey.feature, error: err?.message }, 'warn');
    return {};
  }
  if (!shape || typeof shape !== 'object') return {};
  const out = {};
  if (typeof shape.landing === 'string' && Object.prototype.hasOwnProperty.call(LANDINGS, shape.landing)) out.landing = shape.landing;
  if (Array.isArray(shape.copy) && shape.copy.length === 2 && shape.copy.every((k) => typeof k === 'string' && k)) out.copy = shape.copy;
  return out;
}

async function redirectIfFlagged(feature, { userId, from, language, reason = 'unspecified', now = Date.now(), onLink = null } = {}) {
  if (userId && from) {
    const coach = await coachLink(feature, userId, now, reason);
    if (coach) {
      const journey = startJourney({ userId, feature, door: reason, verdict: 'link', audience: 'coach' });
      return sendAppLink(coach, { userId, from, language, reason, journey });
    }
    // One users read for both questions (bd-zcgpkx): the leader link and the teacher link share it.
    let read = null;
    const account = () => { if (!read) read = loadAccount(userId); return read; };
    const leader = await leaderLink(feature, userId, now, reason, account);
    if (leader) {
      const journey = startJourney({ userId, feature, door: reason, verdict: 'link', audience: 'leader' });
      return sendAppLink(leader, { userId, from, language, reason, journey });
    }
    const note = {};
    const verdict = await linkVerdict(feature, userId, now, note, account);
    if (verdict === 'link') {
      const journey = startJourney({ userId, feature, door: reason, verdict: 'link' });
      // bd-c5reix: the caller's work between deciding and sending (onLink), on this branch only.
      const shape = await shapeLink(onLink, journey);
      return sendAppLink(shape.landing || feature, { userId, from, language, reason, journey, copy: shape.copy || null });
    }
    if (verdict === 'whatsapp') {
      startJourney({ userId, feature, door: reason, verdict: 'whatsapp', why: note.why });
      return false;
    }
  }
  if (!(await isRedirectEnabled(feature, { now }))) return false;
  if (!userId || !from) return false;

  const previous = await lastNotice(userId);
  const lastAt = previous?.video_shown_at ? Date.parse(previous.video_shown_at) : NaN;
  if (Number.isFinite(lastAt) && now - lastAt < QUIET_MS) {
    logToFile('📵 App redirect: inside the quiet hour, no reply', { userId, feature, reason });
    return true;
  }

  let sent = false;
  try {
    sent = await WhatsAppService.sendMessage(from, resolveUx('appRedirectNotice', {
      language,
      params: { url: appStoreUrl() },
    }));
  } catch (err) {
    logToFile('❌ App redirect: notice send threw', { userId, feature, error: err?.message }, 'error');
  }
  if (sent) {
    await recordNotice(userId, previous, now);
    logToFile('📲 App redirect: notice sent', { userId, feature, reason });
  } else {
    // Not recorded, so the next request tries again rather than going quiet.
    logToFile('❌ App redirect: notice not delivered', { userId, feature, reason }, 'error');
  }
  return true;
}

function _resetForTests() { flagCache = null; }

module.exports = {
  APP_REDIRECT_FLAGS,
  NOTICE_FEATURE,
  QUIET_MS,
  FLAG_TTL_MS,
  isRedirectEnabled,
  isOnTeacherApp,
  redirectIfFlagged,
  _resetForTests,
};
