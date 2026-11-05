'use strict';
/** FBISE HSSC-II (Class XII) pattern, 2027. Inclusive 2024 non-50% is the default; the 50% entries are partial, 1A2028+. */
const C = require('./chrome');
const S = require('./fbise-shapes');

const LATER = '1A2028+';
const sci = (key, src, on) => S.subject(key, src, [S.hscSciNon({ id: 'nonpct', time: key === 'physics' ? 190 : 180 })].concat(on ? [S.hsc50({ id: '50pct', on, applies: LATER })] : []));
const A20 = S.MCQ(20, 4);
const PAK = (id) => S.hum({ id }, 50, 150, 15, S.MCQ(10, 4), S.SRQ('Q2 (i-viii)', 8, 12), S.ERQ('Q3-Q4', 2, 32));

module.exports = C.build({
  id: 'fbise_hssc2_2027', grade: 12, board: 'FBISE', exam_kind: 'hssc2',
  subjects: [
    sci('biology', 'fbise-hssc2-biology-inclusive-2024-nonpct', 'omr'),
    sci('chemistry', 'fbise-hssc2-chemistry-inclusive-2024-nonpct', 'omr'),
    sci('computer_science', 'fbise-hssc2-computer_science-inclusive-2024-nonpct', 'question_paper'),
    sci('physics', 'fbise-hssc2-physics-inclusive-2024-nonpct', null),
    S.subject('maths', 'fbise-hssc2-mathematics-2006-nonpct', [S.hscMathsNon({ id: 'nonpct', split: S.splitOf({ K: 20, U: 50, A: 30 }, 'derived') }), S.hscMaths50({ id: '50pct', on: 'question_paper', applies: LATER })]),
    S.subject('english', 'fbise-hssc2-english-2006', [S.variant({
      id: 'single', total: 100, time: 180, ta: 25, split: S.splitOf({ K: 30, U: 49, A: 21 }, 'derived'),
      secs: [['A', 'question_paper', [A20]], ['B', 'e_sheet', [['Q2', 'comprehension', 1, 1, 112], ['Q3A', 'comprehension', 1, 1, 24], ['Q3B', 'essay', 2, 1, 24]]],
        ['C', 'e_sheet', [['Q4', 'essay', 2, 1, 48], ['Q5', 'grammar', 1, 1, 72], ['Q6', 'grammar', 1, 1, 20], ['Q7', 'grammar', 1, 1, 20]]]],
    })]),
    S.subject('urdu', 'fbise-hssc2-urdu-2006', [S.variant({
      id: 'single', total: 100, time: 180, ta: 25,
      secs: [['1', 'question_paper', [A20]],
        ['2', 'e_sheet', [['Q2a prose', 'comprehension', 6, 6, 12], ['Q2b poem', 'comprehension', 3, 3, 12], ['Q2c ghazal', 'comprehension', 2, 2, 12], ['Q2d grammar', 'grammar', 2, 2, 12]]], // ur: needs fluent-Urdu review
        ['3', 'e_sheet', [['Q3', 'explanation_prose', 1, 1, 24], ['Q4', 'explanation_poem', 1, 1, 24], ['Q5', 'explanation_ghazal', 1, 1, 36], ['Q6', 'letter', 1, 1, 32], ['Q7', 'essay', 1, 1, 48]]]],
    })]),
    S.subject('pakistan_studies', 'fbise-hssc2-pakistan-studies-inclusive-2025', [PAK('single')]),
    S.subject('pakistan_studies_ur', 'fbise-hssc2-pakistan-studies-inclusive-2025', [PAK('single')]),
  ],
  pending: [S.pending('tarjuma_quran', 'fbise-hssc2-tarjuma-quran-inclusive-2026', 'Verified pattern (50 marks), no book imported.')],
});
