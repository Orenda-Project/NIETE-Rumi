'use strict';
/**
 * The afternoon quiz offer, for a teacher whose 24-hour window has CLOSED.
 *
 * Reply buttons and free text cannot reach a number that has not written to the bot in a
 * day, so today that teacher is skipped (`window_closed`). A UTILITY template can: the draft
 * `teacher_quiz_reminder_v1` (infrastructure/templates/drafts/, en + ur, the codes every NIETE
 * draft uses) — no header, a fixed body, one URL button on
 * https://portal.niete.edu.pk/quiz/teacher/{{1}}: the quiz teacher home, where the quiz is. Its
 * {{1}} is a teacher-home token (first-touch/teacher-home.token.js, via 'reminder', 24 hours)
 * minted here from the teacher's id and language. Like the other drafts it is NOT submitted to
 * any WABA; until it is approved there, a real send comes back false and is skipped.
 *
 * BUILT SWITCHED OFF. `app_settings.lp_quiz_offer_window_template` names the template
 * (a string, e.g. "teacher_quiz_reminder_v1"). Absent, not a string, not a template name, or
 * unreadable = off. Read at most every 30 seconds; a failed read is not cached (fail closed).
 *
 * DRY RUN. `LP_QUIZ_OFFER_TEMPLATE_DRY_RUN=1` (worker env, read at call time) logs
 * `lp_quiz_offer.template_dry_run {template, lang}` and returns without calling Meta: the
 * sandbox proof for a template nobody has approved yet.
 *
 * STOP. The footer says "Reply STOP to stop reminders". A teacher who did (reminder-stop.js) has
 * a row in `teacher_reminder_optouts` and is never sent this template again, dry run included:
 * `{sent: 0, reason: 'opted_out'}`. An unreadable opt-out table counts as opted out.
 *
 * At most one billed message per teacher per day: the caller is the offer's send, which runs
 * once per teacher_nudges row, and that row is UNIQUE per teacher, day and kind.
 *
 * NOTHING HERE THROWS: a failure is a `{sent: 0, reason}`.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { flagOn } = require('./flags');
const { teacherLanguageFor } = require('../quiz/transcript-quiz-language');
const { signTeacherHome } = require('../first-touch/teacher-home.token');

const SETTING = 'lp_quiz_offer_window_template';
const DRY_RUN_FLAG = 'LP_QUIZ_OFFER_TEMPLATE_DRY_RUN';
const TTL_MS = 30 * 1000;
/** Meta template names: lowercase letters, digits and underscores. */
const NAME_RE = /^[a-z0-9_]{1,512}$/;
const OPTOUTS = 'teacher_reminder_optouts';
const OPTOUT_KIND = 'quiz_reminder_template';

let cache = null; // { at, name }

function _resetCache() { cache = null; }

/** The template name the switch holds, or null (off). */
async function templateName(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.name;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [SETTING]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === SETTING);
    const raw = row && typeof row.value === 'string' ? row.value.trim() : '';
    const name = NAME_RE.test(raw) ? raw : null;
    cache = { at: now, name };
    return name;
  } catch (err) {
    logToFile('⚠️ lp quiz offer: window template setting unreadable — off', { error: err.message }, 'warn');
    return null;
  }
}

/** The teacher's language as the code the template is approved under: 'en' or 'ur'. */
function templateLanguage(lang) {
  return lang === 'ur' ? 'ur' : 'en';
}

/** The button's {{1}}: a teacher-home token for this teacher, in their language. Null without a signing secret. */
function reminderLink({ user } = {}) {
  if (!user || !user.id) return null;
  const lang = teacherLanguageFor({ preferredLanguage: user.preferred_language }) === 'ur' ? 'ur' : 'en';
  return signTeacherHome({ uid: String(user.id), lang, via: 'reminder' });
}

/** True when the teacher said STOP to this template. A failed read is true too: never message someone who may have. */
async function isOptedOut(userId) {
  try {
    const { data, error } = await supabase.from(OPTOUTS).select('id')
      .eq('user_id', userId).eq('kind', OPTOUT_KIND).limit(1);
    if (error) throw new Error(error.message || 'opt-out read failed');
    return (data || []).length > 0;
  } catch (err) {
    logToFile('⚠️ lp quiz offer: reminder opt-out unreadable — treated as opted out', { error: err.message }, 'warn');
    return true;
  }
}

/** Records the STOP. A second STOP (unique violation) is success. → true when the row is there. */
async function optOut(userId) {
  if (!userId) return false;
  try {
    const { error } = await supabase.from(OPTOUTS).insert({ user_id: userId, kind: OPTOUT_KIND, source: 'stop_reply' });
    if (error && error.code !== '23505') throw new Error(error.message || 'opt-out insert failed');
    return true;
  } catch (err) {
    logToFile('❌ lp quiz offer: reminder opt-out not recorded', { error: err.message, userId }, 'error');
    return false;
  }
}

/**
 * `{ name, language, components }` for WhatsAppService.sendTemplate: the one URL-button
 * parameter (the link token). The words are the template's own.
 */
function buildTemplate({ name, lang, link }) {
  return {
    name,
    language: templateLanguage(lang),
    components: [
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(link) }] },
    ],
  };
}

/**
 * @param {{user: {id: string, phone_number: string, preferred_language?: string}}} args
 * @returns {Promise<{sent: 0|1, reason?: string, template?: string, lang?: string}>}
 */
async function sendWindowClosedTemplate({ user } = {}) {
  try {
    const name = await templateName();
    if (!name) return { sent: 0, reason: 'off' };
    if (!user || !user.phone_number) return { sent: 0, reason: 'no_phone' };
    if (await isOptedOut(user.id)) return { sent: 0, reason: 'opted_out' };
    const link = reminderLink({ user });
    if (!link) return { sent: 0, reason: 'no_link' };
    const lang = teacherLanguageFor({ preferredLanguage: user.preferred_language });
    const t = buildTemplate({ name, lang, link });
    if (flagOn(DRY_RUN_FLAG)) {
      logEvent('lp_quiz_offer.template_dry_run', { template: t.name, lang: t.language });
      return { sent: 0, reason: 'dry_run', template: t.name, lang: t.language };
    }
    const ok = await WhatsAppService.sendTemplate(user.phone_number, t.name, t.language, t.components);
    if (!ok) {
      logToFile('❌ lp quiz offer: window template refused (not approved on this WABA?)',
        { template: t.name, lang: t.language, userId: user.id }, 'error');
      return { sent: 0, reason: 'template_missing', template: t.name, lang: t.language };
    }
    logEvent('lp_quiz_offer.template_sent', { template: t.name, lang: t.language, userId: user.id });
    return { sent: 1, template: t.name, lang: t.language };
  } catch (err) {
    logToFile('❌ lp quiz offer: window template send failed', { error: err.message }, 'error');
    return { sent: 0, reason: 'error' };
  }
}

module.exports = {
  sendWindowClosedTemplate, templateName, buildTemplate, templateLanguage, reminderLink, isOptedOut, optOut,
  SETTING, DRY_RUN_FLAG, OPTOUTS, OPTOUT_KIND, _resetCache,
};
