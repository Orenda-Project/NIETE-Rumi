'use strict';
/**
 * Two more G5 key mistakes (bd-5jmnfj.4.58.4), called from keyFixes in fde-g5-key-fixes.js.
 *
 * - G5 Urdu Q3: the key accepted «مثالی» (exemplary, ideal) for تمثیلی (allegorical), a different meaning.
 *   «مثالی» is removed from the model answer's line and from the accept entries for تمثیلی; an accept entry
 *   left with no meaning goes.
 * - G5 Science Q3(b) 5: for one battery and one bulb the key paid 2 marks for «the battery is connected correctly
 *   (positive and negative terminals) and is not dead». Polarity does not matter there: the point and the model
 *   answer keep «the battery is not dead» only, marks unchanged.
 *
 * Pure: one item in, the item out; notes are strings pushed on `notes`. Never throws on an item it cannot read.
 */

const { scienceKeys } = require('./fde-science-keys'); // bd-5jmnfj.4.58 round 4
const { mathsKeys } = require('./fde-maths-keys');

const WORD = 'تمثیلی';
const WRONG = 'مثالی';
const meaningsOf = (line) => line.slice(line.indexOf(':') + 1).split('،').map((m) => m.trim()).filter(Boolean);
const isWordLine = (line) => line.trim().startsWith(`${WORD}:`);
const without = (line) => `${WORD}: ${meaningsOf(line).filter((m) => m !== WRONG).join('، ')}`;

function fixAllegorical(q, notes) {
  const hit = (s) => typeof s === 'string' && s.split('\n').some((l) => isWordLine(l) && meaningsOf(l).includes(WRONG));
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : [];
  if (!hit(q.answer) && !accept.some(hit)) return q;
  const answer = typeof q.answer === 'string'
    ? q.answer.split('\n').map((l) => (isWordLine(l) && meaningsOf(l).includes(WRONG) ? without(l) : l)).join('\n') : q.answer;
  const kept = accept.flatMap((a) => {
    if (!hit(a)) return [a];
    return meaningsOf(a).filter((m) => m !== WRONG).length ? [without(a)] : [];
  });
  notes.push(`${q.slot}: removed «${WRONG}» as an accepted meaning of ${WORD}; it is a different meaning`);
  return { ...q, answer, ...(q.scheme ? { scheme: { ...q.scheme, accept: kept } } : {}) };
}

const POLARITY = /positive and negative|right way round|polarity|terminals/i;
const SENTENCE = /\s*[^.]*(?:positive and negative|right way round|polarity|terminals)[^.]*\./i;
const DEAD = /not dead|flat/i;

function fixPolarity(q, notes) {
  const question = String(q.question || '');
  if (q.slot !== 'science.C.Q3b' || !/\ba battery\b/i.test(question) || /batteries|\bcells?\b/i.test(question)) return q;
  const points = q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [];
  if (!points.some((p) => p && POLARITY.test(String(p.text || '')) && DEAD.test(p.text))) return q;
  const fixedPoints = points.map((p) => (p && POLARITY.test(String(p.text || '')) && DEAD.test(p.text) ? { ...p, text: 'Check the battery is not dead' } : p));
  const answer = typeof q.answer === 'string' ? q.answer.replace(SENTENCE, ' They should also check that the battery is not dead.').trim() : q.answer;
  notes.push('science.C.Q3b: dropped the battery polarity clause (one battery and one bulb, so direction does not matter); kept "battery is not dead", marks unchanged');
  return { ...q, answer, scheme: { ...q.scheme, points: fixedPoints } };
}

function moreKeyFixes(q, notes) {
  return mathsKeys(scienceKeys(fixPolarity(fixAllegorical(q, notes), notes), notes), notes);
}

module.exports = { moreKeyFixes };
