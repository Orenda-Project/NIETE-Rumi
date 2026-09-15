/**
 * The `/roster` command.
 *
 * Lifted out of the text handler so it can be EXECUTED by a test: that handler
 * requires ~40 services at module load and cannot be booted in a unit suite, so
 * everything inside it can only ever be checked by reading its source. The
 * command's two gates and its copy are unchanged in behaviour — the copy now
 * comes from the catalog in the reader's own language rather than as English
 * literals.
 *
 * Gated two ways, both deliberate. The role check reuses `isSchoolLeader()` from
 * observe-gate — the single source of truth for the leader family, with a guard
 * test that forbids anyone comparing the role string directly. The env check is
 * how a market ships: no `ROSTER_FLOW_ID` means the command does not exist here,
 * so this is a no-op on any deployment that has not published the Flow.
 */

const WhatsAppService = require('../services/whatsapp.service');
const { logToFile } = require('../utils/logger');
const { getUserLanguage } = require('../utils/language-cache');
const { resolveUx } = require('../config/ux-strings');

/**
 * @param {object} opts
 * @param {object|null} opts.user               the users row (may be null)
 * @param {string} opts.from                    WhatsApp sender
 * @param {object} [opts.typingController]      the handler's typing indicator
 * @param {function} [opts.noAccountCopy]       the shared no-account message wrapper
 */
async function handleRosterCommand({ user, from, typingController, noAccountCopy }) {
  const { isSchoolLeader } = require('../services/observe/observe-gate');

  if (!process.env.ROSTER_FLOW_ID) return;

  if (!user) {
    const copy = 'I could not find your account. Send me a message first so I can set you up.';
    await WhatsAppService.sendMessage(from, noAccountCopy ? noAccountCopy(copy) : copy);
    return;
  }

  const language = await getUserLanguage(user.id);

  if (!isSchoolLeader(user)) {
    await WhatsAppService.sendMessage(from, resolveUx('rosterRoleRefusal', { language }));
    return;
  }

  if (typingController && typeof typingController.stop === 'function') typingController.stop();

  const sent = await WhatsAppService.sendFlow(from, {
    flowId: process.env.ROSTER_FLOW_ID,
    header: resolveUx('rosterFlowHeader', { language }),
    body: resolveUx('rosterFlowBody', { language }),
    footer: resolveUx('rosterFlowFooter', { language }),
    buttonText: resolveUx('rosterFlowButton', { language }),
    // No screen: with a flow token this sends as data_exchange, so Meta calls the
    // endpoint's INIT and the school list is built server-side.
    flowToken: user.id,
  });

  logToFile(sent ? '📋 /roster flow sent' : '❌ /roster flow failed', { userId: user.id }, sent ? 'info' : 'error');
  if (!sent) {
    await WhatsAppService.sendMessage(from, resolveUx('rosterFlowFailed', { language }));
  }
}

module.exports = { handleRosterCommand };
