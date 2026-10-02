'use strict';
/**
 * The one door into the class manager.
 *
 * Holds the rule that made this worth extracting rather than duplicating: a
 * class needs a school (`classes.school_id` is NOT NULL) and roughly one in
 * eight teachers has none on file. Opening a Flow that cannot succeed is the
 * dead-end pattern that has already cost this deployment once — so a teacher
 * with no school is answered in chat, and told what would fix it.
 *
 * Any surface that wants "manage my classes" calls this. The alternative was a
 * menu row re-implementing the school check, which is how one of the two copies
 * eventually forgets it.
 */

const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { resolveUx } = require('../../config/ux-strings');

/**
 * @param {object} args
 * @param {string} args.from
 * @param {object} args.user       the resolved users row (id is the flow token)
 * @param {string} [args.language]
 * @param {string} [args.reason]
 * @returns {Promise<boolean>} true if the Flow was sent
 */
async function openClassManagerFlow({ from, user, language, reason = 'unspecified' }) {
  const supabase = require('../../config/supabase');
  const flowId = process.env.CLASS_MANAGER_FLOW_ID || '';

  if (!flowId) {
    logToFile('🏫 Classes requested but CLASS_MANAGER_FLOW_ID is unset', { userId: user?.id, reason });
    await WhatsAppService.sendMessage(from, resolveUx('classesNotAvailable', { language }));
    return false;
  }

  const { data: schoolRow } = await supabase
    .from('users')
    .select('school_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!schoolRow || !schoolRow.school_id) {
    logToFile('🏫 Classes: no school on file — answering in chat, not opening the Flow', {
      userId: user.id, reason,
    });
    await WhatsAppService.sendMessage(from, resolveUx('classNoSchool', { language }));
    return false;
  }

  await WhatsAppService.sendFlow(from, {
    flowId,
    header: resolveUx('classFlowHeader', { language }),
    body: resolveUx('classFlowBody', { language }),
    buttonText: resolveUx('classFlowButton', { language }),
    flowToken: classManagerFlowToken(user.id),
  });

  logToFile('🏫 Sent class manager flow', { userId: user.id, reason });
  return true;
}

/**
 * The class-manager Flow's token: "<userId>:classes".
 *
 * The marker is how the Flow's completion is recognised. Its SAVED Footer
 * completes with an empty payload on every WABA, so the token is the only thing
 * the completion carries — and a bare user id, which this used to be, is
 * indistinguishable from half a dozen other Flows. Unrecognised, every save was
 * answered "Thanks for your response! Type /menu…" (89 a week in production).
 * The endpoint reads the user id from before the first colon, so a Flow already
 * delivered with the bare id still opens.
 *
 * Every sender of the class-manager Flow builds its token here.
 */
function classManagerFlowToken(userId) {
  return `${userId}:classes`;
}

module.exports = { openClassManagerFlow, classManagerFlowToken };
