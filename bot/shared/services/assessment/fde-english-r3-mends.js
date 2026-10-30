'use strict';
/**
 * v37 round 3 English mends (W-EN3), called from fde-early-english-fixes-2 and fde-g5-lang-fixes. Pure, never throws.
 *   describe210     a 2-mark criterion with no 2/1/0 wording gains generic descriptors (G2 Q12 «My House», Q15).
 *   bandStoryOrder  G2 Q16 scored by six adjacency marks cost several marks for one displaced sentence: one point of the
 *                   slot total, full marks in order, minus 1 per sentence out of place, never below 0.
 *   sentenceStem    G5 Q2 part i pays «Answers in a complete sentence» but the stem never asks for one: the stem says so.
 */

const HAS_BANDS = /\b2\b[^.]*\b1\b[^.]*\b0\b/;
const SENTENCE_POINT = /\bcomplete\s+sentence/i;
const ASKS_SENTENCE = /\b(?:complete|full|whole)\s+sentences?\b/i;
const INSTRUCTION = 'Answer in complete sentences.';

function describe210(q, notes) {
  const pts = q && q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : null;
  if (!pts || !pts.some((p) => p && Number(p.marks) === 2 && !HAS_BANDS.test(String(p.text)))) return q;
  const points = pts.map((p) => (p && Number(p.marks) === 2 && !HAS_BANDS.test(String(p.text))
    ? { ...p, text: `${String(p.text).replace(/[.:;\s]+$/, '')}: 2 if fully met, 1 if partly met, 0 if not met` } : p));
  notes.push(`${q.slot}: 2-mark criteria carry 2/1/0 descriptors`);
  return { ...q, scheme: { ...q.scheme, points } };
}

function bandStoryOrder(q, notes) {
  const pts = q && q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : null;
  const total = pts ? pts.reduce((n, p) => n + Number(p.marks || 0), 0) : 0;
  if (!pts || pts.length < 2 || total <= 0 || pts.some((p) => /out of place/i.test(String(p.text)))) return q;
  const text = `Puts the sentences in order: ${total} if every sentence is in place, minus 1 for each sentence out of place, never below 0`;
  notes.push(`${q.slot}: story order scored by position banding (${total} marks, minus 1 per sentence out of place)`);
  return { ...q, scheme: { ...q.scheme, points: [{ text, marks: total, kind: pts[0].kind || 'K' }] } };
}

function sentenceStem(q, notes) {
  const part = q && Array.isArray(q.parts) ? q.parts.find((p) => p && p.key === 'questions') : null;
  if (!part || !Array.isArray(part.questions)) return q;
  let changed = false;
  const questions = part.questions.map((x) => {
    const pts = x && x.scheme && Array.isArray(x.scheme.points) ? x.scheme.points : [];
    if (!pts.some((p) => SENTENCE_POINT.test(String(p && p.text))) || ASKS_SENTENCE.test(String(x.question))) return x;
    changed = true;
    return { ...x, question: `${String(x.question).trim()} ${INSTRUCTION}` };
  });
  if (!changed) return q;
  notes.push(`${q.slot}: part i stem asks for a complete sentence where the scheme pays one`);
  return { ...q, parts: q.parts.map((p) => (p === part ? { ...p, questions } : p)) };
}

module.exports = { describe210, bandStoryOrder, sentenceStem };
