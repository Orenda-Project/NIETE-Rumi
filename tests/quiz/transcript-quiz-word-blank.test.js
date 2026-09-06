'use strict';
/**
 * A `word_blank` must never cost the child the question.
 *
 * Two real grade 1-2 English phonics lessons, both attempts of each, all four
 * failed the same way on the live bot:
 *
 *   q6: FIGURE_RENDER — the word_blank figure could not be drawn:
 *       word_blank: `blanks` must name at least one letter index to hide
 *
 * The author reached for the right instrument — a picture of a road and
 * "_ o a d" is exactly what a beginning-sound question wants — and left out the
 * one key that says which letter to hide. The retry quoted the complaint back
 * and the model repeated itself, so both quizzes shipped with seven questions
 * and no picture at all.
 *
 * Three things are wrong there and each is fixed on its own axis:
 *
 * 1. THE STEM ALREADY SAYS WHICH LETTER. "What is the beginning sound of the
 *    word 'road'?" can only mean the first letter, and "the ending sound of
 *    'park'" can only mean the last. A key the question itself determines is
 *    not a key worth failing a question over — it is inferred in the quiz
 *    lane's spec normalisation, before the render, and logged so the inference
 *    is visible rather than silent.
 * 2. AN ERROR THAT NAMES THE RULE IS NOT AN ERROR THAT SHOWS THE FIX. The one
 *    retry gets the complete, renderable spec appended to it — with an unknown
 *    pictogram already dropped, because the engine checks `blanks` first and
 *    the model would otherwise have spent its second attempt discovering that
 *    "park" is not in the pictogram set either.
 * 3. A WORD THE SET CANNOT PICTURE MUST STILL DRAW. `park` and `land` have no
 *    glyph; the letters alone are a legitimate phonics figure, and the lane
 *    threw them away as blank because one line of text paints two elements.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const WordBlank = require('../../bot/shared/services/quiz/transcript-quiz-word-blank');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Pictograms = require('../../bot/vendor/lp-v9/diagrams/lib/pictogram');

// ── a quiz the validator otherwise accepts, so the only verdict is the figure ──

const DIGEST = { subject: 'english', slos: [{ id: 'S1', statement: 'blend and segment CVC words', taught_level: 'recall' }] };
const SUMMARY = 'The class sounded out road, park and land together and clapped the first and last sound of each one.';

function plainQuestion(i) {
  return {
    slo_id: 'S1',
    level: 'recall',
    question: `Which word did the class sound out in part ${i} of the lesson?`,
    options: ['road', 'chair', 'window'],
    correct_index: 0,
    explanation: 'The class clapped the sounds in road together on the mat.',
    selected_because: 'she clapped the sounds of road with the class',
    distractor_misconceptions: { 1: 'picks a word from the room', 2: 'picks a word from the room' },
    option_feedback: {
      correct: 'Yes — road was the word the class clapped.',
      wrong: { 1: 'Chair was in the room, not in the sounding-out game.', 2: 'Window was in the room, not in the sounding-out game.' },
    },
    figure: null,
    figure_role: null,
  };
}

/** Six questions, the last one carrying `figure`, run through the real validator. */
function validateWithFigure(figure, { stem, options = ['r', 'b', 't'], language = 'en' } = {}) {
  const questions = [0, 1, 2, 3, 4].map(plainQuestion);
  questions.push({
    ...plainQuestion(5),
    question: stem,
    options,
    correct_index: 0,
    figure,
    figure_role: 'read_off',
  });
  const v = validate(questions, { language, subject: 'english', digest: DIGEST, lessonSummary: SUMMARY, quizId: 'quiz-k' });
  return { ...v, figureErrors: v.errors.filter((e) => /^q5: FIGURE_/.test(e)), q: v.questions[5] };
}

// ── 1. the stem decides the blank ────────────────────────────────────────────

describe('the blank is inferred from the stem the author already wrote', () => {
  beforeEach(() => logEvent.mockClear());

  test('"the beginning sound of the word road" renders, and hides the first letter', () => {
    const { figureErrors, q } = validateWithFigure(
      { type: 'word_blank', word: 'road', picto: 'road' },
      { stem: "What is the beginning sound of the word 'road'?" },
    );
    expect(figureErrors).toEqual([]);
    expect(q.figure.blanks).toEqual([0]);
    expect(q.figureSvg).toContain('<svg');
  });

  test('"the ending sound of the word park" renders, and hides the last letter', () => {
    const { figureErrors, q } = validateWithFigure(
      { type: 'word_blank', word: 'park' },
      { stem: "What is the ending sound of the word 'park'?", options: ['k', 'p', 't'] },
    );
    expect(figureErrors).toEqual([]);
    expect(q.figure.blanks).toEqual([3]);
  });

  test('the inference is an event, not a silence', () => {
    validateWithFigure({ type: 'word_blank', word: 'road', picto: 'road' },
      { stem: "What is the beginning sound of the word 'road'?" });
    const call = logEvent.mock.calls.find(([name]) => name === 'transcript_quiz.figure_blanks_inferred');
    expect(call).toBeDefined();
    expect(call[1]).toMatchObject({ quizId: 'quiz-k', index: 5, word: 'road', blanks: [0], rule: 'stem-beginning' });
  });

  test('a spec that already names its blanks is left exactly as it is', () => {
    const { figureErrors, q } = validateWithFigure(
      { type: 'word_blank', word: 'cat', picto: 'cat', blanks: [1] },
      { stem: "What is the beginning sound of the word 'cat'?", options: ['a', 'e', 'o'] },
    );
    expect(figureErrors).toEqual([]);
    expect(q.figure.blanks).toEqual([1]);
    expect(logEvent.mock.calls.filter(([n]) => n === 'transcript_quiz.figure_blanks_inferred')).toEqual([]);
  });
});

describe('the rules, one at a time', () => {
  const infer = (spec, stem, language = 'en') =>
    WordBlank.normaliseWordBlank(spec, { stem, language, quizId: 'q', index: 0 }).blanks;

  test.each([
    ['beginning', "What is the beginning sound of 'road'?", 'road', [0]],
    ['starts with', "Which letter does 'goat' start with?", 'goat', [0]],
    ['first', "What is the first letter of 'train'?", 'train', [0]],
    ['ending', "What is the ending sound of 'park'?", 'park', [3]],
    ['ends with', "Which letter does 'land' end with?", 'land', [3]],
    ['last', "What is the last sound in 'tree'?", 'tree', [3]],
  ])('a stem that says "%s" hides that end of the word', (_label, stem, word, expected) => {
    expect(infer({ type: 'word_blank', word }, stem)).toEqual(expected);
  });

  test('with no cue in the stem, the first vowel is the blank', () => {
    expect(infer({ type: 'word_blank', word: 'train' }, 'Which letter is missing?')).toEqual([2]);
    expect(infer({ type: 'word_blank', word: 'goat' }, 'Which letter is missing?')).toEqual([1]);
  });

  test('a stem naming both ends takes the one it names first', () => {
    expect(infer({ type: 'word_blank', word: 'road' }, "Not the ending sound — what is the beginning sound of 'road'?"))
      .toEqual([3]);
  });

  test('an Urdu word with no cue hides the first letter that is not the initial', () => {
    // کتاب is ک=0 ت=1 ا=2 ب=3 — an initial letter a child cannot start from is
    // no help, so the blank is the next one along.
    expect(infer({ type: 'word_blank', word: 'کتاب' }, 'کون سا حرف غائب ہے؟', 'ur')).toEqual([1]);
  });

  test('an Urdu stem carries the same two cues', () => {
    expect(infer({ type: 'word_blank', word: 'کتاب' }, 'لفظ کتاب کا پہلا حرف کون سا ہے؟', 'ur')).toEqual([0]);
    expect(infer({ type: 'word_blank', word: 'کتاب' }, 'لفظ کتاب کا آخری حرف کون سا ہے؟', 'ur')).toEqual([3]);
  });

  test('an explicit `letters` split decides the positions, not the code points', () => {
    expect(infer({ type: 'word_blank', word: 'ship', letters: ['sh', 'i', 'p'] }, "What is the beginning sound of 'ship'?"))
      .toEqual([0]);
    expect(infer({ type: 'word_blank', word: 'ship', letters: ['sh', 'i', 'p'] }, "What is the ending sound of 'ship'?"))
      .toEqual([2]);
  });

  test('a one-letter word is left alone — there would be nothing left to read', () => {
    expect(infer({ type: 'word_blank', word: 'a' }, "What is the first letter?")).toBeNull();
  });

  test('an out-of-range blank is treated as no blank at all', () => {
    // The engine filters an index off the end of the word and then throws the
    // same "must name at least one" it throws for a missing key.
    expect(infer({ type: 'word_blank', word: 'road', blanks: [9] }, "What is the beginning sound of 'road'?")).toEqual([0]);
  });

  test('nothing is touched on any other figure type', () => {
    const spec = { type: 'clock', time: '3:30' };
    expect(WordBlank.normaliseWordBlank(spec, { stem: 'What is the first hour?', language: 'en' }).spec).toBe(spec);
  });
});

// ── 2. the retry shows the complete spec ─────────────────────────────────────

describe('the one retry is told the fix, not only the rule', () => {
  test('the hint is a complete, renderable spec', () => {
    expect(WordBlank.wordBlankFixHint({ type: 'word_blank', word: 'road', picto: 'road' },
      { stem: "What is the beginning sound of the word 'road'?", language: 'en' }))
      .toBe('use {"type":"word_blank","word":"road","picto":"road","blanks":[0]}');
  });

  test('a pictogram the set does not have is dropped from the hint, not carried into the next attempt', () => {
    // The engine checks `blanks` BEFORE `picto`, so a model that fixed only the
    // blanks would have spent its second attempt discovering that "park" is not
    // in the set. The hint it is given renders on the first try.
    expect(Pictograms.has('park')).toBe(false);
    const hint = WordBlank.wordBlankFixHint({ type: 'word_blank', word: 'park', picto: 'park' },
      { stem: "What is the ending sound of the word 'park'?", language: 'en' });
    expect(hint).toBe('use {"type":"word_blank","word":"park","blanks":[3]}');
    const suggested = JSON.parse(hint.replace(/^use /, ''));
    expect(() => Figure.renderFigureSvg(suggested, 'en')).not.toThrow();
  });

  test('a word_blank the engine still refuses carries the spec that works on the error line', () => {
    // Every letter blank: the engine refuses it and inference deliberately does
    // not overwrite an author who named real indices.
    const { figureErrors } = validateWithFigure(
      { type: 'word_blank', word: 'cat', picto: 'cat', blanks: [0, 1, 2] },
      { stem: "Which letters spell 'cat'?", options: ['c', 'b', 'd'] },
    );
    expect(figureErrors).toHaveLength(1);
    expect(figureErrors[0]).toMatch(/^q5: FIGURE_RENDER — /);
    expect(figureErrors[0]).toContain('use {"type":"word_blank","word":"cat","picto":"cat","blanks":[1]}');
  });

  test('the hint stays short enough to be worth its place in the retry', () => {
    // A message quoted verbatim into the one retry is prompt real estate (T28).
    const hint = WordBlank.wordBlankFixHint({ type: 'word_blank', word: 'elephant', picto: 'elephant' },
      { stem: "What is the beginning sound of 'elephant'?", language: 'en' });
    expect(hint.length).toBeLessThan(120);
  });
});

// ── 3. the contract defines `blanks` where the author is looking ─────────────

describe('the author contract defines the key, it does not only demonstrate it', () => {
  const prompt = Author.buildAuthorPrompt({
    digest: DIGEST, excerpts: 'x', language: 'en', gradeBand: '1-2',
  });

  test('the worked example carries blanks', () => {
    expect(prompt).toContain('{"type":"word_blank","word":"cat","blanks":[1],"picto":"cat"}');
  });

  test('the required-keys line names blanks', () => {
    const entry = prompt.slice(prompt.indexOf("- word_blank — ", prompt.indexOf("ALLOWED TYPES")));
    expect(entry.slice(0, entry.indexOf('\n  minimal:'))).toContain('required: word, blanks');
  });

  test('the contract says what blanks IS, not just where it goes', () => {
    expect(prompt).toMatch(/"blanks" is REQUIRED/);
    expect(prompt).toMatch(/0-based/);
  });
});

// ── 4. a word the set cannot picture still draws ─────────────────────────────

describe('a word with no pictogram is drawn from its letters alone', () => {
  test.each(['road', 'tree', 'goat', 'train'])('%s has a pictogram', (word) => {
    expect(Pictograms.has(word)).toBe(true);
  });

  test.each(['park', 'land'])('%s has none — and the question must survive that', (word) => {
    expect(Pictograms.has(word)).toBe(false);
    const { figureErrors, q } = validateWithFigure(
      { type: 'word_blank', word },
      { stem: `What is the ending sound of the word '${word}'?`, options: ['k', 'p', 't'] },
    );
    expect(figureErrors).toEqual([]);
    // The letters the child still has are on the picture; the hidden one is not.
    const shown = Figure.svgText(q.figureSvg).join(' ');
    [...word].slice(0, -1).forEach((letter) => expect(shown).toContain(letter));
    expect(shown).not.toContain(word);
  });

  test('the letters-only figure paints enough to clear the lane\'s own blank gate', () => {
    const spec = { type: 'word_blank', word: 'park', blanks: [3] };
    const svg = Figure.renderFigureSvg(WordBlank.normaliseWordBlank(spec, { stem: '', language: 'en' }).spec, 'en');
    expect(Figure.svgInkCount(svg)).toBeGreaterThanOrEqual(3);
  });
});

// ── 5. the contract offers the third option, so the author stops dropping ────

describe('the contract says what to do when the set cannot picture the word', () => {
  const prompt = Author.buildAuthorPrompt({
    digest: DIGEST, excerpts: 'x', language: 'en', gradeBand: '1-2',
  });

  test('the word_blank line offers the pictoless spec, worked out', () => {
    expect(prompt).toContain('{"type":"word_blank","word":"park","blanks":[3]}');
  });

  test('the pictogram paragraph names the exception rather than contradicting it', () => {
    // The roster paragraph used to say the two options were "a word that IS on
    // the list, or no figure". For word_blank there is a third, and a rule that
    // contradicts the one beside the field is how a type stops being used.
    const roster = prompt.slice(prompt.indexOf('PICTOGRAM NAMES'));
    expect(roster.slice(0, 900)).toMatch(/word_blank has a third/);
  });

  test('the suggested pictoless spec is one the engine actually draws', () => {
    const spec = JSON.parse('{"type":"word_blank","word":"park","blanks":[3]}');
    const { figureErrors } = validateWithFigure(spec,
      { stem: "What is the ending sound of the word 'park'?", options: ['k', 'p', 't'] });
    expect(figureErrors).toEqual([]);
  });
});
