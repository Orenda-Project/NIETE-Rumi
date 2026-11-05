'use strict';
/** FBISE SSC-I (Class IX) pattern, 2027: every paper from the real-paper fixtures (structure only). */
const C = require('./chrome');
const S = require('./fbise-shapes');

const NON = 'inclusive-2024-non-50';
const sci = (key, on, src, nonSrc) => S.subject(key, src, [S.ssc50({ id: '50pct', on }), S.sscSciNon({ id: 'nonpct', applies: NON, time: key === 'physics' ? 185 : 180 })],
  { notes: `non-50% variant: ${nonSrc}` });
const A15 = S.MCQ(15, 4);
const URDU_B = [['Q2 الف نثر', 'comprehension', 8, 8, 8], ['Q2 ب شعر', 'srq', 5, 5, 8], ['Q2 ج قواعد', 'grammar', 4, 4, 8]]; // ur: needs fluent-Urdu review
const urC = (...e4) => e4.map((m, i) => [`Q${i + 3}`, 'srq', 1, 1, m]);
const ISL = (id) => S.hum({ id }, 100, 180, 25, S.MCQ(20, 4), S.SRQ('Q2 i-xii', 12, 12), S.ERQ('Q3-5', 3, 40), [['D', 'e_sheet', [['Q6 i-ii', 'srq', 2, 2, 28, true]]]]);

module.exports = C.build({
  id: 'fbise_ssc1_2027', grade: 9, board: 'FBISE', exam_kind: 'ssc1',
  subjects: [
    sci('biology', 'omr', 'fbise-ssc1-biology-50pct-2026', 'fbise-ssc1-biology-inclusive2024-nonpct'),
    sci('chemistry', 'omr', 'fbise-ssc1-chemistry-50pct-2026', 'fbise-ssc1-chemistry-inclusive2024-nonpct'),
    sci('physics', 'question_paper', 'fbise-ssc1-physics-50pct-2026', 'fbise-ssc1-physics-inclusive2024-nonpct'),
    S.subject('maths', 'fbise-ssc1-mathematics-50pct-2026', [S.sscMaths50({ id: '50pct', on: 'question_paper' }), S.sscMathsNon({ id: 'nonpct', applies: NON })],
      { notes: `non-50% variant: fbise-ssc1-mathematics-inclusive2024-nonpct` }),
    S.subject('english', 'fbise-ssc1-english-inclusive2024', [S.variant({
      id: 'single', total: 75, time: 180, ta: 20,
      secs: [['A', 'question_paper', [A15]], ['B', 'e_sheet', [['Q2', 'comprehension', 1, 1, 72], ['Q3', 'explanation_poem', 1, 1, 36], ['Q4', 'grammar', 1, 1, 52]]],
        ['C', 'e_sheet', [['Q5', 'letter', 1, 1, 32, true], ['Q6', 'essay', 1, 1, 24, true], ['Q7', 'srq', 1, 1, 24, true]]]],
    })]),
    S.subject('urdu', 'fbise-urdu-ssc1-ncp2022', [S.variant({
      id: 'single', total: 75, time: 180, ta: 20, secs: [['A', 'question_paper', [A15]], ['B', 'e_sheet', URDU_B], ['C', 'e_sheet', urC(20, 20, 20, 24, 20)]],
    })]),
    S.subject('islamiat', 'fbise-ssc1-islamiyat-lazmi-inclusive2024', [ISL('single')].map((v) => ({ ...v, cognitive_split: S.splitOf(undefined, 'default') }))),
    S.subject('pakistan_studies_ur', 'fbise-ssc2-pakistanstudies-inclusive2024', [S.hum({ id: 'term' }, 100, 180, 25, S.MCQ(20, 4), S.SRQ('Q2 i-x', 10, 20), S.ERQ('Q3-5', 3, 40))], {
      status: 'ship_derived', derivation: 'SSC-I does not examine Pakistan Studies; the shape is the SSC-II paper (fbise-ssc2-pakistanstudies-inclusive2024), set as a term paper (P7).',
    }),
  ],
  pending: [
    S.pending('computer_science', 'fbise-ssc1-computerscience-50pct-2026', 'The pattern is verified, but the only book is the practicals supplement, so an on-syllabus theory paper cannot be written from it (BLUEPRINTS §4).'),
    S.pending('tarjuma_quran', 'fbise-ssc1-tarjuma-quran-inclusive2024', 'Verified pattern (50 marks), no book imported.'),
    S.pending('general_science', 'fbise-ssc1-generalscience-ncp2022', 'Verified pattern (75 marks), no book imported.'),
  ],
});
