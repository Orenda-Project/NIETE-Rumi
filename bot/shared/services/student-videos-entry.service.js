'use strict';
/**
 * The one door into the pre-made student video library.
 *
 * Presence-gated on STUDENT_VIDEOS_FLOW_ID, read at call time. When it is unset
 * this returns false and says NOTHING: `/video` then falls through to runtime
 * video generation, and a refusal here would leave the teacher with two replies
 * to one command. The caller owns the fallback — same contract as
 * `lp-browse-entry.openLpBrowseFlow`.
 */

const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');

/**
 * @param {object} args
 * @param {string} args.from
 * @param {string} args.userId
 * @param {string} [args.language]
 * @param {string} [args.reason]
 * @returns {Promise<boolean>} true if the library Flow was sent; false means
 *   "no library on this deployment" and the caller should fall through.
 */
async function openStudentVideosFlow({ from, userId, language, reason = 'unspecified' }) {
  const flowId = process.env.STUDENT_VIDEOS_FLOW_ID || '';
  if (!flowId) {
    logToFile('🎬 No STUDENT_VIDEOS_FLOW_ID — caller falls through to generation', { userId, reason });
    return false;
  }

  await WhatsAppService.sendFlow(from, {
    flowId,
    header: resolveUx('studentVideosHeader', { language }),
    body: resolveUx('studentVideosBody', { language }),
    buttonText: resolveUx('studentVideosButton', { language }),
    flowToken: `${userId || 'anon'}:student-videos:${Date.now()}`,
  });

  logToFile('🎬 Sent student videos flow', { userId, reason });
  return true;
}

module.exports = { openStudentVideosFlow };
