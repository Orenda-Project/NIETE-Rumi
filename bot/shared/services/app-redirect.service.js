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
 *      today's WhatsApp flow. "teachers" on a feature with no page is OFF.
 *   2b. THE COACH APP LINK (bd-fmf24g.52), for /menu and /observe only (COACH_LINKS): a coach gets ONE message with a
 *      button that opens the COACH app signed in — /menu on coach Home, /observe on the coach app's Observe page —
 *      when ALL hold: users.role is coach; they are on the coach app (portal_coach_v2, the portal's rule: true or a
 *      list holding them); and they are on `coach_app_link`, a JSON LIST of users.id that is SEPARATE from
 *      portal_coach_v2 (more coaches on the coach app never changes WhatsApp by itself). Any other value of
 *      coach_app_link — true, "teachers", an object, no row — is OFF, and so is a failed read. It is asked before the
 *      teacher link and only decides for someone on the list; everyone else goes on exactly as below. Old code never
 *      reads coach_app_link, so a rollback reads it as OFF: no notice, no link, for anyone.
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
const InboundTyping = require('./inbound-typing');
const { signAppLink, LANDINGS } = require('./app-login-link');
const { portalUrl } = require('../config/branding');
const { isTeachersValue, isTeacherRole, isCoachRole } = require('./teacher-audience');
const { isRegistered } = require('../utils/registration-status');

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
  lesson_plan: ['appLinkBodyLessonPlan', 'appLinkButtonLessonPlan'],
  assessment_generator: ['appLinkBodyAssessment', 'appLinkButtonAssessment'],
  ai_coaching: ['appLinkBodyCoaching', 'appLinkButtonCoaching'],
  teacher_training: ['appLinkBodyTraining', 'appLinkButtonTraining'],
  attendance: ['appLinkBodyAttendance', 'appLinkButtonAttendance'],
  classes: ['appLinkBodyClasses', 'appLinkButtonClasses'],
});
const APP_LINK_GENERIC = APP_LINK_COPY.menu;

/**
 * bd-fmf24g.52 — the coach app link. Request → the coach-app page it lands on (app-login-link.js COACH_LANDINGS).
 * Only these two; any other request a coach makes is today's path.
 */
const COACH_LINKS = Object.freeze({ menu: 'coach_menu', observe: 'coach_observe' });
/** Who gets it: a JSON list of users.id, and nothing else. Not an app_redirect_* key — old code never reads it. */
const COACH_LINK_KEY = 'coach_app_link';
/** The coach app's own switch (dashboard/lib/feature-flags.js PORTAL_COACH_V2_KEY): true or a list of users.id. */
const COACH_APP_KEY = 'portal_coach_v2';

/** The teacher app's own switch (dashboard/lib/feature-flags.js PORTAL_TEACHER_V2_KEY): true, "teachers", or a list of users.id. */
const TEACHER_APP_KEY = 'portal_teacher_v2';

const NOTICE_FEATURE = 'app_redirect_notice';
const QUIET_MS = 60 * 60 * 1000;

/**
 * The switches are read on EVERY open message (general_chat), so they are read
 * together, once, and held for a short while. 30 s is the longest a flip waits
 * to take effect on a running replica.
 */
const FLAG_TTL_MS = 30 * 1000;
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
      .in('key', [...Object.values(APP_REDIRECT_FLAGS), TEACHER_APP_KEY, COACH_LINK_KEY, COACH_APP_KEY]);
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
 * bd-fmf24g.35/.46 — the one-tap link. For a feature with a v2 page:
 *   'link'      her switch is a LIST holding her (a pilot), or "teachers" and she is a registered teacher —
 *               and, either way, she is on the teacher app. The pilot gate and the v2 flag must agree, so a
 *               teacher who would land on a page she cannot open never gets the link.
 *   'whatsapp'  the switch is "teachers" but it does not cover her: today's flow, never the Play Store notice.
 *   null        not a link matter (off, a list without her, plain true): the notice path decides.
 * Her users row is read only when the answer depends on it, so general_chat (every open message) never reads it.
 */
async function linkVerdict(feature, userId, now) {
  const key = APP_REDIRECT_FLAGS[feature];
  if (!key) throw new Error(`app-redirect: unknown feature "${feature}"`);
  if (!Object.prototype.hasOwnProperty.call(LANDINGS, feature)) return null;
  const values = await settingValues(now);
  const flag = values.get(key);
  const pilot = listHas(flag, userId);
  if (!pilot && !isTeachersValue(flag)) return null;

  let read = null;
  const account = () => { if (!read) read = loadAccount(userId); return read; };
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
    logToFile('↩️ App link: not for her — the WhatsApp flow runs', { userId, feature, why });
    return 'whatsapp';
  } catch (err) {
    logToFile('⚠️ App link: her account could not be read — the WhatsApp flow runs', { userId, feature, error: err?.message }, 'warn');
    return pilot ? null : 'whatsapp';
  }
}

/**
 * bd-fmf24g.52 — the coach app link: the coach-app page to land on (COACH_LINKS), or null for today's path. The list
 * is checked first, so nobody off it pays a users read. On it: their role must be coach and they must be on the coach
 * app, as the portal reads portal_coach_v2 (isFlagEnabledForUser: true or a list holding them; "teachers" never
 * covers a coach). A failed read is null — today's flow, never silence.
 */
async function coachLink(feature, userId, now) {
  if (!Object.prototype.hasOwnProperty.call(COACH_LINKS, feature)) return null;
  const values = await settingValues(now);
  if (!listHas(values.get(COACH_LINK_KEY), userId)) return null;
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
async function redirectIfFlagged(feature, args = {}) {
  const handled = await decideRedirect(feature, args);
  // Meta bill cut FX3 (bd-w2daa.24): typing state only — what is sent is unchanged. Not
  // redirected → the feature will answer, so a quiet-hour-held "typing…" may show now.
  if (!handled) InboundTyping.replyComing();
  return handled;
}

/**
 * The pilot's answer: ONE message — a line and a button that opens the app signed in on the right page.
 * No quiet hour: she asked for this, and each ask (menu, then lessons) is a different page. Failing closed means
 * false — the caller runs the WhatsApp flow — never silence.
 */
async function sendAppLink(feature, { userId, from, language, reason }) {
  const base = String(portalUrl() || '').replace(/\/+$/, '');
  const token = base ? signAppLink(userId, feature) : null;
  if (!token) {
    logToFile('⚠️ App link: no portal url or signing key on this deployment — the flow runs', { userId, feature }, 'warn');
    return false;
  }
  const url = `${base}/go/${token}`;
  const [bodyKey, buttonKey] = Object.prototype.hasOwnProperty.call(APP_LINK_COPY, feature)
    ? APP_LINK_COPY[feature]
    : APP_LINK_GENERIC;
  const body = resolveUx(bodyKey, { language });
  const buttonText = resolveUx(buttonKey, { language });
  let sent = false;
  try {
    sent = await WhatsAppService.sendCtaUrl(from, { body, buttonText, url });
    // The button is the nicer form; if Meta refuses it the same link goes as plain text.
    if (!sent) sent = await WhatsAppService.sendMessage(from, `${body}\n${url}`);
  } catch (err) {
    logToFile('❌ App link: send threw', { userId, feature, error: err?.message }, 'error');
  }
  // The token is the credential: it is never logged.
  if (sent) logToFile('🔗 App link sent', { userId, feature, reason });
  else logToFile('❌ App link not delivered — the flow runs', { userId, feature, reason }, 'error');
  return Boolean(sent);
}

async function decideRedirect(feature, { userId, from, language, reason = 'unspecified', now = Date.now() } = {}) {
  if (userId && from) {
    const coach = await coachLink(feature, userId, now);
    if (coach) return sendAppLink(coach, { userId, from, language, reason });
    const verdict = await linkVerdict(feature, userId, now);
    if (verdict === 'link') return sendAppLink(feature, { userId, from, language, reason });
    if (verdict === 'whatsapp') return false;
  }
  if (!(await isRedirectEnabled(feature, { now }))) return false;
  if (!userId || !from) return false;

  const previous = await lastNotice(userId);
  const lastAt = previous?.video_shown_at ? Date.parse(previous.video_shown_at) : NaN;
  if (Number.isFinite(lastAt) && now - lastAt < QUIET_MS) {
    logToFile('📵 App redirect: inside the quiet hour, no reply', { userId, feature, reason });
    // FX3: this turn ends silent — no "typing…" for it, and her next turns in the hour hold
    // theirs until their door decides (the text handler reaches it ~2.7 s in, past the 2 s deadline).
    InboundTyping.nothingComing({ reason: 'app_redirect_quiet_hour' });
    InboundTyping.expectSilence(from, lastAt + QUIET_MS);
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
    InboundTyping.expectSilence(from, now + QUIET_MS);   // FX3: her next hour of redirects is silent
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
  redirectIfFlagged,
  _resetForTests,
};
