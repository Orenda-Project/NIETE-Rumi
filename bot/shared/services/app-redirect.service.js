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
 *   2. ON → the teacher gets ONE notice with the Play Store link, in her
 *      language, and the feature does not run.
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

/** The teacher app's own switch (dashboard/lib/feature-flags.js PORTAL_TEACHER_V2_KEY): true, or a list of users.id. */
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
      .in('key', [...Object.values(APP_REDIRECT_FLAGS), TEACHER_APP_KEY]);
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

/**
 * bd-fmf24g.35 — the one-tap link, for a pilot: `feature` has a v2 page, its switch holds a LIST that includes
 * this teacher, and she is on the teacher app (portal_teacher_v2 true, or a list holding her). The pilot gate
 * and the v2 flag must agree, so a teacher who would land on a page she cannot open never gets the link.
 */
async function isLinkPilot(feature, userId, now) {
  const key = APP_REDIRECT_FLAGS[feature];
  if (!key) throw new Error(`app-redirect: unknown feature "${feature}"`);
  if (!Object.prototype.hasOwnProperty.call(LANDINGS, feature)) return false;
  const values = await settingValues(now);
  if (!listHas(values.get(key), userId)) return false;
  const app = values.get(TEACHER_APP_KEY);
  return isOn(app) || listHas(app, userId);
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
async function sendAppLink(feature, { userId, from, language, reason }) {
  const base = String(portalUrl() || '').replace(/\/+$/, '');
  const token = base ? signAppLink(userId, feature) : null;
  if (!token) {
    logToFile('⚠️ App link: no portal url or signing key on this deployment — the flow runs', { userId, feature }, 'warn');
    return false;
  }
  const url = `${base}/go/${token}`;
  const body = resolveUx('appLinkBody', { language });
  const buttonText = resolveUx('appLinkButton', { language });
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

async function redirectIfFlagged(feature, { userId, from, language, reason = 'unspecified', now = Date.now() } = {}) {
  if (userId && from && await isLinkPilot(feature, userId, now)) {
    return sendAppLink(feature, { userId, from, language, reason });
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
  redirectIfFlagged,
  _resetForTests,
};
