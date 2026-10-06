'use strict';
/**
 * A QUESTION THAT POINTS AT A PICTURE THAT ISN'T THERE (quiz_author_gates_v2).
 *
 * A child on the web met "If a diagram shows four concentric circles
 * representing Earth's layers, which circle would represent the mantle?" with
 * no diagram. The picture check knew "in the diagram", "the diagram below" and
 * "look at the picture", but not a picture the stem SUPPOSES ("if a diagram
 * shows"), describes ("the image shows 2/6"), reads from ("according to the
 * chart"), or a part only a drawing has ("the shaded part"). Each phrasing
 * below is a real picture-less stem from the sandbox. With the flag on it is
 * PICTURE_MISSING — the existing rewrite asks it without the picture, else it
 * is dropped within the floor. Phrasings that only mention a picture word
 * ("what can a map show", «پیراگراف», «مشکل», «کس شکل میں») stay clean.
 */
const mockSettings = { rows: [] };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({
    select: () => ({
      in: async () => ({ data: mockSettings.rows, error: null }),
      eq: (_col, key) => ({ maybeSingle: async () => ({ data: mockSettings.rows.find((r) => r.key === key) || null, error: null }) }),
    }),
  }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const DIGEST = { subject: 'science', slos: [{ id: 'S1', statement: 'name the layers of the Earth', taught_level: 'recall' }] };
const q = (i, over = {}) => ({
  slo_id: 'S1', level: 'recall',
  question: `Which layer is number ${i + 1} from the top?`,
  options: [`layer ${i + 1}`, `layer ${i + 2}`, `layer ${i + 3}`],
  correct_index: 0,
  explanation: `Layer ${i + 1} is number ${i + 1} from the top.`,
  selected_because: 'the class named the layers',
  option_feedback: { correct: 'Yes.', wrong: { 1: 'That one is lower.', 2: 'That one is lower still.' } },
  ...over,
});
const six = (over) => [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0 ? over : {}));
const codes = (stem, authorGates, language = 'en') => validate(six({ question: stem }), {
  language, subject: 'science', digest: DIGEST, authorGates,
}).errors.filter((e) => /^q0: /.test(e)).map((e) => e.replace(/^q\d+: /, '').split(/\s/)[0]);

const POINTS = [
  ['en', "If a diagram shows four concentric circles representing Earth's layers, which circle would represent the mantle?"],
  ['en', 'The image shows 2/6. What will its equivalent fraction be?'],
  ['en', 'The image shows rain mixed with nitrogen oxide. What is this kind of rain called?'],
  ['en', 'A drawing shows the electron inside the nucleus. What should be fixed?'],
  ['en', 'A map shows a plateau west of the Kirthar range. Which plateau is it?'],
  ['en', 'If a map shows attacks on the northern border, which area should be marked?'],
  ['en', 'According to the chart, which month had the most rain?'],
  ['en', 'Calculate the area of the shaded part.'],
  ['en', 'Which layer is labelled B?'],
  ['ur', 'نقشے میں کون سا شہر سب سے اوپر ہے؟'],
  ['ur', 'کلاس کے چارٹ میں عین کے لیے کون سی سرخی درست ہے؟'],
];
const CLEAN = [
  ['en', 'What can a map show better than a globe?'],
  ['en', "The clock shows 4 o'clock. After 1 hour, what time is it?"],
  ['en', 'If two places are 6 cm apart on a map with 1 cm = 1 km, how far apart are they?'],
  ['en', 'Which word in the sentence is labelled as a noun by the teacher?'],
  ['ur', 'سنوبر والے پیراگراف میں کون سی بات اہم واقعہ ہے؟'],
  ['ur', 'اگر کوئی دوست مشکل میں مدد کے لیے پکارے تو کیا کرنا چاہیے؟'],
  ['ur', 'دو چشمی ہ الفاظ میں کس شکل میں آتا ہے؟'],
];

describe('flag on: every stem that supposes a picture it does not carry is PICTURE_MISSING', () => {
  test.each(POINTS)('%s: %s', (lang, stem) => {
    expect(codes(stem, true, lang)).toContain('PICTURE_MISSING');
  });
});

describe('flag on: a picture word that points at nothing is clean', () => {
  test.each(CLEAN)('%s: %s', (lang, stem) => {
    expect(codes(stem, true, lang)).not.toContain('PICTURE_MISSING');
  });
});

describe('flag off: today\'s complaints, exactly', () => {
  test.each(POINTS)('%s: %s', (lang, stem) => {
    expect(codes(stem, false, lang)).not.toContain('PICTURE_MISSING');
  });
});

test('the same stem WITH a figure is not PICTURE_MISSING', () => {
  const errs = validate(six({ question: 'Calculate the area of the shaded part.', figure: { type: 'grid', rows: 2, cols: 2, shaded: 1 } }), {
    language: 'en', subject: 'science', digest: DIGEST, authorGates: true,
  }).errors.filter((e) => /^q0: PICTURE_MISSING/.test(e));
  expect(errs).toEqual([]);
});
