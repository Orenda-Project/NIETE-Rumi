'use strict';
/**
 * Grade 1-2 English answers printed in another item (bd-5jmnfj.4.58.4, round 4). v29:
 *   - G1 Q14 iv printed «sing», which Q6 iii accepts; G2 Q14 iii printed «apples» (Q6 ii answers apple) and
 *     Q16 printed «mangoes» (Q8 i answers mangoes). A word counts in the singular or plural, and accept lists count.
 *   - G1 Q14 asks the child to capitalise names and a day (Dani, Dadi, Friday) that Q9 and Q15 print capitalised.
 * Flags {slot, reason:'giveaway', words, with, text, printed} for the item that prints the answer, in the shape
 * fde-mcq-giveaway.js uses, so fde-g5-paper-giveaways can concatenate them. Pure; never throws.
 */

// Slots whose text prints sentences, and slots whose key is a word the child writes.
const PRINTS = new Set(['Capital Letters', 'Punctuation', 'Story Order', 'Pronouns', 'Is Am Are', 'Has Have', 'Articles', 'Complete the Sentences', 'Prepositions', 'Speech Bubbles']);
const KEYED = new Set(['Rhyming Pairs', 'Singular Plural', 'Opposites', 'Action Words', 'Spelling', 'Name the Picture', 'Complete the Words', 'Missing Letters']);
const CAPITALS = 'Capital Letters';
const SMALL = new Set(['the', 'and', 'she', 'her', 'his', 'was', 'for', 'you', 'are', 'not', 'can', 'has', 'had', 'but', 'its', 'our', 'out', 'all']);
const STARTERS = new Set(['The', 'A', 'An', 'My', 'I', 'We', 'He', 'She', 'It', 'They', 'This', 'That', 'These', 'Those', 'Today', 'Look', 'Please', 'Is', 'Are', 'Can', 'Do', 'Let', 'Our', 'His', 'Her', 'Your', 'There', 'Here', 'What', 'Who', 'Where', 'When', 'Why', 'How', 'Good', 'You', 'Yes', 'No', 'Thank', 'Sorry', 'First', 'Next', 'Then', 'Finally']);

const wordsOf = (s) => String(s == null ? '' : s).match(/[A-Za-z]+/g) || [];

function stem(word) {
  const w = String(word).toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(oes|ches|shes|xes|sses)$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  return w;
}

function items(examJson) {
  const out = [];
  ['seen', 'unseen'].forEach((branch) => {
    const cats = examJson && examJson[branch];
    if (!cats || typeof cats !== 'object') return;
    Object.values(cats).forEach((byType) => {
      if (!byType || typeof byType !== 'object') return;
      Object.entries(byType).forEach(([type, list]) => {
        if (Array.isArray(list)) list.forEach((q) => { if (q && typeof q === 'object' && q.slot) out.push({ q, type }); });
      });
    });
  });
  return out;
}

const printedText = (q) => [q.question, q.passage, ...(Array.isArray(q.options) ? q.options : []),
  ...(Array.isArray(q.questions) ? q.questions.map((x) => (x && x.question) || x) : [])].filter((s) => typeof s === 'string').join(' ');

function keyWords(q) {
  const sch = q.scheme || {};
  const raw = [q.answer, ...(Array.isArray(sch.accept) ? sch.accept : [])].filter((s) => typeof s === 'string' && wordsOf(s).length <= 3);
  return new Set(raw.flatMap(wordsOf).filter((w) => w.length >= 3 && !SMALL.has(w.toLowerCase())).map(stem));
}

function wordGiveaways(all) {
  const flags = [];
  all.filter((p) => PRINTS.has(p.type)).forEach((p) => {
    const printed = new Set(wordsOf(printedText(p.q)).map(stem));
    all.filter((k) => KEYED.has(k.type) && k.q.slot !== p.q.slot).forEach((k) => {
      const hit = [...keyWords(k.q)].filter((w) => printed.has(w));
      if (hit.length) flags.push({ slot: p.q.slot, reason: 'giveaway', words: hit, with: k.q.slot, text: printedText(p.q), printed: k.q.question || '' });
    });
  });
  return flags;
}

function capitalGiveaways(all) {
  const flags = [];
  all.filter((c) => c.type === CAPITALS).forEach((c) => {
    const targets = (String(c.q.answer || '').match(/\b[A-Z][a-z]+/g) || []).filter((w) => !STARTERS.has(w));
    all.filter((o) => o.q.slot !== c.q.slot && PRINTS.has(o.type)).forEach((o) => {
      const printed = new Set(String(printedText(o.q)).match(/\b[A-Z][a-z]+/g) || []);
      const hit = targets.filter((w) => printed.has(w));
      if (hit.length) flags.push({ slot: c.q.slot, reason: 'giveaway', words: hit, with: o.q.slot, text: c.q.question || '', printed: printedText(o.q) });
    });
  });
  return flags;
}

/** The shape fde-answer-repeats reads (fde-mcq-giveaway): one flag per slot, `with` and `text` as parallel lists. */
function merged(flags) {
  const out = new Map();
  flags.forEach((f) => {
    const r = out.get(f.slot) || { slot: f.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
    f.words.forEach((w) => { if (!r.words.includes(w)) r.words.push(w); });
    if (!r.with.includes(f.with)) { r.with.push(f.with); r.text.push(String(f.text).slice(0, 160)); }
    out.set(f.slot, r);
  });
  return [...out.values()];
}

function earlyGiveaways(examJson) {
  try {
    const all = items(examJson);
    return merged(wordGiveaways(all).concat(capitalGiveaways(all)));
  } catch (e) { return []; }
}

module.exports = { earlyGiveaways };
