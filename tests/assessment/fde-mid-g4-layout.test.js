/**
 * Offline layout of the Grade 4 patterns (bd-5jmnfj.33.1): a synthetic model tree goes through
 * applyLayout and checkBlueprint, then renderPaper where it can.
 */

const P = require('../../bot/shared/services/assessment/patterns/fde-g4-2026');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { checkBlueprint } = require('../../bot/shared/services/assessment/blueprint-check');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-29T07:00:00.000Z';

function itemsFor(slot, band) {
  return Array.from({ length: slot.generate }, (_, i) => ({
    slot: slot.slot, question: `Question ${i + 1} for ${slot.slot}`, marks: slot.marks_each, blooms: band,
    ...(slot.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three'], answer: 'a) one' } : { answer: String(i + 1) }),
    scheme: { points: [{ kind: 'A', text: 'correct', marks: slot.marks_each }] },
  }));
}

// Spread the three bands over the slots the way the section levels do.
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

const codes = (r) => r.problems.map((p) => p.code);

describe.each(Object.keys(P.subjects))('%s', (key) => {
  const subject = P.subjects[key];
  describe.each([[{ kind: 'chapters' }], [{ kind: 'pages' }]])('scope %j', (scope) => {
    const { examJson } = applyLayout(treeFor(subject), subject, scope, { now: NOW });
    const r = checkBlueprint(examJson, { tos: subject.tos });

    test('lays out whole: no TOTAL or SECTION problem', () => {
      expect(r.total).toBe(50);
      expect(codes(r)).not.toContain('TOTAL');
      expect(codes(r)).not.toContain('SECTION');
    });

    test('renders offline with every slot id as data-slot', () => {
      const html = R.renderPaper({ examJson, grade: 4, subject: key });
      subject.sections.flatMap((s) => s.slots).forEach((s) => expect(html).toContain(`data-slot="${s.slot}"`));
    });
  });
});
