/**
 * The Grade 3 papers through the real layout and blueprint check, offline (bd-5jmnfj.33.1):
 * a synthetic model tree per subject, laid out by chapters and by pages; no TOTAL or SECTION problem.
 */
const P = require('../../bot/shared/services/assessment/patterns/fde-g3-2026');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { checkBlueprint } = require('../../bot/shared/services/assessment/blueprint-check');

const NOW = '2026-10-29T07:00:00.000Z';
const BAND = ['Remember', 'Understand', 'Apply'];

function itemsFor(slot, band) {
  return Array.from({ length: slot.generate }, (_, i) => ({
    slot: slot.slot, question: `Question ${i + 1} of ${slot.slot} about topic ${i + 1}`, marks: slot.marks_each, blooms: band,
    ...(slot.shape === 'mcq'
      ? { options: ['a) one', 'b) two', 'c) three'], answer: 'a) one' }
      : { answer: `Answer ${i + 1}` }),
    scheme: { points: [{ kind: 'A', text: 'correct', marks: slot.marks_each }] },
  }));
}

function treeFor(subject) {
  const tree = { unseen: { objective: {}, subjective: {} } };
  subject.sections.forEach((sec) => {
    // give each slot the band that still has marks in the section's levels
    const left = { ...sec.levels };
    sec.slots.forEach((slot) => {
      const need = slot.attempt * slot.marks_each;
      const band = BAND.find((b) => (left[b] || 0) >= need) || BAND.find((b) => (left[b] || 0) > 0) || 'Understand';
      left[band] = (left[band] || 0) - need;
      (tree.unseen[slot.category][slot.type] = tree.unseen[slot.category][slot.type] || []).push(...itemsFor(slot, band));
    });
  });
  return tree;
}

describe.each(Object.keys(P.subjects))('%s', (key) => {
  const subject = P.subjects[key];
  describe.each([[{ kind: 'chapters', chapters: [3] }], [{ kind: 'pages', pages: '10-20' }]])('scope %j', (scope) => {
    const laid = applyLayout(treeFor(subject), subject, scope, { now: NOW }).examJson;
    const r = checkBlueprint(laid, { tos: subject.tos });

    test('totals 50 with no TOTAL or SECTION problem', () => {
      expect(r.total).toBe(50);
      expect(r.problems.filter((p) => ['TOTAL', 'SECTION'].includes(p.code))).toEqual([]);
      expect(r.sections.map((s) => s.marks)).toEqual(subject.sections.map((s) => s.marks));
    });

    test('every slot keeps its generate count', () => {
      const all = Object.values(laid.unseen).flatMap((t) => Object.values(t)).flat();
      subject.sections.flatMap((s) => s.slots).forEach((slot) => {
        expect(all.filter((q) => q.slot === slot.slot)).toHaveLength(slot.generate);
      });
    });
  });
});
