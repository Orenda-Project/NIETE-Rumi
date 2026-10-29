'use strict';
/**
 * Two key mistakes the model makes on a G5 paper (bd-5jmnfj.4.57).
 *
 * - An English paragraph's model answer sets its own length: v25 said "5-8 sentences" while the
 *   marking line printed under it says "about 8–10". The marking template is the one source, so
 *   the answer takes its figure.
 * - An Urdu ارکان سازی key splits a word to a lone letter: v25 gave «دن – دا – ن – ساز» while the
 *   right «دن – دان – ساز» sat in accept. A clean accept split of the same letters is promoted;
 *   with none, the key stays and a note says so. A lone آ is a syllable, not a mistake.
 *
 * Pure: exam JSON in, { examJson, notes } out. Never throws on an item it cannot read.
 */

const { criteriaFor } = require('./composition-criteria');

const RANGE = /\b(\d+)\s*[-–]\s*(\d+)\s+sentences\b/;
const SYLLABLES = /ارکان/;
const DASH = /\s*[–\-+]\s*/;

/** "8–10 sentences" from the template's length row; null if the template has none. */
function paragraphLength() {
  const row = criteriaFor('paragraph', 10, 'en').find((r) => /length/i.test(r.name));
  const m = row && RANGE.exec(row.look_for || '');
  return m ? m[0] : null;
}

/** "word: p1 – p2" or "p1 – p2" → { head, parts }. */
function readSegment(seg) {
  const [head, body] = seg.includes(':') ? seg.split(/:\s*/, 2) : [null, seg];
  return { head, parts: String(body).split(DASH).map((p) => p.trim()).filter(Boolean) };
}

const loneLetter = (parts) => parts.some((p) => [...p].length === 1 && p !== 'آ');
const joined = (parts) => parts.join('').replace(/\s+/g, '');

function fixSyllables(q, notes) {
  const text = `${q.main_question || ''} ${q.question || ''}`;
  if (!SYLLABLES.test(text) || typeof q.answer !== 'string') return q;
  const segs = q.answer.split(/\s*؛\s*/);
  const read = segs.map(readSegment);
  if (!read.some((r) => loneLetter(r.parts))) return q;
  const accept = ((q.scheme && q.scheme.accept) || []).flatMap((a) => String(a).split(/\s*؛\s*|\s+اور\s+/))
    .map(readSegment).filter((r) => r.parts.length > 1 && !loneLetter(r.parts));
  let fixed = true;
  const swaps = [];
  const out = read.map((r, i) => {
    if (!loneLetter(r.parts)) return segs[i];
    const alt = accept.find((a) => joined(a.parts) === joined(r.parts));
    if (!alt) { fixed = false; return segs[i]; }
    const sep = segs[i].includes('+') ? ' + ' : ' – ';
    const split = alt.parts.join(sep);
    swaps.push([r.parts.join(sep), split]);
    return r.head ? `${r.head}: ${split}` : split;
  });
  const answer = out.join('؛ ');
  notes.push({ slot: q.slot, reason: 'syllables', fixed, answer: q.answer, ...(fixed ? { promoted: answer } : {}) });
  if (!fixed) return q;
  // A marking point that quotes the broken split quotes the promoted one instead.
  const swap = (t) => swaps.reduce((acc, [from, to]) => acc.split(from).join(to), t);
  const points = q.scheme && Array.isArray(q.scheme.points)
    ? q.scheme.points.map((pt) => (pt && typeof pt.text === 'string' ? { ...pt, text: swap(pt.text) } : pt))
    : null;
  return { ...q, answer, ...(points ? { scheme: { ...q.scheme, points } } : {}) };
}

function keyFixes(examJson) {
  const notes = [];
  const slots = ((examJson && examJson._layout && examJson._layout.sections) || []).flatMap((s) => s.slots || []);
  const paragraphs = new Set(slots.filter((s) => /^english\./.test(s.slot) && (s.kinds || []).includes('paragraph')).map((s) => s.slot));
  const length = paragraphs.size ? paragraphLength() : null;
  const fix = (q) => {
    if (!q || typeof q !== 'object') return q;
    if (length && paragraphs.has(q.slot) && typeof q.answer === 'string' && RANGE.test(q.answer)) {
      return { ...q, answer: q.answer.replace(RANGE, length) };
    }
    return fixSyllables(q, notes);
  };
  const unseen = Object.fromEntries(Object.entries((examJson && examJson.unseen) || {}).map(([cat, byType]) => [cat,
    Object.fromEntries(Object.entries(byType || {}).map(([type, list]) => [type, Array.isArray(list) ? list.map(fix) : list]))]));
  return { examJson: { ...examJson, unseen }, notes };
}

module.exports = { keyFixes };
