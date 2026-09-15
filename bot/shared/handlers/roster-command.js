/**
 * The `/roster` command.
 *
 * Lifted out of the text handler so it can be EXECUTED by a test: that handler
 * requires ~40 services at module load and cannot be booted in a unit suite, so
 * everything inside it can only ever be checked by reading its source.
 *
 * The send itself lives in services/roster-entry.service (`openRosterFlow`) —
 * ONE door, shared with the /menu row. Two PRs extracted this command in
 * parallel (the language pass and the menu-doors pass) and each produced its own
 * copy of the send plus its own leader gate; merge resolution on 2026-09-15 kept
 * both seams but only one implementation, because two copies of a role gate is
 * how a row and a command come to disagree about who is allowed in.
 *
 * What stays here is what is specific to the typed command: the no-account
 * reply, the typing indicator, and the apology when Meta refuses the send.
 * The env check is how a market ships: no `ROSTER_FLOW_ID` means the command
 * does not exist here, so this is a no-op on any deployment that has not
 * published the Flow.
 */

const WhatsAppService = require('../services/whatsapp.service');
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
  if (!process.env.ROSTER_FLOW_ID) return;

  if (!user) {
    const copy = 'I could not find your account. Send me a message first so I can set you up.';
    await WhatsAppService.sendMessage(from, noAccountCopy ? noAccountCopy(copy) : copy);
    return;
  }

  const language = await getUserLanguage(user.id);

  if (typingController && typeof typingController.stop === 'function') typingController.stop();

  const { openRosterFlow } = require('../services/roster-entry.service');
  // 'no_flow' is unreachable here (the env check above) and 'denied_role' was
  // already answered inside the door, in her language. Only a real send failure
  // needs an apology from the command.
  const outcome = await openRosterFlow({ from, user, language, reason: 'command' });

  if (outcome === 'send_failed') {
    await WhatsAppService.sendMessage(from, resolveUx('rosterFlowFailed', { language }));
  }
}

module.exports = { handleRosterCommand };
