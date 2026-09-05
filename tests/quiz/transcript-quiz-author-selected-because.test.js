'use strict';
/**
 * PLAN_R4 D4 — the author call also emits a top-level "lesson_summary"
 * and a per-question "selected_because": the transcript moment a question was
 * chosen from, not why its answer is right (that stays "explanation").
 */
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const V = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const DIGEST = {
  subject: 'science',
  slos: [
    { id: 'S1', statement: 'name the parts of a plant', taught_level: 'recall' },
    { id: 'S2', statement: 'explain what roots do', taught_level: 'understand' },
  ],
};

function q(overrides = {}) {
  return {
    slo_id: 'S1', level: 'recall',
    question: 'Which part of the plant is under the soil?',
    options: ['root', 'leaf', 'flower'], correct_index: 0,
    explanation: 'The root grows down into the soil.',
    selected_because: 'she pointed at the root while pulling up the plant',
    distractor_misconceptions: { 1: 'leaves are the base', 2: 'flowers anchor' },
    option_feedback: {
      correct: 'Yes — the root is under the soil, holding the plant and drinking water.',
      wrong: { 1: 'Leaves are up in the air making food; the part under the soil is the root.',
               2: 'Flowers make seeds at the top; the part under the soil is the root.' },
    },
    ...overrides,
  };
}

function eightGood() {
  return [
    q(), q({ slo_id: 'S2', level: 'understand', question: 'What do roots do?', options: ['drink water', 'make seeds', 'catch light'] }),
    q({ question: 'q3', options: ['a', 'b', 'c'] }), q({ slo_id: 'S2', level: 'recall', question: 'q4', options: ['d', 'e', 'f'] }),
    q({ question: 'q5', options: ['g', 'h', 'i'] }), q({ slo_id: 'S2', level: 'understand', question: 'q6', options: ['j', 'k', 'l'] }),
    q({ question: 'q7', options: ['m', 'n', 'o'] }), q({ slo_id: 'S2', level: 'apply', question: 'q8', options: ['p', 'r', 's'] }),
  ];
}

const LESSON_SUMMARY = 'She taught the parts of a plant, starting with the root and moving up to the leaves and flower. She pulled up a real plant to show the class.';

describe('buildAuthorPrompt — asks for lesson_summary and selected_because', () => {
  test('the prompt instructs the model to return both, and the JSON skeleton shows the keys', () => {
    const prompt = Author.buildAuthorPrompt({ digest: DIGEST, excerpts: 'x', language: 'en', n: 8 });
    expect(prompt).toMatch(/lesson_summary/);
    expect(prompt).toMatch(/2[–-]3 sentences/);
    expect(prompt).toMatch(/selected_because/);
    expect(prompt).toMatch(/15 words/);
    // The returned-JSON skeleton carries both keys, on both example questions.
    const skeletonMatch = prompt.match(/Return ONLY this JSON object:\n([\s\S]+?)\n\nLESSON DIGEST/);
    expect(skeletonMatch).toBeTruthy();
    const skeleton = skeletonMatch[1];
    expect(skeleton).toMatch(/"lesson_summary"/);
    expect((skeleton.match(/"selected_because"/g) || []).length).toBe(2);
  });
});

describe('validate — lesson_summary (only enforced when the caller opts in)', () => {
  test('an empty lesson_summary is rejected when the caller passes the key', () => {
    const r = V.validate(eightGood(), { language: 'en', subject: 'science', digest: DIGEST, lessonSummary: '' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /AUTHOR_MISSING_SUMMARY/.test(e))).toBe(true);
  });

  test('a lessonSummary under 20 code points is rejected the same way', () => {
    const r = V.validate(eightGood(), { language: 'en', subject: 'science', digest: DIGEST, lessonSummary: 'too short' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /AUTHOR_MISSING_SUMMARY/.test(e))).toBe(true);
  });

  test('a caller that never passes lessonSummary at all sees unchanged behaviour — a good quiz still passes', () => {
    const r = V.validate(eightGood(), { language: 'en', subject: 'science', digest: DIGEST });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe('validate — selected_because (only enforced when the caller opts in via lessonSummary)', () => {
  test('a missing selected_because on one question is rejected with its index', () => {
    const qs = eightGood();
    qs[0].selected_because = '';
    const r = V.validate(qs, { language: 'en', subject: 'science', digest: DIGEST, lessonSummary: LESSON_SUMMARY });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /q0: Q_MISSING_WHY/.test(e))).toBe(true);
  });

  test('a selected_because over 30 words is rejected', () => {
    const qs = eightGood();
    qs[0].selected_because = new Array(31).fill('word').join(' ');
    const r = V.validate(qs, { language: 'en', subject: 'science', digest: DIGEST, lessonSummary: LESSON_SUMMARY });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /q0: Q_MISSING_WHY/.test(e))).toBe(true);
  });

  test('a fully-formed set with both lesson_summary and every selected_because passes, and the trimmed string is carried through', () => {
    const qs = eightGood();
    qs[0].selected_because = `  ${qs[0].selected_because}  `;
    const r = V.validate(qs, { language: 'en', subject: 'science', digest: DIGEST, lessonSummary: LESSON_SUMMARY });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.questions[0].selected_because).toBe('she pointed at the root while pulling up the plant');
  });

  test('a caller that never passes lessonSummary is untouched even with missing selected_because', () => {
    const qs = eightGood();
    qs[0].selected_because = '';
    const r = V.validate(qs, { language: 'en', subject: 'science', digest: DIGEST });
    expect(r.ok).toBe(true);
  });
});

describe('toRows / applyMedia — selected_because rides on media without moving render_pattern', () => {
  test('a question with no figure gets selected_because on row.media and stays P1', () => {
    const rows = Gen.toRows('quiz-1', eightGood(), { rng: () => 0 });
    expect(rows[0].render_pattern).toBe('P1');
    expect(rows[0].media).toEqual(expect.objectContaining({ selected_because: 'she pointed at the root while pulling up the plant' }));
  });

  test('applyMedia preserves selected_because through the render pass', () => {
    const questions = eightGood();
    const rows = Gen.toRows('quiz-1', questions, { rng: () => 0 });
    const applied = Gen.applyMedia(rows, questions, { figureUrls: {}, cardUrls: {}, language: 'en' });
    expect(applied[0].media.selected_because).toBe('she pointed at the root while pulling up the plant');
    expect(applied[0].render_pattern).toBe('P1');
  });
});
