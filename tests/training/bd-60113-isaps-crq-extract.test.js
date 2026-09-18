/**
 * bd-60113 — splitting an I-SAPS CRQ document into items.
 *
 * Each module ships one .docx holding 4 constructed-response items, uniformly
 * shaped:
 *
 *   Item No. 1
 *   Concept: Revised Bloom's Taxonomy
 *   Marks/points: 10
 *   Reference: Purpose before Plan - ...
 *   Scenario
 *   <several paragraphs>
 *   Question<the ask, often glued to the heading with no space>
 *   <bulleted sub-asks>
 *   Possible Answer
 *   <model answer>
 *   Rubric for CRQ (Total Marks: 10)
 *   <criteria table>
 *
 * Two shapes matter for grading and are pinned here:
 *
 *   - The teacher is shown scenario + question. The "Possible Answer" and the
 *     rubric must NEVER reach them — handing over the model answer mid-exam
 *     would make the item worthless.
 *   - Those two sections DO belong in the LLM's marking context, which is what
 *     makes rubric-grounded AI marking possible at all (I-SAPS doc section 4.3
 *     permits AI marking "based on the rubrics and notes on key components of
 *     a correct answer").
 *
 * "Question" is frequently run together with its first word ("QuestionWrite a
 * 2-3 paragraph response"), so the splitter cannot rely on the heading sitting
 * on its own line.
 */

const { splitCrqItems } = require('../../bot/shared/services/training/isaps-crq.rules');

const DOC = [
  'Development of Virtual/Digital Training Content/Programs',
  'Module 1 - Summative Assessment – Open-Ended Questions',
  'Item No. 1',
  'Concept: Revised Bloom’s Taxonomy',
  'Marks/points: 10',
  'Reference: Purpose before Plan',
  'Scenario',
  'You are a head teacher working with 8th-grade science teachers.',
  'The teachers are frustrated because students cannot apply knowledge.',
  'QuestionWrite a 2-3 paragraph response to the teacher team. You must:',
  'Explain the two dimensions of the Revised Taxonomy.',
  'Possible Answer',
  'The Revised Taxonomy provides a two-dimensional framework.',
  'Rubric for CRQ (Total Marks: 10)',
  'Criteria',
  'Exemplary',
  'Item No. 2',
  'Concept: Divergent vs. Convergent Thinking',
  'Marks/points: 10',
  'Scenario',
  'A teacher asks students to brainstorm.',
  'QuestionDescribe a specific 10-15 minute classroom activity.',
  'Possible Answer',
  'A good activity would be...',
  'Rubric for CRQ (Total Marks: 10)',
  'Criteria',
];

describe('bd-60113 — splitCrqItems', () => {
  test('finds every item in the document', () => {
    const items = splitCrqItems(DOC);
    expect(items).toHaveLength(2);
    expect(items[0].item_no).toBe(1);
    expect(items[1].item_no).toBe(2);
  });

  test('pulls the concept and the marks', () => {
    const [a, b] = splitCrqItems(DOC);
    expect(a.concept).toBe('Revised Bloom’s Taxonomy');
    expect(a.marks).toBe(10);
    expect(b.concept).toBe('Divergent vs. Convergent Thinking');
  });

  test('scenario holds the situation and stops before the Question', () => {
    const [a] = splitCrqItems(DOC);
    expect(a.scenario).toContain('head teacher');
    expect(a.scenario).toContain('frustrated');
    expect(a.scenario).not.toContain('Write a 2-3 paragraph');
  });

  test('question survives being glued to its heading', () => {
    const [a, b] = splitCrqItems(DOC);
    // "QuestionWrite a 2-3..." must yield "Write a 2-3...", not "QuestionWrite".
    expect(a.question).toMatch(/^Write a 2-3 paragraph/);
    expect(a.question).toContain('Explain the two dimensions');
    expect(b.question).toMatch(/^Describe a specific 10-15 minute/);
  });

  test('the teacher-facing prompt carries scenario + question and NOTHING else', () => {
    const [a] = splitCrqItems(DOC);
    expect(a.prompt).toContain('head teacher');
    expect(a.prompt).toContain('Write a 2-3 paragraph');
    // The two that would destroy the item if leaked:
    expect(a.prompt).not.toContain('Possible Answer');
    expect(a.prompt).not.toContain('two-dimensional framework');
    expect(a.prompt).not.toContain('Rubric');
    expect(a.prompt).not.toContain('Exemplary');
  });

  test('model answer and rubric are captured separately, for the marker', () => {
    const [a] = splitCrqItems(DOC);
    expect(a.model_answer).toContain('two-dimensional framework');
    expect(a.rubric).toContain('Criteria');
  });

  test('an empty or heading-only document yields no items rather than throwing', () => {
    expect(splitCrqItems([])).toEqual([]);
    expect(splitCrqItems(['Some title', 'No items here'])).toEqual([]);
  });

  test('a glued Scenario heading keeps its first paragraph', () => {
    // Real data: M3 item 1 and M4 item 2 ship "ScenarioYou are a mentor
    // teacher...". Treating only Question as gluable dropped the opening
    // paragraph and left the scenario empty, so the teacher would have been
    // shown a question with no situation.
    const items = splitCrqItems([
      'Item No. 1',
      'Concept: Classroom Management that Works',
      'Marks/points: 10',
      'ScenarioYou are a mentor teacher working with Miss Lubna.',
      'Based on Marzano’s synthesis, you want to help her.',
      'QuestionWrite a 2-3 paragraph response.',
      'Possible Answer',
      'The four categories are...',
    ]);
    expect(items[0].scenario).toMatch(/^You are a mentor teacher/);
    expect(items[0].scenario).toContain('Marzano');
    expect(items[0].prompt).toMatch(/^You are a mentor teacher/);
    expect(items[0].question).toMatch(/^Write a 2-3 paragraph/);
  });

  test('marks default to 10 when the line is absent', () => {
    const items = splitCrqItems([
      'Item No. 1', 'Concept: Something', 'Scenario', 'A situation.',
      'QuestionDo the thing.', 'Possible Answer', 'An answer.',
    ]);
    expect(items[0].marks).toBe(10);
  });
});
