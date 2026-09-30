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

  // With versioned editing a removed question stays in the tree. The renderer
  // prints only the ACTIVE ones, so the pin is: the active subset of the index,
  // in order, is exactly what the renderer collects — and the index's number is
  // the number printed.
  test('the ACTIVE subset of the index is what the renderer prints, numbered as printed', () => {
    const t = JSON.parse(JSON.stringify(EXAM));
    t.seen.objective.MCQs[0].removed = true;
    const active = indexQuestions(t).filter((q) => !q.removed);
    expect(active.map((q) => q.question)).toEqual(Renderer.collectQuestions(t).map((q) => q.question));
    expect(active.map((q) => q.number)).toEqual([1, 2, 3]);
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

describe('Urdu questions survive indexing and selection intact', () => {
  // Every fixture above is English. Two `\W` regexes that erased whole Urdu
  // titles passed all of them (bd-60041, bd-60047); this is the fixture that
  // would have failed.
  const { optionTitle } = require('../../bot/shared/services/assessment/assessment-selection');
  const URDU = {
    unseen: {
      objective: {
        MCQs: [{ question: 'سب سے تیز رفتار سواری کون سی ہے؟', options: ['سائیکل', 'ہوائی جہاز'], marks: 1 }],
      },
      subjective: {
        'Short Questions': [{ question: 'محترمہ فاطمہ جناح نے بچوں کو کیا اہم پیغام دیا؟ مختصر بیان کریں۔', marks: 3 }],
      },
    },
  };

  test('indexed items carry the Urdu text, not an emptied string', () => {
    const items = indexQuestions(URDU);
    expect(items.length).toBe(2);
    for (const it of items) expect(/[؀-ۿ]/.test(it.text)).toBe(true);
  });

  test('a truncated Urdu title is cut, not erased', () => {
    const items = indexQuestions(URDU);
    for (const it of items) {
      const t = optionTitle(it);
      expect(t.replace(/^\d+\.\s*/, '').length).toBeGreaterThan(3);
    }
  });

  test('selecting one Urdu question keeps exactly that question', () => {
    const items = indexQuestions(URDU);
    const out = applySelection(URDU, [items[0].id]);
    expect(out.unseen.objective.MCQs).toHaveLength(1);
    expect(/[؀-ۿ]/.test(out.unseen.objective.MCQs[0].question)).toBe(true);
    // An emptied branch is DROPPED, not left as an empty object — so the
    // subjective side is gone entirely rather than present and empty.
    expect(indexQuestions(out)).toHaveLength(1);
  });
});

/*
 * Versioned editing. A removed question stays IN the tree, flagged, so the path
 * ids of every other question survive — a removal and an add-back are one flag
 * flip, not a rebuild. Everything that prints or counts looks at the ACTIVE
 * subset only.
 */
describe('removed questions stay in the tree', () => {
  const Selection = require('../../bot/shared/services/assessment/assessment-selection');
  const withRemoved = () => {
    const t = JSON.parse(JSON.stringify(EXAM));
    t.seen.objective.MCQs[1].removed = true;
    return t;
  };

  test('indexQuestions flags a removed question and numbers only the active ones', () => {
    const items = Selection.indexQuestions(withRemoved());
    expect(items.map((q) => q.removed)).toEqual([false, true, false, false]);
    expect(items.map((q) => q.number)).toEqual([1, null, 2, 3]);
    // ids never move because of a removal
    expect(items.map((q) => q.id)).toEqual(indexQuestions(EXAM).map((q) => q.id));
  });

  test('activeTree drops removed questions and prunes containers they emptied', () => {
    const t = withRemoved();
    t.unseen.objective['True / False'][0].removed = true;
    const active = Selection.activeTree(t);
    expect(active.seen.objective.MCQs).toHaveLength(1);
    expect(active.unseen).toBeUndefined();
    expect(Selection.indexQuestions(active).every((q) => !q.removed)).toBe(true);
  });

  test('activeTree of a tree with nothing removed prints the same questions', () => {
    const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
    expect(Renderer.collectQuestions(Selection.activeTree(EXAM)).map((q) => q.question))
      .toEqual(Renderer.collectQuestions(EXAM).map((q) => q.question));
  });

  test('setRemoved returns a copy and leaves the input alone; add-back clears the flag', () => {
    const src = JSON.parse(JSON.stringify(EXAM));
    const out = Selection.setRemoved(src, 'seen.objective.MCQs.0', true);
    expect(out.seen.objective.MCQs[0].removed).toBe(true);
    expect(src.seen.objective.MCQs[0].removed).toBeUndefined();
    const back = Selection.setRemoved(out, 'seen.objective.MCQs.0', false);
    expect('removed' in back.seen.objective.MCQs[0]).toBe(false);
    expect(Selection.setRemoved(src, 'seen.objective.MCQs.9', true)).toBeNull();
  });
});

describe('appendQuestion — a question she adds', () => {
  const Selection = require('../../bot/shared/services/assessment/assessment-selection');
  const q = (text) => ({ question: text, answer: 'x', marks: 1, source: 'teacher' });

  test('an MCQ joins the existing MCQs list, at the end, and existing ids do not move', () => {
    const before = indexQuestions(EXAM);
    const { tree, id } = Selection.appendQuestion(EXAM, { kind: 'mcq', subject: 'science', grade: 4 }, q('New?'));
    expect(id).toBe('seen.objective.MCQs.2');
    expect(tree.seen.objective.MCQs[2].question).toBe('New?');
    const after = new Map(indexQuestions(tree).map((i) => [i.id, i.question.question]));
    for (const b of before) expect(after.get(b.id)).toBe(b.question.question);
    expect(EXAM.seen.objective.MCQs).toHaveLength(2); // input untouched
  });

  test('a long question lands in the LAST sub-list when the key holds sub-typed lists', () => {
    const { tree, id } = Selection.appendQuestion(EXAM, { kind: 'long', subject: 'english', grade: 4 }, q('Describe.'));
    expect(id).toBe('seen.subjective.Long Question.Essay Writing.1');
    expect(tree.seen.subjective['Long Question']['Essay Writing'][1].question).toBe('Describe.');
  });

  test('a short question with no existing key uses the catalogue name and category', () => {
    const maths = Selection.appendQuestion(EXAM, { kind: 'short', subject: 'maths', grade: 3 }, q('2+2?'));
    expect(maths.id).toBe('unseen.subjective.Short Questions.0');
    const sci = Selection.appendQuestion(EXAM, { kind: 'short', subject: 'science', grade: 4 }, q('Why?'));
    expect(sci.id).toBe('unseen.subjective.Brief Answers.0');
  });

  test('fill joins an existing Fill in the Blanks key whatever its case', () => {
    const t = JSON.parse(JSON.stringify(EXAM));
    t.seen.objective['fill in the blanks'] = [{ question: 'A __', marks: 1 }];
    const { id } = Selection.appendQuestion(t, { kind: 'fill', subject: 'english', grade: 2 }, q('B __'));
    expect(id).toBe('seen.objective.fill in the blanks.1');
  });

  test('with neither section present, a new type goes under seen', () => {
    const { tree, id } = Selection.appendQuestion({}, { kind: 'fill', subject: 'english', grade: 2 }, q('C __'));
    expect(id).toBe('seen.objective.Fill in the Blanks.0');
    expect(tree.seen.objective['Fill in the Blanks']).toHaveLength(1);
  });

  test('copies the shared instruction from its last sibling; otherwise a default in the paper language', () => {
    const t = JSON.parse(JSON.stringify(EXAM));
    t.seen.objective.MCQs[1].main_question = 'Choose one.';
    const a = Selection.appendQuestion(t, { kind: 'mcq', subject: 'science', grade: 4 }, q('x'));
    expect(a.tree.seen.objective.MCQs[2].main_question).toBe('Choose one.');
    const b = Selection.appendQuestion({}, { kind: 'mcq', subject: 'urdu', grade: 2 }, q('x'));
    expect(b.tree.seen.objective.MCQs[0].main_question).toBe('درست جواب کا انتخاب کریں۔');
    const c = Selection.appendQuestion({}, { kind: 'mcq', subject: 'english', grade: 2 }, q('x'));
    expect(c.tree.seen.objective.MCQs[0].main_question).toBe('Choose the correct option.');
  });

  test('an unknown kind is refused', () => {
    expect(() => Selection.appendQuestion(EXAM, { kind: 'essay' }, q('x'))).toThrow();
  });
});

describe('diffTrees — what changed between the version she opened and her draft', () => {
  const Selection = require('../../bot/shared/services/assessment/assessment-selection');
  test('nothing changed is all zero', () => {
    expect(Selection.diffTrees(EXAM, JSON.parse(JSON.stringify(EXAM))))
      .toEqual({ edited: 0, removed: 0, restored: 0, added: 0 });
  });

  test('counts an edit, a removal, a restore and an add, and ignores the removed key when judging edits', () => {
    const base = JSON.parse(JSON.stringify(EXAM));
    base.unseen.objective['True / False'][0].removed = true;
    let d = Selection.setRemoved(base, 'seen.objective.MCQs.1', true);
    d = Selection.setRemoved(d, 'unseen.objective.True / False.0', false);
    d = Selection.replaceAt(d, 'seen.objective.MCQs.0', { ...d.seen.objective.MCQs[0], marks: 3 });
    d = Selection.appendQuestion(d, { kind: 'mcq', subject: 'science', grade: 4 },
      { question: 'n', answer: 'a', marks: 1 }).tree;
    expect(Selection.diffTrees(base, d)).toEqual({ edited: 1, removed: 1, restored: 1, added: 1 });
  });

  test('key order inside a question is not an edit', () => {
    const d = JSON.parse(JSON.stringify(EXAM));
    const q0 = d.seen.objective.MCQs[0];
    d.seen.objective.MCQs[0] = { marks: q0.marks, options: q0.options, question: q0.question };
    expect(Selection.diffTrees(EXAM, d).edited).toBe(0);
  });
});

describe('the ✓/✗ list pages at 16 rows', () => {
  const Selection = require('../../bot/shared/services/assessment/assessment-selection');
  test('LIST_PAGE_SIZE leaves room for add, make, previous and next inside Meta\'s 20', () => {
    expect(Selection.LIST_PAGE_SIZE).toBe(16);
    expect(Selection.LIST_PAGE_SIZE + 4).toBeLessThanOrEqual(20);
  });
  test('pageOf takes a page size; the default stays the checkbox page', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const p = Selection.pageOf(items, 3, 16);
    expect(p.items).toEqual([48, 49]);
    expect(p.pageCount).toBe(4);
    expect(p.from).toBe(49);
    expect(Selection.pageOf(items, 0).items).toHaveLength(20);
  });
});
