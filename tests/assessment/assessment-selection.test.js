/**
 * Ticking questions off a paper.
 *
 * The review layer's whole job is to turn "she unticked question 4" into a new
 * PDF. That needs three things to be true, and each one is a way it can quietly
 * go wrong:
 *
 *   1. A question must have a STABLE id. If ids move when the tree changes, the
 *      ticks she saved describe a different paper than the one she saw.
 *   2. Filtering must PRUNE, not blank. A type left behind as an empty array
 *      prints its heading over nothing.
 *   3. NULL and [] must not collapse. NULL is "she never chose" — the whole
 *      paper. [] is "she unticked every one" — which we refuse rather than
 *      render an empty exam.
 */

const {
  questionId, indexQuestions, applySelection, isAllSelected,
} = require('../../bot/shared/services/assessment/assessment-selection');

// A tree with both shapes the generator emits: a flat array under a type, and a
// nested sub-type object. Both must be addressable and both must prune.
const EXAM = {
  seen: {
    objective: {
      MCQs: [
        { question: 'Which is a living thing?', options: ['Rock', 'Cat'], marks: 1 },
        { question: 'Plants make food using ____.', marks: 1 },
      ],
    },
    subjective: {
      'Long Question': {
        'Essay Writing': [
          { question: 'Why do animals need air?', marks: 2 },
        ],
      },
    },
  },
  unseen: {
    objective: {
      'True / False': [
        { question: 'The sun is a plant.', marks: 1 },
      ],
    },
  },
};

describe('questionId — addressing a question inside the tree', () => {
  test('is built from the path, so it survives a re-read of the same tree', () => {
    const ids = indexQuestions(EXAM).map((q) => q.id);
    expect(ids).toEqual([
      'seen.objective.MCQs.0',
      'seen.objective.MCQs.1',
      'seen.subjective.Long Question.Essay Writing.0',
      'unseen.objective.True / False.0',
    ]);
  });

  test('indexes in printing order, so her numbering matches the paper', () => {
    const numbers = indexQuestions(EXAM).map((q) => q.number);
    expect(numbers).toEqual([1, 2, 3, 4]);
  });

  test('carries the marks, so the running total can be shown as she ticks', () => {
    expect(indexQuestions(EXAM).map((q) => q.marks)).toEqual([1, 1, 2, 1]);
  });

  test('a sub-questioned item reports the sum of its parts, not zero', () => {
    const tree = { seen: { subjective: { Comprehension: [
      { question: 'Read and answer.', questions: [{ marks: 2 }, { marks: 3 }] },
    ] } } };
    expect(indexQuestions(tree)[0].marks).toBe(5);
  });
});

describe('applySelection — the tree she gets back', () => {
  test('keeps only what is ticked', () => {
    const out = applySelection(EXAM, ['seen.objective.MCQs.0', 'unseen.objective.True / False.0']);
    expect(indexQuestions(out).map((q) => q.id))
      .toEqual(['seen.objective.MCQs.0', 'unseen.objective.True / False.0']);
  });

  test('PRUNES an emptied type rather than leaving a heading over nothing', () => {
    const out = applySelection(EXAM, ['seen.objective.MCQs.0']);
    expect(out.seen.subjective).toBeUndefined();
    expect(out.unseen).toBeUndefined();
    expect(out.seen.objective.MCQs).toHaveLength(1);
  });

  test('prunes an emptied SUB-type too, not just a flat array', () => {
    const out = applySelection(EXAM, ['seen.objective.MCQs.0', 'seen.objective.MCQs.1']);
    expect(out.seen.subjective).toBeUndefined();
  });

  test('null means she never chose — the paper is whole', () => {
    expect(applySelection(EXAM, null)).toEqual(EXAM);
  });

  test('does not mutate the stored original', () => {
    const before = JSON.stringify(EXAM);
    applySelection(EXAM, ['seen.objective.MCQs.0']);
    expect(JSON.stringify(EXAM)).toBe(before);
  });

  test('an id for a question that no longer exists is ignored, not fatal', () => {
    const out = applySelection(EXAM, ['seen.objective.MCQs.0', 'seen.objective.MCQs.99']);
    expect(indexQuestions(out)).toHaveLength(1);
  });

  test('an empty tick list yields an empty tree — the CALLER must refuse it', () => {
    // Encoded so the distinction is not lost: [] is a real, reachable state and
    // it is the caller's job to reject it. Silently treating it as "all" would
    // hand her back the paper she just emptied.
    expect(indexQuestions(applySelection(EXAM, []))).toHaveLength(0);
  });
});

describe('isAllSelected — whether a re-render is even needed', () => {
  test('null is all', () => {
    expect(isAllSelected(EXAM, null)).toBe(true);
  });

  test('every id present is all, whatever the order', () => {
    const ids = indexQuestions(EXAM).map((q) => q.id).reverse();
    expect(isAllSelected(EXAM, ids)).toBe(true);
  });

  test('one missing is not all', () => {
    const ids = indexQuestions(EXAM).map((q) => q.id).slice(1);
    expect(isAllSelected(EXAM, ids)).toBe(false);
  });
});

describe('the index and the renderer must agree', () => {
  // Her ticks are numbered against what the PAPER printed. If this module walks
  // the tree in a different order than the renderer, "question 4" on her screen
  // is a different question than "4." on the page, and she unticks the wrong one.
  // Nothing else in the system would notice.
  const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');

  test('same questions, same order, as collectQuestions', () => {
    const mine = indexQuestions(EXAM).map((q) => q.question);
    const theirs = Renderer.collectQuestions(EXAM).map((q) => q.question);
    expect(mine).toEqual(theirs);
  });

  test('a filtered tree still renders, and totals only what is ticked', () => {
    const out = applySelection(EXAM, ['seen.objective.MCQs.0', 'seen.subjective.Long Question.Essay Writing.0']);
    expect(Renderer.totalMarks(Renderer.collectQuestions(out))).toBe(3);
  });
});

describe('paging — a paper is routinely longer than a checkbox screen', () => {
  // Meta caps a CheckboxGroup at 20 options. Real papers on staging came back at
  // 10, 20, 28 and 64 questions, so two of four could not be shown at all on one
  // screen. Paging is not a nicety here; without it the feature is unreachable
  // for the papers teachers actually get.
  const { pageOf, PAGE_SIZE } = require('../../bot/shared/services/assessment/assessment-selection');

  const many = (n) => ({ seen: { objective: { MCQs:
    Array.from({ length: n }, (_, i) => ({ question: `Q${i + 1}`, marks: 1 })) } } });

  test('never offers more options than Meta will render', () => {
    expect(PAGE_SIZE).toBeLessThanOrEqual(20);
  });

  test('a 64-question paper is reachable in whole pages', () => {
    const items = indexQuestions(many(64));
    const pages = Math.ceil(items.length / PAGE_SIZE);
    const seen = [];
    for (let p = 0; p < pages; p += 1) seen.push(...pageOf(items, p).items);
    expect(seen).toHaveLength(64);
    expect(new Set(seen.map((q) => q.id)).size).toBe(64);
  });

  test('reports where she is, so the screen can say "21-40 of 64"', () => {
    const page = pageOf(indexQuestions(many(64)), 1);
    expect(page.from).toBe(PAGE_SIZE + 1);
    expect(page.pageCount).toBe(Math.ceil(64 / PAGE_SIZE));
    expect(page.hasNext).toBe(true);
    expect(page.hasPrev).toBe(true);
  });

  test('a short paper is one page with no next', () => {
    const page = pageOf(indexQuestions(many(10)), 0);
    expect(page.items).toHaveLength(10);
    expect(page.hasNext).toBe(false);
    expect(page.pageCount).toBe(1);
  });

  test('a page past the end clamps rather than throwing', () => {
    const page = pageOf(indexQuestions(many(10)), 99);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.index).toBe(0);
  });
});

describe('option titles must survive the device', () => {
  const { optionTitle } = require('../../bot/shared/services/assessment/assessment-selection');

  test('fits the 30-char cap the device clips at, mid-word, without asking', () => {
    const t = optionTitle({ number: 7, marks: 2,
      text: 'Explain in detail why living things need air and water to survive' });
    expect(t.length).toBeLessThanOrEqual(30);
  });

  test('keeps the number, because that is what ties it to the printed paper', () => {
    expect(optionTitle({ number: 7, marks: 2, text: 'Why do animals need air?' })).toMatch(/^7\./);
  });

  test('does not end mid-word when it has to cut', () => {
    const full = 'Photosynthesis requires sunlight water';
    const t = optionTitle({ number: 1, marks: 1, text: full });
    // The last word it kept must be a WHOLE word from the original, not a
    // fragment of one — "requires" is fine, "requi" is the failure being pinned.
    const lastWord = t.replace(/^\d+\.\s*/, '').split(' ').pop();
    expect(full.split(' ')).toContain(lastWord);
  });
});
