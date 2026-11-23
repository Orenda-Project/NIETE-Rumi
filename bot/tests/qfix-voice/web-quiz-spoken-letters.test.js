/**
 * A read-aloud clip never says an option letter the page would show differently (web-quiz-publish.service.js spoken()).
 *
 * The page shows options in each child's own order and rewrites a letter after "answer (is)", "option", "choice",
 * «جواب» or «آپشن» to that order (wq.js letters()). A clip is recorded once for every child. Bug (Nov 2026):
 * spoken() dropped only "answer is B" and "B)", so a why line "The answer is option B, a root drinks water" was
 * voiced with "B" while the child saw that option under another letter: 15 of 13,599 production questions,
 * 178 question-sittings 8-21 Nov. The test runs the real partsFor (the clips a question gets).
 *
 * Second bug (23 Nov): the first fix deleted "option C" whole, so a line heard after the answer became a broken
 * sentence ("All three matches in are correct.") — 8 of the 9 production clips it changed. In those lines (why, and
 * the feedback after a wrong pick) the letter phrase now names what that option is to the child: the right answer,
 * the child's own answer, or another answer. A stem or an option never says "the right answer": it would give it away.
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
    ['Choice B shows the part that drinks water.', 'The right answer shows the part that drinks water.'],
    ['The correct answer B tells us a root drinks water.', 'The correct answer tells us a root drinks water.'],
  ])('%s', (why, voiced) => {
    expect(said(item({ why }), 'why')).toBe(voiced);
  });

  test('Urdu: «جواب B» keeps «جواب» and drops the letter; «آپشن B» after «جواب» goes whole', () => {
    expect(said(item({ why: 'درست جواب B ہے، کیونکہ جڑ پانی پیتی ہے۔' }), 'why')).toBe('درست جواب ہے، کیونکہ جڑ پانی پیتی ہے۔');
    expect(said(item({ why: 'درست جواب آپشن B ہے۔' }), 'why')).toBe('درست جواب ہے۔');
  });
});

describe('a line heard after the answer names the option, never leaves a hole (23 Nov)', () => {
  // The production shapes, in fictional words: in all 8 the letter was the question's correct option.
  test.each([
    ['All three parts in option B are true.', 'All three parts in the right answer are true.'],
    ['Option B correctly shows the part that drinks water.', 'The right answer correctly shows the part that drinks water.'],
    ["The word 'جڑ' means root, and option B uses it correctly.", "The word 'جڑ' means root, and the right answer uses it correctly."],
    ['Option C is a flower, but option B drinks water.', 'Another answer is a flower, but the right answer drinks water.'],
  ])('%s', (why, voiced) => {
    expect(said(item({ why }), 'why')).toBe(voiced);
  });

  test('Urdu: «آپشن B» is «صحیح جواب», «آپشن C» «دوسرا جواب», in the Urdu line', () => {
    expect(said(item({ why: 'آپشن B میں جڑ پانی پیتی ہے۔' }), 'why')).toBe('صحیح جواب میں جڑ پانی پیتی ہے۔');
    expect(said(item({ why: 'آپشن C میں پھول ہے، جڑ نہیں۔' }), 'why')).toBe('دوسرا جواب میں پھول ہے، جڑ نہیں۔');
  });

  test('the feedback after a wrong pick calls that pick "your answer"', () => {
    const q = item({ why: 'A root drinks water.', fb: { A: 'Option A is a leaf; option B drinks the water.', C: 'آپشن C ایک پھول ہے۔' } });
    expect(said(q, 'xa')).toBe('Your answer is a leaf; the right answer drinks the water.');
    expect(said(q, 'xc')).toBe('آپ کا جواب ایک پھول ہے۔');
  });

  test('a plain row (no web item) is voiced the same way: why from the explanation, wrong feedback by index', () => {
    const q = {
      id: 'aaaaaaaa-0000-4000-8000-0000000000b2',
      question_text: 'Match each animal to its home.', option_a: '1-b, 2-a', option_b: '1-a, 2-b', option_c: '1-a, 2-a',
      correct_option: 'A', explanation: 'All three matches in option A are correct.',
      option_feedback: { wrong: { 1: 'In option B the bird lives in water; look at option A.' } },
    };
    expect(said(q, 'why')).toBe('All three matches in the right answer are correct.');
    expect(said(q, 'xb')).toBe('In your answer the bird lives in water; look at the right answer.');
  });

  test('a question with two right options calls both "the right answer"', () => {
    const q = item({ why: 'Option A and option B both grow on a plant; option C does not.' });
    q.correct_option = 'A,B';
    expect(said(q, 'why')).toBe('The right answer and the right answer both grow on a plant; another answer does not.');
  });
});

describe('the same for the wrong-answer clips and the question itself', () => {
  test('no clip of a question full of letter phrases says one', () => {
    const q = item({ stem: 'Look at option A and choice C. Which drinks water?', why: 'The answer is option B.', fb: { C: 'Not choice C: the answer is B.' } });
    for (const p of Publish.partsFor(q)) expect(p.text).not.toMatch(LETTER_AFTER);
  });

  test('a stem or an option never says "the right answer" (it would give it away): the letter phrase just goes', () => {
    const q = item({ stem: 'Is option B or option C a part that drinks water?', why: 'A root drinks water.' });
    expect(said(q, 'q')).toBe('Is or a part that drinks water?');
    for (const p of Publish.partsFor(q).filter((x) => ['q', 'a', 'b', 'c', 'd'].includes(x.part))) {
      expect(p.text).not.toMatch(/right answer|your answer|another answer|صحیح جواب|آپ کا جواب|دوسرا جواب/i);
    }
  });
});

describe('what was never a letter phrase stays as it was', () => {
  test('lowercase "a" after "answer" is the article, not option A', () => {
    expect(said(item({ why: 'The answer a farmer gives is: roots.' }), 'why')).toBe('The answer a farmer gives is: roots.');
  });

  test('lowercase "a" after "answer is" is the article too: the page shows it, so the clip says it', () => {
    expect(said(item({ why: 'The correct answer is a root, which drinks water.' }), 'why')).toBe('The correct answer is a root, which drinks water.');
    expect(said(item({ why: 'The answer is B.' }), 'why')).toBe('The answer is');
  });

  test('"Vitamin B", "Part B of the plant" and "B)" lines keep today\'s voicing', () => {
    expect(said(item({ why: 'Roots store Vitamin B.' }), 'why')).toBe('Roots store Vitamin B.');
    expect(said(item({ why: 'B) Root, because a root drinks water.' }), 'why')).toBe('Root, because a root drinks water.');
  });
});
