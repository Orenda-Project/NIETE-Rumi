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
});

const NOTICE_FEATURE = 'app_redirect_notice';
const QUIET_MS = 60 * 60 * 1000;

/**
 * The switches are read on EVERY open message (general_chat), so they are read
 * together, once, and held for a short while. 30 s is the longest a flip waits
 * to take effect on a running replica.
 */
const FLAG_TTL_MS = 30 * 1000;
let flagCache = null; // { at, enabled: Set<key> }

function isOn(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* keep the raw string */ }
  }
  if (v === true) return true;
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
  return false;
}

async function enabledFlags(now) {
  if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.enabled;
  const enabled = new Set();
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key,value')
      .in('key', Object.values(APP_REDIRECT_FLAGS));
    if (error) throw new Error(error.message || 'app_settings read failed');
    for (const row of data || []) if (isOn(row.value)) enabled.add(row.key);
  } catch (err) {
    // Fail closed, and do not cache the failure — the next message retries.
    logToFile('⚠️ App-redirect flag lookup failed — treating all as off', { error: err?.message });
    return enabled;
  }
  flagCache = { at: now, enabled };
  return enabled;
}

/** Is the redirect switch for `feature` on? */
async function isRedirectEnabled(feature, { now = Date.now() } = {}) {
  const key = APP_REDIRECT_FLAGS[feature];
  if (!key) throw new Error(`app-redirect: unknown feature "${feature}"`);
  return (await enabledFlags(now)).has(key);
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
    const { error } = await supabase
      .from('user_feature_first_use')
      .upsert({
        user_id: userId,
        feature: NOTICE_FEATURE,
        video_shown_at: new Date(now).toISOString(),
        intro_shown_count: (previous?.intro_shown_count || 0) + 1,
      }, { onConflict: 'user_id,feature' });
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
async function redirectIfFlagged(feature, { userId, from, language, reason = 'unspecified', now = Date.now() } = {}) {
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
    logToFile('❌ App redirect: notice send threw', { userId, feature, error: err?.message });
  }
  if (sent) {
    await recordNotice(userId, previous, now);
    logToFile('📲 App redirect: notice sent', { userId, feature, reason });
  } else {
    // Not recorded, so the next request tries again rather than going quiet.
    logToFile('❌ App redirect: notice not delivered', { userId, feature, reason });
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
