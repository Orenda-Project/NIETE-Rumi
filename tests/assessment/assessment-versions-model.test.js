/**
 * Turning a paper edited the OLD way into two versions.
 *
 * Before versions, an edit overwrote the one row: `exam_json` became the trimmed,
 * edited paper, `original_exam_json` kept the model's output, and
 * `selected_question_ids` held the kept paths (into the original). The backfill
 * makes the original version 1 and rebuilds the edited row as the FULL original
 * tree with her edits swapped in at the kept paths and every other question
 * flagged removed — so she can bring a trimmed question back.
 *
 * The one thing it must never do is change the paper she already has. So the
 * rebuilt tree is only trusted if it PRINTS byte-identically to the stored one;
 * otherwise it falls back to the stored tree untouched.
 */
const Selection = require('../../bot/shared/services/assessment/assessment-selection');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');

// Shaped like a real edited production paper (keys and nesting as stored;
// the text is invented).
const q = (text, extra = {}) => ({
  question: text, answer: `ans ${text}`, blooms: 'remember', lines: 0,
  main_question: 'Answer these.', marks: 1, ...extra,
});
const ORIGINAL = {
  seen: {
    objective: {
      MCQs: [
        q('M1', { options: ['A) 1', 'B) 2'], answer: 'A) 1' }),
        q('M2', { options: ['A) 3', 'B) 4'], answer: 'B) 4' }),
      ],
      'Fill in the blanks': [q('F1'), q('F2')],
    },
    subjective: {
      'Word Problems': [q('W1', { marks: 3, lines: 4 }), q('W2', { marks: 3, lines: 4 })],
    },
  },
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const SELECTED = [
  'seen.objective.Fill in the blanks.0', 'seen.objective.Fill in the blanks.1',
  'seen.subjective.Word Problems.0', 'seen.subjective.Word Problems.1',
];
// What the old edit path stored: the selection, with one question re-worded.
const CURRENT = (() => {
  const t = Selection.applySelection(clone(ORIGINAL), SELECTED);
  t.seen.subjective['Word Problems'][1] = { ...t.seen.subjective['Word Problems'][1], question: 'W2 edited', marks: 5 };
  return clone(t);
})();
const HEAD = { grade: 3, subject: 'maths', schoolName: 'School', pageReference: '1-4', chapterTitle: null };
const render = (examJson) => Renderer.renderPaper({ ...HEAD, examJson });

describe('reconstructLegacy', () => {
  test('aligned: the full original, her edits at the kept paths, the rest flagged removed', () => {
    const { tree, mode } = Selection.reconstructLegacy({ original: ORIGINAL, current: CURRENT, selectedIds: SELECTED });
    expect(mode).toBe('aligned');
    const items = Selection.indexQuestions(tree);
    expect(items.map((i) => i.id)).toEqual(Selection.indexQuestions(ORIGINAL).map((i) => i.id));
    expect(items.filter((i) => i.removed).map((i) => i.text)).toEqual(['M1', 'M2']);
    expect(tree.seen.subjective['Word Problems'][1]).toMatchObject({ question: 'W2 edited', marks: 5 });
    expect(ORIGINAL.seen.subjective['Word Problems'][1].question).toBe('W2'); // input untouched
  });

  test('the rebuilt paper PRINTS exactly what she already has', () => {
    const { tree } = Selection.reconstructLegacy({ original: ORIGINAL, current: CURRENT, selectedIds: SELECTED });
    expect(render(Selection.activeTree(tree))).toBe(render(CURRENT));
  });

  test('edit_only: no selection and the same number of questions — the stored tree as it is', () => {
    const edited = clone(ORIGINAL);
    edited.seen.objective.MCQs[0].question = 'M1 edited';
    const out = Selection.reconstructLegacy({ original: ORIGINAL, current: edited, selectedIds: null });
    expect(out.mode).toBe('edit_only');
    expect(out.tree).toEqual(edited);
  });

  test('fallback: after a second trim the stored ids name the wrong questions of the original', () => {
    // A second trim recorded paths into the ALREADY-TRIMMED tree. Here those
    // paths exist in the original too, and the counts agree, but they name
    // M1 and M2 while the stored paper holds F2 and "W2 edited": 0 of 2 texts
    // match, so the rebuild is not trusted.
    const shifted = Selection.applySelection(CURRENT, ['seen.objective.Fill in the blanks.1', 'seen.subjective.Word Problems.1']);
    const bad = Selection.reconstructLegacy({
      original: ORIGINAL, current: shifted, selectedIds: ['seen.objective.MCQs.0', 'seen.objective.MCQs.1'],
    });
    expect(bad.mode).toBe('fallback');
    expect(bad.tree).toBe(shifted);
  });

  test('fallback when a selected id is not in the original, or the counts disagree', () => {
    expect(Selection.reconstructLegacy({ original: ORIGINAL, current: CURRENT, selectedIds: ['seen.objective.Nope.0'] }).mode).toBe('fallback');
    expect(Selection.reconstructLegacy({ original: ORIGINAL, current: CURRENT, selectedIds: SELECTED.slice(0, 3) }).mode).toBe('fallback');
    expect(Selection.reconstructLegacy({ original: ORIGINAL, current: CURRENT, selectedIds: null }).mode).toBe('fallback');
  });

  test('fallback when no original was kept', () => {
    const out = Selection.reconstructLegacy({ original: null, current: CURRENT, selectedIds: SELECTED });
    expect(out).toEqual({ tree: CURRENT, mode: 'fallback' });
  });
});
