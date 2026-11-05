'use strict';
/** FBISE HSSC-I (Class XI) pattern, 2027: all candidates sit the 50% paper in the five subjects (BLUEPRINTS §6). */
const C = require('./chrome');
const S = require('./fbise-shapes');

const NON = 'inclusive-2024-non-50';
const sci = (key, on) => S.subject(key, `fbise-hssc1-${key}-50pct-2026`, [S.hsc50({ id: '50pct', on }), S.hscSciNon({ id: 'nonpct', applies: NON })],
  { notes: `non-50% variant: fbise-hssc1-${key}-inclusive-nonpct-2025` });
const A20 = S.MCQ(20, 4);

module.exports = C.build({
  id: 'fbise_hssc1_2027', grade: 11, board: 'FBISE', exam_kind: 'hssc1',
  subjects: [
    sci('biology', 'omr'),
    sci('chemistry', 'omr'),
    sci('physics', 'question_paper'),
    sci('computer_science', 'question_paper'),
    S.subject('maths', 'fbise-hssc1-mathematics-50pct-2026', [S.hscMaths50({ id: '50pct', on: 'question_paper' }), S.hscMathsNon({ id: 'nonpct', applies: NON })],
      { notes: 'non-50% variant: fbise-hssc1-mathematics-inclusive-nonpct-2024' }),
    S.subject('english', 'fbise-hssc1-english-inclusive-2025', [S.variant({
      id: 'single', total: 100, time: 180, ta: 25,
      secs: [['A', 'question_paper', [A20]], ['B', 'e_sheet', [['Q2', 'comprehension', 1, 1, 112], ['Q3a', 'comprehension', 1, 1, 24], ['Q3b', 'essay', 2, 1, 24]]],
        ['C', 'e_sheet', [['Q4', 'letter', 1, 1, 32, true], ['Q5', 'grammar', 1, 1, 64], ['Q6', 'srq', 1, 1, 32], ['Q7', 'essay', 1, 1, 32]]]],
    })], { status: 'ship_derived', derivation: 'Section totals are printed; the inner marks of Q2 (summary 8 + 5 parts x 4 = 28) and Q5 (idioms 6 + narration 6 + punctuation 4 = 16) are derived from them.' }),
    S.subject('urdu', 'fbise-hssc1-urdu-inclusive-2025', [S.variant({
      id: 'single', total: 100, time: 180, ta: 25,
      secs: [['1', 'question_paper', [A20]],
        ['2', 'e_sheet', [['Q2a prose', 'comprehension', 6, 6, 16], ['Q2b poem', 'comprehension', 3, 3, 16], ['Q2c ghazal', 'comprehension', 2, 2, 8], ['Q2d grammar', 'grammar', 2, 2, 16]]], // ur: needs fluent-Urdu review
        ['3', 'e_sheet', [['Q3', 'explanation_prose', 1, 1, 24], ['Q4', 'explanation_poem', 1, 1, 28], ['Q5', 'explanation_ghazal', 1, 1, 36], ['Q6', 'letter', 1, 1, 20], ['Q7', 'srq', 1, 1, 20]]]],
    })]),
    S.subject('islamiat', 'fbise-hssc1-islamiat-compulsory-inclusive-2025', [{
      ...S.variant({
        id: 'single', total: 50, time: 150, ta: 15,
        secs: [['1', 'question_paper', [S.MCQ(10, 4)]], ['2', 'e_sheet', [S.SRQ('Q2 (i-vi)', 6, 12)]], ['3', 'e_sheet', [S.ERQ('Q3-Q4', 2, 32)]], ['4', 'e_sheet', [S.SRQ('Q5', 1, 24)]]],
      }),
      cognitive_split: S.splitOf(undefined, 'default'),
    }]),
  ],
  pending: [S.pending('tarjuma_quran', 'fbise-hssc1-tarjuma-quran-inclusive-2025', 'Verified pattern (50 marks), no book imported.')],
});
