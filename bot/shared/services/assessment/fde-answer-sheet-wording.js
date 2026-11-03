'use strict';
/**
 * A section the child answers on the answer sheet prints no frame or box on the question paper
 * (bd-5jmnfj.4.58.9.1, v37r5 G5 Science Q2 (a): "Draw a food chain ... in the frame below" with no frame).
 * Such a stem's "in the frame below" / "in the box below" / "in the space below" becomes
 * "on your answer sheet", and the item's own frame flag is dropped.
 *
 * Pure: exam JSON in, { examJson, notes } out.
 */
const BELOW = /\s+in the (frame|box|space) (below|given)\b/i;

function answerSheetWording(examJson) {
  const notes = [];
  const sections = (examJson && examJson._layout && examJson._layout.sections) || [];
  const sheet = new Set(sections.filter((s) => s && s.answer_on === 'answer_sheet')
    .flatMap((s) => (s.slots || []).map((x) => x.slot)));
  if (!sheet.size) return { examJson, notes };
  const fix = (q) => {
    if (!q || typeof q !== 'object' || !sheet.has(q.slot) || !BELOW.test(String(q.question || ''))) return q;
    const { frame, ...rest } = q; // eslint-disable-line no-unused-vars
    notes.push(`${q.slot}: "${String(q.question).match(BELOW)[0].trim()}" now reads "on your answer sheet"; the section is answered on the answer sheet`);
    return { ...rest, question: String(q.question).replace(BELOW, ' on your answer sheet') };
  };
  const unseen = Object.fromEntries(Object.entries(examJson.unseen || {}).map(([cat, byType]) => [cat,
    Object.fromEntries(Object.entries(byType || {}).map(([type, list]) => [type, Array.isArray(list) ? list.map(fix) : list]))]));
  return { examJson: { ...examJson, unseen }, notes };
}

module.exports = { answerSheetWording };
