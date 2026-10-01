/**
 * bd-bfnsk — AG 1.2 items 3 and 4.
 *
 * Item 3: answer keys came back mostly "—". Measured on the last 200 NIETE prod
 * papers (30 Sep 2026): of the 148 requested WITHOUT an answer key, 147 carried
 * no answer on any question; of the 52 requested WITH one, 47 were fully
 * answered. The split is the request flag, not the model, subject or source —
 * because buildSystemPrompt appended "ANSWER KEY DISABLED: do NOT include the
 * answer field" whenever the teacher had not ticked the key. The paper never
 * prints answers anyway, so the instruction saved a few tokens and cost every
 * later key (revision, portal download) its content. Answers are now always
 * asked for, for every question type, and normalised deterministically where
 * the model's form is recoverable.
 *
 * Item 4: every question carries a `lines` number, and the paper ignored it —
 * ruled lines came from a per-type table. The stored number is now printed when
 * it is sane (an integer 0..15), the table is only the fallback, and questions
 * with nowhere to write (options, match columns, no-line types) stay at 0.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const R = require('../../bot/shared/services/assessment/assessment-paper.renderer');

const HEAD = { grade: 3, subject: 'Eng', schoolName: 'S', pageReference: '1-2', chapterTitle: 'C' };
const one = (type, q, section = 'subjective') => ({ unseen: { [section]: { [type]: [q] } } });
const ruled = (html) => (html.match(/<div class="answer-line">/g) || []).length;

beforeEach(() => mockCreate.mockReset());

describe('item 3 — answers are always asked for', () => {
  it.each(['Eng', 'Urdu', 'Maths', 'Islamiat', 'SST', 'GenK', 'Science'])(
    '%s: no "ANSWER KEY DISABLED" even when the teacher did not tick the key', (subject) => {
      const off = Gen.buildSystemPrompt({ subject, includeAnswerKey: false });
      expect(off).not.toContain('ANSWER KEY DISABLED');
      expect(off).not.toMatch(/Do NOT include the "answer" field/);
      // The flag no longer changes what the model is asked to write.
      expect(off).toBe(Gen.buildSystemPrompt({ subject, includeAnswerKey: true }));
    });

  it('names every shape the key needs an answer for', () => {
    const sys = Gen.buildSystemPrompt({ subject: 'Urdu', includeAnswerKey: false });
    expect(sys).toContain('ANSWER KEY REQUIRED');
    for (const needle of [/MCQ/i, /Match the Column/i, /Fill in the blanks/i, /words/i,
      /writing task/i, /Comprehension/i, /sub-question/i]) {
      expect(sys).toMatch(needle);
    }
  });

  it('the model call itself carries no disable instruction when the key is off', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(one('MCQs', { question: 'q', options: ['a) 1', 'b) 2'], answer: 'b', marks: 1 }, 'objective')) } }],
      usage: {},
    });
    const out = await Gen.generateExam({
      grade: 1, subject: 'Eng', pageContent: 'x', pageReference: '1', contentSource: 'unseen',
      questionTypes: [{ id: 'MCQs', count: 1, category: 'objective' }], includeAnswerKey: false,
    });
    const system = mockCreate.mock.calls[0][0].messages[0].content;
    expect(system).not.toContain('ANSWER KEY DISABLED');
    // Normalised on the way out, and the coverage is reported.
    expect(out.examJson.unseen.objective.MCQs[0].answer).toBe('b) 2');
    expect(out.answerCoverage).toEqual({ questions: 1, answered: 1 });
  });
});

describe('item 3 — deterministic normalisation', () => {
  const mcq = (answer, options = ['a) 3', 'b) 4', 'c) 5', 'd) 6']) =>
    one('MCQs', { question: 'What is 2+2?', options, answer, marks: 1 }, 'objective');
  const first = (exam) => exam.unseen.objective.MCQs[0].answer;

  it.each([
    ['b', 'b) 4'], ['B', 'b) 4'], ['(b)', 'b) 4'], ['b)', 'b) 4'],
    ['4', 'b) 4'], ['b) 4', 'b) 4'], [' b) 4 ', 'b) 4'],
  ])('MCQ answer %p resolves to the option %p', (given, want) => {
    const exam = mcq(given);
    Gen.normaliseAnswers(exam);
    expect(first(exam)).toBe(want);
  });

  it('resolves an Urdu letter label to its option', () => {
    const exam = mcq('ج', ['الف) کراچی', 'ب) لاہور', 'ج) اسلام آباد', 'د) پشاور']);
    Gen.normaliseAnswers(exam);
    expect(first(exam)).toBe('ج) اسلام آباد');
  });

  it('leaves an MCQ answer it cannot place untouched rather than guessing', () => {
    const exam = mcq('seven');
    Gen.normaliseAnswers(exam);
    expect(first(exam)).toBe('seven');
  });

  it('splits a numbered comprehension answer written on the parent onto its sub-questions', () => {
    const exam = one('Comprehension Passage', {
      passage: 'p', marks: 3, answer: '1) چار بیٹے تھے۔ 2) لڑنے سے۔ 3) اتفاق میں برکت ہے۔',
      questions: [{ question: 'a', marks: 1 }, { question: 'b', marks: 1 }, { question: 'c', marks: 1 }],
    });
    Gen.normaliseAnswers(exam);
    const subs = exam.unseen.subjective['Comprehension Passage'][0].questions;
    expect(subs.map((s) => s.answer)).toEqual(['چار بیٹے تھے۔', 'لڑنے سے۔', 'اتفاق میں برکت ہے۔']);
  });

  it('never overwrites a sub-question answer the model did give', () => {
    const exam = one('Comprehension Passage', {
      passage: 'p', answer: '1) X 2) Y',
      questions: [{ question: 'a', answer: 'kept' }, { question: 'b' }],
    });
    Gen.normaliseAnswers(exam);
    const subs = exam.unseen.subjective['Comprehension Passage'][0].questions;
    expect(subs[0].answer).toBe('kept');
    expect(subs[1].answer).toBe('Y');
  });

  it('counts coverage the way the key prints it', () => {
    const exam = {
      unseen: {
        objective: { MCQs: [{ question: 'q', options: ['a) 1'], answer: 'a) 1' }, { question: 'q2', options: ['a) 1'] }] },
        subjective: { 'Comprehension Passage': [{ passage: 'p', questions: [{ question: 'a', answer: 'x' }, { question: 'b' }] }] },
      },
    };
    // Two MCQs (one answered) + two sub-questions (one answered).
    expect(Gen.answerCoverage(exam)).toEqual({ questions: 4, answered: 2 });
  });
});

describe('item 3 — the answer key uses what it has', () => {
  it('prints a comprehension parent answer when the sub-questions carry none', () => {
    const key = R.renderAnswerKey({ ...HEAD, examJson: one('Comprehension Passage', {
      passage: 'p', answer: 'The whole model answer', questions: [{ question: 'a' }, { question: 'b' }],
    }) });
    expect(key).toContain('The whole model answer');
  });
});

describe('item 4 — the paper prints the stored answer lines', () => {
  const paper = (type, q, section) => R.renderPaper({ ...HEAD, answerLines: true, examJson: one(type, q, section) });

  it.each([[1], [6], [8], [15]])('prints %i stored lines under a written question', (n) => {
    expect(ruled(paper('Short Questions', { question: 'q', marks: 2, lines: n }))).toBe(n);
  });

  it('prints none when the stored number is 0', () => {
    expect(ruled(paper('Essay Writing', { question: 'q', marks: 5, lines: 0 }))).toBe(0);
  });

  it.each([[undefined], [null], [-1], [16], [99], [2.5], ['lots'], [NaN]])(
    'falls back to the type default when lines is %p', (bad) => {
      // Short Questions defaults to 4.
      expect(ruled(paper('Short Questions', { question: 'q', marks: 2, lines: bad }))).toBe(4);
    });

  it('accepts a whole number sent as a string', () => {
    expect(ruled(paper('Brief Answers', { question: 'q', marks: 2, lines: '5' }))).toBe(5);
  });

  it('keeps multiple choice, match and no-line types at 0 whatever lines says', () => {
    expect(ruled(paper('MCQs', { question: 'q', options: ['a) 1', 'b) 2'], lines: 5 }, 'objective'))).toBe(0);
    expect(ruled(paper('Match the Column', { question: 'q', column_a: ['A'], column_b: ['B'], lines: 3 }, 'objective'))).toBe(0);
    expect(ruled(paper('True/False', { question: 'q', lines: 3 }, 'objective'))).toBe(0);
    expect(ruled(paper('Fill in the blanks', { question: 'q ___', lines: 2 }, 'objective'))).toBe(0);
  });

  it('prints a comprehension sub-question\'s own lines, defaulting to 2', () => {
    const html = paper('Comprehension Passage', {
      passage: 'p', questions: [{ question: 'a', lines: 5 }, { question: 'b' }, { question: 'c', lines: 40 }],
    });
    expect(ruled(html)).toBe(5 + 2 + 2);
  });

  it('prints nothing when she turned answer lines off, stored lines or not', () => {
    const html = R.renderPaper({ ...HEAD, answerLines: false,
      examJson: one('Short Questions', { question: 'q', lines: 6 }) });
    expect(ruled(html)).toBe(0);
  });

  it('the revision path renders through the same renderPaper', () => {
    const src = require('fs').readFileSync(require.resolve(
      '../../bot/shared/services/assessment/assessment-revision.service.js'), 'utf8');
    expect(src).toMatch(/Renderer\.renderPaper\(/);
  });
});
