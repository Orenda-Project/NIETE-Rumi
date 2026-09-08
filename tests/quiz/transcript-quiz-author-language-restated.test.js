'use strict';
/**
 * PROD 2026-09-07 — the FIRST authoring attempt kept coming back in the wrong
 * language. Four of four real quizzes that morning had attempt 1 rejected by
 * the validator on a language fault and none of the four retries did: English
 * quizzes on Urdu-taught lessons came back with all eight stems in Urdu
 * script, and the one Urdu quiz came back with its teacher-facing
 * "selected_because" / "distractor_misconceptions" in English. One teacher lost
 * a quiz to it (the language fault ate attempt 1, and the single remaining
 * attempt tripped the level gate).
 *
 * The author prompt stated the quiz language ONCE, in its opening lines, and
 * then appended the question contract, the style rules, the figure and multi
 * contracts, the JSON shape, the digest and an all-Urdu transcript. Only the
 * RETRY prompt restated it, from retryNote(), after the contracts — and every
 * retry honoured it.
 *
 * So the first attempt must carry the same restatement the retry has always
 * had, in the same place. On a retry the restatement is not repeated: the retry
 * note already opens with it, and attempt 2's prompt must stay exactly what
 * production has proven.
 */
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');

const DIGEST = {
  subject: 'science',
  grade_band: '3-5',
  slos: [
    { id: 'S1', statement: 'name the parts of a plant', taught_level: 'recall' },
    { id: 'S2', statement: 'explain what roots do', taught_level: 'understand' },
  ],
};
const EXCERPTS = 'استاد نے پودے کی جڑ دکھائی اور بچوں سے پوچھا کہ یہ کہاں ہوتی ہے۔';

function build(language, previousErrors = null) {
  return Author.buildAuthorPrompt({
    digest: DIGEST, excerpts: EXCERPTS, language, n: 8, gradeBand: '3-5', previousErrors,
  });
}

// The last block of the shared question contract — everything after this index
// is the tail of the prompt the model reads immediately before writing.
const AFTER_CONTRACT = 'STYLE RULES FOR ENGLISH';

describe('the author prompt restates the quiz language on the FIRST attempt', () => {
  test('an English quiz names English again, after the question contract', () => {
    const p = build('en');
    expect(p).toContain('QUIZ LANGUAGE, AGAIN: English');
    expect(p.indexOf('QUIZ LANGUAGE, AGAIN: English')).toBeGreaterThan(p.indexOf(AFTER_CONTRACT));
  });

  test('an Urdu quiz names Urdu again, after the question contract', () => {
    const p = build('ur');
    expect(p).toContain('QUIZ LANGUAGE, AGAIN: Urdu');
    expect(p.indexOf('QUIZ LANGUAGE, AGAIN: Urdu')).toBeGreaterThan(p.indexOf(AFTER_CONTRACT));
  });

  test('the restatement covers the teacher-facing fields, which is how the Urdu quiz failed', () => {
    const p = build('ur');
    const tail = p.slice(p.indexOf('QUIZ LANGUAGE, AGAIN: Urdu'));
    expect(tail).toContain('selected_because');
    expect(tail).toContain('distractor_misconceptions');
  });

  test('a retry says it exactly once — the retry note already opens with it', () => {
    const p = build('en', ['q0: an English quiz must be written in English — the stem and options are mostly not Latin script']);
    expect(p.match(/QUIZ LANGUAGE, AGAIN: English/g)).toHaveLength(1);
    expect(p).toContain('A PREVIOUS ATTEMPT FAILED THESE CHECKS');
  });

  test('the opening statement of the language is still there', () => {
    expect(build('en')).toContain('QUIZ LANGUAGE: English');
    expect(build('ur')).toContain('QUIZ LANGUAGE: Urdu');
  });
});
