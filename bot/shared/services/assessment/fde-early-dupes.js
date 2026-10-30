'use strict';
/**
 * Grade 1-2 "early" paper defects the v34 reader found (bd-5jmnfj.4.58):
 *  - an accept line that is prose, not answers: G2 English Q3 i accepted «bun», «run is not allowed», «gun», «nun»;
 *  - the same target asked twice: G2 Urdu asked the opposite of «دن» in Q1 v and Q6, and printed the sentence
 *    «رانی بازار جائے گی۔» in Q1 ix and Q4 ii.
 * Each flag is `{ slot, reason: 'answer', items: ['<question> → <answer> (<why>)'] }`, the shape keyShortfall returns, so it
 * rides the same ask-again path. A sentence repeated inside one slot is that slot's shared stem, not a repeat. A repeat is flagged on the LATER item; the first asking stays.
 *
 * Pure: exam JSON and pattern in, flags out; never throws.
 */

const NEGATION = /\bnot (?:allowed|accepted|acceptable|correct)\b|\bwrong\b|\bincorrect\b|\bdo not accept\b|\bdon't accept\b/i;
const JOINED = /[;；؛]/;
const MIN_SENTENCE_WORDS = 3;
const MIN_TARGET_LETTERS = 2;

const text = (v) => (typeof v === 'string' ? v : '');
const choice = (o) => text(o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();
// Diacritics, punctuation and spacing do not make two words or two sentences different.
const norm = (s) => text(s).normalize('NFC').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
const wordCount = (s) => (norm(s) ? norm(s).split(' ').length : 0);

/** The items of the slots the pattern names, in pattern order then paper order. */
function itemsOf(examJson, P) {
  const order = new Map();
  ((P && P.sections) || []).forEach((s) => ((s && s.slots) || []).forEach((sl) => sl && order.set(sl.slot, order.size)));
  const list = [];
  ['seen', 'unseen'].forEach((branch) => {
    Object.values((examJson && examJson[branch]) || {}).forEach((types) => {
      Object.values(types || {}).forEach((l) => { if (Array.isArray(l)) l.forEach((q) => { if (q && typeof q === 'object' && order.has(q.slot)) list.push(q); }); });
    });
  });
  return list.map((q, i) => ({ q, i })).sort((a, b) => order.get(a.q.slot) - order.get(b.q.slot) || a.i - b.i).map((x) => x.q);
}

const lineOf = (q, why) => `${text(q.question).trim()} → ${text(q.answer).trim()} (${why})`;

function collect(list, build) {
  const bySlot = new Map();
  list.forEach((q) => build(q).forEach((why) => {
    if (!bySlot.has(q.slot)) bySlot.set(q.slot, []);
    const lines = bySlot.get(q.slot);
    const line = lineOf(q, why);
    if (!lines.includes(line)) lines.push(line);
  }));
  return [...bySlot].map(([slot, items]) => ({ slot, reason: 'answer', items }));
}

const proseWhy = (entry, what) => `${what} «${entry}» is not one acceptable answer; list single answers only, with no semicolons, no "not allowed" and no explanation`;

/** An accept entry, or a one-word item's mark point, that is prose: joined answers, a negation, an explanation. */
function acceptProseShortfall(examJson, P) {
  try {
    return collect(itemsOf(examJson, P), (q) => {
      const sch = q.scheme;
      if (!sch || typeof sch !== 'object') return [];
      // A sum keys its working («column method giving 59»), so only a worded answer has its entries length-checked.
      const oneWord = wordCount(choice(q.answer)) <= 2;
      const worded = oneWord && !/\d/.test(text(q.answer));
      const whys = [];
      (Array.isArray(sch.accept) ? sch.accept : []).filter((e) => typeof e === 'string').forEach((e) => {
        if (JOINED.test(e) || NEGATION.test(e) || (worded && wordCount(e) >= 4)) whys.push(proseWhy(e, 'the accept entry'));
      });
      if (oneWord) {
        (Array.isArray(sch.points) ? sch.points : []).map((p) => p && p.text).filter((t) => typeof t === 'string').forEach((t) => {
          if (JOINED.test(t) || NEGATION.test(t)) whys.push(proseWhy(t, 'the mark point'));
        });
      }
      return whys;
    });
  } catch (e) { return []; }
}

const guillemets = (s) => (text(s).match(/«[^»]*»/g) || []).map((m) => m.slice(1, -1));
const subTexts = (q) => (Array.isArray(q.questions) ? q.questions : []).map((x) => (x && typeof x === 'object' ? x.question : x)).filter((x) => typeof x === 'string');

/** The one word an item asks about: «دن» in a stem, or a stem that is only the word. */
function targetOf(q) {
  const quoted = guillemets(q.question).map(norm).filter((w) => w && !w.includes(' '));
  const bare = norm(q.question);
  const word = quoted.length === 1 ? quoted[0] : (bare && !bare.includes(' ') ? bare : '');
  return [...word].length >= MIN_TARGET_LETTERS ? word : '';
}

/** The sentences an item prints: quoted in a stem, the stem itself (not a choice question), sub-questions, a long answer. */
function sentencesOf(q) {
  const hasOptions = Array.isArray(q.options) && q.options.length > 0;
  const raw = [...guillemets(q.question), ...(hasOptions ? [] : [q.question]), ...subTexts(q), ...subTexts(q).flatMap(guillemets), q.answer];
  return [...new Set(raw.filter((s) => typeof s === 'string' && wordCount(s) >= MIN_SENTENCE_WORDS).map(norm))];
}

/** The same target word asked in two items, or the same sentence printed in two items: the later item is flagged. */
function dupeShortfall(examJson, P) {
  try {
    const list = itemsOf(examJson, P);
    const firstWord = new Map();
    const firstSentence = new Map();
    const hits = new Map(); // item -> reasons
    const note = (q, why) => { if (!hits.has(q)) hits.set(q, []); if (!hits.get(q).includes(why)) hits.get(q).push(why); };
    list.forEach((q) => {
      const where = (o) => `${o.slot} «${text(o.question).replace(/\s+/g, ' ').trim().slice(0, 60)}»`;
      const word = targetOf(q);
      if (word) {
        if (firstWord.has(word) && firstWord.get(word) !== q) note(q, `the target word «${word}» is already asked in ${where(firstWord.get(word))}; ask a different word`);
        else firstWord.set(word, q);
      }
      sentencesOf(q).forEach((s) => {
        if (firstSentence.has(s) && firstSentence.get(s).slot !== q.slot) note(q, `the sentence «${s}» is already printed in ${where(firstSentence.get(s))}; write a different sentence`);
        else if (!firstSentence.has(s)) firstSentence.set(s, q);
      });
    });
    return collect(list, (q) => hits.get(q) || []);
  } catch (e) { return []; }
}

/** Both checks, in the shape keyShortfall returns. */
function earlyDupeShortfall(examJson, P) {
  return [...acceptProseShortfall(examJson, P), ...dupeShortfall(examJson, P)];
}

module.exports = { acceptProseShortfall, dupeShortfall, earlyDupeShortfall };
