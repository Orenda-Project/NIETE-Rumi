/**
 * bd-snkn32.48 — Science own plans name each new English key word in Urdu too (the shelf reviewer's 9B, "Bilingual
 * Concept Glossary": EN term of record + Urdu gloss at first use). The v9 keyword item is {word, meaning} only and the
 * Science brief already allows Urdu "only as a keyword gloss" (brief_author_v3_flash_sci §7b), so the gloss rides in
 * the word itself, in brackets.
 *
 * Pure: no I/O.
 */

const SCIENCE = /(^|_|\b)(physics|chemistry|biology|science)(_|\b|$)/i;

/** @param ctx {{subject?:string, segmentId?:string}} */
function isScience(ctx) {
  const c = ctx || {};
  if (c.subject && SCIENCE.test(String(c.subject))) return true;
  const stem = String(c.segmentId || '').split('.')[0];
  return SCIENCE.test(stem);
}

const SCIENCE_GLOSS_LINE = 'Science key words: every keyword `word` keeps its English term and adds its Urdu name in Urdu script in brackets, for example "free fall (آزادانہ گراوٹ)". Use the same English word with its Urdu name the first time it is said in I do.';

const URDU = /[؀-ۿ]/;

/** Key words with no Urdu script in word or meaning (for a counter log; never fails her plan). */
function missingGlosses(doc) {
  if (!doc || !Array.isArray(doc.sections)) return [];
  const out = [];
  for (const s of doc.sections) {
    for (const b of (s && Array.isArray(s.blocks) ? s.blocks : [])) {
      if (!b || b.type !== 'keywords' || !Array.isArray(b.items)) continue;
      for (const it of b.items) if (it && !URDU.test(`${it.word || ''} ${it.meaning || ''}`)) out.push(it.word);
    }
  }
  return out;
}

module.exports = { isScience, missingGlosses, SCIENCE_GLOSS_LINE };
