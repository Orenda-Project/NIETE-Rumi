/**
 * v28 findings on the G1 and G2 Urdu written papers (bd-5jmnfj.4.58.4):
 *   G2 Urdu Q1 vi poet «نادیہ نغمان» (is «نعمان»); G2 Urdu Q7 i restated the heading's instruction and its model
 *   sentences described a kite-flying child and green leaves the outline picture does not show; G2 Urdu Q9 never
 *   said five turns or how to mark who speaks; G1 Urdu Q7 iii-v pictured faceless people and animals.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { earlyUrduFixes, withoutColours } = require('../../bot/shared/services/assessment/fde-early-urdu-fixes');
const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');

const slotOf = (pid, slot) => Patterns.subjectOf(pid, 'urdu').sections.flatMap((s) => s.slots).find((s) => s.slot === slot);

const picItem = (over = {}) => ({
  slot: 'g2.urdu.B.Q7', question: 'تصویر میں جو کچھ نظر آ رہا ہے، اس کے بارے میں پانچ جملے لکھیں۔',
  picture: { kind: 'scene', describe: 'A park: a bare tree, two children holding a kite string.' },
  answer: '1. بچے پارک میں کھیل رہے ہیں۔ 2. دو بچے پتنگ پکڑے ہیں۔ 3. درخت پر ہرے ہرے پتے ہیں۔ 4. لڑکی جھولا جھول رہی ہے۔ 5. لڑکا سائیکل چلا رہا ہے۔',
  scheme: { points: [{ text: 'پہلا جملہ تصویر کے مطابق درست ہو', marks: 2, kind: 'K' }] },
  ...over,
});
const paper = (items, type = 'Picture Sentences') => ({ unseen: { subjective: { [type]: items } }, _layout: { sections: [{ id: 'B', slots: [{ slot: items[0].slot, type }] }] } });
const first = (ex) => Object.values(ex.unseen.subjective)[0][0];

describe('G2 Urdu Q1 vi poet spelling', () => {
  test('نغمان becomes نعمان in the option and anywhere else it prints', () => {
    const q = { slot: 'g2.urdu.A.Q1', question: 'نظم کس نے لکھی ہے؟', options: ['الف) صوفی تبسم', 'ب) نادیہ نغمان', 'ج) قیوم نظر'], answer: 'ب) نادیہ نغمان' };
    const { examJson, notes } = earlyUrduFixes(paper([q], 'MCQs'));
    expect(first(examJson).options[1]).toBe('ب) نادیہ نعمان');
    expect(first(examJson).answer).toBe('ب) نادیہ نعمان');
    expect(notes.join(' ')).toMatch(/نعمان/);
  });
});

describe('G2 Urdu Q7 picture sentences', () => {
  test('a stem that restates the slot instruction is cleared', () => {
    const { examJson, notes } = earlyUrduFixes(paper([picItem()]));
    expect(first(examJson).question).toBe('');
    expect(notes.join(' ')).toMatch(/g2\.urdu\.B\.Q7/);
  });
  test('colour words leave the model sentences, repeated forms included, grammar kept', () => {
    const { examJson } = earlyUrduFixes(paper([picItem()]));
    expect(first(examJson).answer).toContain('3. درخت پر پتے ہیں۔');
    expect(first(examJson).answer).not.toMatch(/ہرے/);
  });
  test('withoutColours drops attributive colours and reports a predicate colour it cannot drop', () => {
    expect(withoutColours('ایک لال پتنگ اڑ رہی ہے۔').text).toBe('ایک پتنگ اڑ رہی ہے۔');
    const r = withoutColours('آسمان نیلا ہے۔');
    expect(r.text).toBe('آسمان نیلا ہے۔');
    expect(r.stuck).toEqual(['نیلا']);
  });
  test('the prompt tells the model to keep to the describe text, same counts, no colour, and an empty stem', () => {
    const rule = slotOf('fde_g2_2026', 'g2.urdu.B.Q7').prompt_rule;
    expect(rule).toMatch(/only what its own `describe` shows, with the same counts/);
    expect(rule).toMatch(/never a colour/);
    expect(rule).toMatch(/`question` is an empty string/);
  });
});

describe('G2 Urdu Q9 dialogue', () => {
  test('the slot asks for five turns and the speaker named before each', () => {
    const s = slotOf('fde_g2_2026', 'g2.urdu.B.Q9');
    expect(s.instruction_ur).toBe('دو دوستوں کے درمیان پانچ باتوں کا مکالمہ لکھیں۔ ہر بات سے پہلے بولنے والے کا نام لکھیں۔');
    expect(s.prompt_rule).toMatch(/five turns/);
    expect(s.prompt_rule).toMatch(/speaker's name/);
  });
});

describe('G1 Urdu Q7 pictures', () => {
  test('the rule asks for a whole figure with its face and no clothing alone', () => {
    const rule = slotOf('fde_g1_2026', 'g1.urdu.B.Q7').prompt_rule;
    expect(rule).toMatch(/living: true/);
    expect(rule).toMatch(/head included/);
    expect(rule).toMatch(/never a dress or a clothing item alone/);
  });
  test('a living picture is told to show its head, eyes and mouth; an egg still has no face', () => {
    const p = Kie.promptFor({ kind: 'object', name: 'monkey', living: true });
    expect(p).toMatch(/whole, head included, with its face: eyes and mouth/);
    expect(p).not.toMatch(/no face/i);
    expect(Kie.negativeFor(p)).not.toMatch(/\bface\b|\beyes\b/);
    expect(Kie.promptFor({ kind: 'object', name: 'egg' })).toMatch(/no face/i);
  });
});
