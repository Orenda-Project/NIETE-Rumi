'use strict';
/**
 * A number keeps the word after it: the space after it becomes U+00A0, so a wrap never leaves «۱» at a line's end
 * without its noun («۱ ستارہ», «۷ میں سے ۱ صحیح»). Either digit system, a fraction (۳/۵), and a number that closes an
 * isolate (U+2069) or a drawn number's span. Used by the Urdu share lines under web_quiz_share_bidi.
 */
const RX = /([0-9\u06F0-\u06F9]+(?:\/[0-9\u06F0-\u06F9]+)?(?:\u2069|<\/span>)?) (?=\S)/g;
function keepNum(s) {
  return String(s).replace(RX, '$1\u00a0');
}
module.exports = { keepNum };
