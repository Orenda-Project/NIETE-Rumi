'use strict';
/**
 * G5 Urdu Q6 poem explanation (v37r4 g5-urdu): the poem is printed under the title «ندی کی فریاد», and the key paid
 * 1.5 of 5 for «بولنے والا ندی ہے», which the title already tells. A scheme point whose content words are all found
 * in the title line (the passage's first line, when more lines follow) earns nothing a child has to work out, so it
 * is dropped and its marks go to the largest remaining point (the total stays). Speaker words (بولنے والا, کون)
 * and function words do not count as content. Pure: {examJson, notes}.
 */

const { mapAll } = require('./fde-urdu-walk-all');

const STOP = new Set(['ہے', 'ہیں', 'کا', 'کی', 'کے', 'کو', 'نے', 'میں', 'سے', 'اور', 'یہ', 'وہ', 'ہی', 'بھی', 'پر',
  'بولنے', 'والا', 'والی', 'والے', 'کہنے', 'کون', 'شاعر', 'نظم']);
const words = (s) => String(s || '').replace(/[ً-ٰٟ]/g, '').split(/[^\p{Script=Arabic}]+/u).filter(Boolean);
const content = (s) => words(s).filter((w) => !STOP.has(w));

function titleOf(passage) {
  const lines = String(passage || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 ? lines[0] : '';
}

function dropTitleGiveaway(examJson) {
  const notes = [];
  const out = mapAll(examJson, (q) => {
    if (!/^urdu\./.test(String(q.slot || ''))) return undefined;
    const pts = q.scheme && q.scheme.points;
    const title = titleOf(q.passage);
    if (!title || !Array.isArray(pts) || pts.length < 2) return undefined;
    const titleWords = new Set(content(title));
    const gives = (p) => { const c = content(p.text); return c.length > 0 && c.every((w) => titleWords.has(w)); };
    const dropped = pts.filter(gives);
    const kept = pts.filter((p) => !gives(p));
    if (!dropped.length || !kept.length) return undefined;
    const moved = dropped.reduce((s, p) => s + (Number(p.marks) || 0), 0);
    const top = kept.reduce((b, p, i) => ((Number(p.marks) || 0) > (Number(kept[b].marks) || 0) ? i : b), 0);
    const points = kept.map((p, i) => (i === top ? { ...p, marks: (Number(p.marks) || 0) + moved } : p));
    notes.push(`${q.slot}: «${dropped.map((p) => p.text).join('، ')}» is stated in the printed title «${title}»; its ${moved} marks moved to «${kept[top].text}»`);
    return { ...q, scheme: { ...q.scheme, points } };
  });
  return { examJson: out, notes };
}

module.exports = { dropTitleGiveaway };
