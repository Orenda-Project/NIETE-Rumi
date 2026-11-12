/**
 * bd-ipoxhx.1 — on a "Both" paper the questions lifted from the textbook stay inside the categories she
 * chose. Objective types only → no seen short/long answers; subjective only → no seen MCQs. Mixed (or no
 * types) → no restriction, so those papers are exactly what they always were.
 */
const ALL = ['objective', 'subjective'];

function seenCategoriesOf(questionTypes) {
  const cats = new Set((questionTypes || []).map((t) => (t.category === 'objective' ? 'objective' : 'subjective')));
  if (cats.size !== 1) return ALL.slice();
  return [...cats];
}

/** The words appended to the seen line of the prompt; empty when nothing is restricted. */
function seenCategoryLine(questionTypes) {
  const cats = seenCategoriesOf(questionTypes);
  if (cats.length !== 1) return '';
  return cats[0] === 'objective'
    ? '. Objective questions only (MCQs, fill in the blanks, true/false, matching) — no short or long answer questions'
    : '. Subjective questions only (short and long answers) — no MCQs or other objective questions';
}

function _countIn(node) {
  if (Array.isArray(node)) return node.length;
  if (!node || typeof node !== 'object') return 0;
  return Object.values(node).reduce((s, v) => s + _countIn(v), 0);
}

/** Drop seen categories she did not choose. Returns how many questions were removed. */
function keepSeenCategories(examJson, questionTypes) {
  const branch = examJson?.seen;
  if (!branch || typeof branch !== 'object') return 0;
  const keep = new Set(seenCategoriesOf(questionTypes));
  let removed = 0;
  for (const cat of Object.keys(branch)) {
    if (keep.has(cat)) continue;
    removed += _countIn(branch[cat]);
    delete branch[cat];
  }
  return removed;
}

module.exports = { seenCategoriesOf, seenCategoryLine, keepSeenCategories };
