/**
 * What the v19 sandbox papers (26 Oct 2026) still got wrong:
 * - G1 GK Q4 printed "اونٹ → صحرا" as Column B: every pair already joined, with an arrow (bd-5jmnfj.4.43).
 * - G1 English Q13's bubble tail was a solid black triangle that read like an arrowhead, and the bubble
 *   sat beside the child who was not speaking (bd-5jmnfj.4.40).
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { matchAnswer } = require('../../bot/shared/services/assessment/fde-match-block');
const { PICTURE_CSS } = require('../../bot/shared/services/assessment/fde-picture-block');
const gk = require('./fixtures/early/g1-general_knowledge-exam.json');

const slotOf = (grade, key, id) => Patterns.get(`fde_g${grade}_2026`).subjects[key].sections
  .flatMap((s) => s.slots).find((s) => s.slot === id);
const ARROW = /→|←|->|<-|⇒|=>/;

describe('bd-5jmnfj.4.43 match prints its pairs already joined', () => {
  const Q4 = 'g1.general_knowledge.A.Q4';
  const PAIRS = [['اونٹ', 'صحرا'], ['پرندہ', 'گھونسلا'], ['مالی', 'پودے'], ['مچھلی', 'پانی'], ['ناک', 'سونگھنا']];

  // v19's items, as the model wrote them: the answer is the joined pair, Column B the right side.
  function joinedPaper() {
    const exam = JSON.parse(JSON.stringify(gk));
    exam._layout.sections.forEach((s) => s.slots.forEach((sl) => {
      if (sl.slot !== Q4) return;
      sl.shape = 'match';
      delete sl.option_labels;
    }));
    const type = Object.keys(exam.unseen.objective).find((k) => exam.unseen.objective[k].some((q) => q.slot === Q4));
    exam.unseen.objective[type] = exam.unseen.objective[type].map((q, i) => {
      const { options, ...rest } = q;
      return { ...rest, question: PAIRS[i][0], answer: `${PAIRS[i][0]} → ${PAIRS[i][1]}`, column_a: [PAIRS[i][0]], column_b: [PAIRS[i][1]] };
    });
    return exam;
  }

  test('Column B takes the item\'s own Column B, never the joined pair', () => {
    const html = R.renderPaper({ examJson: joinedPaper(), grade: 1, subject: 'general_knowledge' });
    const block = html.split(`data-slot="${Q4}"`)[1].split('</table>')[0];
    expect(block).not.toMatch(ARROW);
    PAIRS.forEach(([, b]) => expect(block).toContain(b));
  });

  test('the key pairs each number with Column B alone', () => {
    const html = R.renderMarkingScheme({ examJson: joinedPaper(), grade: 1, subject: 'general_knowledge', allowShort: true });
    const row = html.split(`data-row="${Q4}"`)[1].split('</div>')[0];
    expect(row).not.toMatch(ARROW);
    PAIRS.forEach(([, b]) => expect(row).toContain(b));
  });

  test('with no Column B, the answer is what follows the arrow', () => {
    expect(matchAnswer({ answer: 'اونٹ → صحرا' })).toBe('صحرا');
    expect(matchAnswer({ answer: 'cow -> milk' })).toBe('milk');
    expect(matchAnswer({ answer: 'گھونسلا', column_b: ['گھونسلا'] })).toBe('گھونسلا');
    expect(matchAnswer({ answer: 'صحرا' })).toBe('صحرا');
  });

  test('an answer with an arrow in it goes back, on both match slots', () => {
    [[1, 'g1.general_knowledge.A.Q4'], [2, 'g2.general_knowledge.A.Q4']].forEach(([g, id]) => {
      const s = slotOf(g, 'general_knowledge', id);
      expect(s.answer_ok({ question: 'اونٹ', answer: 'صحرا' })).toBe(true);
      expect(s.answer_ok({ question: 'اونٹ', answer: 'اونٹ → صحرا' })).toBe(false);
      expect(s.answer_ok({ question: 'اونٹ', answer: 'اونٹ -> صحرا' })).toBe(false);
      expect(s.prompt_rule).toMatch(/never the pair or an arrow/i);
    });
  });
});

describe('bd-5jmnfj.4.40 the bubble is an outline beside the speaker', () => {
  const s = slotOf(1, 'english', 'g1.english.C.Q13');

  test('the tail is drawn as an outline, not a solid black triangle', () => {
    const after = PICTURE_CSS.match(/\.bubble::after\s*\{[^}]*\}/);
    expect(after).not.toBeNull();
    expect(after[0]).toMatch(/#fff/);
  });

  test('the child who speaks stands on the right, next to the bubble', () => {
    expect(s.prompt_rule).toMatch(/speaks stands on the right/i);
    expect(s.answer_ok({ picture: { kind: 'scene', describe: 'Two children meet in the morning; the boy on the right waves.' } })).toBe(true);
    expect(s.answer_ok({ picture: { kind: 'scene', describe: 'Two children meet in the morning.' } })).toBe(false);
  });
});
