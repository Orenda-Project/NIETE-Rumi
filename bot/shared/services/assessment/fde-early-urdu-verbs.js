'use strict';
/**
 * G2 Urdu Q4 verb items (v29 should-fix, bd-5jmnfj.4.58).
 *   - Q4 iii «بندر ٹوپی پہن کر بھاگ جاتا ہے۔» holds two verb forms, the converb «پہن کر» and the main verb «بھاگ جاتا
 *     ہے»; the key paid only the second. The converb is added to `accept` (it is not made of the key's words, so the
 *     key prints it under «یہ بھی درست»).
 *   - Q4 i «ہنس رہی ہے» accepted «ہنس رہی», but the key hides an accepted form made only of the key's own words, so
 *     the teacher never saw it. The first point's text now names it («… مختصر شکل بھی درست: ہنس رہی»).
 *
 * Pure: {examJson, notes}.
 */

const { mapItems } = require('./fde-early-urdu-walk');

const bare = (s) => String(s == null ? '' : s).replace(/[۔.،!؟?]+/gu, ' ').replace(/\s+/g, ' ').trim().normalize('NFC');
const tokens = (s) => bare(s).split(' ').filter(Boolean);

/** Converbs «X کر» in the sentence that the key's answer does not already hold. */
function converbs(q) {
  const words = tokens(q.question);
  const own = ` ${bare(q.answer)} `;
  return words.map((w, i) => (w === 'کر' && i > 0 ? `${words[i - 1]} کر` : null)).filter((c) => c && !own.includes(` ${c} `));
}

function fixItem(q, notes) {
  let scheme = { ...(q.scheme || {}) };
  const accept = Array.isArray(scheme.accept) ? scheme.accept.slice() : [];
  const have = new Set(accept.map(bare));
  const added = converbs(q).filter((c) => !have.has(c));
  if (added.length) {
    accept.push(...added);
    notes.push(`${q.slot}: «${added.join('، ')}» is a second verb form in «${bare(q.question)}» and is accepted`);
  }
  const keyWords = new Set(tokens(q.answer));
  const hidden = accept.filter((a) => { const t = tokens(a); return t.length > 1 && t.every((w) => keyWords.has(w)) && bare(a) !== bare(q.answer); });
  let points = scheme.points;
  if (hidden.length && Array.isArray(points) && points.length && !String(points[0].text || '').includes(hidden[0])) {
    points = [{ ...points[0], text: `${String(points[0].text || '').trim()} (مختصر شکل بھی درست: ${hidden.map(bare).join('، ')})` }, ...points.slice(1)];
    notes.push(`${q.slot}: the shorter accepted form «${hidden.map(bare).join('، ')}» is named in the marking point`);
  }
  // Named in the point, the shorter form leaves the accept line so the key does not print it twice (bd-5jmnfj.33.8).
  const named = hidden.length && Array.isArray(points) && points.length && String(points[0].text || '').includes(bare(hidden[0]));
  const kept = named ? accept.filter((a) => !hidden.includes(a)) : accept;
  if (!added.length && points === scheme.points && kept.length === accept.length) return q;
  scheme = { ...scheme, accept: kept, points };
  return { ...q, scheme };
}

function verbFix(examJson) {
  const notes = [];
  const out = mapItems(examJson, (q, type) => (type === 'Verbs' ? fixItem(q, notes) : q));
  return { examJson: out, notes };
}

module.exports = { verbFix, converbs };
