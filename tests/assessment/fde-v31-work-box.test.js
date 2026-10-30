/**
 * bd-5jmnfj.33.2 — a Grade 3-4 item whose stem carries a blank still gets its working box.
 * v30 G4 Maths Q2 v "___ x 25 = 4,000" and G3 Maths Q5 ii (part (c) "7 x ___ = 56") printed no
 * box while their neighbours did: every mid slot inherits answer_box from the early chrome, and
 * workSpace dropped the box for any stem with "___", a rule meant for a one-line early fill item.
 * The rule now applies only to a one-line slot with no working space.
 */

const G4 = require('../../bot/shared/services/assessment/patterns/fde-g4-2026');
const G3 = require('../../bot/shared/services/assessment/patterns/fde-g3-2026');
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

const slotOf = (subject, id) => subject.sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const listOf = (tree, slot) => tree.unseen[slot.category][slot.type];
/** Each item's printed block of a slot: from its data-slot marker to the next marker. */
const itemsOf = (html, slotId) => html.split('data-slot="').filter((p) => p.startsWith(`${slotId}"`));

test('G4 Maths Q2: a "find the number" item with a blank prints the same 20mm box as its neighbours', () => {
  const subject = G4.subjects.maths;
  const tree = treeFor(subject);
  const slot = slotOf(subject, 'g4.maths.A.directed');
  expect(slot.lines).toBe(2);
  const list = listOf(tree, slot);
  list[4].question = 'Find the number that makes this true: ___ x 25 = 4,000';
  list[4].answer = '160';
  const { examJson } = applyLayout(tree, subject, { kind: 'chapters' }, { now: NOW });
  const html = R.renderPaper({ examJson, grade: 4, subject: 'maths' });
  const items = itemsOf(html, 'g4.maths.A.directed');
  expect(items).toHaveLength(5);
  items.forEach((it) => expect(it).toContain('class="write-box" style="height:20mm"'));
});

test('G3 Maths Q5: a task whose part (c) has a blank keeps its box', () => {
  const subject = G3.subjects.maths;
  const tree = treeFor(subject);
  const slot = slotOf(subject, 'g3.maths.C.extended');
  const list = listOf(tree, slot);
  list[1].question = '(a) Write 6,384 in words.\n(b) Expand 6,384.\n(c) Find the missing number: 7 x ___ = 56.';
  list[1].answer = '(a) six thousand three hundred and eighty-four (b) 6,000 + 300 + 80 + 4 (c) 8';
  const { examJson } = applyLayout(tree, subject, { kind: 'chapters' }, { now: NOW });
  const html = R.renderPaper({ examJson, grade: 3, subject: 'maths' });
  const items = itemsOf(html, 'g3.maths.C.extended');
  expect(items).toHaveLength(3);
  items.forEach((it) => expect(it).toMatch(/class="(?:write|work)-box"/));
});
