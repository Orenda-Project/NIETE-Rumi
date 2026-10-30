/**
 * v27 printed-paper blockers and should-fixes the renderer owns (bd-5jmnfj.4.58.3):
 *   1. the marking scheme cut a question beside its answer at 110 characters (G5 Maths Q2), so a two-line word
 *      problem could not be told from its neighbour: a question prints whole up to 200 characters;
 *   2. the teacher box said "1 marking row was written from the answer" without saying which: it names the row;
 *   3. a short slot (one to six items) split from its instruction across a page break (G1 English Q12, G5 Science
 *      Q2 (a)): a short slot keeps its head and items on one page;
 *   4. a diagram frame the teacher must fill printed empty with only a grey title, and the panel read it as a
 *      missing picture twice running: the frame carries the teacher's duty and the book page inside it.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-30T07:00:00.000Z';
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const full1 = () => JSON.parse(JSON.stringify(require('./fixtures/fde/r7-science-full1.exam.json')));

describe('the key echoes a question whole up to 200 characters', () => {
  const P = Patterns.get('fde_g5_2027').subjects.maths;
  const itemsFor = (slot, band) => Array.from({ length: slot.generate }, (_, i) => ({
    slot: slot.slot, question: `Question ${i + 1} for ${slot.slot}`, marks: slot.marks_each, blooms: band,
    ...(slot.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three', 'd) four'], answer: 'a) one' } : { answer: String(i + 1) }),
    scheme: { points: [{ kind: 'A', text: 'correct', marks: slot.marks_each }] },
  }));
  const treeFor = (subject) => {
    const tree = { unseen: { objective: {}, subjective: {} } };
    subject.sections.forEach((sec) => {
      const bands = Object.entries(sec.levels).filter(([, n]) => n > 0).map(([b]) => b);
      sec.slots.forEach((slot, i) => {
        (tree.unseen[slot.category][slot.type] = tree.unseen[slot.category][slot.type] || []).push(...itemsFor(slot, bands[i % bands.length]));
      });
    });
    return tree;
  };
  const MID = 'Find the number that makes this statement true and then check your answer by multiplying it by twenty five and writing the product in words under the line.';
  const LONG = `${MID} Then round the product to the nearest hundred and write the rounded number in words as well, showing each step of the rounding.`;
  const keyFor = (question) => {
    const tree = treeFor(P);
    const slot = P.sections.flatMap((s) => s.slots).find((s) => s.slot === 'maths.B.Q2');
    const list = tree.unseen[slot.category][slot.type];
    list[0].question = question;
    list[0].answer = '160';
    const { examJson } = applyLayout(tree, P, { kind: 'pages', chapters: null, pages: '171-180' }, { now: NOW });
    return visible(R.renderMarkingScheme({ examJson, grade: 5, subject: 'maths' }));
  };

  test('a question between 110 and 200 characters prints whole beside its answer', () => {
    expect(MID.length).toBeGreaterThan(110);
    expect(MID.length).toBeLessThan(200);
    expect(keyFor(MID)).toContain(MID);
  });

  test('a question over 200 characters is still cut at a word with an ellipsis', () => {
    expect(LONG.length).toBeGreaterThan(200);
    const key = keyFor(LONG);
    expect(key).not.toContain(LONG);
    expect(key).toMatch(/Find the number that makes this statement true[^…]*\S…/);
  });
});

describe('the teacher box does not print the rows-written-from-the-answer note (4.58.9.1)', () => {
  const keyWith = (shortfall) => {
    const ex = full1();
    ex._layout.scheme_shortfall = shortfall;
    return visible(R.renderMarkingScheme({ examJson: ex, grade: 5, subject: 'science' }));
  };

  test('one row: "It is Q3 (a) 1."', () => {
    expect(keyWith([{ slot: 'science.C.Q3a', item: 0, part: null, filled_by: 'code' }]))
      .not.toMatch(/written from the answer|It is Q3/);
  });

  test('two rows: "They are Q3 (a) 1 and Q3 (b) 2."', () => {
    expect(keyWith([{ slot: 'science.C.Q3a', item: 0, part: null }, { slot: 'science.C.Q3b', item: 1, part: null }]))
      .not.toMatch(/written from the answer|They are Q3/);
  });

  test('no rows: the sentence is not printed', () => {
    expect(keyWith([])).not.toMatch(/written from the answer/);
  });
});

describe('a short slot stays on one page', () => {
  test('one to six live items mark the slot short; ten or twenty do not', () => {
    const paper = R.renderPaper({ examJson: full1(), grade: 5, subject: 'science' });
    // Paper order: Q1 (a) 20 MCQs, Q1 (b) 1 frame, Q2 (a) 2 draw (either), Q2 (b) 3 situations, Q3 (a) 10 short, Q3 (b) 5 short.
    expect(paper.match(/<div class="slot(?: [^"]*)?"/g)).toEqual([
      '<div class="slot"', '<div class="slot short"', '<div class="slot either short"', '<div class="slot short"', '<div class="slot"', '<div class="slot short"',
    ]);
    expect(paper).toMatch(/\.slot\.short\s*\{[^}]*break-inside:\s*avoid/);
  });
});

describe('a teacher-filled frame says what goes in it', () => {
  const frameOf = (paper) => {
    const start = paper.indexOf('id="fde-frame-science.A.Q1b"');
    expect(start).toBeGreaterThan(-1);
    return paper.slice(start, paper.indexOf('<div class="label-lines">', start));
  };

  test('the duty and the book page print inside the frame, once', () => {
    const paper = R.renderPaper({ examJson: full1(), grade: 5, subject: 'science' });
    const frame = frameOf(paper);
    expect(frame).toMatch(/<div class="frame-duty">Teacher: draw or paste the diagram to label here \(book p\. 168\) before photocopying\.<\/div>/);
    expect(paper.match(/frame-duty">/g)).toHaveLength(1);
  });

  test('with no book page the line still names the duty', () => {
    const ex = full1();
    const slot = ex._layout.sections.flatMap((s) => s.slots).find((s) => s.slot === 'science.A.Q1b');
    slot.frame = { ...slot.frame, book_page: null };
    ex._layout.supplies = [];
    const frame = frameOf(R.renderPaper({ examJson: ex, grade: 5, subject: 'science' }));
    expect(frame).toMatch(/Teacher: draw or paste the diagram to label here before photocopying\./);
  });
});
