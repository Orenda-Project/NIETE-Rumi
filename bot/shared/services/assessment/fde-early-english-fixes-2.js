'use strict';
/**
 * v29 Grade 1-2 English keys and schemes (bd-5jmnfj.4.58.4, round 4). Fixed in code, after earlyEnglishFixes:
 *   - G1 Q8 paid the -ing form only and listed the plain verb as the error: the plain verb is accepted, the error goes.
 *   - G1 Q14 said one capital letter where «dani helps dadi.» needs two: the mark point names every capital.
 *   - G1 Q12 paid 1 of 2 marks for copying the capital and full stop of the printed «This is a ____.»: the marks pay
 *     naming the object and spelling it.
 *   - G2 Q12 paid «describing words» and capitals / full stops (Q14 teaches those): five paragraph points that are not Q14's.
 *   - G2 Q16 zeroed the item on one misplacement: each sentence is marked by the sentence it follows.
 *   - G2 Q1 split one answer into two marks: a why / how question with one idea pays one 2-mark point.
 *   - G1 Q6 / G2 Q3 rhyme items: the stem names the picture word (hat could be «cap»); an incoherent common error is replaced.
 * Pure: takes {examJson, notes} (or an exam) and returns {examJson, notes}; never throws.
 */

const { describe210, bandStoryOrder } = require('./fde-english-r3-mends'); // v37 r3: 2/1/0 descriptors, story order by position
const { earlyEnglishAccepts } = require('./fde-early-english-accepts'); // v37r6: no «near» / non-opposite accepts

const E_VERBS = new Set(['writ', 'danc', 'rid', 'driv', 'mak', 'tak', 'com', 'hav', 'giv', 'liv', 'smil', 'wav', 'bak', 'lov', 'shar', 'chas', 'skat']);
const STEM_CUE = /\b(and|two|three|both)\b/i;
const ONE_IDEA = /^(why|how|what would)\b/i;

const sum = (points) => points.reduce((n, p) => n + p.marks, 0);

function baseVerbs(ing) {
  const stem = String(ing).trim().toLowerCase().replace(/ing$/, '');
  if (!stem || stem === String(ing).trim().toLowerCase()) return [];
  // «running» gives run, never the non-word «runn»; «kissing», «falling» keep their double letter.
  const out = [/([^aeiouslfz])\1$/.test(stem) ? stem.slice(0, -1) : stem];
  if (E_VERBS.has(stem)) out.push(`${stem}e`);
  return out;
}

function fixAction(q, notes) {
  const bases = baseVerbs(q.answer);
  if (!bases.length) return q;
  const accept = (q.scheme.accept || []).slice();
  bases.forEach((b) => { if (!accept.some((a) => a.toLowerCase() === b)) accept.push(b); });
  const points = q.scheme.points.map((p) => ({ ...p, text: 'the action shown, as the -ing word or the plain verb' }));
  notes.push(`${q.slot}: «${q.question}» accepts ${bases.join(' / ')}; base-verb error dropped`);
  return { ...q, scheme: { ...q.scheme, accept, points, common_error: 'Naming an action the picture does not show.' } };
}

function fixCapitals(q, notes) {
  const caps = String(q.answer || '').match(/\b[A-Z][a-z]*/g) || [];
  if (!caps.length || !q.scheme.points.length) return q;
  const text = caps.length === 1 ? `capital letter used correctly (${caps[0]})` : `all ${caps.length} capital letters correct (${caps.join(', ')})`;
  const points = q.scheme.points.map((p, i) => (i === 0 ? { ...p, text } : p));
  notes.push(`${q.slot}: «${q.question}» mark point names ${caps.length} capital(s)`);
  return { ...q, scheme: { ...q.scheme, points } };
}

function fixThisIsA(q, notes) {
  const name = q.picture && q.picture.name;
  if (!name || !q.scheme.points.some((p) => /capital|full stop|sentence/i.test(p.text))) return q;
  const first = Math.max(1, Math.floor(q.marks / 2));
  const points = [{ text: `names the object correctly (${name})`, marks: first, kind: 'K' }, { text: 'spells the word correctly', marks: q.marks - first, kind: 'K' }];
  notes.push(`${q.slot}: «${name}» marks pay naming and spelling, not the printed frame`);
  return { ...q, scheme: { ...q.scheme, points } };
}

function fixParagraph(q, notes) {
  const per = q.marks / 5;
  if (!Number.isInteger(per) || !q.scheme.points.some((p) => /describing|capital|full stop/i.test(p.text))) return q;
  const texts = ['Writes about the topic: every sentence is about the house', 'Writes five sentences', 'Each sentence gives a different fact about the house',
    'The sentences follow a sensible order', 'Spells familiar words correctly'];
  notes.push(`${q.slot}: paragraph points rewritten (no describing words, no Q14 mechanics)`);
  return { ...q, scheme: { ...q.scheme, points: texts.map((text) => ({ text, marks: per, kind: 'K' })) } };
}

function fixStoryOrder(q, notes) {
  const order = String(q.answer || '').split(/[\s,]+/).filter(Boolean);
  const pts = q.scheme.points;
  if (order.length !== pts.length || !order.every((l) => /^[a-z]$/i.test(l)) || pts.some((p) => /straight after/i.test(p.text))) return q;
  const points = pts.map((p, i) => ({ ...p, text: i === 0 ? `Sentence (${order[0]}) is first` : `Sentence (${order[i]}) comes straight after (${order[i - 1]})` }));
  notes.push(`${q.slot}: each sentence marked by what it follows`);
  return { ...q, scheme: { ...q.scheme, points } };
}

function fixPassageQuestion(x, notes, slot) {
  const pts = x && x.scheme && x.scheme.points;
  if (!pts || pts.length !== 2 || STEM_CUE.test(x.question) || !ONE_IDEA.test(x.question) || sum(pts) !== x.marks) return x;
  notes.push(`${slot}: «${x.question}» one answer, one ${x.marks}-mark point`);
  const text = `Gives the answer: ${pts[0].text}; ${pts[1].text} (1 mark if only part of it is given)`;
  return { ...x, scheme: { ...x.scheme, points: [{ text, marks: x.marks, kind: pts[0].kind }] } };
}

function fixRhyme(q, notes) {
  const name = q.picture && q.picture.name;
  if (!name) return q;
  let out = q;
  if (!new RegExp(`\\b${name}\\b`, 'i').test(q.question)) out = { ...out, question: `Write a word that rhymes with ${name}.` };
  if (/near sounds|-like\b/i.test(String(q.scheme.common_error))) {
    out = { ...out, scheme: { ...q.scheme, common_error: `Writing a word that does not rhyme with ${name}, such as one that only starts with the same letter.` } };
  }
  if (out !== q) notes.push(`${q.slot}: rhyme stem names «${name}»`);
  return out;
}

// G1 Q4 «b e e» for bee: letters printed in the answer's own order are copied, not built (v37 round 6). A fixed rotation
// of the letters is printed instead; a word with no other order is flagged in the notes and kept.
function fixUnscramble(q, notes) {
  const answer = String(q.answer || '').trim().toLowerCase();
  const letters = String(q.question || '').trim().split(/\s+/);
  if (!answer || letters.join('').toLowerCase() !== answer) return q;
  for (let k = 1; k < letters.length; k += 1) {
    const turned = letters.slice(k).concat(letters.slice(0, k));
    if (turned.join('').toLowerCase() !== answer) {
      notes.push(`${q.slot}: «${q.question}» printed the answer's own order; now «${turned.join(' ')}»`);
      return { ...q, question: turned.join(' ') };
    }
  }
  notes.push(`${q.slot}: «${q.question}» has no other order than the answer; replace the word`);
  return q;
}

const BY_SLOT = [
  [/^g1\.english\.A\.Q4$/, fixUnscramble],
  [/^g1\.english\.B\.Q8$/, fixAction], [/^g1\.english\.C\.Q14$/, fixCapitals], [/^g1\.english\.C\.Q12$/, fixThisIsA],
  [/^g2\.english\.C\.Q12$/, (q, n) => describe210(fixParagraph(q, n), n)], [/^g2\.english\.C\.Q15$/, describe210], [/^g2\.english\.C\.Q16$/, (q, n) => bandStoryOrder(fixStoryOrder(q, n), n)],
  [/^g1\.english\.B\.Q6$|^g2\.english\.B\.Q3$/, fixRhyme],
];

function fixOne(q, notes) {
  if (!q || typeof q !== 'object' || typeof q.slot !== 'string') return q;
  if (q.slot === 'g2.english.A.Q1' && Array.isArray(q.questions)) return { ...q, questions: q.questions.map((x) => fixPassageQuestion(x, notes, q.slot)) };
  if (!q.scheme) return q;
  const hit = BY_SLOT.find(([re]) => re.test(q.slot));
  if (!hit) return q;
  try { return hit[1](q, notes); } catch (e) { return q; }
}

function earlyEnglishFixes2(input) {
  const prev = input && input.examJson ? input : { examJson: input, notes: [] };
  const { examJson } = prev;
  const notes = prev.notes ? prev.notes.slice() : [];
  if (!examJson || typeof examJson !== 'object' || !examJson.unseen) return { examJson, notes };
  const unseen = Object.fromEntries(Object.entries(examJson.unseen).map(([cat, byType]) => [cat,
    !byType || typeof byType !== 'object' ? byType
      : Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, Array.isArray(list) ? list.map((q) => fixOne(q, notes)) : list]))]));
  return earlyEnglishAccepts({ examJson: { ...examJson, unseen }, notes });
}

module.exports = { earlyEnglishFixes2 };
