'use strict';
/**
 * STOP to the window-closed quiz reminder template (window-closed-template.js), whose footer says
 * "Reply STOP to stop reminders".
 *
 * handleReminderStop({user, text}) claims the text — records the opt-out (teacher_reminder_optouts)
 * and replies one short line in the teacher's language — only when ALL of:
 *   1. the text is exactly STOP (any case, trimmed) or «روکیں» (no I/O before this check);
 *   2. the switch `app_settings.lp_quiz_offer_window_template` names a template (switch absent ⇒
 *      false, and the text goes exactly where it went before);
 *   3. the teacher got the template in the last 7 days: a teacher_nudges row of kind lp_quiz_offer,
 *      skipped as window_closed_template, with context.sent = 1 or context.reason = 'dry_run'.
 * The text handler calls it AFTER its quiz intercepts, so a STOP inside a quiz still ends the quiz.
 *
 * NOTHING HERE THROWS: any failure is false (not handled), and the text goes on as before.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { teacherLanguageFor } = require('../quiz/transcript-quiz-language');
const WindowTemplate = require('./window-closed-template');

const RECENT_DAYS = 7;
const STOP_WORDS = Object.freeze(['stop', 'روکیں']);
const CONFIRM = Object.freeze({
  en: 'You will not get quiz reminders like this again.',
  ur: 'آپ کو اب ایسی کوئز یاد دہانیاں نہیں ملیں گی۔',
});

function isStopText(text) {
  return typeof text === 'string' && STOP_WORDS.includes(text.trim().toLowerCase());
}

const gotTemplate = (r) => {
  const c = (r && r.context) || {};
  return c.skip_reason === 'window_closed_template' && (c.sent === 1 || c.reason === 'dry_run');
};

/** Did this teacher get the reminder template in the last 7 days? */
async function receivedRecently(userId, now) {
  const since = new Date(now - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('teacher_nudges').select('id, context, updated_at')
    .eq('user_id', userId).eq('kind', 'lp_quiz_offer').eq('status', 'skipped')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message || 'teacher_nudges read failed');
  return (data || []).some(gotTemplate);
}

/**
 * @param {{user: {id: string, phone_number?: string, preferred_language?: string}, text: string, to?: string, now?: number}} args
 *   to: where the reply goes (the inbound number); defaults to the user's phone
 * @returns {Promise<boolean>} true when the STOP was this template's and is handled
 */
async function handleReminderStop({ user, text, to, now = Date.now() } = {}) {
  if (!isStopText(text)) return false;
  if (!user || !user.id) return false;
  try {
    if (!(await WindowTemplate.templateName())) return false;
    if (!(await receivedRecently(user.id, now))) return false;
    if (!(await WindowTemplate.optOut(user.id))) return false;
    const lang = teacherLanguageFor({ preferredLanguage: user.preferred_language }) === 'ur' ? 'ur' : 'en';
    await WhatsAppService.sendMessage(to || user.phone_number, CONFIRM[lang]);
    logEvent('lp_quiz_offer.template_stop', { userId: user.id, lang });
    return true;
  } catch (err) {
    logToFile('⚠️ lp quiz offer: reminder STOP not handled', { error: err.message, userId: user.id }, 'warn');
    return false;
  }
}

module.exports = { handleReminderStop, isStopText, CONFIRM, RECENT_DAYS };
