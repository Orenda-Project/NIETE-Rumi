/**
 * A read-aloud clip never says an option letter the page would show differently (web-quiz-publish.service.js spoken()).
 *
 * The page shows options in each child's own order and rewrites a letter after "answer (is)", "option", "choice",
 * «جواب» or «آپشن» to that order (wq.js letters()). A clip is recorded once for every child. Bug (Nov 2026):
 * spoken() dropped only "answer is B" and "B)", so a why line "The answer is option B, a root drinks water" was
 * voiced with "B" while the child saw that option under another letter: 15 of 13,599 production questions,
 * 178 question-sittings 8-21 Nov. The test runs the real partsFor (the clips a question gets).
 */
jest.mock('axios');
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const Publish = require('../../shared/services/quiz/web-quiz-publish.service');

// A web item (media.web v2) as the generator stores it; fictional content.
function item({ stem = 'Which part of a plant drinks water?', why, fb = {} }) {
  return {
    id: 'aaaaaaaa-0000-4000-8000-0000000000b1',
    question_text: stem, option_a: 'Leaf', option_b: 'Root', option_c: 'Flower', correct_option: 'B',
    media: {
      language: 'en',
      web: {
        v: 2, type: 'single', key: 'B', stem, why,
        options: [{ slot: 'A', text: 'Leaf', fb: fb.A }, { slot: 'B', text: 'Root' }, { slot: 'C', text: 'Flower', fb: fb.C }],
      },
    },
  };
}
const said = (q, part) => (Publish.partsFor(q).find((p) => p.part === part) || {}).text;
const LETTER_AFTER = /(\b(?:answer is|answer|option|choice)\s+|جواب\s+|آپشن\s+)[A-D](?![A-Za-z])/;

describe('the why clip says no letter the page would remap', () => {
  test.each([
    ['The answer is option B, because a root drinks water.', 'The answer is, because a root drinks water.'],
    ['Choice B is right: a root drinks water.', 'is right: a root drinks water.'],
    ['The correct answer B tells us a root drinks water.', 'The correct answer tells us a root drinks water.'],
  ])('%s', (why, voiced) => {
    expect(said(item({ why }), 'why')).toBe(voiced);
  });

  test('Urdu: «جواب B» keeps «جواب» and drops the letter; «آپشن B» goes whole', () => {
    expect(said(item({ why: 'درست جواب B ہے، کیونکہ جڑ پانی پیتی ہے۔' }), 'why')).toBe('درست جواب ہے، کیونکہ جڑ پانی پیتی ہے۔');
    expect(said(item({ why: 'درست جواب آپشن B ہے۔' }), 'why')).toBe('درست جواب ہے۔');
  });
});

describe('the same for the wrong-answer clips and the question itself', () => {
  test('a wrong-option line naming "option B" is voiced without the letter', () => {
    const q = item({ why: 'A root drinks water.', fb: { A: 'Leaves make food; the water goes in through option B.' } });
    expect(said(q, 'xa')).toBe('Leaves make food; the water goes in through.');
  });

  test('no clip of a question full of letter phrases says one', () => {
    const q = item({ stem: 'Look at option A and choice C. Which drinks water?', why: 'The answer is option B.', fb: { C: 'Not choice C: the answer is B.' } });
    for (const p of Publish.partsFor(q)) expect(p.text).not.toMatch(LETTER_AFTER);
  });
});

describe('what was never a letter phrase stays as it was', () => {
  test('lowercase "a" after "answer" is the article, not option A', () => {
    expect(said(item({ why: 'The answer a farmer gives is: roots.' }), 'why')).toBe('The answer a farmer gives is: roots.');
  });

  test('"Vitamin B", "Part B of the plant" and "B)" lines keep today\'s voicing', () => {
    expect(said(item({ why: 'Roots store Vitamin B.' }), 'why')).toBe('Roots store Vitamin B.');
    expect(said(item({ why: 'B) Root, because a root drinks water.' }), 'why')).toBe('Root, because a root drinks water.');
  });
});
