'use strict';
/**
 * A grade 1-5 lesson is DRAWABLE IN EVERY SUBJECT of round 5.
 *
 * Before this round the drawable roster was the 6-12 one, so the author prompt
 * told a language teacher's quiz to "leave figure null" and the FIGURE_REQUIRED
 * gate only fired for maths, science and general knowledge. That was the right
 * call while `word_blank`, `count_objects`, `match`, `clock`, `pattern`,
 * `count_frame`, `money` and `compare_size` did not exist. They do now, and
 * they are language and early-maths types before they are anything else: across
 * the ICT K-5 segmentation `match` serves 360 segments and `word_blank` 257,
 * nearly all of them English or Urdu periods (the option-space study).
 *
 * The reverse also matters and is asserted here: a grade 9 chemistry quiz is
 * never shown a ten-frame. Every type in the prompt is tokens spent AND one
 * more shape the model can reach for wrongly.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Generate = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { EARLY_YEARS_TYPES } = require('../../bot/shared/services/quiz/transcript-quiz-figure');

const prompt = (subject, gradeBand, language = 'en') => Author.buildAuthorPrompt({
  digest: { subject, slos: [{ id: 'S1', statement: 's', taught_level: 'recall' }] },
  excerpts: 'the class counted apples', language, gradeBand,
});

describe('the author prompt', () => {
  test('a grade 1-5 lesson is told the lesson is drawable, whatever the subject', () => {
    ['english', 'urdu', 'islamiat', 'maths'].forEach((subject) => {
      expect(prompt(subject, '1-2')).toContain('THIS LESSON IS DRAWABLE');
    });
  });

  test('a grade 1-5 lesson is shown the early-years types with worked specs', () => {
    const p = prompt('english', '1-2', 'ur');
    expect(p).toContain('EARLY YEARS');
    EARLY_YEARS_TYPES.forEach((type) => expect(p).toContain(`- ${type} — `));
    expect(p).toContain('"word":"cat","blanks":[1],"picto":"cat"'); // the operator's own c _ t case
    expect(p).toContain('"type":"clock","time":"3:30"');
  });

  test('it is told which pictogram names exist, and that nothing else is allowed', () => {
    const p = prompt('english', '1-2');
    expect(p).toContain('PICTOGRAM NAMES');
    expect(p).toContain('cat');
    expect(p).toContain('apple');
  });

  test('the Urdu word_blank instruction says why the whole word is passed', () => {
    expect(prompt('urdu', '1-2', 'ur')).toContain('Nastaliq joins');
  });

  test('a grade 6-12 lesson is shown NEITHER the block nor the early-years types', () => {
    const p = prompt('science', '9-10');
    expect(p).not.toContain('EARLY YEARS');
    EARLY_YEARS_TYPES.forEach((type) => expect(p).not.toContain(`- ${type} — `));
    expect(p).toContain('- atom — '); // the 6-12 roster is untouched
  });

  test('KG and prep count as early years however the band is spelled', () => {
    ['KG', 'prep', 'Grade 1', '2-3', 'katchi'].forEach((band) => {
      expect(prompt('english', band)).toContain('EARLY YEARS');
    });
    ['6-8', '9-10', '11-12'].forEach((band) => {
      expect(prompt('english', band)).not.toContain('EARLY YEARS');
    });
  });
});

describe('FIGURE_REQUIRED', () => {
  const textOnly = [{ question: 'a' }, { question: 'b' }];
  const withFigure = [{ question: 'a', figure: { type: 'clock', time: '3:30' } }];
  const call = (over) => Generate.figureRequiredError({
    questions: textOnly, attempt: 1, maxAttempts: 2, ...over,
  });

  test('a grade 1-5 language lesson with no picture is sent back', () => {
    expect(call({ subject: 'english', gradeBand: '1-2' })).toMatch(/FIGURE_REQUIRED/);
    expect(call({ subject: 'urdu', gradeBand: 'KG' })).toMatch(/FIGURE_REQUIRED/);
  });

  test('the reason names the early-years case, so the retry knows what to draw', () => {
    const msg = call({ subject: 'english', gradeBand: '1-2' });
    expect(msg).toContain('grade 1-5');
    expect(msg).toContain('the word they sounded out');
  });

  test('a grade 6-12 language lesson is still not required to draw', () => {
    expect(call({ subject: 'english', gradeBand: '9-10' })).toBeNull();
  });

  test('the 6-12 science rule is untouched', () => {
    expect(call({ subject: 'maths', gradeBand: '9-10' })).toMatch(/FIGURE_REQUIRED/);
    expect(call({ subject: 'science', gradeBand: '6-8' })).toMatch(/FIGURE_REQUIRED/);
  });

  test('a quiz that DID draw passes, and the last attempt is never failed for it', () => {
    expect(Generate.figureRequiredError({ questions: withFigure, subject: 'urdu', gradeBand: '1', attempt: 1, maxAttempts: 2 })).toBeNull();
    expect(call({ subject: 'urdu', gradeBand: '1', attempt: 2 })).toBeNull();
  });
});
