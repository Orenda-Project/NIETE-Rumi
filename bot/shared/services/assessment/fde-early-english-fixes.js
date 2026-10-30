'use strict';
/**
 * v28 Grade 1-2 English keys that refused or mis-set a right answer (bd-5jmnfj.4.58.4):
 *   - G1 English Q6 keyed three rhymes per item while cat (Q3 i), hat (Q4 v), fan (Q3 iii) and pen are printed
 *     elsewhere on the paper and are real rhymes. Every word printed on the paper that shares the given word's
 *     rime (last vowel to the end) joins scheme.accept.
 *   - G2 English Q11 keyed «He» while accept held «He is playing outside.»; the sentence becomes the answer and
 *     the point pays the correct pronoun in it.
 *   - G2 English Q10 ii keyed «in» for a bird in a tree and called «on» an error; a tree or branch accepts both.
 *
 * Runs after earlyKeyFixes in fde-early-writer. Pure: takes and returns {examJson, notes}.
 */

const { earlyEnglishFixes2 } = require('./fde-early-english-fixes-2');

const RHYMES = 'Rhyming Pairs';
const PRONOUNS = 'Pronouns';
const PREPOSITIONS = 'Prepositions';
const WORD = /[A-Za-z]+/g;
const PRONOUN = /^(he|she|it|they)$/i;
const TREE = /\b(tree|branch|branches)\b/i;

// «rat» → «at», «cake» → «ake»: the last vowel group (with a silent e) to the end.
function rime(word) {
  const w = String(word).toLowerCase();
  const m = /[aeiou][^aeiou]e$/.exec(w) || /[aeiou]+[^aeiou]*$/.exec(w);
  return m ? m[0] : null;
}

function eachItem(examJson, fn) {
  for (const cats of Object.values((examJson && examJson.unseen) || {})) {
    for (const list of Object.values(cats || {})) if (Array.isArray(list)) list.forEach((q) => q && fn(q));
  }
}

const optionText = (o) => String(o).replace(/^\s*\(?[a-d]\)\s*/i, '');

// Every word the paper prints or draws: stems, options, word boxes, picture names.
function printedWords(examJson) {
  const words = new Set();
  const add = (text) => (String(text || '').match(WORD) || []).forEach((w) => words.add(w.toLowerCase()));
  eachItem(examJson, (q) => {
    add(q.main_question); add(q.question); add(q.passage);
    (q.options || []).forEach((o) => add(optionText(o)));
    (q.words || []).forEach(add);
    if (q.picture && q.picture.name) add(q.picture.name);
  });
  return words;
}

function fixRhyme(q, words, notes) {
  const given = String(q.question || '').trim().toLowerCase();
  const sound = rime(given);
  if (!sound || !q.scheme) return q;
  const have = new Set([given, String(q.answer || '').trim().toLowerCase(),
    ...(q.scheme.accept || []).map((a) => String(a).trim().toLowerCase())]);
  const added = [...words].filter((w) => w.length >= 3 && !have.has(w) && rime(w) === sound);
  if (!added.length) return q;
  notes.push(`${q.slot}: «${given}» also accepts ${added.join(', ')} (printed elsewhere on the paper)`);
  return { ...q, scheme: { ...q.scheme, accept: (q.scheme.accept || []).concat(added) } };
}

function fixPronoun(q, notes) {
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : [];
  if (!PRONOUN.test(String(q.answer || '').trim())) return q;
  const sentence = accept.find((a) => new RegExp(`^${String(q.answer).trim()}\\b.+\\s`, 'i').test(String(a)));
  if (!sentence) return q;
  const points = (q.scheme.points || []).map((p, i) => (i === 0
    ? { ...p, text: 'Writes the correct pronoun in the rewritten sentence' } : p));
  notes.push(`${q.slot}: «${q.question}» keys the rewritten sentence «${sentence}», not the lone pronoun`);
  return { ...q, answer: sentence, scheme: { ...q.scheme, points, accept: accept.filter((a) => a !== sentence) } };
}

function fixTree(q, notes) {
  const answer = String(q.answer || '').trim().toLowerCase();
  const other = { in: 'on', on: 'in' }[answer];
  const scene = `${q.question || ''} ${(q.picture && q.picture.describe) || ''}`;
  if (!other || !TREE.test(scene) || !q.scheme) return q;
  const accept = q.scheme.accept || [];
  const error = typeof q.scheme.common_error === 'string' && new RegExp(`\\b${other}\\b[^.]*\\binstead of ${answer}\\b|\\b${answer}\\b[^.]*\\binstead of ${other}\\b`, 'i').test(q.scheme.common_error)
    && /instead of/i.test(q.scheme.common_error);
  const scheme = { ...q.scheme, accept: accept.includes(other) ? accept : accept.concat(other) };
  if (error) delete scheme.common_error;
  notes.push(`${q.slot}: «${q.question}» accepts in and on for a tree or branch`);
  return { ...q, scheme };
}

function earlyEnglishFixes(prev) {
  const { examJson } = prev;
  const notes = prev.notes ? prev.notes.slice() : [];
  if (!examJson || typeof examJson !== 'object' || !examJson.unseen) return { examJson, notes };
  const types = new Map();
  ((examJson._layout && examJson._layout.sections) || []).forEach((s) => (s.slots || []).forEach((sl) => types.set(sl.slot, sl.type)));
  const words = printedWords(examJson);
  const fix = (q) => {
    if (!q || typeof q !== 'object') return q;
    const type = types.get(q.slot);
    if (/^g1\.english\./.test(q.slot || '') && type === RHYMES) return fixRhyme(q, words, notes);
    if (/^g2\.english\./.test(q.slot || '') && type === PRONOUNS) return fixPronoun(q, notes);
    if (/^g2\.english\./.test(q.slot || '') && type === PREPOSITIONS) return fixTree(q, notes);
    return q;
  };
  const unseen = Object.fromEntries(Object.entries(examJson.unseen).map(([cat, byType]) => [cat,
    !byType || typeof byType !== 'object' ? byType
      : Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, Array.isArray(list) ? list.map(fix) : list]))]));
  return earlyEnglishFixes2({ examJson: { ...examJson, unseen }, notes });
}

module.exports = { earlyEnglishFixes, rime };
