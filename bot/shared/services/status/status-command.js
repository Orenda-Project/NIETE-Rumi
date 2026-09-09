'use strict';
/**
 * What /status should do — decided before anything is sent.
 *
 * The command used to send the Flow CTA the moment STATUS_FLOW_ID was present,
 * without ever asking what was running. That is fine when something IS running:
 * the Flow is the only surface that can stop it. It is bad when nothing is,
 * because the Flow's INIT returns a TERMINAL success screen for an empty store,
 * so it flashes open and shut — and the chat-side completion branch spoke only
 * for `cancelled`. Net effect for the teacher: a tap, a flicker, and silence.
 *
 * So the probe moves ahead of the send. One extra cheap read on a low-volume
 * command (a few Supabase selects and a Redis MGET, per the endpoint's own
 * note), in exchange for /status always answering.
 *
 * WHY THIS IS A SEPARATE MODULE: text-message.handler.js pulls in ~40 services,
 * so this repo does not load it in unit tests — it extracts the decision and
 * asserts the routing statically. Same shape as services/classes/class-command.js
 * and the /certificate extraction.
 *
 * THE ONE THING TO PRESERVE IF YOU EDIT THIS: a failed probe must not be able
 * to suppress the Flow. `items === null` means "could not tell", which is not
 * "nothing" — reporting it as empty would tell a teacher with a live session
 * that she has none, trading a silence bug for a lying one. A null therefore
 * still opens the Flow, which re-reads at INIT and shows its own error screen.
 * That degrades to exactly the pre-fix behaviour rather than to silence.
 */

/**
 * @param {object}  args
 * @param {string}  args.statusFlowId  STATUS_FLOW_ID, '' when not published.
 * @param {Array|null} args.items      listActiveResources' answer, or null/any
 *                                     non-array when the probe could not run.
 * @returns {{mode: 'flow'} | {mode: 'text', kind: 'empty'|'list'|'unknown'}}
 */
function decideStatusReply({ statusFlowId, items } = {}) {
  const hasFlow = Boolean(statusFlowId);

  // Deliberately Array.isArray and not a truthiness or length check: undefined,
  // null and {} all have to read as "could not tell", never as "empty".
  if (!Array.isArray(items)) {
    return hasFlow ? { mode: 'flow' } : { mode: 'text', kind: 'unknown' };
  }

  if (items.length === 0) return { mode: 'text', kind: 'empty' };

  return hasFlow ? { mode: 'flow' } : { mode: 'text', kind: 'list' };
}

module.exports = { decideStatusReply };
