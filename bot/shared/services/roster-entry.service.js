'use strict';
/**
 * The one door into the class-roster builder.
 *
 * It used to start inline in text-message.handler behind `/roster` — 814 sends
 * in seven days, the third most-used feature on the deployment, and unreachable
 * from anywhere else. Same reason as its three siblings: a menu row would have
 * had to re-implement the send AND the leader gate, and the gate is the half
 * that matters.
 *
 * Presence gate read at call time (ROSTER_FLOW_ID), role gate from
 * observe-gate.isSchoolLeader — the same authority /observe uses, so the row and
 * the command cannot disagree in a direction that grants access.
 */

const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');

/**
 * Outcomes, named rather than booleaned, because the two refusals are not the
 * same thing to a caller:
 *
 *   'sent'         the Flow went out
 *   'no_flow'      ROSTER_FLOW_ID unset — NOTHING was sent, and that is the
 *                  documented behaviour of this command on a deployment that has
 *                  not published the Flow: the feature does not exist there, so
 *                  the command is a no-op and the caller decides what to say.
 *                  A menu row is presence-gated away in that case; a scrollback
 *                  tap on one gets the honest line from the dispatch.
 *   'denied_role'  not a school leader — the refusal IS sent, here, in her
 *                  language, because it is the same refusal for every caller.
 *   'send_failed'  Meta rejected it; the caller owns the apology.
 *
 * @param {object} args
 * @param {string} args.from
 * @param {object} args.user
 * @param {string} [args.language]
 * @param {string} [args.reason]
 * @returns {Promise<'sent'|'no_flow'|'denied_role'|'send_failed'>}
 */
async function openRosterFlow({ from, user, language, reason = 'unspecified' }) {
  const { isSchoolLeader } = require('./observe/observe-gate');
  const flowId = process.env.ROSTER_FLOW_ID || '';

  if (!flowId) {
    logToFile('📋 Roster requested but ROSTER_FLOW_ID is unset', { userId: user?.id, reason });
    return 'no_flow';
  }

  if (!isSchoolLeader(user)) {
    logToFile('🚫 Roster refused — not a school leader', { userId: user?.id, role: user?.role, reason }, 'warn');
    await WhatsAppService.sendMessage(from, resolveUx('rosterLeadersOnly', { language }));
    return 'denied_role';
  }

  const sent = await WhatsAppService.sendFlow(from, {
    flowId,
    header: resolveUx('rosterFlowHeader', { language }),
    body: resolveUx('rosterFlowBody', { language }),
    footer: resolveUx('rosterFlowFooter', { language }),
    buttonText: resolveUx('rosterFlowButton', { language }),
    // No screen: with a flow token this sends as data_exchange, so Meta calls the
    // endpoint's INIT and the school list is built server-side.
    flowToken: user.id,
  });

  logToFile(sent ? '📋 roster flow sent' : '❌ roster flow failed', { userId: user.id, reason });
  return sent ? 'sent' : 'send_failed';
}

module.exports = { openRosterFlow };
