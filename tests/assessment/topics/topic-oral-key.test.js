/**
 * bd-6clakk.11 — a topic paper's answer key ends with the FDE oral teacher sheet when the paper
 * carries one (examJson._oral); a paper without one renders exactly as before.
 */
const Renderer = require('../../../bot/shared/services/assessment/assessment-paper.renderer');
const { oralFor } = require('../../../bot/shared/services/assessment/topics/topic-oral');
const exam = require('./fixtures/topic-key-exam');

const TOPICS = [{ topicId: 't1', name: 'Rhyming words', sloCodes: ['E-1'] }];
const BASE = { grade: 3, subject: 'english', schoolName: 'S', pageReference: '4-14', topics: TOPICS };

const withOral = (subject, grade, content) => ({ ...exam, _oral: { ...oralFor({ grade, subject }), content } });
const EN_CONTENT = [
  { id: 'listening', script: 'The Zen master & the cup.', items: [{ ask: 'Who poured tea?', answer: 'The master' }] },
  { id: 'speaking', items: [{ ask: 'What is your favourite food?' }] },
  { id: 'read_aloud', script: 'Little pines grow tall.', items: [{ ask: 'Little pines grow tall.' }] },
];

test('the key prints the oral sheet: script, questions with answers, rubric and class grid', () => {
  const html = Renderer.renderAnswerKey({ ...BASE, examJson: withOral('english', 3, EN_CONTENT) });
  expect(html).toContain('<section class="oral">');
  expect(html).toContain('The Zen master &amp; the cup.');
  expect(html).toContain('Answer: The master');
  expect(html).toContain('data-task="read_aloud"');
  expect(html).toContain('Class record: oral marks');
  expect(html).toContain('Total (20)');
  expect(html).toContain('section.oral { break-before: page; }');
  expect(html.indexOf('<section class="oral">')).toBeGreaterThan(html.indexOf('</table>'));
});

test('an Urdu key prints the Urdu sheet', () => {
  const oral = oralFor({ grade: 2, subject: 'urdu' });
  const content = oral.tasks.map((t) => ({ id: t.id, script: 'متن', items: [{ ask: 'سوال', answer: 'جواب' }] }));
  const html = Renderer.renderAnswerKey({ ...BASE, subject: 'urdu', grade: 2, examJson: withOral('urdu', 2, content) });
  expect(html).toContain('جماعت کا ریکارڈ: زبانی نمبر');
  expect(html).toContain('جواب: جواب');
});

test('a paper with no _oral gains nothing', () => {
  const html = Renderer.renderAnswerKey({ ...BASE, examJson: exam });
  expect(html).not.toContain('class="oral');
  expect(html).not.toContain('section.oral');
});

test('an edit keeps the oral part: selection carries _oral like _topics', () => {
  const { applySelection, indexQuestions } = require('../../../bot/shared/services/assessment/assessment-selection');
  const paper = withOral('english', 3, EN_CONTENT);
  const ids = indexQuestions(paper).map((q) => q.id);
  const out = applySelection(paper, ids.slice(0, 1));
  expect(out._oral).toEqual(paper._oral);
});
