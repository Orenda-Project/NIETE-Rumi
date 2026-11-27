/**
 * bd-nr8mrm.2 — FEAT-209 (Ramisha Riaz): the printed paper follows the fit step stored on it.
 * `_print.fit.twoCol` sets MCQs and word blanks side by side in two columns; `_print.fit.trimLines`
 * takes one line off each short answer. A paper with no fit step prints byte for byte as before.
 */

const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const Fit = require('../../bot/shared/services/assessment/page-fit');

const mcq = (n) => ({ question: `Pick ${n}`, options: ['a', 'b', 'c', 'd'], marks: 1 });
const EXAM = (print) => ({
  ...(print ? { _print: print } : {}),
  unseen: {
    objective: {
      MCQs: [mcq(1), mcq(2), mcq(3)],
      'Fill in the blanks': [{ question: 'Fill', words: ['cat', 'dog'], marks: 2 }],
    },
    subjective: {
      'Short Questions': [{ question: 'Name two fruits.', marks: 2 }],
      'Long Question': [{ question: 'Describe a farm.', marks: 5 }],
    },
  },
});
const render = (print) => Renderer.renderPaper({ examJson: EXAM(print), grade: 4, subject: 'science' });
const count = (s, needle) => s.split(needle).length - 1;

describe('two columns', () => {
  test('MCQs and word blanks sit in a two-column block; written answers stay full width', () => {
    const html = render({ compact: true, fit: { twoCol: true, trimLines: false } });
    expect(html).toContain(Fit.fitCss({ twoCol: true }));
    const blocks = html.split('<div class="cols2">').slice(1).map((b) => b.split('</div><!--cols2-->')[0]);
    expect(blocks).toHaveLength(2);
    const mcqs = blocks.find((x) => x.includes('Pick 1'));
    expect(mcqs).toContain('Pick 3');
    expect(blocks.find((x) => x.includes('cat'))).not.toBe(mcqs);
    expect(blocks.join('')).not.toContain('Name two fruits.');
    expect(blocks.join('')).not.toContain('Describe a farm.');
  });

  test('every question is still printed', () => {
    const html = render({ compact: true, fit: { twoCol: true, trimLines: true } });
    ['Pick 1', 'Pick 2', 'Pick 3', 'cat', 'Name two fruits.', 'Describe a farm.'].forEach((t) => expect(html).toContain(t));
  });

  test('without the step there are no columns', () => {
    expect(render({ compact: true })).not.toContain('cols2');
  });
});

describe('fewer short-answer lines', () => {
  const lines = (html, q) => count(html.split(q)[1].split('<div class="q">')[0], 'answer-line');

  test('a short answer loses one line, a long answer keeps all of them', () => {
    const plain = render({ compact: true });
    const trimmed = render({ compact: true, fit: { twoCol: true, trimLines: true } });
    expect(lines(plain, 'Name two fruits.')).toBe(4);
    expect(lines(trimmed, 'Name two fruits.')).toBe(3);
    expect(lines(trimmed, 'Describe a farm.')).toBe(lines(plain, 'Describe a farm.'));
  });

  test('a comprehension sub-question keeps at least one line', () => {
    const exam = { unseen: { subjective: { Comprehension: [{ passage: 'A cat sat.', questions: [{ question: 'Who sat?', marks: 1 }] }] } } };
    const html = Renderer.renderPaper({ examJson: { ...exam, _print: { compact: true, fit: { twoCol: false, trimLines: true } } }, grade: 4, subject: 'english' });
    expect(count(html.split('Who sat?')[1], 'answer-line')).toBe(1);
  });
});

test('a paper with no fit step is byte for byte what it was', () => {
  expect(render(null)).toBe(Renderer.renderPaper({ examJson: EXAM(null), grade: 4, subject: 'science' }));
  expect(render({ compact: true })).toBe(Renderer.renderPaper({ examJson: EXAM(null), grade: 4, subject: 'science', compact: true }));
});

describe('fit helpers', () => {
  test('a column question is one with options or a word list', () => {
    expect(Fit.isColumnQuestion(mcq(1))).toBe(true);
    expect(Fit.isColumnQuestion({ words: ['a'] })).toBe(true);
    expect(Fit.isColumnQuestion({ question: 'x' })).toBe(false);
    expect(Fit.isColumnQuestion({ options: [] })).toBe(false);
    expect(Fit.isColumnQuestion('a string')).toBe(false);
    expect(Fit.isColumnQuestion(null)).toBe(false);
  });

  test('fit css is empty without columns', () => {
    expect(Fit.fitCss({ twoCol: false })).toBe('');
    expect(Fit.fitCss(null)).toBe('');
    expect(Fit.fitCss({ twoCol: true })).toMatch(/column-count: 2/);
  });
});
