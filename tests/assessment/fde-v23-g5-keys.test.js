/**
 * bd-5jmnfj.4.51.9 — v23 G5.
 *  (The Urdu Q6 Naat key is not tested here: religious text is never authored, assessment-generation.service.js:949.)
 *  Maths Q1(a) vii / Q4 ii word "supplementary angles" confusingly: the stem defines the term and
 *  then asks the 90-degree fact it already states. (Q4's "Supplementary angle" is FDE's own wording, kept.)
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');

const G5 = () => Patterns.get('fde_g5_2027');
const allSlots = () => Object.values(G5().subjects).flatMap((P) => P.sections.flatMap((s) => s.slots.map((sl) => ({ P, sl }))));
const slot = (id) => allSlots().find(({ sl }) => sl.slot === id).sl;

describe('supplementary angles (Maths)', () => {
  // Q4's three options (obtuse, supplementary, straight) are FDE's own (CAE 2026 p.11) and stay as
  // printed there; fde-maths-angle-options.test.js pins them. Only the Q1(a) giveaway is ours to fix.

  test('Q1(a) tells the writer not to define a term and then ask what the definition states', () => {
    expect(slot('maths.A.Q1a').prompt_rule).toMatch(/never (define|state)|does not (define|state)|give away|answer is not in the (stem|question)/i);
  });

  test('the missing-angle item keeps its wording in words (not removed with Q4 change)', () => {
    expect(slot('maths.C.Q4-8').prompt_rule).toMatch(/Two angles are supplementary/);
  });
});
