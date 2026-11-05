/**
 * bd-cj8ggk.5 — Amena, 5 Nov 2026: if a G2 multiplication or division picture is still missing after the
 * re-ask, the item prints as the plain number fact, as it did before pictures. The paper never fails over it,
 * and never prints an empty box. A slot marked `picture_optional` gets this; every other picture slot still
 * fails the paper (fde-early-writer.test.js).
 */

const G2 = require('../../bot/shared/services/assessment/patterns/early/g2-maths');
const { run, items } = require('./helpers/early-writer-harness');

const slotOf = (id) => G2.sections.flatMap((x) => x.slots).find((x) => x.slot === id);

test.each(['g2.maths.B.Q10', 'g2.maths.B.Q12'])('%s is picture_optional', (id) => {
  expect(slotOf(id).picture_optional).toBe(true);
});

test('a G2 multiplication still short of its picture after the re-ask prints as the plain fact', async () => {
  const miss = { noPicture: ['g2.maths.B.Q10'] };
  const { calls, d, go } = run(2, 'maths', { replies: { B: [miss, miss] } });
  const out = await go();
  expect(calls.sections.filter((c) => c.id === 'B')).toHaveLength(2); // still asked once more first
  const q10 = items(out.examJson).filter((q) => q.slot === 'g2.maths.B.Q10');
  expect(q10.length).toBe(slotOf('g2.maths.B.Q10').generate);
  expect(q10.every((q) => !q.picture)).toBe(true);
  expect(d.logToFile).toHaveBeenCalledWith('[assessment] pictures dropped', expect.objectContaining({ slots: ['g2.maths.B.Q10'] }));
  // Q12 kept its pictures
  expect(items(out.examJson).filter((q) => q.slot === 'g2.maths.B.Q12').every((q) => q.picture && q.picture.src)).toBe(true);
});

test('one bad picture in an optional slot drops the whole question\'s pictures, so it reads as one kind', async () => {
  const { go } = run(2, 'maths', { replies: { B: [{ noPicture: ['g2.maths.B.Q12'] }, { noPicture: ['g2.maths.B.Q12'] }] } });
  const out = await go();
  expect(items(out.examJson).filter((q) => q.slot === 'g2.maths.B.Q12').some((q) => q.picture)).toBe(false);
});
