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

/** Whether a question has been taken off the paper (it stays in the tree). */
function isRemoved(question) {
  return !!(question && typeof question === 'object' && question.removed === true);
}

/**
 * Every question, in printing order, with its id, its number and its marks.
 *
 * A removed question is still listed — she has to be able to see it to bring it
 * back — but it has no number, because the paper does not print it. `number` is
 * the position among the ACTIVE questions, which is the number on the page.
 */
function indexQuestions(examJson) {
  const out = [];
  let printed = 0;
  _walk(examJson, ({ path, index, question, type }) => {
    const removed = isRemoved(question);
    if (!removed) printed += 1;
    out.push({
      id: questionId(path, index),
      number: removed ? null : printed,
      removed,
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

/**
 * The tree the paper prints: every question not flagged removed, with the
 * containers a removal emptied pruned away (same pruning as applySelection).
 */
function activeTree(examJson) {
  const keep = indexQuestions(examJson).filter((q) => !q.removed).map((q) => q.id);
  return applySelection(examJson, keep);
}

function _clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

/** A copy with one question's removed flag set or cleared; null if the id is gone. */
function setRemoved(examJson, id, removed) {
  const target = indexQuestions(examJson).find((q) => q.id === id);
  if (!target) return null;
  const next = { ..._clone(target.question) };
  if (removed) next.removed = true; else delete next.removed;
  return replaceAt(examJson, id, next);
}

/*
 * Where a question she adds goes. The type key is matched against what the
 * paper already has first, so a new MCQ joins the MCQs she can see rather than
 * opening a second MCQ heading; only when the paper has no such type does the
 * subject's own catalogue name it.
 */
const ADD_KINDS = {
  mcq: { match: (k) => /^mcqs?$/i.test(k), fallback: () => 'MCQs' },
  short: {
    match: (k) => ['Short Questions', 'Brief Answers', 'Short questions', 'Short Answer'].includes(k),
    order: ['Short Questions', 'Brief Answers', 'Short questions', 'Short Answer'],
    fallback: (subject, grade) => {
      const ids = require('./question-types').forSubject(subject, grade).map((t) => t.id);
      return ids.includes('Short Questions') ? 'Short Questions' : 'Brief Answers';
    },
  },
  long: {
    match: (k) => ['Long Question', 'Long Questions', 'Long Answers', 'Detailed Answers'].includes(k),
    order: ['Long Question', 'Long Questions', 'Long Answers', 'Detailed Answers'],
    fallback: () => 'Long Question',
  },
  fill: { match: (k) => /^fill in the blanks$/i.test(k), fallback: () => 'Fill in the Blanks' },
};

/** Every [section, category, typeKey] in the tree, in walk order. */
function _typeSlots(tree) {
  const out = [];
  for (const section of ['seen', 'unseen']) {
    const branch = tree?.[section];
    if (!branch || typeof branch !== 'object') continue;
    for (const [category, types] of Object.entries(branch)) {
      if (!types || typeof types !== 'object') continue;
      for (const key of Object.keys(types)) out.push({ section, category, key });
    }
  }
  return out;
}

/**
 * Add one question she wrote. Returns the new tree and the new question's path
 * id. Nothing already in the tree moves, so every existing id stays valid.
 */
function appendQuestion(examJson, { kind, subject, grade } = {}, question) {
  const rule = ADD_KINDS[kind];
  if (!rule) throw Object.assign(new Error(`Unknown question kind: ${kind}`), { code: 'EDIT_REJECTED' });
  const tree = _clone(examJson);
  const slots = _typeSlots(tree);

  let slot = null;
  if (rule.order) {
    for (const name of rule.order) {
      slot = slots.find((s) => s.key === name);
      if (slot) break;
    }
  } else {
    slot = slots.find((s) => rule.match(s.key)) || null;
  }

  if (!slot) {
    const key = rule.fallback(subject, grade);
    const category = require('./question-types').categoryOf(key, subject, grade);
    const section = tree.unseen && typeof tree.unseen === 'object' ? 'unseen' : 'seen';
    slot = { section, category, key };
  }

  const sec = tree[slot.section] || (tree[slot.section] = {});
  const cat = sec[slot.category] || (sec[slot.category] = {});
  let path;
  let list;
  const entry = cat[slot.key];
  if (entry && !Array.isArray(entry) && typeof entry === 'object') {
    const subKeys = Object.keys(entry).filter((k) => Array.isArray(entry[k]));
    const subType = subKeys[subKeys.length - 1];
    if (subType) {
      list = entry[subType];
      path = [slot.section, slot.category, slot.key, subType];
    }
  }
  if (!list) {
    if (!Array.isArray(cat[slot.key])) cat[slot.key] = [];
    list = cat[slot.key];
    path = [slot.section, slot.category, slot.key];
  }

  const added = { ..._clone(question) };
  if (added.main_question === undefined) {
    const sibling = [...list].reverse().find((q) => q && q.main_question);
    if (sibling) {
      added.main_question = sibling.main_question;
    } else {
      const { defaultInstruction } = require('./assessment-vocabulary');
      const { isRtl } = require('./assessment-paper.renderer');
      added.main_question = defaultInstruction(kind, isRtl(subject));
    }
  }
  list.push(added);
  return { tree, id: questionId(path, list.length - 1) };
}

/** JSON with sorted keys, so key order is never mistaken for an edit. */
function _canonical(value) {
  if (Array.isArray(value)) return `[${value.map(_canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${_canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function _withoutRemoved(question) {
  if (!question || typeof question !== 'object') return question;
  const { removed, ...rest } = question; // eslint-disable-line no-unused-vars
  return rest;
}

/**
 * What her draft changed against the version she opened. Compared by path id;
 * the `removed` flag is counted as a removal or a restore, never as an edit.
 */
function diffTrees(base, draft) {
  const before = new Map(indexQuestions(base).map((q) => [q.id, q]));
  const out = { edited: 0, removed: 0, restored: 0, added: 0 };
  for (const q of indexQuestions(draft)) {
    const b = before.get(q.id);
    if (!b) {
      if (!q.removed) out.added += 1;
      continue;
    }
    if (!b.removed && q.removed) out.removed += 1;
    if (b.removed && !q.removed) out.restored += 1;
    if (_canonical(_withoutRemoved(b.question)) !== _canonical(_withoutRemoved(q.question))) out.edited += 1;
  }
  return out;
}

/**
 * A paper edited before versions existed, as the full tree a version holds.
 *
 * The old edit path stored the trimmed, edited tree in `current`, the model's
 * output in `original`, and the kept paths (into the original) in
 * `selectedIds`. When those three agree, the k-th kept path is replaced by the
 * k-th stored question and every other question is flagged removed, so a
 * trimmed question can be brought back. When they do not — a second trim
 * recorded paths into an already-trimmed tree, or no original was kept — the
 * stored tree is returned unchanged ('fallback'). The CALLER still checks the
 * rebuilt tree prints exactly what `current` prints before trusting it.
 */
function reconstructLegacy({ original, current, selectedIds }) {
  const fallback = { tree: current, mode: 'fallback' };
  if (!original || !current) return fallback;
  const cur = indexQuestions(current);
  const orig = indexQuestions(original);

  if (selectedIds == null) {
    return orig.length === cur.length ? { tree: current, mode: 'edit_only' } : fallback;
  }
  if (!Array.isArray(selectedIds) || selectedIds.length !== cur.length || !cur.length) return fallback;
  const byId = new Map(orig.map((o) => [o.id, o]));
  if (!selectedIds.every((id) => byId.has(id))) return fallback;

  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  let same = 0;
  selectedIds.forEach((id, k) => { if (norm(byId.get(id).text) === norm(cur[k].text)) same += 1; });
  if (same * 2 < selectedIds.length) return fallback;

  const kept = new Map(selectedIds.map((id, k) => [id, cur[k].question]));
  let tree = _clone(original);
  for (const o of orig) {
    const replacement = kept.has(o.id)
      ? _withoutRemoved(_clone(kept.get(o.id)))
      : { ..._clone(o.question), removed: true };
    tree = replaceAt(tree, o.id, replacement);
  }
  return { tree, mode: 'aligned' };
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

/**
 * Question rows per page of the ✓/✗ list. A NavigationList takes at most 20
 * rows, and the page also carries "Add a question", "Make my paper" and, when
 * needed, "Previous" and "More questions" — 16 + 4 is exactly the cap.
 */
const LIST_PAGE_SIZE = 16;

/** One screenful, clamped, with enough context for the screen to describe itself. */
function pageOf(items, index, size = PAGE_SIZE) {
  const PAGE = Number.isInteger(size) && size > 0 ? size : PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE));
  // A stale client can ask for a page that no longer exists. Clamping to the
  // first page shows her something real; throwing would end the Flow.
  const i = Number.isInteger(index) && index >= 0 && index < pageCount ? index : 0;
  const start = i * PAGE;
  return {
    items: items.slice(start, start + PAGE),
    index: i,
    pageCount,
    from: start + 1,
    to: Math.min(start + PAGE, items.length),
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
  // Shave a dangling space or punctuation mark off the cut — and NOTHING else.
  // This was `[\s\W]+$`, and in JavaScript `\W` is "not [A-Za-z0-9_]", so every
  // Urdu letter matched it: the whole title was eaten and the option came back
  // as "1. ". Meta refuses a checkbox with an empty title, which is how the
  // review screen died on "Something went wrong" for Urdu-medium subjects while
  // English was untouched. Name the punctuation instead of negating a Latin
  // alphabet — including the Urdu full stop (۔) and comma (،).
  return `${prefix}${kept.replace(/[\s.,;:!?—–\-·۔،]+$/u, '')}`;
}

/**
 * A copy of the tree with ONE question replaced.
 *
 * Addressed by the same path the id encodes, so the replacement cannot land on a
 * neighbour. Returns null when the path no longer resolves — which is a refusal,
 * not a reason to append a question the teacher never asked for.
 */
function replaceAt(examJson, id, replacement) {
  const next = JSON.parse(JSON.stringify(examJson || {}));
  let found = false;
  _walk(next, ({ path, index }) => {
    if (found || questionId(path, index) !== id) return;
    const [section, category, type, subType] = path;
    const list = subType
      ? next[section][category][type][subType]
      : next[section][category][type];
    list[index] = replacement;
    found = true;
  });
  return found ? next : null;
}

module.exports = {
  questionId, indexQuestions, applySelection, isAllSelected, marksOf,
  pageOf, optionTitle, replaceAt, PAGE_SIZE, TITLE_MAX,
  isRemoved, activeTree, setRemoved, appendQuestion, diffTrees, LIST_PAGE_SIZE,
  reconstructLegacy,
};
