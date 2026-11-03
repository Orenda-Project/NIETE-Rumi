/**
 * What the v20 sandbox papers (26 Oct 2026) still got wrong:
 * - G1 GK Q10 keyed the crocodile پانی: it lives on land and in water, so the key must say both (bd-5jmnfj.4.45).
 * - G1 English Q13 ii asked about a gift and drew a wrapped box; the bubble's tail stood apart from
 *   the bubble and read as a "<" sign (bd-5jmnfj.4.40).
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { PICTURE_CSS } = require('../../bot/shared/services/assessment/fde-picture-block');

const slotOf = (grade, key, id) => Patterns.get(`fde_g${grade}_2026`).subjects[key].sections
  .flatMap((s) => s.slots).find((s) => s.slot === id);

describe('bd-5jmnfj.4.45 an animal of land and water is keyed both', () => {
  const s = slotOf(1, 'general_knowledge', 'g1.general_knowledge.B.Q10');
  const item = (name, answer) => ({ picture: { kind: 'object', name }, answer });
  const BOTH = 'خشکی اور پانی دونوں';

  test('the question and the rule offer both', () => {
    expect(s.instruction_ur).toMatch(/دونوں/);
    expect(s.prompt_rule).toContain(BOTH);
    expect(s.prompt_rule).toMatch(/crocodile/i);
  });

  test('a crocodile, frog, turtle or duck keyed land or water alone is off the rule', () => {
    ['crocodile', 'frog', 'turtle', 'duck'].forEach((n) => {
      expect(s.answer_ok(item(n, 'پانی'))).toBe(false);
      expect(s.answer_ok(item(n, 'خشکی'))).toBe(false);
      expect(s.answer_ok(item(n, BOTH))).toBe(true);
    });
  });

  test('a land or water animal keyed both is off the rule', () => {
    expect(s.answer_ok(item('fish', BOTH))).toBe(false);
    expect(s.answer_ok(item('horse', BOTH))).toBe(false);
    expect(s.answer_ok(item('fish', 'پانی'))).toBe(true);
    expect(s.answer_ok(item('horse', 'خشکی'))).toBe(true);
  });
});

describe('bd-5jmnfj.4.40 Q13 asks about no gift; the tail joins the bubble', () => {
  const s = slotOf(1, 'english', 'g1.english.C.Q13');
  const scene = 'Two children meet in the morning; the girl on the right waves.';

  test('the rule keeps a gift out of the question too', () => {
    expect(s.prompt_rule).toMatch(/never a gift/i);
    expect(s.answer_ok({ question: 'A child gets a gift from a friend. What will she say?', picture: { kind: 'scene', describe: scene } })).toBe(false);
    expect(s.answer_ok({ question: 'Two friends meet at school. What will the girl say?', picture: { kind: 'scene', describe: scene } })).toBe(true);
  });

  // The bubble is an ellipse: its left edge is only at the side's middle, so a tail placed low stood apart.
  const rule = (sel) => PICTURE_CSS.match(new RegExp(`\\.bubble::${sel}\\s*\\{[^}]*\\}`))[0];
  const mm = (css, prop) => Number((css.match(new RegExp(`${prop}:\\s*(-?[\\d.]+)mm`)) || [])[1]);
  const reach = (css) => mm(css, 'left') + Number(css.match(/border-width:\s*[\d.]+mm\s+([\d.]+)mm/)[1]);

  test('the tail sits at the middle of the bubble\'s side', () => {
    ['before', 'after'].forEach((sel) => {
      expect(rule(sel)).toMatch(/top:\s*50%/);
      expect(rule(sel)).not.toMatch(/bottom:/);
    });
  });

  test('the black tail reaches the border and the white one covers it, so the tail opens into the bubble', () => {
    expect(reach(rule('before'))).toBeGreaterThanOrEqual(0.5);
    expect(reach(rule('after'))).toBeGreaterThan(0.5);
  });
});
