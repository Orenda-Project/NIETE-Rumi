'use strict';
/**
 * Training on the web — the link a teacher taps to open the portal's training
 * pages from WhatsApp.
 *
 * It is offered only when BOTH:
 *   - app_settings `web_training_enabled` is true, and
 *   - app_settings `web_training_teachers` is "all", or a list holding the
 *     teacher's user id (the pilot allow-list).
 * Everything else — the flag off, a missing row, a read error, a teacher not on
 * the list, no signing secret, a template that fails to send — is today's Flow.
 * FAIL CLOSED: the Flow is the kill switch. (The same contract as the web quiz's
 * switch, web-quiz-link.js.)
 *
 * The link goes out as the button of an approved template, not as a link in a
 * message: a template's URL button is what WhatsApp opens in its own browser,
 * so the teacher never leaves the chat. The template's URL is fixed when it is
 * approved — `<portal>/t/{{1}}` — and the button parameter is the signed token
 * (training-link-token.js). A WABA without the template answers "template not
 * found", sendTemplate returns false, and the caller sends the Flow.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logWarn } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { signTrainingLink } = require('./training-link-token');

const ENABLED_KEY = 'web_training_enabled';
const TEACHERS_KEY = 'web_training_teachers';
const DEFAULT_TEMPLATE = 'training_open_v1';
/** The languages the template is approved in; English is the floor (CLAUDE.md rule 20). */
const TEMPLATE_LANGUAGES = Object.freeze(['en', 'ur']);
const TTL_MS = 30 * 1000;

let cache = null; // { at, enabled, teachers }

function parse(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

function isTrue(value) {
  const v = parse(value);
  if (v === true) return true;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

async function readSettings(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase
      .from('app_settings').select('key, value').in('key', [ENABLED_KEY, TEACHERS_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const byKey = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: now, enabled: isTrue(byKey[ENABLED_KEY]), teachers: parse(byKey[TEACHERS_KEY]) };
    return cache;
  } catch (err) {
    // Fail closed, and do not cache the failure. A warning: teachers silently lose the web link.
    logWarn('web training: settings lookup failed — sending the Flow', { error: err.message });
    return { enabled: false, teachers: null };
  }
}

function teacherAllowed(teachers, userId) {
  if (typeof teachers === 'string') return teachers.trim().toLowerCase() === 'all';
  if (Array.isArray(teachers)) return Boolean(userId) && teachers.map(String).includes(String(userId));
  return false;
}

/** True when this teacher should get the web link instead of the Flow. Never throws. */
async function webTrainingOn(userId) {
  const s = await readSettings();
  return s.enabled && teacherAllowed(s.teachers, userId);
}

function templateName() {
  return (process.env.WEB_TRAINING_TEMPLATE || '').trim() || DEFAULT_TEMPLATE;
}

/**
 * Send the training template with this teacher's signed link on its button.
 * @returns {Promise<boolean>} true if WhatsApp accepted it; false means "send the Flow".
 */
async function sendTrainingLink(user, from, language = 'en') {
  const token = signTrainingLink(user && user.id);
  if (!token) {
    logWarn('web training: no signing secret on this deployment — sending the Flow', { userId: user && user.id });
    return false;
  }
  const lang = TEMPLATE_LANGUAGES.includes(language) ? language : 'en';
  const name = templateName();
  const components = [
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
  ];
  const sent = (await WhatsAppService.sendTemplate(from, name, lang, components)) === true;
  logEvent(sent ? 'training.web_link_sent' : 'training.web_link_failed', { userId: user.id, template: name, lang });
  // sendTemplate logs Meta's answer; this says what it cost: she got the Flow, not the link.
  if (!sent) logWarn('web training: template send failed — sending the Flow', { userId: user.id, template: name, lang });
  return sent;
}

module.exports = {
  webTrainingOn,
  sendTrainingLink,
  _resetCache: () => { cache = null; },
};
