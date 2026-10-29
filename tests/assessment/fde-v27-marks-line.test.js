/**
 * A slot whose one item is n equal parts prints "(n×m=t)" (bd-5jmnfj.4.58.2, v26 finding 3).
 *
 * v26 g2-english Q1: ten sub-questions of 2 marks printed "(20)"; g5-english Q4: five sentences of
 * 2 marks printed "(10)". Slots whose pattern line already holds {n:}×m ("(5×2=10)") are unchanged.
 */

const fs = require('fs');
const path = require('path');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { equalPartsLine } = require('../../bot/shared/services/assessment/fde-marks-line');

const load = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v26', `${n}-trimmed.json`), 'utf8'));
const heads = (html) => [...html.matchAll(/<div class="slot-head">(.*?)<\/div>/g)].map((m) => m[1]);
const ml = (head) => (head.match(/<span class="ml">(.*?)<\/span>/) || [])[1];

describe('printed marks lines', () => {
  test('G2 English Q1: ten parts of 2 marks print (10×2=20)', () => {
    const html = R.renderPaper({ examJson: load('g2-english'), grade: 2, subject: 'english' });
    expect(ml(heads(html)[0])).toBe('(10×2=20)');
  });

  test('G5 English Q4: five sentences of 2 marks print (5×2=10)', () => {
    const html = R.renderPaper({ examJson: load('g5-english'), grade: 5, subject: 'english' });
    const q4 = heads(html).find((h) => /Q\.4/.test(h));
    expect(ml(q4)).toBe('(5×2=10)');
  });

  test('G5 English Q1(b), five single marks, stays (5)', () => {
    const html = R.renderPaper({ examJson: load('g5-english'), grade: 5, subject: 'english' });
    expect(ml(heads(html).find((h) => /Q1 \(b\)/.test(h)))).toBe('(5)');
  });

  test('G2 English Q16, six parts of one mark, stays (6)', () => {
    const html = R.renderPaper({ examJson: load('g2-english'), grade: 2, subject: 'english' });
    expect(ml(heads(html).find((h) => /Q16/.test(h)))).toBe('(6)');
  });
});

describe('equalPartsLine', () => {
  const slot = { generate: 1, attempt: 1, marks_each: 20 };
  const parts = (n, m) => ({ questions: Array.from({ length: n }, () => ({ marks: m })) });
  test('rewrites the total atom into n×m=t', () => {
    expect(equalPartsLine('({t:20})', slot, [parts(10, 2)])).toBe('(10×2={t:20})');
    expect(equalPartsLine('{t:20}', slot, [parts(10, 2)])).toBe('10×2={t:20}');
  });
  test('leaves a line that already shows its factors, unequal parts, one-mark parts and a mismatched total', () => {
    expect(equalPartsLine('({n:5}×2={t:10})', slot, [parts(10, 2)])).toBe('({n:5}×2={t:10})');
    expect(equalPartsLine('({t:20})', slot, [{ questions: [{ marks: 2 }, { marks: 3 }] }])).toBe('({t:20})');
    expect(equalPartsLine('({t:20})', slot, [parts(20, 1)])).toBe('({t:20})');
    expect(equalPartsLine('({t:20})', slot, [parts(5, 2)])).toBe('({t:20})');
    expect(equalPartsLine(null, slot, [parts(10, 2)])).toBe(null);
  });
  test('reads equal scheme points of a choose-n item', () => {
    const q = { scheme: { points: Array.from({ length: 5 }, () => ({ marks: 2 })) } };
    expect(equalPartsLine('({t:10})', { generate: 1, attempt: 1, marks_each: 10, in_item_choice: { n: 5, g: 6 } }, [q])).toBe('(5×2={t:10})');
    expect(equalPartsLine('({t:10})', { generate: 1, attempt: 1, marks_each: 10 }, [q])).toBe('({t:10})');
  });
});
