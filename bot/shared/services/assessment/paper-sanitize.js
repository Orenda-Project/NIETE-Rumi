/**
 * Teacher-facing text the writer puts INTO a question (bd-firpy.5, port of the main bot's bd-firpy.3).
 *
 * eg.ict.math.system asks for a Bloom's level "in brackets at the end of the question statement" and
 * for "(Based on the chapter/concept: …)", and its Fill in the Blanks / Sequences lines are recipes the
 * model pastes in as the question ("Develop original, … without copying them directly with 2 options.").
 * ict-prompts.json is pinned key by key, so the prompt stays and this pass makes the paper certain.
 *
 * Anchored on purpose: only a trailing parenthetical that IS a Bloom's level, any "(Based on …)", and
 * the two template clauses go. Real content in brackets ("(longer / shorter)", "(Options: …)") stays.
 * The level itself is not lost: it lives in each question's `blooms` field.
 */
const BLOOM_LABEL = /\s*\((?:Remember(?:ing)?|Understand(?:ing)?|Apply(?:ing)?|Analy[sz](?:e|ing)|Evaluat(?:e|ing)|Creat(?:e|ing))\)\s*$/i;
const BASED_ON_TAG = /\s*\(Based on\b[^)]*\)/gi;
const TEMPLATE_PREFIX = /^\s*Develop original,\s*/i;
const TEMPLATE_CLAUSE = /\s+based on (?:the concepts and examples in the \w+ textbook without copying them directly|the textbook examples)(?: with \d+ options)?\./gi;

function sanitizeQuestionText(text) {
  if (typeof text !== 'string' || !text) return text;
  let s = text.replace(BASED_ON_TAG, '');
  let prev;
  do { prev = s; s = s.replace(BLOOM_LABEL, ''); } while (s !== prev);
  if (TEMPLATE_PREFIX.test(s)) {
    s = s.replace(TEMPLATE_PREFIX, '');
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  s = s.replace(TEMPLATE_CLAUSE, '.');
  // Untouched text is returned byte for byte: a passage's own spacing is not ours to normalise.
  return s === text ? text : s.trim();
}

/** Cleans every question / main_question / sub-question in the tree; `walk` visits each question. */
function sanitizePaper(examJson, walk) {
  let changed = 0;
  const clean = (obj, field) => {
    const before = obj[field];
    const after = sanitizeQuestionText(before);
    if (after !== before) { obj[field] = after; changed += 1; }
  };
  walk(examJson, (q) => {
    clean(q, 'question');
    clean(q, 'main_question');
    if (Array.isArray(q.sub_questions)) {
      q.sub_questions.forEach((sq) => sq && typeof sq === 'object' && clean(sq, 'question'));
    }
  });
  return changed;
}

module.exports = { sanitizeQuestionText, sanitizePaper };
