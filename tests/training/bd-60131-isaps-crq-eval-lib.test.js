/**
 * bd-60131 — pure helpers for the I-SAPS CRQ marker eval.
 *
 * The live marker (capstone-delivery scoreAnswer) never sees the I-SAPS rubric
 * or the "possible answer": the seeder extracted both and stored neither, and
 * the prompt is a generic "score 0-N, specific and practical" instruction. The
 * eval compares that marker against a rubric-grounded variant on a golden set
 * graded by hand. These helpers are the parts of the variant that can be wrong
 * silently — reading the criterion weights off the printed rubric, stripping
 * the marker-facing placeholders I-SAPS left inside its model answers, and
 * clamping whatever JSON the model returns — so they are pinned here.
 */

const {
  criterionMaxima,
  stripMarkerPlaceholders,
  parseMarkerReply,
  buildRubricMarkerMessages,
} = require('../../scripts/training/isaps-crq-eval.lib');

// The band header every I-SAPS rubric prints before its criteria.
const HEADER = 'for CRQ (Total Marks: 10)\nCriteria\nExemplary\n(4 marks)\nProficient\n(3 marks)\nDeveloping\n(2 marks)\nBeginning\n(1 mark)\n';

describe('criterionMaxima — criterion weights read off the printed rubric', () => {
  test('the common 4/3/3 shape (M1 item 1)', () => {
    const rubric = `${HEADER}Explains the Two Dimensions (4 marks)\n...\nCritiques the Current Unit Plan\n(3 marks)\n-\n...\nProposes a New Objective and Assessment Task\n(3 marks)\n-\n...`;
    expect(criterionMaxima(rubric, 10)).toEqual([4, 3, 3]);
  });

  test('the two odd shapes: 2/4/4 (M4 item 4) and 3/3/4 (M5 item 2)', () => {
    expect(criterionMaxima(`${HEADER}Identifies Key Concepts\n(2 marks)\n-\n-\nDescribes a 45-Minute Lesson\n(4 marks)\nExplains Engagement\n(4 marks)`, 10)).toEqual([2, 4, 4]);
    expect(criterionMaxima(`${HEADER}Explains Importance\n(3 marks)\n-\nAnalyzes Assessment (3 marks)\n-\nProposes Two Questions\n(4 marks)`, 10)).toEqual([3, 3, 4]);
  });

  test('a rubric whose weights do not add up to the total is refused, not guessed', () => {
    expect(() => criterionMaxima(`${HEADER}A (4 marks)\nB (4 marks)\nC (4 marks)`, 10)).toThrow(/sum to 12/);
  });
});

describe('stripMarkerPlaceholders — the "(or any other ...)" notes are for a human marker, not a candidate', () => {
  test('removes the placeholders I-SAPS left in M2 items 3 and 4', () => {
    const s = 'A common practice in my math (or any other subject) classroom is the "unit test" approach (or any other problem). '
      + 'I would implement a cycle (or any other actionable strategy that fulfill the marking criteria). I teach fractions (or any other topic).';
    const out = stripMarkerPlaceholders(s);
    expect(out).not.toMatch(/or any other/);
    expect(out).toBe('A common practice in my math classroom is the "unit test" approach. I would implement a cycle. I teach fractions.');
  });

  test('keeps ordinary parentheticals', () => {
    const s = 'Students will define key terms (e.g., producer, consumer) and the process (carbon cycle).';
    expect(stripMarkerPlaceholders(s)).toBe(s);
  });
});

describe('parseMarkerReply — whatever comes back is clamped to the printed maxima', () => {
  test('fenced JSON parses; an over-award is clamped, a negative floors at 0, and the total is recomputed', () => {
    const raw = '```json\n{"criteria":[{"name":"A","marks":99,"max":4},{"name":"B","marks":-2,"max":3},{"name":"C","marks":2.6,"max":3}],"total":50,"feedback":"ok"}\n```';
    const r = parseMarkerReply(raw, [4, 3, 3]);
    expect(r.ok).toBe(true);
    expect(r.criteria.map(c => c.marks)).toEqual([4, 0, 3]);
    expect(r.total).toBe(7);
    expect(r.feedback).toBe('ok');
  });

  test('a missing criterion scores 0 and flags the reply', () => {
    const r = parseMarkerReply('{"criteria":[{"name":"A","marks":3}],"total":3}', [4, 3, 3]);
    expect(r.ok).toBe(false);
    expect(r.criteria.map(c => c.marks)).toEqual([3, 0, 0]);
    expect(r.total).toBe(3);
  });

  test('unparseable text scores 0 across the board and says so', () => {
    const r = parseMarkerReply('Sorry, I cannot grade this.', [4, 3, 3]);
    expect(r.ok).toBe(false);
    expect(r.total).toBe(0);
    expect(r.criteria).toHaveLength(3);
  });
});

describe('buildRubricMarkerMessages — the rules the live prompt lacks', () => {
  const msgs = buildRubricMarkerMessages({
    prompt: 'SCENARIO TEXT', rubric: 'RUBRIC TEXT', modelAnswer: 'NOTES TEXT (or any other topic)', answer: 'TEACHER TEXT', totalMarks: 10, maxima: [4, 3, 3],
  });
  const system = msgs[0].content;
  const user = msgs[1].content;

  test('system message carries the zero band, the no-jargon rule, and the no-language-penalty rule', () => {
    expect(msgs[0].role).toBe('system');
    expect(system).toMatch(/0 .*(does not attempt|off-topic|non-answer)/i);
    expect(system).toMatch(/vocabulary alone|term counts only/i);
    expect(system).toMatch(/Urdu/);
    expect(system).toMatch(/ONE way to reach full marks/);
  });

  test('user message has the rubric before the notes before the answer, and the placeholders stripped from the notes', () => {
    expect(user.indexOf('RUBRIC TEXT')).toBeLessThan(user.indexOf('NOTES TEXT'));
    expect(user.indexOf('NOTES TEXT')).toBeLessThan(user.indexOf('TEACHER TEXT'));
    expect(user).not.toMatch(/or any other topic/);
    expect(user).toMatch(/total 10 marks/);
  });
});
