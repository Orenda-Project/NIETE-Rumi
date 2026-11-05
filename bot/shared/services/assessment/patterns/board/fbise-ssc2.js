'use strict';
/** FBISE SSC-II (Class X) pattern, 2027. Non-50% is the default; the 50% entries are partial (by analogy), 1A2028+. */
const C = require('./chrome');
const S = require('./fbise-shapes');

const LATER = '1A2028+';
const sci = (key, on, src) => S.subject(key, src, [S.sscSciNon({ id: 'nonpct', time: key === 'physics' ? undefined : 180 }), S.ssc50({ id: '50pct', on, applies: LATER })]);
const A15 = S.MCQ(15, 4);
const URDU_B = [['Q2 الف نثر', 'comprehension', 8, 8, 8], ['Q2 ب شعر', 'srq', 5, 5, 8], ['Q2 ج قواعد', 'grammar', 4, 4, 8]]; // ur: needs fluent-Urdu review
const urC = (...e4) => e4.map((m, i) => [`Q${i + 3}`, 'srq', 1, 1, m]);
const PAK = (id) => S.hum({ id }, 100, 180, 25, S.MCQ(20, 4), S.SRQ('Q2 i-x', 10, 20), S.ERQ('Q3-5', 3, 40));

module.exports = C.build({
  id: 'fbise_ssc2_2027', grade: 10, board: 'FBISE', exam_kind: 'ssc2',
  subjects: [
    sci('biology', 'omr', 'fbise-ssc2-biology-inclusive2024-nonpct'),
    sci('chemistry', 'omr', 'fbise-ssc2-chemistry-inclusive2024-nonpct'),
    sci('computer_science', 'omr', 'fbise-ssc2-computerscience-inclusive2024-nonpct'),
    sci('physics', 'question_paper', 'fbise-ssc2-physics-inclusive2024-nonpct'),
    S.subject('maths', 'fbise-ssc2-mathematics-nonpct', [S.sscMathsNon({ id: 'nonpct', split: S.splitOf({ K: 20, U: 50, A: 30 }, 'derived') }), S.sscMaths50({ id: '50pct', on: 'question_paper', applies: LATER })]),
    S.subject('english', 'fbise-ssc2-english-ncp2022-scheme2006', [S.variant({
      id: 'single', total: 75, time: 180, ta: 20,
      secs: [['A', 'question_paper', [A15]], ['B', 'e_sheet', [['Q2', 'comprehension', 1, 1, 72], ['Q3', 'explanation_poem', 1, 1, 36], ['Q4', 'grammar', 1, 1, 48]]],
        ['C', 'e_sheet', [['Q5', 'srq', 1, 1, 24], ['Q6', 'grammar', 1, 1, 20], ['Q7', 'essay', 1, 1, 40]]]],
    })]),
    S.subject('urdu', 'fbise-urdu-ssc2-ncp2022', [S.variant({
      id: 'single', total: 75, time: 180, ta: 20, secs: [['A', 'question_paper', [A15]], ['B', 'e_sheet', URDU_B], ['C', 'e_sheet', urC(16, 16, 16, 20, 36)]],
    })]),
    S.subject('islamiat', 'fbise-ssc1-islamiyat-lazmi-inclusive2024', [{
      ...S.hum({ id: 'term' }, 100, 180, 25, S.MCQ(20, 4), S.SRQ('Q2 i-xii', 12, 12), S.ERQ('Q3-5', 3, 40), [['D', 'e_sheet', [['Q6 i-ii', 'srq', 2, 2, 28, true]]]]),
      cognitive_split: S.splitOf(undefined, 'default'),
    }], { status: 'ship_derived', derivation: 'Islamiat is examined in SSC-I; the SSC-II shape is the SSC-I paper (fbise-ssc1-islamiyat-lazmi-inclusive2024), set as a term paper (P7).' }),
    S.subject('pakistan_studies', 'fbise-ssc2-pakistanstudies-inclusive2024', [PAK('single')]),
    S.subject('pakistan_studies_ur', 'fbise-ssc2-pakistanstudies-inclusive2024', [PAK('single')]),
  ],
  pending: [
    S.pending('tarjuma_quran', 'fbise-ssc2-tarjuma-quran-inclusive2024', 'Verified pattern (50 marks), no book imported.'),
    S.pending('general_science', 'fbise-ssc2-generalscience-ncp2022', 'No book imported.'),
  ],
});
