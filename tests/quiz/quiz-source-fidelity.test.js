'use strict';
/**
 * SOURCE FIDELITY — the pure gates (transcript-quiz-source-fidelity). Each case
 * is a fault class a pedagogy review found in real quizzes, written with
 * fictional text: an answer invented for a question the plan only asked, a
 * word problem with numbers the lesson never used, a quote of the class's slip
 * instead of the fact, a long grade-1 stem — and the good item an earlier gate
 * refused wrongly (the class's own division problem, shared only by numbers).
 */
const SF = require('../../bot/shared/services/quiz/transcript-quiz-source-fidelity');

const LP = [
  'WHAT THE CLASS WAS TO LEARN: going back to the dialogue to find an answer.',
  'Question b: What was Pinky told not to eat?',
  'Teacher: Read the dialogue again and find the line where the answer is.',
].join('\n');

const TX = [
  '[02:10] Teacher: 64 divided by 7. 7 nines are 63, and 1 is our remainder.',
  '[04:00] Teacher: 24 letters have a half form, the other letters do not.',
  '[09:30] Class: 12 letters have a half form!',
  '[12:00] Teacher: We add the ones first, then the tens: 146 plus 27 is 173.',
].join('\n');

const q = (over) => ({
  question: 'What is 146 + 27?', options: ['173', '163', '1713'], correct_index: 0,
  explanation: 'Add the ones first, then the tens: 173.', source_quote: 'We add the ones first, then the tens: 146 plus 27 is 173', ...over,
});

describe('questionFaults', () => {
  test('a quote of the lesson moment that carries the key passes', () => {
    expect(SF.questionFaults(q(), TX)).toEqual([]);
  });

  test('no quote is refused', () => {
    expect(SF.questionFaults(q({ source_quote: '' }), TX).map((f) => f.code)).toEqual(['SOURCE_QUOTE_MISSING']);
  });

  test('a quote that is not in the source is refused', () => {
    expect(SF.questionFaults(q({ source_quote: 'Zainab has fourteen marbles and gives seven to her friend' }), TX).map((f) => f.code))
      .toEqual(['SOURCE_QUOTE_NOT_FOUND']);
  });

  test('a quoted QUESTION never anchors a key (the textbook question the plan only asked)', () => {
    const pinky = {
      question: 'What was Pinky told not to eat?', options: ['sweets', 'nothing was forbidden', 'bread'], correct_index: 1,
      explanation: 'Nothing was forbidden.', source_quote: 'What was Pinky told not to eat?',
    };
    expect(SF.questionFaults(pinky, LP).map((f) => f.code)).toEqual(['SOURCE_QUOTE_IS_QUESTION']);
    expect(SF.questionFaults({ ...pinky, source_quote: 'پنکی کو کیا کھانے سے منع کیا گیا؟' }, 'پنکی کو کیا کھانے سے منع کیا گیا؟')
      .map((f) => f.code)).toEqual(['SOURCE_QUOTE_IS_QUESTION']);
  });

  test('a real quote that shares nothing with the key or why is refused', () => {
    const off = q({ source_quote: 'Read the dialogue again and find the line where the answer is' });
    expect(SF.questionFaults(off, LP).map((f) => f.code)).toEqual(['SOURCE_QUOTE_OFF_KEY']);
  });

  test('numbers count as content: the class\'s own 64 ÷ 7 passes', () => {
    const div = {
      question: 'What is $64 \\div 7$?', options: ['9 remainder 1', '8 remainder 8', '9'], correct_index: 0,
      explanation: '7 × 9 = 63 and 1 is left over.', source_quote: '64 divided by 7. 7 nines are 63, and 1 is our remainder',
    };
    expect(SF.questionFaults(div, TX)).toEqual([]);
  });

  test('a numeric key quoted at the class\'s slip (12) is the wrong moment; quoted at the teacher\'s 24 it passes', () => {
    const half = {
      question: 'How many letters have a half form?', options: ['24', '12', '36'], correct_index: 0,
      explanation: '24 letters have a half form.', source_quote: '12 letters have a half form!',
    };
    expect(SF.questionFaults(half, TX).map((f) => f.code)).toEqual(['SOURCE_QUOTE_WRONG_MOMENT']);
    expect(SF.questionFaults({ ...half, source_quote: '24 letters have a half form, the other letters do not' }, TX)).toEqual([]);
  });

  test('a word problem on numbers the lesson never used, quoting the rule, is refused', () => {
    const invented = q({ question: 'What is 19 − 7?', options: ['12', '11', '26'], explanation: 'Take away the ones first, then the tens: 12.' });
    expect(SF.questionFaults(invented, TX).map((f) => f.code)).toEqual(['SOURCE_QUOTE_WRONG_MOMENT']);
  });

  test('grade 1-2: a stem over 8 words is refused, 8 or fewer passes; other grades untouched', () => {
    const long = q({ question: 'Bunty has 20 toys and picks up 7, which number is the whole group?' });
    expect(SF.questionFaults(long, TX, { gradeBand: '1-2' }).map((f) => f.code)).toContain('STEM_TOO_LONG_G12');
    expect(SF.questionFaults(long, TX, { gradeBand: '3-5' }).map((f) => f.code)).not.toContain('STEM_TOO_LONG_G12');
    expect(SF.questionFaults(q(), TX, { gradeBand: '1-2' })).toEqual([]);
    expect(SF.stemWords('What is $\\frac{1}{2}$ of 8?')).toBe(5);
  });

  test('Urdu: digits and diacritics are normalised before the lookup', () => {
    const src = 'استاد: ۲۴ حروف کی آدھی شکل ہوتی ہے۔';
    const ur = {
      question: 'کتنے حروف کی آدھی شکل ہوتی ہے؟', options: ['24', '12', '36'], correct_index: 0,
      explanation: '24 حروف کی آدھی شکل ہوتی ہے۔', source_quote: '24 حروف کی آدھی شکل ہوتی ہے',
    };
    expect(SF.questionFaults(ur, src)).toEqual([]);
  });
});

describe('sourceFaults → complaints in the targeted rewrite\'s form', () => {
  test('one complaint per fault, "qN: CODE — …", naming the lesson\'s nearest moment', () => {
    const qs = [q(), q({ source_quote: 'What was Pinky told not to eat?' })];
    const { byIndex, errors } = SF.sourceFaults(qs, `${TX}\n${LP}`);
    expect(Object.keys(byIndex)).toEqual(['1']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^q1: SOURCE_QUOTE_IS_QUESTION — /);
    expect(errors[0]).toMatch(/146 plus 27 is 173/);   // the lesson's own example to rebuild on
    expect(SF.SOURCE_FAULT.test(errors[0])).toBe(true);
  });
});

test('teachingErrors records what the author flagged, nothing else', () => {
  const qs = [
    q({ teaching_error: { said: '12 letters have a half form', correct: '24 letters have a half form' } }),
    q({ teaching_error: null }),
    q({ teaching_error: { said: '', correct: 'x' } }),
  ];
  expect(SF.teachingErrors(qs)).toEqual([{
    question: 'What is 146 + 27?', said: '12 letters have a half form', correct: '24 letters have a half form',
    quote: 'We add the ones first, then the tens: 146 plus 27 is 173',
  }]);
});
