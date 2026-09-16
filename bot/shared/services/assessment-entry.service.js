'use strict';
/**
 * The one door into the assessment generator.
 *
 * It used to start inside an `if` block in text-message.handler, which meant
 * nothing else could open it — a menu row would have had to re-implement the
 * send, and two implementations of one rule is the drift `lp-browse-entry` and
 * `training-entry` exist to prevent.
 *
 * Two gates, both read at call time so a change in Railway or in the database
 * takes effect on the next message rather than the next restart:
 *   · ASSESSMENT_GEN_FLOW_ID — presence-based, per the architecture rule
 *   · isAssessmentGeneratorEnabled() — the shared DB switch, fail-CLOSED, so
 *     shipping the code does not ship the feature
 *
 * Copy lives in the catalog, one reviewed string per offered language, capped
 * there and resolved through the one language clamp.
 */

const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');

/**
 * @param {object} args
 * @param {string} args.from       WhatsApp number to send to
 * @param {string} args.userId     users.id — leads the flow token
 * @param {string} [args.language] resolved response language
 * @param {string} [args.reason]   which door — log line only
 * @returns {Promise<boolean>} true if the Flow was sent
 */
async function openAssessmentFlow({ from, userId, language, reason = 'unspecified' }) {
  const { isAssessmentGeneratorEnabled } = require('../config/feature-flags');
  const flowId = process.env.ASSESSMENT_GEN_FLOW_ID || '';
  const live = await isAssessmentGeneratorEnabled();

  if (!live || !flowId) {
    logToFile('📝 Assessment generator not live for this deployment', {
      userId, reason, hasFlowId: Boolean(flowId), dbSwitch: live,
    });
    await WhatsAppService.sendMessage(from, resolveUx('assessmentNotReady', { language }));
    return false;
  }

  await WhatsAppService.sendFlow(from, {
    flowId,
    header: resolveUx('assessmentFlowHeader', { language }),
    body: resolveUx('assessmentFlowBody', { language }),
    buttonText: resolveUx('assessmentFlowButton', { language }),
    flowToken: `${userId}:assessment-gen:${Date.now()}`,
  });

  logToFile('📝 sent assessment flow', { userId, reason });
  return true;
}

module.exports = { openAssessmentFlow };
