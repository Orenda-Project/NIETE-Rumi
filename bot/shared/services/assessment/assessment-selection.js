'use strict';
/**
 * Which questions stay on the paper.
 *
 * A generated paper is a tree, and the teacher's edit is a set of ticks against
 * it. This module is the one place that knows how to name a question inside that
 * tree and how to build a smaller tree from a set of names.
 *
 * The id is the PATH — `seen.objective.MCQs.0` — not a position in the printed
 * list. Printed position is a property of the whole tree: untick question 2 and
 * everything after it renumbers, so a stored "question 4" would silently come to
 * mean a different question than the one she unticked. The path only changes if
 * the tree itself is regenerated, and a regeneration is a new paper with a new
 * row.
 *
 * The traversal deliberately mirrors the renderer's `collectQuestions`. They must
 * agree on order, because her ticks are numbered against what the paper printed;
 * a test pins the two together.
 */

/** The tree's two shapes: a flat array under a type, or sub-types under a type. */
function _walk(examJson, visit) {
  for (const section of ['seen', 'unseen']) {
    const branch = examJson?.[section];
    if (!branch || typeof branch !== 'object') continue;
    for (const [category, types] of Object.entries(branch)) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, entry] of Object.entries(types)) {
        if (Array.isArray(entry)) {
          entry.forEach((q, i) => q && visit({
            path: [section, category, type], index: i, question: q, type,
          }));
        } else if (entry && typeof entry === 'object') {
          for (const [subType, list] of Object.entries(entry)) {
            if (!Array.isArray(list)) continue;
            list.forEach((q, i) => q && visit({
              path: [section, category, type, subType], index: i, question: q, type: subType,
            }));
          }
        }
      }
    }
  }
}

/** The address of one question. Path segments joined, then its index. */
function questionId(path, index) {
  return `${path.join('.')}.${index}`;
}

/**
 * What a question is worth. A question with sub-questions is worth the sum of
 * its parts — the same rule the renderer totals by, so the number she sees while
 * ticking is the number that lands on the paper.
 */
function marksOf(question) {
  if (Array.isArray(question?.questions)) {
    const subs = question.questions.reduce((s, q) => s + (Number(q?.marks) || 0), 0);
    if (subs > 0) return subs;
  }
  return Number(question?.marks) || 0;
}

/** Every question, in printing order, with its id, its number and its marks. */
function indexQuestions(examJson) {
  const out = [];
  _walk(examJson, ({ path, index, question, type }) => {
    out.push({
      id: questionId(path, index),
      number: out.length + 1,
      type,
      marks: marksOf(question),
      text: String(question?.question || question?.main_question || '').trim(),
      question,
    });
  });
  return out;
}

/**
 * A tree holding only the ticked questions.
 *
 * `null` means she never chose, which is the whole paper — distinct from `[]`,
 * which means she unticked every one. `[]` genuinely produces an empty tree; the
 * caller refuses that rather than this function quietly reinterpreting it, because
 * "she emptied the paper" and "she hasn't decided" must not become the same state.
 *
 * Emptied containers are pruned rather than left behind: the renderer prints a
 * heading per type, and a type left as `[]` prints its heading over nothing.
 */
function applySelection(examJson, selectedIds) {
  if (selectedIds == null) return examJson;
  const keep = new Set(selectedIds);
  const out = {};

  _walk(examJson, ({ path, index, question }) => {
    if (!keep.has(questionId(path, index))) return;
    const [section, category, type, subType] = path;
    const sec = out[section] || (out[section] = {});
    const cat = sec[category] || (sec[category] = {});
    if (subType) {
      const t = cat[type] || (cat[type] = {});
      (t[subType] || (t[subType] = [])).push(question);
    } else {
      (cat[type] || (cat[type] = [])).push(question);
    }
  });

  return out;
}

/** Whether the ticks amount to the whole paper — i.e. nothing to re-render. */
function isAllSelected(examJson, selectedIds) {
  if (selectedIds == null) return true;
  const all = indexQuestions(examJson).map((q) => q.id);
  if (selectedIds.length < all.length) return false;
  const keep = new Set(selectedIds);
  return all.every((id) => keep.has(id));
}

/**
 * How many questions fit on one review screen.
 *
 * Meta renders at most 20 CheckboxGroup options and validates nothing above it —
 * the surplus simply does not appear. Real papers on staging came back at 10, 20,
 * 28 and 64 questions, so half of them overflow a single screen. 20 is the cap
 * rather than a smaller round number because every extra page is another tap
 * between her and the paper.
 */
const PAGE_SIZE = 20;

/** One screenful, clamped, with enough context for the screen to describe itself. */
function pageOf(items, index) {
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // A stale client can ask for a page that no longer exists. Clamping to the
  // first page shows her something real; throwing would end the Flow.
  const i = Number.isInteger(index) && index >= 0 && index < pageCount ? index : 0;
  const start = i * PAGE_SIZE;
  return {
    items: items.slice(start, start + PAGE_SIZE),
    index: i,
    pageCount,
    from: start + 1,
    to: Math.min(start + PAGE_SIZE, items.length),
    total: items.length,
    hasPrev: i > 0,
    hasNext: i < pageCount - 1,
  };
}

/** The device clips a checkbox title at 30 characters, mid-word and silently. */
const TITLE_MAX = 30;

/**
 * What one question looks like in the list.
 *
 * The number leads, because it is the only thing tying the row to the printed
 * paper in her hand — she is reading "4." off the page, not the question text.
 * The rest is whatever fits, cut at a word boundary so the tail is not a broken
 * fragment.
 */
function optionTitle({ number, text }) {
  const prefix = `${number}. `;
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  const room = TITLE_MAX - prefix.length;
  if (body.length <= room) return `${prefix}${body}`;

  const cut = body.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour the word boundary if it leaves something worth reading.
  const kept = lastSpace > room * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${prefix}${kept.replace(/[\s\W]+$/, '')}`;
}

module.exports = {
  questionId, indexQuestions, applySelection, isAllSelected, marksOf,
  pageOf, optionTitle, PAGE_SIZE, TITLE_MAX,
};
