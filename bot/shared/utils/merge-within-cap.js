'use strict';
/**
 * Join adjacent message parts into ONE WhatsApp field — or report that they do
 * not fit, so the caller keeps its separate messages.
 *
 * Every message delivered is billed. Where two bubbles in a row are read together
 * and nothing is decided between them (an acknowledgement and the next question,
 * a card and its line of praise, a report and its companion note), one message
 * whose body or caption holds both says the same thing for half the price.
 *
 * Each of those fields has a hard cap measured in CODE POINTS, and Meta refuses
 * the WHOLE message when a value overruns it — the feature then sends nothing at
 * all. So a merge is only ever attempted when the result fits; otherwise this
 * returns null and the caller sends the parts the way it always did.
 */

/** WhatsApp's caps, in code points, for the fields these merges write. */
const FIELD_CAPS = Object.freeze({
  text: 4096, // a plain text message body
  body: 1024, // an interactive (buttons / list) body
  caption: 1024, // an image / video / document caption
});

const codePoints = (s) => [...String(s == null ? '' : s)].length;

/**
 * @param {Array<string|null|undefined>} parts  in reading order; empty parts are skipped
 * @param {number} cap                          the field's cap in code points
 * @param {string} [separator]                  between parts (a blank line by default)
 * @returns {string|null} the joined text, or null when it would overrun the cap
 *   (or there is nothing to join)
 */
function mergeWithinCap(parts, cap, separator = '\n\n') {
  const kept = (parts || []).map((p) => (p == null ? '' : String(p).trim())).filter(Boolean);
  if (!kept.length) return null;
  const joined = kept.join(separator);
  return codePoints(joined) <= cap ? joined : null;
}

module.exports = { mergeWithinCap, FIELD_CAPS };
