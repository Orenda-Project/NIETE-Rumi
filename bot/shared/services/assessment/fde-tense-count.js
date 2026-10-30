'use strict';
/**
 * The tense construct asked more than twice (bd-5jmnfj.4.58.34). v29 G5 English tested it five times: Q1(a) 8 'simple past
 * tense' and 9 'present perfect tense', Q1(b) iv 'Change into simple past' and v 'Change into simple present', and Q2 ii(b)
 * 'Change the tense', which also repeated Q1(b) v. Two asks per paper is the cap, in paper order; each later ask is flagged
 * on its own slot against the first two, so that section is asked again with another construct.
 *
 * English papers only (the slot starts english.). fde-concept-count.js is science and is left as it was.
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { asks } = require('./fde-lang-cross-asks');

const TENSE_CAP = 2;
const TENSE = /\btense\b|\bsimple\s+(?:past|present|future)\b|\b(?:present|past|future)\s+(?:perfect|continuous|progressive)\b/i;
const excerpt = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 70);

/** The tense asks of an English paper, in paper order. */
const tenseAsks = (examJson) => asks(examJson).filter((a) => /^english\./.test(a.slot) && TENSE.test(String(a.text || '')));

function tenseFlags(examJson) {
  const list = tenseAsks(examJson);
  if (list.length <= TENSE_CAP) return [];
  const first = list.slice(0, TENSE_CAP);
  const out = new Map();
  list.slice(TENSE_CAP).forEach((a) => {
    const r = out.get(a.slot) || { slot: a.slot, reason: 'giveaway', words: ['tense'], with: [], text: [], printed: true };
    if (!r.with.length) first.forEach((f) => { r.with.push(f.slot); r.text.push(`${excerpt(f.text)} (tense is asked ${list.length} times; the cap is ${TENSE_CAP})`); });
    out.set(a.slot, r);
  });
  return [...out.values()];
}

module.exports = { tenseFlags, tenseAsks, TENSE_CAP };
