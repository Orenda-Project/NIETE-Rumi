'use strict';
/**
 * The afternoon quiz offer, for a teacher whose 24-hour window has CLOSED.
 *
 * Reply buttons and free text cannot reach a number that has not written to the bot in a
 * day, so today that teacher is skipped (`window_closed`). A UTILITY template can: the draft
 * `teacher_quiz_reminder_v1` (infrastructure/templates/drafts/, en_US + ur) — no header, a
 * fixed body, one URL button on https://portal.niete.edu.pk/t/{{1}} whose {{1}} is a signed
 * portal link token (portal-link-token.js). Like the other drafts it is NOT submitted to any
 * WABA; until it is approved there, a real send comes back false and is skipped.
 *
 * BUILT SWITCHED OFF. `app_settings.lp_quiz_offer_window_template` names the template
 * (a string, e.g. "teacher_quiz_reminder_v1"). Absent, not a string, not a template name, or
 * unreadable = off. Read at most every 30 seconds; a failed read is not cached (fail closed).
 *
 * DRY RUN. `LP_QUIZ_OFFER_TEMPLATE_DRY_RUN=1` (worker env, read at call time) logs
 * `lp_quiz_offer.template_dry_run {template, lang}` and returns without calling Meta: the
 * sandbox proof for a template nobody has approved yet.
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

const SETTING = 'lp_quiz_offer_window_template';
const DRY_RUN_FLAG = 'LP_QUIZ_OFFER_TEMPLATE_DRY_RUN';
const TTL_MS = 30 * 1000;
/** Meta template names: lowercase letters, digits and underscores. */
const NAME_RE = /^[a-z0-9_]{1,512}$/;

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

/** The teacher's language as the code the template is approved under: 'en_US' or 'ur'. */
function templateLanguage(lang) {
  return lang === 'ur' ? 'ur' : 'en_US';
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
 * @param {{user: {id: string, phone_number: string, preferred_language?: string}, link: string|null}} args
 *   link: the signed portal link token for the button's {{1}}
 * @returns {Promise<{sent: 0|1, reason?: string, template?: string, lang?: string}>}
 */
async function sendWindowClosedTemplate({ user, link } = {}) {
  try {
    const name = await templateName();
    if (!name) return { sent: 0, reason: 'off' };
    if (!link) return { sent: 0, reason: 'no_link' };
    if (!user || !user.phone_number) return { sent: 0, reason: 'no_phone' };
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
  sendWindowClosedTemplate, templateName, buildTemplate, templateLanguage, SETTING, DRY_RUN_FLAG, _resetCache,
};
