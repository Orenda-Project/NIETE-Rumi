/**
 * Task 7 — the answer key grouped by topic, and a student copy with no total line.
 * A chapter paper's student and key HTML must be byte-identical to before (sha256 taken before the edit).
 */
const crypto = require('crypto');
const Renderer = require('../../../bot/shared/services/assessment/assessment-paper.renderer');
const { renderTopicSummary, topicsFromScope } = require('../../../bot/shared/services/assessment/topic-key.renderer');
const exam = require('./fixtures/topic-key-exam');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const BASE = { examJson: exam, grade: 3, subject: 'english', schoolName: 'S', pageReference: '4-14', chapterTitle: 'Ch' };
const TOPICS = [
  { topicId: 't1', name: 'Rhyming words', sloCodes: ['E-1'] },
  { topicId: 't2', name: 'Sentences', sloCodes: ['E-2'] },
];
const questions = Renderer.collectQuestions(exam);

describe('renderTopicSummary', () => {
  test('one line per topic, in topic order, with question numbers and marks', () => {
    const html = renderTopicSummary({ questions, topics: TOPICS });
    expect(html.indexOf('Rhyming words: Q1-3, 3 marks')).toBeGreaterThan(-1);
    expect(html.indexOf('Sentences: Q4, 2 marks')).toBeGreaterThan(html.indexOf('Rhyming words'));
  });

  test('questions with no matching topic go under Other, never dropped', () => {
    const html = renderTopicSummary({ questions, topics: TOPICS });
    expect(html).toContain('Other: Q5-6, 3 marks');
  });

  test('marks across all lines add up to the paper total', () => {
    const html = renderTopicSummary({ questions, topics: TOPICS });
    const sum = [...html.matchAll(/, (\d+) marks?</g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(sum).toBe(Renderer.totalMarks(questions));
  });

  test('a shared slo goes to the first topic in order; a topic with no questions still shows', () => {
    const topics = [{ name: 'A', sloCodes: ['E-1'] }, { name: 'B', sloCodes: ['E-1'] }];
    const html = renderTopicSummary({ questions: questions.slice(0, 3), topics });
    expect(html).toContain('A: Q1-3, 3 marks');
    expect(html).toContain('B: no questions, 0 marks');
    expect(html).not.toContain('Other');
  });

  test('non-contiguous numbers list as separate runs; one mark is singular; names are escaped', () => {
    const qs = [1, 2, 3].map((n) => ({ question: { marks: 1, slo: n === 2 ? 'X' : 'E-1' } }));
    const html = renderTopicSummary({ questions: qs, topics: [{ name: 'A<b>', sloCodes: ['E-1'] }] });
    expect(html).toContain('A&lt;b&gt;: Q1, 3, 2 marks');
    expect(html).toContain('Other: Q2, 1 mark<');
  });
});

describe('topicsFromScope', () => {
  test('groups the scope slos by topic in topicIds order', () => {
    const slos = [
      { code: 'E-2', topicId: 't2', topicName: 'Sentences' },
      { code: 'E-1', topicId: 't1', topicName: 'Rhyming words' },
      { code: 'E-3', topicId: 't1', topicName: 'Rhyming words' },
    ];
    expect(topicsFromScope({ kind: 'topics', topicIds: ['t1', 't2'], slos })).toEqual([
      { topicId: 't1', name: 'Rhyming words', sloCodes: ['E-1', 'E-3'] },
      { topicId: 't2', name: 'Sentences', sloCodes: ['E-2'] },
    ]);
  });
  test('no topic scope gives undefined', () => {
    expect(topicsFromScope(null)).toBeUndefined();
  });
});

describe('renderAnswerKey with topics', () => {
  const key = Renderer.renderAnswerKey({ ...BASE, topics: TOPICS });
  test('carries the summary and each answer shows its SLO code', () => {
    expect(key).toContain('Rhyming words: Q1-3, 3 marks');
    expect(key).toMatch(/hat[\s\S]*?E-1/);
    expect(key).toContain('E-9');
  });
});

describe('renderPaper for a topic paper', () => {
  test('has no total or obtained marks line, and still has name and roll no', () => {
    const html = Renderer.renderPaper({ ...BASE, paperKind: 'topic' });
    expect(html).not.toMatch(/Total Marks|Obtained Marks|Pass/);
    expect(html).toContain('Student Name');
    expect(html).toContain('Roll No');
  });
});

describe('chapter papers are unchanged', () => {
  test('student copy', () => {
    expect(sha(Renderer.renderPaper(BASE))).toBe('62055bb8278ca98ab6bd4d7ce7ea9121c59b95e7b5c094a32731fcdcd8e5b07c');
  });
  test('answer key', () => {
    expect(sha(Renderer.renderAnswerKey(BASE))).toBe('c7ba66a3ac67be032134ade7525ea4d237d031809f27920ab413a8847e5f588d');
  });
  test('an empty topics list is a chapter key', () => {
    expect(sha(Renderer.renderAnswerKey({ ...BASE, topics: [] }))).toBe('c7ba66a3ac67be032134ade7525ea4d237d031809f27920ab413a8847e5f588d');
  });
});
