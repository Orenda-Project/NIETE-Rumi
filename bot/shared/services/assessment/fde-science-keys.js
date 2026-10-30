'use strict';
/**
 * G5 Science key and stem fixes from the v29 review (bd-5jmnfj.4.58 round 4), called from moreKeyFixes. Each rule is keyed on
 * the item's stem, since a section's items share one slot.
 *
 * - Q3 (b) needle: the key paid for stroking in one direction and the cork (both in the stem) and for the magnetism
 *   fading (never asked). Those points go; their marks join the first point kept.
 * - Q3 (b) rubbish dump: the reuse / substitutes point and the land pollution point answer what the stem does not ask.
 * - Q3 (a) define vaccine: two of five marks paid for the forms a vaccine comes in; the definition keeps all five.
 * - Q3 (a) fossil fuels: the greenhouse trap point is Q3 (b) 2's, so Q3 (a) asks and pays only the gas (2 marks); the
 *   accept line adds petrol, diesel and LPG, the fuels a child meets.
 * - Q2 (a) food chain: the accept line "grass, rabbit, fox, hawk" has a hawk eat a fox; it becomes a true chain.
 * - Q2 (a) respiratory system: «at least 7 labels» paid up to 5; the stem, point and answer ask for the 5 paid.
 * - Q3 (b) noise: «animals hear even louder noises than humans» is not a hearing ability; the sentence says animals are harmed.
 * - Q3 (b) contagious diseases: the accept line adds vaccination (polio vaccine drops).
 * - Q1 (a) non-contagious disease: malaria and cholera are defensible second answers; measles and influenza replace them.
 *
 * Pure: one item in, the item out; notes are strings pushed on `notes`. Never throws on an item it cannot read.
 */

const pts = (q) => (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : []);
const accept = (q) => (q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : []);
const withScheme = (q, patch) => ({ ...q, scheme: { ...q.scheme, ...patch } });
const text = (p) => String((p && p.text) || '');
const cut = (answer, re) => (typeof answer === 'string' ? answer.replace(re, '').replace(/\s{2,}/g, ' ').trim() : answer);

// Drop the points `drop` names; their marks join the first point kept (`into` picks another receiver).
function dropPoints(q, drop, notes, why, into) {
  const kept = pts(q).filter((p) => !drop(p));
  if (kept.length === pts(q).length || !kept.length) return q;
  const moved = pts(q).filter(drop).reduce((s, p) => s + (Number(p.marks) || 0), 0);
  const at = Math.max(0, into ? kept.findIndex(into) : 0);
  notes.push(`${q.slot}: ${why} (${moved} marks moved to «${text(kept[at]).slice(0, 40)}»)`);
  return withScheme(q, { points: kept.map((p, i) => (i === at ? { ...p, marks: (Number(p.marks) || 0) + moved } : p)) });
}

const addAccept = (q, line, notes, why) => {
  notes.push(`${q.slot}: ${why}`);
  return withScheme(q, { accept: [...accept(q), line] });
};

const needle = (q, notes) => {
  const k = dropPoints(q, (p) => /^Stroking in one direction|cork lets the needle|magnetism fades/i.test(text(p)), notes,
    'dropped the points that restate the stem or answer an unasked question', (p) => /tiny magnets/i.test(text(p)));
  return k === q ? q : { ...k, answer: cut(cut(k.answer, /\s*On the floating cork it turns freely\./), /\s*After a while the tiny magnets[^.]*\./) };
};

const rubbish = (q, notes) => {
  const k = dropPoints(q, (p) => /substitutes|reusing things|land pollution/i.test(text(p)), notes,
    'dropped the unasked reuse, substitutes and land-pollution points');
  return k === q ? q : { ...k, answer: cut(k.answer, /\s*Using substitutes for plastic items[^.]*\./) };
};

const vaccine = (q, notes) => {
  const k = dropPoints(q, (p) => /injection|nasal spray/i.test(text(p)), notes, 'dropped the forms-of-vaccine point',
    (p) => /teaches the immune system/i.test(text(p)));
  return k === q ? q : { ...k, answer: String(k.answer).replace(/an injection, liquid, pill or nasal spray that/i, 'a medicine that') };
};

const fuels = (q, notes) => {
  let k = addAccept(q, 'Petrol, diesel or LPG as a fossil fuel', notes, 'accept adds petrol, diesel and LPG');
  const trap = (p) => /trap/i.test(text(p));
  if (!pts(k).some(trap)) return k;
  const moved = pts(k).filter(trap).reduce((s, p) => s + (Number(p.marks) || 0), 0);
  const points = pts(k).filter((p) => !trap(p)).map((p) => (/greenhouse gas/i.test(text(p))
    ? { ...p, text: 'Names one greenhouse gas that is released when fossil fuels burn, such as carbon dioxide', marks: (Number(p.marks) || 0) + moved } : p));
  notes.push(`${q.slot}: the greenhouse trap point belongs to Q3 (b) 2 alone; marks moved to the gas point`);
  k = { ...withScheme(k, { points }), question: String(k.question).replace(/\s*What do greenhouse gases do to the Sun's heat\?/i, '') };
  return { ...k, answer: cut(k.answer, /\s*Greenhouse gases trap[^.]*\./) };
};

const foodChain = (q, notes) => {
  const list = accept(q);
  if (!list.some((a) => /fox,\s*hawk/i.test(a))) return q;
  notes.push(`${q.slot}: accept line «grass, rabbit, fox, hawk» (a hawk does not eat a fox) became grass, grasshopper, frog, snake`);
  return withScheme(q, { accept: list.map((a) => (/fox,\s*hawk/i.test(a) ? 'Grass, grasshopper, frog, snake with producer and consumer labels' : a)) });
};

const SEVEN = /^(?:Seven|7) parts labelled correctly[^|]*$/i;
const respiratory = (q, notes) => {
  const label = pts(q).find((p) => p.kind === 'L');
  const m = /Label at least (\d+) parts/i.exec(String(q.question));
  if (!label || !m || Number(m[1]) === label.marks) return q;
  const n = label.marks;
  notes.push(`${q.slot}: asks ${n} labels to match the ${n} label marks paid (was ${m[1]})`);
  const k = withScheme(q, { points: pts(q).map((p) => (p === label ? { ...p, text: SEVEN.test(text(p)) ? `${n} parts labelled correctly (a mark for each correct label)` : text(p) } : p)) });
  return { ...k, question: String(q.question).replace(/Label at least \d+ parts/i, `Label at least ${n} parts`), answer: String(q.answer).replace(/\b\d+ labels\b/, `${n} labels`) };
};

const noise = (q, notes) => {
  if (!/Animals can hear even louder noises than humans/i.test(String(q.answer))) return q;
  notes.push(`${q.slot}: replaced «animals hear even louder noises than humans» (not a fact a child is paid for)`);
  return { ...q, answer: q.answer.replace(/Animals can hear even louder noises than humans, so they are affected too\./i, 'Loud noise can also harm animals, so they are affected too.') };
};

const contagious = (q, notes) => (accept(q).some((a) => /vaccin/i.test(a)) ? q
  : addAccept(q, 'Vaccination, for example the polio vaccine drops, as a way to stop a disease spreading', notes, 'accept adds vaccination'));

const nonContagious = (q, notes) => {
  const opts = Array.isArray(q.options) ? q.options : [];
  if (!opts.some((o) => /malaria|cholera/i.test(o))) return q;
  const swap = { malaria: 'Measles', cholera: 'Influenza' };
  notes.push(`${q.slot}: malaria and cholera are defensible non-contagious answers; replaced by measles and influenza`);
  return { ...q, options: opts.map((o) => o.replace(/malaria|cholera/i, (w) => swap[w.toLowerCase()])) };
};

const RULES = [
  [/strokes a sewing needle/i, needle], [/rubbish dump/i, rubbish], [/^Define the word vaccine/i, vaccine],
  [/^Name three fossil fuels/i, fuels], [/Food Chain of four/i, foodChain], [/Draw and label the Respiratory System/i, respiratory],
  [/noise pollution affects/i, noise], [/contagious diseases such as COVID-19/i, contagious], [/non-contagious disease/i, nonContagious],
];

function scienceKeys(q, notes) {
  if (!q || typeof q !== 'object' || !/^science\./.test(q.slot || '')) return q;
  const rule = RULES.find(([re]) => re.test(String(q.question || '')));
  return rule ? rule[1](q, notes) : q;
}

module.exports = { scienceKeys };
