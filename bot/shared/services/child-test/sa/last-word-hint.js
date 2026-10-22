'use strict';
/**
 * The last word read, from the passage recording (switch sa_coach_last_word): the words heard (Soniox, in order) aligned
 * to the passage's words, so the coach's phone can suggest where the child stopped and the coach's tap confirms it.
 *
 *   lastWordIndex(tokens, heard, lang) → { index, matched }
 *     tokens  the passage's words as the phone shows them (punctuation may be attached)
 *     heard   [{ w }] the STT's words (text-norm wordsFromTokens; `w` already folded), or plain strings
 *   Greedy and in order: each word heard is looked for in the next WINDOW passage words from the pointer (the study's
 *   "same word" rule: one edit on words of 4+ letters); a skipped stretch longer than that is caught up by two words heard
 *   in a row matching two passage words in a row. index = the last passage word matched; null under MIN_MATCHED.
 *   Speech that is not the passage (the coach, Jugnu, the room) matches nothing and is passed over.
 */

const { clean, same } = require('../scoring/text-norm');

const WINDOW = 4;
const MIN_MATCHED = 2;

function lastWordIndex(tokens, heard, lang) { // eslint-disable-line no-unused-vars
  const ref = (tokens || []).map((t) => clean(t));
  const hyp = (heard || []).map((h) => clean(typeof h === 'string' ? h : (h && (h.w || h.raw)) || '')).filter(Boolean);
  let p = 0;
  let last = null;
  let matched = 0;
  const hit = (i) => { last = i; matched += 1; p = i + 1; };
  for (let k = 0; k < hyp.length; k += 1) {
    const w = hyp[k];
    let at = -1;
    for (let j = p; j < Math.min(ref.length, p + WINDOW); j += 1) if (ref[j] && same(ref[j], w)) { at = j; break; }
    if (at < 0 && k + 1 < hyp.length) {
      for (let j = p + WINDOW; j + 1 < ref.length; j += 1) if (same(ref[j], w) && same(ref[j + 1], hyp[k + 1])) { at = j; break; }
    }
    if (at >= 0) hit(at);
  }
  return matched >= MIN_MATCHED ? { index: last, matched } : { index: null, matched };
}

module.exports = { lastWordIndex, WINDOW, MIN_MATCHED };
