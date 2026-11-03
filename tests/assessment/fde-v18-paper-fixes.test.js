/**
 * What the v18 sandbox papers (23 Oct 2026) still got wrong:
 * - G2 Urdu printed a "which spelling is correct" item whose three choices were all آلودگی (bd-5jmnfj.4.35).
 * - G1 GK Q10 "یہ کہاں رہتا ہے؟ خشکی یا پانی" showed a ship, a bus, a train and a cart (bd-5jmnfj.4.34).
 * - G1 English Q13 asked the child to write in a speech bubble the image model never drew, put it over the
 *   wrong child, drew a gift box for a pencil case, and printed a box under it as well (bd-5jmnfj.4.40).
 * - Fill in the blank printed both the ___ and a box; G2 GK Q8 never said what goes in each box (bd-5jmnfj.4.39).
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const english = require('./fixtures/early/g1-english-exam.json');
const gk = require('./fixtures/early/g1-general_knowledge-exam.json');

const slotOf = (grade, key, id) => Patterns.get(`fde_g${grade}_2026`).subjects[key].sections
  .flatMap((s) => s.slots).find((s) => s.slot === id);
const itemsOf = (page, slot) => page.split('<div class="q').slice(1).filter((s) => s.includes(`data-slot="${slot}"`));

describe('bd-5jmnfj.4.35 choices that are all the same', () => {
  const P = Patterns.get('fde_g2_2026').subjects.urdu;
  const paper = (...items) => ({ seen: { objective: { T: items } } });

  test('an item whose options repeat goes back, named', () => {
    const same = { slot: 'g2.urdu.A.Q1', question: 'درست املا والا لفظ چنیں', options: ['آلودگی', 'آلودگی ', 'آلودگی'], answer: 'آلودگی' };
    const fine = { slot: 'g2.urdu.A.Q1', question: 'درست املا والا لفظ چنیں', options: ['آلودگی', 'آلودگى', 'الودگی'], answer: 'آلودگی' };
    const out = Prompt.answerShortfall(paper(same, fine), P);
    expect(out).toEqual([{ slot: 'g2.urdu.A.Q1', reason: 'answer', items: ['درست املا والا لفظ چنیں → آلودگی'] }]);
  });

  test('the re-ask says every choice must differ', () => {
    const note = Prompt.answerNote([{ slot: 'g2.urdu.A.Q1', reason: 'answer', items: ['x → y'] }], P);
    expect(note).toMatch(/every choice must be different/i);
    expect(note).toMatch(/one right spelling/i);
  });
});

describe('bd-5jmnfj.4.34 G1 GK land or water shows animals', () => {
  const s = slotOf(1, 'general_knowledge', 'g1.general_knowledge.B.Q10');
  const item = (name, answer) => ({ picture: { kind: 'object', name }, answer });

  test('the rule asks for animals only', () => {
    expect(s.prompt_rule).toMatch(/animals only/i);
    expect(s.prompt_rule).not.toMatch(/transport/i);
  });

  test('a vehicle, or an answer that is not خشکی or پانی, is off the rule', () => {
    expect(s.answer_ok(item('fish', 'پانی'))).toBe(true);
    expect(s.answer_ok(item('camel', 'خشکی '))).toBe(true);
    ['ship', 'bus', 'train', 'horse-drawn cart', 'boat', 'car'].forEach((n) => expect(s.answer_ok(item(n, 'خشکی'))).toBe(false));
    expect(s.answer_ok(item('frog', 'دونوں'))).toBe(false);
  });
});

describe('bd-5jmnfj.4.40 G1 English Q13 prints its own speech bubble', () => {
  const s = slotOf(1, 'english', 'g1.english.C.Q13');
  const html = R.renderPaper({ examJson: english, grade: 1, subject: 'english' });

  test('each item is the picture beside a bubble to write in, with no box', () => {
    const items = itemsOf(html, 'g1.english.C.Q13');
    expect(items).toHaveLength(2);
    items.forEach((it) => {
      expect(it).toContain('class="bubble"');
      expect(it).not.toContain('write-box');
    });
  });

  test('the picture never draws a bubble or a gift; it shows what the question names', () => {
    expect(s.bubble).toBe(true);
    expect(s.prompt_rule).toMatch(/no speech bubble/i);
    expect(s.answer_ok({ picture: { kind: 'scene', describe: 'Two children; the one on the right hands the other a pencil case.' } })).toBe(true);
    expect(s.answer_ok({ picture: { kind: 'scene', describe: 'A child with an empty speech bubble above her.' } })).toBe(false);
    expect(s.answer_ok({ picture: { kind: 'scene', describe: 'One child gives a wrapped gift.' } })).toBe(false);
  });
});

describe('bd-5jmnfj.4.39 formats left over', () => {
  test('a fill-in-the-blank item writes on its own line, with no box', () => {
    const html = R.renderPaper({ examJson: gk, grade: 1, subject: 'general_knowledge' });
    const items = itemsOf(html, 'g1.general_knowledge.A.Q1');
    expect(items.length).toBeGreaterThan(0);
    items.forEach((it) => expect(it).not.toContain('write-box'));
  });

  test('G2 GK put-in-order tells the child to write each step\'s number', () => {
    expect(slotOf(2, 'general_knowledge', 'g2.general_knowledge.B.Q8').instruction_ur).toMatch(/1 سے 5/);
  });
});
