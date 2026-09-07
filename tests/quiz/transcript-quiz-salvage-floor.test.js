'use strict';
/**
 * The salvage drops the bad questions and ships what is left — and the limit on
 * it is how many questions SURVIVE, not how many are dropped.
 *
 * Live on production 2026-09-07T07:57:12Z: a maths lesson taught through group
 * turns produced, on its last attempt, three questions whose only complaints
 * were per-question PEDAGOGY_ codes. Every one was droppable and five good
 * questions remained, but `bad.size > 2` threw the whole quiz away and the
 * teacher was told nothing could be made. The rewrite had already been widened
 * to five questions (#744) and the repair allow-list to any complaint that
 * names a question (#758); this cap was the one ceiling left below the number
 * of independent faults a hard lesson produces.
 *
 * Every fixture here is synthetic; no transcript text enters this repo.
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
    slo_id: 'S2',
    level: 'understand',
    question: 'Which of these is a type of matter?',
    options: ['gas', 'speed', 'weight'],
    correct_index: 0,
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

const LESSON_SUMMARY = 'Today you taught the three states of matter with a stone, a glass of milk and the air in a balloon. You poured water between two glasses to show that a liquid takes the shape of its container.';
const ctx = { language: 'en', subject: 'science', digest: DIGEST, nExpected: 8, lessonSummary: LESSON_SUMMARY };
const salvageCtx = { language: 'en', subject: 'science', digest: DIGEST, lessonSummary: LESSON_SUMMARY };

/** A question whose only faults are per-question PEDAGOGY_ codes. */
function groupTurnQuestion(level) {
  return q({ level, question: 'Which atom did the teacher ask your group to draw?', options: ['Oxygen', 'Carbon', 'Boron'] });
}

describe('the salvage is limited by what survives, not by how many are dropped', () => {
  test('THREE pedagogy-only rejects are dropped and the five good questions ship', () => {
    const qs = eightClean();
    qs[1] = groupTurnQuestion('understand');
    qs[4] = groupTurnQuestion('recall');
    qs[7] = groupTurnQuestion('apply');
    const r = V.validate(qs, ctx);
    expect(r.ok).toBe(false);
    // every complaint names a question and is droppable — this is the live shape
    expect(r.errors.every((e) => /^q\d+: (FIGURE_|PEDAGOGY_|RELIGIOUS_)/.test(e))).toBe(true);
    expect(new Set(r.errors.map((e) => Number(/^q(\d+):/.exec(e)[1])))).toEqual(new Set([1, 4, 7]));

    const salvaged = Gen.salvageWithoutBadFigures(r.questions, r.errors, salvageCtx);
    expect(salvaged).not.toBeNull();
    expect(salvaged.dropped).toEqual([1, 4, 7]);
    expect(salvaged.questions).toHaveLength(5);
    expect(salvaged.questions.every((x) => !/your group/i.test(x.question))).toBe(true);
  });

  test('FOUR rejects leave too few questions, so the quiz still fails rather than shipping a stub', () => {
    const qs = eightClean();
    qs[1] = groupTurnQuestion('understand');
    qs[3] = groupTurnQuestion('understand');
    qs[4] = groupTurnQuestion('recall');
    qs[7] = groupTurnQuestion('apply');
    const r = V.validate(qs, ctx);
    expect(r.ok).toBe(false);
    expect(Gen.salvageWithoutBadFigures(r.questions, r.errors, salvageCtx)).toBeNull();
  });

  test('a structural fault alongside three droppable ones is still fatal — salvage is not a bypass', () => {
    const qs = eightClean();
    qs[1] = groupTurnQuestion('understand');
    qs[4] = groupTurnQuestion('recall');
    qs[7] = groupTurnQuestion('apply');
    qs[5].options = ['same', 'same', 'other'];
    const r = V.validate(qs, ctx);
    expect(Gen.salvageWithoutBadFigures(r.questions, r.errors, salvageCtx)).toBeNull();
  });
});
