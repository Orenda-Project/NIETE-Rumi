'use strict';
/**
 * The one door into the v8 lesson-plan catalogue.
 *
 * Every path that means "she wants a lesson plan" ends here — the bare
 * "lp" / "lesson plan" command, the LLM's lesson_plan intent (text and voice),
 * the /menu tap, and the Oxbridge picker's fallback button. They used to fan
 * out to three different endings: this Flow, a Gamma generation, and (after
 * bd-2540) a "not in our catalogue" reply. Production ran ~200 generations a
 * day (bd-jnfbd), so the day the not-in-catalogue reply reached main, those
 * teachers would have got nothing. Once generation is retired the catalogue
 * IS the answer, and one function owns the copy so the doors cannot drift
 * apart again (the bd-72dth lesson).
 *
 * Returns true when the Flow was sent. False means "no Flow provisioned, or
 * the send failed" — the caller decides what the fallback says.
 */

const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');

// NIETE is a flat en/ur deployment: every teacher-facing string exists in
// both, and fits its WhatsApp field cap measured in CODE POINTS (header 60,
// button 20). Pinned by tests/lp-v8/bd-hgwfo-gamma-door.test.js.
const COPY = {
  en: {
    header: '📘 Lesson Plans',
    body: "Pick your class, subject and chapter, then the day's lesson — the plan lands in your chat.",
    buttonText: 'Pick Class',
  },
  ur: {
    header: '📘 سبق کے منصوبے',
    body: 'اپنی جماعت، مضمون اور باب چنیں، پھر اُس دن کا سبق — منصوبہ آپ کی چیٹ میں آ جائے گا۔',
    buttonText: 'جماعت چنیں',
  },
};

/**
 * @param {object} args
 * @param {string} args.from      WhatsApp number to send to
 * @param {string} args.userId    users.id — leads the flow token so the endpoint can resolve her
 * @param {string} [args.language] 'en' | 'ur' (anything else falls back to English)
 * @param {string} [args.reason]  which door — for the log line only
 * @returns {Promise<boolean>}
 */
async function openLpBrowseFlow({ from, userId, language, reason = 'unspecified' }) {
  const flowId = process.env.PAKISTAN_LP_FLOW_ID || '';
  if (!flowId) {
    logToFile('LP browse: no PAKISTAN_LP_FLOW_ID provisioned, caller falls back', { userId, reason });
    return false;
  }
  const copy = String(language || '').toLowerCase().startsWith('ur') ? COPY.ur : COPY.en;
  try {
    const sent = await WhatsAppService.sendFlow(from, {
      flowId,
      ...copy,
      flowToken: `${userId}:pakistan-lp:${Date.now()}`,
    });
    if (sent) {
      logToFile('📘 LP browse Flow opened', { userId, reason });
      return true;
    }
    logToFile('LP browse: Flow send returned false, caller falls back', { userId, reason });
    return false;
  } catch (err) {
    logToFile('LP browse: Flow send threw, caller falls back', { userId, reason, error: err.message });
    return false;
  }
}

module.exports = { openLpBrowseFlow, COPY };
