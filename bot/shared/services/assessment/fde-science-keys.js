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
 * v37 (round 6, v34 review):
 * - Q3 (b) compass: the model answer said Earth's magnetic north attracts the needle's north end (unlike poles attract).
 * - Q3 (a) contagious: the accept line paid malaria (a mosquito) and cholera (water) as person-to-person.
 * - Q3 (b) COVID-19 and polio: the key paid clean water for polio and nothing for the vaccine.
 * - Q3 (a) «one way different and one way alike»: the key paid three differences; it pays one and the likeness.
 * - Q3 (b) bulb: a cause a child can meet is a fused or loose bulb, not wires of plastic or wood.
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

// v37 compass: unlike poles attract, so the needle's north-seeking end is drawn to Earth's magnetic pole in the north.
const COMPASS_SENTENCE = /Earth's magnetic north attracts the north end of the needle and the south attracts its south end, so the needle lines up with Earth's magnetic poles\./i;
const compass = (q, notes) => {
  if (!COMPASS_SENTENCE.test(String(q.answer))) return q;
  notes.push(`${q.slot}: the key said a magnetic north attracts the needle's north end; unlike poles attract`);
  const points = pts(q).map((p) => (/attracts the needle's ends/i.test(text(p))
    ? { ...p, text: 'Unlike poles attract, so the needle\'s north-seeking end is pulled towards Earth\'s magnetic pole in the north and it lines up north-south' } : p));
  return { ...withScheme(q, { points }), answer: q.answer.replace(COMPASS_SENTENCE, 'Unlike poles attract, so the needle\'s north-seeking end is pulled towards Earth\'s magnetic pole in the north (a magnetic south pole), and the needle lines up north-south.') };
};

const contagiousDefine = (q, notes) => {
  if (!accept(q).some((a) => /malaria|cholera/i.test(a))) return q;
  notes.push(`${q.slot}: malaria (mosquito) and cholera (water) are not passed from person to person; dropped from the accept line`);
  return withScheme(q, { accept: accept(q).map((a) => a.replace(/\s*(?:malaria|cholera),?/gi, '').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim()) });
};

// v37 polio: the protection a child knows best is the vaccine; clean water stays as a second way.
const polio = (q, notes) => {
  const clean = (p) => /clean water[^|]*protect against polio/i.test(text(p));
  if (!pts(q).some(clean) || pts(q).some((p) => /vaccin|polio drops/i.test(text(p)))) return q;
  notes.push(`${q.slot}: polio protection is the vaccine (polio drops); the key paid clean water alone`);
  const points = pts(q).map((p) => (clean(p) ? { ...p, text: 'The polio vaccine (polio drops) protects against polio; clean water and sanitation also help' } : p));
  const k = withScheme(q, { points, accept: [...accept(q), 'Polio drops or the polio vaccine as the way to protect against polio'] });
  return { ...k, answer: String(k.answer).replace(/and clean water and sanitation protect against polio\./i, 'and the polio vaccine (polio drops) protects against polio, with clean water and sanitation helping too.') };
};

// v37 one way different, one way alike: one difference point (the others become accepted answers) and one likeness point.
const compare = (q, notes) => {
  if (!/\bone way\b[^.?]*\bdifferent\b[^.?]*\bone way\b[^.?]*\balike\b/i.test(String(q.question))) return q;
  const alike = (p) => /^alike/i.test(text(p));
  const diffs = pts(q).filter((p) => !alike(p));
  const likes = pts(q).filter(alike);
  if (diffs.length < 2 || likes.length !== 1) return q;
  const sum = pts(q).reduce((s, p) => s + (Number(p.marks) || 0), 0);
  const like = Math.min(2, sum - 1);
  notes.push(`${q.slot}: asks one difference and one likeness; the key paid ${diffs.length} differences, now one difference (${sum - like}) and the likeness (${like})`);
  const points = [{ ...diffs[0], text: 'One correct difference (the answers below are all accepted)', marks: sum - like }, { ...likes[0], marks: like }];
  return withScheme(q, { points, accept: [...diffs.map((d) => `Difference: ${text(d)}`), ...accept(q)] });
};

// v37 bulb: a fused or loose bulb replaces the wire that is not a conductor (a fault a child cannot meet with two wires).
const bulb = (q, notes) => {
  const wire = (p) => /wire may not be a conductor|not a conductor/i.test(text(p));
  const fix = (p) => /^Fix: use a conductor such as copper wire/i.test(text(p));
  if (!pts(q).some(wire)) return q;
  notes.push(`${q.slot}: «wires of plastic or wood» is not a fault a child meets; the third cause is a fused or loose bulb`);
  const points = pts(q).map((p) => (wire(p) ? { ...p, text: 'The bulb may be fused or loose in its holder' } : fix(p) ? { ...p, text: 'Fix: replace the bulb or tighten it in its holder' } : p));
  const k = withScheme(q, { points, accept: [...accept(q), 'A fused (broken) bulb or a bulb loose in its holder; replace it or screw it in tightly'] });
  return { ...k, answer: String(k.answer).replace(/The wires may not be conductors[^.]*\./i, 'The bulb may be fused or loose in its holder, so he should replace it or tighten it.') };
};

const RULES = [
  [/strokes a sewing needle/i, needle], [/rubbish dump/i, rubbish], [/^Define the word vaccine/i, vaccine],
  [/^Name three fossil fuels/i, fuels], [/Food Chain of four/i, foodChain], [/Draw and label the Respiratory System/i, respiratory],
  [/noise pollution affects/i, noise], [/contagious diseases such as COVID-19/i, contagious], [/non-contagious disease/i, nonContagious],
  [/needle of a compass/i, compass], [/^What is a contagious disease/i, contagiousDefine], [/COVID-19 and polio/i, polio],
  [/one way[^.?]*different[^.?]*one way[^.?]*alike/i, compare], [/battery, a bulb and two wires[^.?]*does not glow/i, bulb],
];

function scienceKeys(q, notes) {
  if (!q || typeof q !== 'object' || !/^science\./.test(q.slot || '')) return q;
  const rule = RULES.find(([re]) => re.test(String(q.question || '')));
  return rule ? rule[1](q, notes) : q;
}

module.exports = { scienceKeys };
