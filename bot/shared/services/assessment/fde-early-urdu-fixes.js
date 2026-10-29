'use strict';
/**
 * v28 G1/G2 Urdu written-paper fixes (bd-5jmnfj.4.58.4), run after the early key fixes in fde-early-writer:
 *   - spelling map (fde-urdu-spelling) over the whole Urdu paper (G2 Urdu Q1 vi «نغمان»);
 *   - G2 Urdu Q7 i: the item stem restated the heading's «پانچ جملے لکھیں»; a picture-sentences stem that asks
 *     to write sentences is cleared (the heading already asks), so the instruction prints once;
 *   - G2 Urdu Q7 key: model sentences named a colour («ہرے ہرے پتے») an outline picture cannot show. An attributive
 *     colour word is dropped from the sentence, which stays grammatical; a colour used as the predicate
 *     («آسمان نیلا ہے») cannot be dropped without breaking the sentence, so it is left and named in the note.
 *
 * Pure: {examJson, notes}.
 */

const { urduSpelling } = require('./fde-urdu-spelling');

const URDU_EARLY = /^g[12]\.urdu\./;
const PICTURE_SENTENCES = 'Picture Sentences';
const COLOURS = new Set(['ہرا', 'ہرے', 'ہری', 'لال', 'نیلا', 'نیلے', 'نیلی', 'پیلا', 'پیلے', 'پیلی', 'کالا', 'کالے', 'کالی',
  'سفید', 'سبز', 'سرخ', 'گلابی', 'نارنجی', 'بھورا', 'بھورے', 'بھوری', 'جامنی', 'زرد', 'اودا', 'اودے', 'اودی']);
const COPULA = new Set(['ہے', 'ہیں', 'تھا', 'تھے', 'تھی', 'ہو', 'ہوں', 'ہوتا', 'ہوتی', 'ہوتے']);
const RESTATES = /جملے\s+لکھیں/;

const bare = (token) => token.replace(/[۔،؟!:"“”«»().]/g, '');
const isColour = (token) => COLOURS.has(bare(token));

/** The text without its attributive colour words; `stuck` names a colour left because it ends or predicates its sentence. */
function withoutColours(text) {
  const tokens = String(text).split(/\s+/);
  const kept = [];
  const stuck = [];
  tokens.forEach((t, i) => {
    if (!isColour(t)) { kept.push(t); return; }
    const next = tokens[i + 1];
    const predicate = /[۔؟!]$/.test(t) || next === undefined || COPULA.has(bare(next));
    if (predicate && !isColour(next || '')) { kept.push(t); stuck.push(bare(t)); }
  });
  return { text: kept.join(' '), stuck };
}

function fixPicture(q, notes) {
  let out = q;
  if (typeof q.question === 'string' && RESTATES.test(q.question)) {
    out = { ...out, question: '' };
    notes.push(`${q.slot}: the stem restated the heading's instruction and was cleared`);
  }
  if (typeof q.answer === 'string') {
    const r = withoutColours(q.answer);
    if (r.text !== q.answer) {
      out = { ...out, answer: r.text };
      notes.push(`${q.slot}: colour words dropped from the model sentences (an outline picture shows none)`);
    }
    if (r.stuck.length) notes.push(`${q.slot}: colour «${r.stuck.join('، ')}» ends its sentence and was left; a teacher reads it`);
  }
  return out;
}

function earlyUrduFixes(examJson) {
  if (!examJson || typeof examJson !== 'object') return { examJson, notes: [] };
  const spelt = urduSpelling(examJson);
  const notes = [...spelt.notes];
  const types = new Map();
  ((spelt.examJson._layout && spelt.examJson._layout.sections) || []).forEach((s) => (s.slots || []).forEach((sl) => types.set(sl.slot, sl.type)));
  const out = { ...spelt.examJson };
  for (const branch of ['seen', 'unseen']) {
    const cats = spelt.examJson[branch];
    if (!cats || typeof cats !== 'object') continue;
    out[branch] = Object.fromEntries(Object.entries(cats).map(([cat, byType]) => [cat, !byType || typeof byType !== 'object' ? byType
      : Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, Array.isArray(list)
        ? list.map((q) => (q && URDU_EARLY.test(String(q.slot || '')) && types.get(q.slot) === PICTURE_SENTENCES && q.picture && q.picture.kind === 'scene' ? fixPicture(q, notes) : q))
        : list]))]));
  }
  return { examJson: out, notes };
}

module.exports = { earlyUrduFixes, withoutColours };
