'use strict';
/**
 * A portal area on the web, opened from WhatsApp — one switch and one send per area.
 *
 * The link is offered only when BOTH:
 *   - app_settings `<enabledKey>` is true, and
 *   - app_settings `<teachersKey>` is "all", or a list holding the teacher's
 *     user id (the pilot allow-list).
 * Everything else — the flag off, a missing row, a read error, a teacher not on
 * the list, no signing secret, a template that fails to send — means "use
 * today's path" (the area's Flow). FAIL CLOSED: the Flow is the kill switch.
 * (The same contract as the web quiz's switch, quiz/web-quiz-link.js.)
 *
 * The link goes out as the button of an approved template, not as a link in a
 * message: a template's URL button is what WhatsApp opens in its own browser, so
 * the teacher never leaves the chat. Every area's template has the same URL,
 * `<portal>/t/{{1}}`, fixed when it is approved; the button parameter is the
 * signed token, which names the area (portal-link-token.js). A WABA without the
 * template answers "template not found", sendTemplate returns false, and the
 * caller sends the Flow.
 *
 * Areas: training (training/training-web-link.js), lesson plans
 * (lesson-plans-web-link.js).
 */

const supabase = require('../config/supabase');
const WhatsAppService = require('./whatsapp.service');
const { logWarn } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { signPortalLink } = require('./portal-link-token');

/** The languages every area's template is approved in; English is the floor (CLAUDE.md rule 20). */
const TEMPLATE_LANGUAGES = Object.freeze(['en', 'ur']);
const TTL_MS = 30 * 1000;

function parse(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

function isTrue(value) {
  const v = parse(value);
  if (v === true) return true;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

function teacherAllowed(teachers, userId) {
  if (typeof teachers === 'string') return teachers.trim().toLowerCase() === 'all';
  if (Array.isArray(teachers)) return Boolean(userId) && teachers.map(String).includes(String(userId));
  return false;
}

/**
 * @param {object} cfg
 * @param {string} cfg.area            the portal area the link opens (portal-link-token AREAS)
 * @param {string} cfg.enabledKey      app_settings key of the on/off switch
 * @param {string} cfg.teachersKey     app_settings key of the allow-list
 * @param {string} cfg.defaultTemplate the approved template's name
 * @param {string} cfg.templateEnv     env var that overrides the template name per deployment
 */
function createWebLink({ area, enabledKey, teachersKey, defaultTemplate, templateEnv }) {
  let cache = null; // { at, enabled, teachers }

  async function readSettings(now = Date.now()) {
    if (cache && now - cache.at < TTL_MS) return cache;
    try {
      const { data, error } = await supabase
        .from('app_settings').select('key, value').in('key', [enabledKey, teachersKey]);
      if (error) throw new Error(error.message || 'app_settings read failed');
      const byKey = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
      cache = { at: now, enabled: isTrue(byKey[enabledKey]), teachers: parse(byKey[teachersKey]) };
      return cache;
    } catch (err) {
      // Fail closed, and do not cache the failure. A warning: teachers silently lose the web link.
      logWarn(`web link (${area}): settings lookup failed — sending the Flow`, { error: err.message });
      return { enabled: false, teachers: null };
    }
  }

  /** True when this teacher should get the web link instead of the Flow. Never throws. */
  async function on(userId) {
    const s = await readSettings();
    return s.enabled && teacherAllowed(s.teachers, userId);
  }

  /**
   * Send the area's template with this teacher's signed link on its button.
   * @returns {Promise<boolean>} true if WhatsApp accepted it; false means "send the Flow".
   */
  async function send(user, from, language = 'en') {
    const userId = user && user.id;
    const token = signPortalLink(userId, area);
    if (!token) {
      logWarn(`web link (${area}): no signing secret on this deployment — sending the Flow`, { userId });
      return false;
    }
    const lang = TEMPLATE_LANGUAGES.includes(language) ? language : 'en';
    const name = (process.env[templateEnv] || '').trim() || defaultTemplate;
    const components = [
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
    ];
    const sent = (await WhatsAppService.sendTemplate(from, name, lang, components)) === true;
    logEvent(sent ? 'web_link.sent' : 'web_link.failed', { area, userId, template: name, lang });
    // sendTemplate logs Meta's answer; this says what it cost: she got the Flow, not the link.
    if (!sent) logWarn(`web link (${area}): template send failed — sending the Flow`, { userId, template: name, lang });
    return sent;
  }

  return { on, send, _resetCache: () => { cache = null; } };
}

module.exports = { createWebLink };
