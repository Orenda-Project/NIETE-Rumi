'use strict';
/**
 * G2 Urdu Q7-Q9 writing marking (v29 should-fix, bd-5jmnfj.4.58). Each sentence was paid 2 marks with no guidance
 * for an unfinished sentence, a spelling slip or a sentence off the picture, so two markers would give different
 * totals. Every point's text now carries the same three levels in Urdu: 2, 1 and 0.
 *
 * Pure: {examJson, notes}. Idempotent. Only the 10-mark G2 writing slots; G1 Q10 (one sentence, 2 marks) is left.
 */

const { mapItems } = require('./fde-early-urdu-walk');

const ABOUT = {
  'Picture Sentences': 'تصویر کے بارے میں',
  'Topic Sentences': 'موضوع پر',
  Dialogue: 'منصوبے اور پچھلی بات کے مطابق',
};
const levels = (about) => ` — 2 نمبر: مکمل جملہ ${about}، املا درست یا ایک غلطی؛ 1 نمبر: ادھورا جملہ یا املا کی دو یا زیادہ غلطیاں؛ 0 نمبر: جملہ ${about} نہیں یا جملہ ہی نہیں`;

function writingMarking(examJson) {
  const notes = [];
  const out = mapItems(examJson, (q, type) => {
    const about = ABOUT[type];
    const pts = q.scheme && q.scheme.points;
    if (!about || !/^g2\./.test(String(q.slot)) || !Array.isArray(pts) || pts.some((p) => /املا/.test(p.text || ''))) return q;
    notes.push(`${q.slot}: each point states the 2 / 1 / 0 levels for a slip, an unfinished sentence and an off-topic sentence`);
    return { ...q, scheme: { ...q.scheme, points: pts.map((p) => ({ ...p, text: `${String(p.text || '').trim()}${levels(about)}` })) } };
  });
  return { examJson: out, notes };
}

module.exports = { writingMarking };
