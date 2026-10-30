'use strict';
/**
 * G5 Maths key fixes from the v29 review (bd-5jmnfj.4.58 round 4), called from moreKeyFixes in fde-g5-key-fixes-2.js.
 *
 * - Ordering fractions: the common error named a slip that does not give its stated result. v29 Q2 vii said comparing only
 *   the numerators places 3/4 m as the shortest; the numerators 5, 7, 3 and 2 place 2/3 m there. The wrong order is worked
 *   out from the slip the key names (only numerators, or only denominators, the larger being taken as the greater) and the
 *   sentence is rewritten with the item it really gives. A sentence that already says so stays.
 * - Methods the stem excludes: «using the vertical method» or «using the division method» must not accept count-up,
 *   prime factorisation or listing multiples (v29 Q2 ii and iv).
 * - The unit mark: v29 Q7 and Q8 folded it into an A2 point reading «Correct answer 18 (Correct unit chosen (kg))». Q5 and Q6
 *   use a separate U1 point; the folded point is split into A (marks less one) and U1, the total unchanged.
 *
 * Pure: one item in, the item out; notes are strings pushed on `notes`. Never throws on an item it cannot read.
 */

const pts = (q) => (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : []);
const withScheme = (q, patch) => ({ ...q, scheme: { ...q.scheme, ...patch } });

const FRACTION = /(\d+)\/(\d+)((?: (?:m|cm|km|mm|kg|g|l|ml|litres?|metres?|hours?))?)(?!\d)/g;
const ASKS = /\b(?:arrange|order|put)\b[^.?]*\bfrom the (shortest|smallest|lightest|least)\b/i;

function orderingError(q, notes) {
  const error = q.scheme && q.scheme.common_error;
  const ask = ASKS.exec(String(q.question || ''));
  const slip = /only the (numerators|denominators)/i.exec(String(error || ''));
  if (!ask || !slip || /\d\s+\d+\/\d+/.test(q.question)) return q;
  const list = [...q.question.matchAll(FRACTION)].map((m) => ({ shown: `${m[1]}/${m[2]}${m[3]}`, key: Number(m[slip[1].toLowerCase() === 'numerators' ? 1 : 2]) }));
  const low = Math.min(...list.map((f) => f.key));
  const firsts = list.filter((f) => f.key === low);
  if (list.length < 3 || firsts.length !== 1) return q;
  if (new RegExp(`${firsts[0].shown.replace(/[/]/g, '\\/')} is placed as the ${ask[1]}`, 'i').test(error)) return q;
  const fixed = `Compares only the ${slip[1].toLowerCase()}, so ${firsts[0].shown} is placed as the ${ask[1].toLowerCase()}.`;
  notes.push(`${q.slot}: common error rewritten to the order the slip gives («${firsts[0].shown}» first)`);
  return withScheme(q, { common_error: fixed });
}

const OTHER = /\b(?:count-?up|adding on|prime factori[sz]ation|listing (?:the )?(?:common )?multiples|number line|repeated addition)\b/i;

function excludedMethods(q, notes) {
  const m = /\busing the ([a-z -]+?) method\b/i.exec(String(q.question || ''));
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : [];
  if (!m) return q;
  const kept = accept.filter((a) => !OTHER.test(String(a)) || new RegExp(m[1], 'i').test(a));
  if (kept.length === accept.length) return q;
  notes.push(`${q.slot}: accept no longer allows methods the stem excludes («using the ${m[1]} method»)`);
  return withScheme(q, { accept: kept });
}

const FOLDED = /^(.*?)\s*\(Correct unit chosen \((.+)\)\)\s*$/;

function unitMark(q, notes) {
  const points = pts(q);
  if (points.some((p) => p && p.kind === 'U') || !points.some((p) => p && FOLDED.test(String(p.text)) && p.marks >= 2)) return q;
  notes.push(`${q.slot}: the unit mark folded into an A point became a U1 point`);
  return withScheme(q, { points: points.flatMap((p) => {
    const m = p && p.marks >= 2 ? FOLDED.exec(String(p.text)) : null;
    return m ? [{ ...p, text: m[1], marks: p.marks - 1 }, { text: `Correct unit chosen (${m[2]})`, marks: 1, kind: 'U' }] : [p];
  }) });
}

function mathsKeys(q, notes) {
  if (!q || typeof q !== 'object' || !/^maths\./.test(q.slot || '')) return q;
  return unitMark(excludedMethods(orderingError(q, notes), notes), notes);
}

module.exports = { mathsKeys };
