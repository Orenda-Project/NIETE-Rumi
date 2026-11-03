/**
 * bd-5jmnfj.33.2 — the marking scheme echoes a question whole up to 200 characters.
 * v30 G4 Maths and G3 Maths keys cut the question beside each answer at 110 characters, so a
 * teacher marking a two-line Do-as-directed item or a three-part task from the key could not
 * see which task the answer belongs to. A longer question is still cut, at a word, with "…".
 */

const G4 = require('../../bot/shared/services/assessment/patterns/fde-g4-2026');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-29T07:00:00.000Z';

function itemsFor(slot, band) {
  return Array.from({ length: slot.generate }, (_, i) => ({
    slot: slot.slot, question: `Question ${i + 1} for ${slot.slot}`, marks: slot.marks_each, blooms: band,
    ...(slot.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three'], answer: 'a) one' } : { answer: String(i + 1) }),
    scheme: { points: [{ kind: 'A', text: 'correct', marks: slot.marks_each }] },
  }));
}

function treeFor(subject) {
  const tree = { unseen: { objective: {}, subjective: {} } };
  subject.sections.forEach((sec) => {
    const bands = Object.entries(sec.levels).filter(([, n]) => n > 0).map(([b]) => b);
    sec.slots.forEach((slot, i) => {
      const list = itemsFor(slot, bands[i % bands.length]);
      (tree.unseen[slot.category][slot.type] = tree.unseen[slot.category][slot.type] || []).push(...list);
    });
  });
  return tree;
}

const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const MID = 'Find the number that makes this statement true and then check your answer by multiplying it by twenty five and writing the product in words under the line.';
const LONG = `${MID} Then round the product to the nearest hundred and write the rounded number in words as well, showing each step of the rounding.`;

function keyFor(question) {
  const subject = G4.subjects.maths;
  const tree = treeFor(subject);
  const slot = subject.sections.flatMap((s) => s.slots).find((s) => s.slot === 'g4.maths.A.directed');
  const list = tree.unseen[slot.category][slot.type];
  list[4].question = question;
  list[4].answer = '160';
  const { examJson } = applyLayout(tree, subject, { kind: 'chapters' }, { now: NOW });
  return visible(R.renderMarkingScheme({ examJson, grade: 4, subject: 'maths' }));
}

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
