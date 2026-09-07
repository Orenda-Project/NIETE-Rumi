'use strict';
/**
 * The pedagogy rules must run on the path a real quiz takes, not only in
 * their own unit test: validate() rejects the quiz, the complaint reaches the
 * author's retry, and a last attempt that fails ONLY on pedagogy drops the bad
 * questions rather than costing the teacher a quiz.
 *
 * Every fixture is synthetic; no transcript text enters this repo.
 */
const V = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const DIGEST = {
  subject: 'science',
  slos: [
    { id: 'S1', statement: 'name the three states of matter', taught_level: 'recall' },
    { id: 'S2', statement: 'explain how a solid differs from a liquid', taught_level: 'understand' },
  ],
};

function q(over = {}) {
  return {
    slo_id: 'S2', level: 'understand',
    question: 'Which of these is a type of matter?',
    options: ['gas', 'speed', 'weight'], correct_index: 0,
    explanation: 'Gas is one of the three states of matter.',
    selected_because: 'the water poured between two glasses in front of the class',
    distractor_misconceptions: { 1: 'confuses how fast with what it is', 2: 'confuses how heavy with what it is' },
    option_feedback: {
      correct: 'Yes — gas is one of the three states matter comes in.',
      wrong: {
        1: 'Speed tells us how fast something moves, not what it is made of; gas is a state of matter.',
        2: 'Weight tells us how heavy something is, not what it is made of; gas is a state of matter.',
      },
    },
    ...over,
  };
}

/** Eight clean questions that pass every structural AND pedagogy rule. */
function eightClean() {
  return [
    q({ slo_id: 'S1', level: 'recall', question: 'Which of these is a solid?', options: ['stone', 'milk', 'air'] }),
    q({ question: 'Which of these is NOT a liquid?', options: ['ice', 'milk', 'water'] }),
    q({ level: 'apply', question: 'Water is left on a hot stove for a long time. What does it turn into?', options: ['steam', 'ice', 'stone'] }),
    q({ question: 'Why does a stone keep its shape?', options: ['it is a solid', 'it is a liquid', 'it is a gas'] }),
    q({ slo_id: 'S1', level: 'recall', question: 'Which of these is a gas?', options: ['air', 'stone', 'milk'] }),
    q({ slo_id: 'S1', level: 'recall', question: 'Which of these is a liquid?', options: ['milk', 'stone', 'air'] }),
    q({ question: 'What makes a liquid different from a solid?', options: ['it takes the shape of its glass', 'it is always cold', 'it is always heavy'] }),
    q({ level: 'apply', question: 'A balloon is squeezed and gets smaller. What is inside it?', options: ['gas', 'a solid', 'nothing'] }),
  ];
}

const ctx = {
  language: 'en', subject: 'science', digest: DIGEST, nExpected: 8, lessonSummary: 'Today you taught the three states of matter with a stone, a glass of milk and the air in a balloon. You poured water between two glasses to show that a liquid takes the shape of its container.',
};

describe('validate() runs the pedagogy rules', () => {
  test('the clean set still passes', () => {
    const r = V.validate(eightClean(), ctx);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('a count-of-mentions question fails validate() with its own code', () => {
    const qs = eightClean();
    qs[0] = q({ slo_id: 'S1', level: 'recall', question: 'How many types of matter did the teacher mention?', options: ['3', '2', '4'] });
    const r = V.validate(qs, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /^q0: PEDAGOGY_COUNT_RECALL/.test(e))).toBe(true);
    // the complaint is the retry note, so it has to say what to write instead
    expect(r.errors.find((e) => /PEDAGOGY_COUNT_RECALL/.test(e))).toMatch(/Which of these is a type of matter/);
  });

  test('a "your group" question fails validate()', () => {
    const qs = eightClean();
    qs[3] = q({ question: 'Which atom did the teacher ask your group to draw?', options: ['Oxygen', 'Carbon', 'Boron'] });
    const r = V.validate(qs, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /^q3: PEDAGOGY_UNANSWERABLE/.test(e))).toBe(true);
    expect(r.errors.some((e) => /^q3: PEDAGOGY_TEACHER_AS_SUBJECT/.test(e))).toBe(true);
  });

  test('an all-recall set fails validate() on the level mix', () => {
    const qs = eightClean().map((x) => ({ ...x, level: 'recall' }));
    const r = V.validate(qs, ctx);
    expect(r.errors.some((e) => /^PEDAGOGY_LEVEL_MIX/.test(e))).toBe(true);
  });

  test('an Urdu quiz is checked in Urdu', () => {
    const urdu = eightClean().map((x, i) => ({
      ...x,
      question: `کیا ${i} ان میں سے کون سا solid ہے؟`,
      options: ['پتھر', 'دودھ', 'ہوا'],
      explanation: 'پتھر ایک solid ہے۔',
      selected_because: 'انہوں نے کلاس کے سامنے پتھر اٹھا کر دکھایا',
      distractor_misconceptions: { 1: 'دودھ کو solid سمجھنا', 2: 'ہوا کو solid سمجھنا' },
      option_feedback: {
        correct: 'درست — پتھر اپنی شکل نہیں بدلتا، اس لیے وہ solid ہے۔',
        wrong: { 1: 'دودھ برتن کی شکل لے لیتا ہے، اس لیے وہ liquid ہے؛ پتھر solid ہے۔', 2: 'ہوا پھیل جاتی ہے، اس لیے وہ gas ہے؛ پتھر solid ہے۔' },
      },
    }));
    urdu[2] = { ...urdu[2], question: 'استاد نے matter کی کتنی قسمیں بتائیں؟', options: ['۳', '۲', '۴'] };
    const r = V.validate(urdu, { ...ctx, language: 'ur', lessonSummary: 'انہوں نے matter کی تین قسمیں پتھر، دودھ اور ہوا کی مثال سے پڑھائیں۔ پانی ایک برتن سے دوسرے میں ڈال کر liquid کی شکل سمجھائی۔' });
    expect(r.errors.some((e) => /^q2: PEDAGOGY_COUNT_RECALL/.test(e))).toBe(true);
  });
});

describe('the last attempt salvages a quiz whose only fault is a bad question', () => {
  test('two pedagogy-only rejects are dropped and the rest is kept', () => {
    const qs = eightClean();
    qs[1] = q({ question: 'Which atom did the teacher ask your group to draw?', options: ['Oxygen', 'Carbon', 'Boron'] });
    qs[6] = q({ slo_id: 'S1', level: 'recall', question: 'How many types of matter did the teacher mention?', options: ['3', '2', '4'] });
    const r = V.validate(qs, ctx);
    expect(r.ok).toBe(false);
    const salvaged = Gen.salvageWithoutBadFigures(r.questions, r.errors, {
      language: 'en', subject: 'science', digest: DIGEST, lessonSummary: ctx.lessonSummary,
    });
    expect(salvaged).not.toBeNull();
    expect(salvaged.dropped).toEqual([1, 6]);
    expect(salvaged.questions).toHaveLength(6);
    expect(salvaged.questions.every((x) => !/your group|how many/i.test(x.question))).toBe(true);
  });

  // SUPERSEDED 2026-09-07. This pinned the salvage's allow-list: a per-question
  // fault whose code was not FIGURE_/PEDAGOGY_/RELIGIOUS_ threw the WHOLE quiz
  // away. On production that turned `q5: duplicate options` on one question
  // into no quiz at all for a teacher, and the operator asked why a fault we
  // could fix later was allowed to be fatal. What decides now is the FLOOR:
  // any question that is individually faulty may be dropped while at least
  // MIN_QUESTIONS survive, and the remainder is re-validated in full. The
  // property this test cared about — the salvage is not a bypass — is still
  // here: it holds when dropping would take the set under the floor, or when
  // the complaint is about the set rather than a question.
  test('two faulty questions are dropped and six ship; a third would go under the floor and fails', () => {
    const qs = eightClean();
    qs[1] = q({ question: 'Which atom did the teacher ask your group to draw?', options: ['Oxygen', 'Carbon', 'Boron'] });
    qs[4].options = ['same', 'same', 'other'];
    const r = V.validate(qs, ctx);
    const base = { language: 'en', subject: 'science', digest: DIGEST, lessonSummary: ctx.lessonSummary };
    const out = Gen.salvageWithoutBadFigures(r.questions, r.errors, base);
    expect(out.refused).toBeUndefined();
    expect(out.dropped).toEqual([1, 4]);
    expect(out.questions).toHaveLength(6);
    // a third bad question takes it under the floor, and the refusal says so
    expect(Gen.salvageWithoutBadFigures(r.questions, [...r.errors, 'q6: duplicate options'], base).refused)
      .toMatch(/under the floor of 6/);
  });

  test('salvage is not a bypass for a complaint about the SET', () => {
    const qs = eightClean();
    qs[4].options = ['same', 'same', 'other'];
    const r = V.validate(qs, ctx);
    expect(Gen.salvageWithoutBadFigures(r.questions, [...r.errors, 'SLOs uncovered: S3'], {
      language: 'en', subject: 'science', digest: DIGEST, lessonSummary: ctx.lessonSummary,
    }).refused).toMatch(/about the set/);
  });
});
