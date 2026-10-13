'use strict';
/**
 * bd-qvevax.2 — "she read this plan in the app": tell the bot, which owns the survey.
 *
 * The lesson-plan survey ("was this plan useful?") is the bot's: it owns her WhatsApp window, the
 * two buttons and lp_feedback. The portal's whole part is to say that an open happened. After the
 * portal's own viewer served a plan whole and the open was RECORDED (niete_lp_opens), `afterOpen`
 * sends the bot that row's id over its internal API; the bot reads who and which plan from the row
 * and decides — the guards (one per plan, the 24-hour window, …) are all its own.
 *
 * Same transport as lp-catalogue.service.js, and for the same reason: bot/shared code resolves its
 * dependencies from bot/node_modules, so the portal asks over HTTP instead of requiring it.
 *
 * FIRE-AND-FORGET. The route does not await this, and it never throws: a bot that is down, slow or
 * not configured can never change or delay an open. A failure is said at error level (console.error
 * reaches the error monitor); a portal with no bot configured at all is a warning, because there
 * is nobody to ask.
 */

const axios = require('axios');

const TIMEOUT_MS = 10_000;
const PATH = '/api/internal/lp/open-survey';

/** Ask the bot for the survey for one recorded open. Resolves the bot's answer, or null on any failure. */
async function requestSurvey(openId) {
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey) {
    console.warn('⚠️ Lesson plan open survey not requested: MAIN_BOT_URL / INTERNAL_API_KEY not configured', { openId });
    return null;
  }
  try {
    const res = await axios.post(`${baseUrl}${PATH}`, { openId }, {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
    });
    return (res && res.data) || null;
  } catch (error) {
    console.error('❌ Lesson plan open survey not requested', { openId, error: error && error.message });
    return null;
  }
}

/**
 * The continuation of LpActivity.logOpen for a plan opened in the portal's viewer: only an open
 * that was actually STORED (not a repeat inside the de-dupe window, not a failed write) and whose
 * source is the viewer asks for a survey. Never throws.
 */
function afterOpen(result) {
  if (!result || result.recorded !== true || !result.id) return result;
  if (!result.open || result.open.source !== 'viewer') return result;
  requestSurvey(result.id);
  return result;
}

module.exports = { requestSurvey, afterOpen };
