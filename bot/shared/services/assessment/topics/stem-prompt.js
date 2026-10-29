'use strict';
/**
 * Her ticked question stems in the paper writer (bd-6clakk.12). A stem is the shared instruction a
 * group of questions prints once (main_question), so the prompt tells the writer to use one of her
 * stems, word for word, and applyStems checks the paper it wrote.
 *
 * Pure: no I/O. With no stems ticked both are no-ops, so every other paper is unchanged.
 */

const withStems = (types) => (Array.isArray(types) ? types : [])
  .filter((t) => t && Array.isArray(t.stems) && t.stems.length);

/** Prompt lines for the types that carry stems; '' when none do. */
function stemsBlock(types) {
  const picked = withStems(types);
  if (!picked.length) return '';
  const lines = picked.map((t) => `• For ${t.id}: set every question's main_question to one of these instructions, `
    + `word for word, and write questions that fit it: ${t.stems.map((s) => `"${s}"`).join(' / ')}`);
  return `\nTHE TEACHER CHOSE THESE QUESTION INSTRUCTIONS:\n${lines.join('\n')}\n`;
}

// Case, spacing and the end mark (. ۔ ? ! :) do not make a different stem.
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.۔?!:]+$/u, '').trim();

/**
 * Sets a main_question that is one of the type's stems to that stem exactly, and returns the
 * questions that use none of them as misses ({type, main_question}), left as written.
 */
function applyStems(examJson, types) {
  const misses = [];
  const unseen = examJson && examJson.unseen;
  if (!unseen || typeof unseen !== 'object') return { misses };
  for (const t of withStems(types)) {
    const byNorm = new Map(t.stems.map((s) => [norm(s), s]));
    for (const section of Object.values(unseen)) {
      if (!section || typeof section !== 'object') continue;
      // The writer may key a type in another case ("Fill in the blanks" for "Fill in the Blanks").
      const key = Object.keys(section).find((k) => norm(k) === norm(t.id));
      const items = key && section[key];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const hit = byNorm.get(norm(item.main_question));
        if (hit) item.main_question = hit;
        else misses.push({ type: t.id, main_question: item.main_question });
      }
    }
  }
  return { misses };
}

module.exports = { stemsBlock, applyStems };
