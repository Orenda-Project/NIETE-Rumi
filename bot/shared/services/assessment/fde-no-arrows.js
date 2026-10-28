'use strict';
/**
 * No arrows where a child or a teacher reads (bd-5jmnfj.4.50.1). v22 printed «بادل، بجلی، گھٹا،
 * موسلادھار ← یہ سب الفاظ…» in a Grade 5 Urdu question: the model wrote the arrow into the text.
 * Every arrow in an item (question, options, answer, scheme, parts) becomes a dash. A match item's
 * answer is left as it is: the paper prints only its Column B side (fde-match-block matchAnswer).
 * Pure: exam JSON in, exam JSON out; `_layout` is not touched.
 */

const ARROW = /[←→⟵⟶➔➜⇐⇒]|-+>/;
const ARROWS = new RegExp(`\\s*(?:${ARROW.source})\\s*`, 'g');

/** «a ← b» → «a – b»; a string with no arrow comes back as it was. */
function unarrow(text) {
  if (!ARROW.test(text)) return text;
  return text.replace(ARROWS, ' – ').replace(/^\s*–\s*|\s*–\s*$/g, '');
}

const plain = (v) => Boolean(v) && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

function noArrows(examJson) {
  const match = new Set(((examJson._layout && examJson._layout.sections) || [])
    .flatMap((s) => s.slots || []).filter((s) => s.shape === 'match').map((s) => s.slot));
  const clean = (value) => {
    if (typeof value === 'string') return unarrow(value);
    if (Array.isArray(value)) return value.map(clean);
    if (!plain(value)) return value;
    const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
    return match.has(value.slot) && 'answer' in value ? { ...out, answer: value.answer } : out;
  };
  return Object.fromEntries(Object.entries(examJson).map(([k, v]) => [k, k.startsWith('_') ? v : clean(v)]));
}

module.exports = { noArrows, unarrow };
