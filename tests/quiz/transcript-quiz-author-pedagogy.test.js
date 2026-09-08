'use strict';
/**
 * PLAN_R5 D3 — the author contract, rebalanced: the SLOs drive the questions
 * and the transcript supplies the level, the examples and the words.
 *
 * The last test is the one that matters. The prompt teaches the model with a
 * GOOD/BAD table; the validator rejects with transcript-quiz-pedagogy.js. If
 * those two ever drift, the model is taught a shape the validator throws away
 * on every attempt — which is how the round-4 logistics ban ended up costing
 * attempts and still shipping the bad question. So the prompt's own BAD
 * examples are fed to the live rules and must be rejected, and its GOOD ones
 * must pass.
 */
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const P = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy');

const DIGEST = {
  subject: 'science',
  slos: [
    { id: 'S1', statement: 'name the three states of matter', taught_level: 'recall' },
    { id: 'S2', statement: 'explain how a solid differs from a liquid', taught_level: 'understand' },
  ],
};
const prompt = (over = {}) => Author.buildAuthorPrompt({ digest: DIGEST, excerpts: 'x', language: 'en', n: 8, ...over });

describe('buildAuthorPrompt — the SLOs drive the questions', () => {
  test('it says the SLOs drive the questions and the transcript supplies the material', () => {
    const p = prompt();
    expect(p).toMatch(/SLOs?\b[^\n]*\bdrive\b/i);
    expect(p).toMatch(/examples_used/);
  });

  test('it bans counting mentions and names the replacement shape', () => {
    const p = prompt();
    expect(p).toMatch(/count(ing)? (of )?mentions|how many .*mention/i);
    expect(p).toMatch(/Which of these is/);
  });

  test('it requires every question to be answerable by any child who understood the concept', () => {
    // Round 4 already said "answerable by any child who sat in the lesson" —
    // which the model read as "was in the room", and wrote "what were YOU
    // asked to draw" anyway. The bar is understanding, not attendance.
    expect(prompt()).toMatch(/any child who understood/i);
  });

  test('it quotes the FEASIBLE number of higher-order questions, not a fraction', () => {
    // A lesson taught wholly at recall cannot carry four of eight above the
    // taught level; told "half", the model tagged questions "apply" on recall
    // SLOs and the validator threw the quiz away. The prompt now states the
    // integer requiredHigherOrder() computes from this digest.
    const recallOnly = { subject: 'urdu', slos: Array.from({ length: 5 }, (_, i) => ({ id: `S${i + 1}`, statement: 'x', taught_level: 'recall' })) };
    expect(prompt({ digest: recallOnly })).toMatch(/at least 3 of the 8/i);
    expect(prompt()).toMatch(/at least 4 of the 8/i);
    // half of eight, because this digest has an understand-level SLO to hang them on
    // and it names the ceiling the model kept breaking
    expect(prompt({ digest: recallOnly })).toMatch(/one level above/i);
  });

  test('it keeps the round-4 rules the quiz still depends on', () => {
    const p = prompt();
    expect(p).toMatch(/lesson_summary/);
    expect(p).toMatch(/selected_because/);
    expect(p).toMatch(/distractor_misconceptions/);
    expect(p).toMatch(/NEVER refer to options by letter/);
    expect(p).toMatch(/ﷺ/);                       // religious marks
    expect(p).toMatch(/ALLOWED TYPES/);           // the figure contract
    expect(p).toMatch(/misconception/i);          // distractors are misconceptions
  });

  test('a retry quotes the checks back and tells the model to follow their instructions', () => {
    const p = prompt({ previousErrors: ['q0: PEDAGOGY_COUNT_RECALL — say what to write instead'] });
    expect(p).toMatch(/PEDAGOGY_COUNT_RECALL/);
    expect(p).toMatch(/q0 is your FIRST question/);
  });

  test('the retry note carries enough complaints that the pedagogy ones are not truncated away', () => {
    const many = Array.from({ length: 16 }, (_, i) => `q${i}: SOMETHING_${i}`);
    const p = prompt({ previousErrors: many });
    expect(p).toMatch(/SOMETHING_13/);
  });
});

// ── prompt and validator must agree ─────────────────────────────────────────
describe('the prompt teaches exactly what the rules enforce', () => {
  // The table in the prompt, transcribed here as { bad, badOptions, good,
  // goodOptions }. Each `bad` line must appear in the prompt verbatim.
  const PAIRS = [
    { bad: 'How many types of matter did the teacher mention?', badOptions: ['3', '2', '4'],
      good: 'Which of these is a type of matter?', goodOptions: ['gas', 'speed', 'weight'] },
    { bad: 'Which atom did the teacher ask your group to draw?', badOptions: ['Oxygen', 'Carbon', 'Boron'],
      good: 'An atom has 6 protons. Which element is it?', goodOptions: ['Carbon', 'Oxygen', 'Boron'] },
    { bad: 'What did madam call the middle of the atom?', badOptions: ['nucleus', 'shell', 'orbit'],
      good: 'Where in an atom are the protons found?', goodOptions: ['in the nucleus', 'in the outer shell', 'outside the atom'] },
  ];

  test('every BAD example is written in the prompt', () => {
    const p = prompt();
    PAIRS.forEach(({ bad }) => expect(p).toContain(bad));
  });

  test('every GOOD example is written in the prompt', () => {
    const p = prompt();
    PAIRS.forEach(({ good }) => expect(p).toContain(good));
  });

  test('the live rules reject every BAD example and accept every GOOD one', () => {
    PAIRS.forEach(({ bad, badOptions, good, goodOptions }) => {
      const rejected = P.pedagogyDefects([{ question: bad, options: badOptions, level: 'recall', slo_id: 'S1' }], { language: 'en' });
      expect(rejected.map((d) => d.code).filter((c) => c !== 'PEDAGOGY_LEVEL_MIX').length).toBeGreaterThan(0);
      const accepted = P.pedagogyDefects([{ question: good, options: goodOptions, level: 'understand', slo_id: 'S2' }], { language: 'en' });
      expect(accepted).toEqual([]);
    });
  });

  test('the Urdu BAD example in the prompt is rejected by the Urdu rules', () => {
    const bad = 'استاد نے matter کی کتنی قسمیں بتائیں؟';
    expect(prompt({ language: 'ur' })).toContain(bad);
    expect(P.pedagogyDefects([{ question: bad, options: ['۳', '۲', '۴'], level: 'recall', slo_id: 'S1' }], { language: 'ur' }).map((d) => d.code))
      .toContain('PEDAGOGY_COUNT_RECALL');
  });

  test('counting what a PICTURE shows is still allowed, and the prompt says so', () => {
    const p = prompt();
    expect(p).toMatch(/picture/i);
    expect(P.pedagogyDefects([{ question: 'تصویر میں کتنے خانے رنگے ہوئے ہیں؟', options: ['۱۲', '۸', '۲۰'], level: 'understand', slo_id: 'S2' }], { language: 'ur' }))
      .toEqual([]);
  });
});
