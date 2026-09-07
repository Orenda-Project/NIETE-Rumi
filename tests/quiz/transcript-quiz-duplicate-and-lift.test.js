'use strict';
/**
 * Two defects from the same production run (2026-09-07 13:2x PKT, quiz
 * `f5d625e9`, an Urdu grade 3-5 lesson whose five SLOs were ALL taught at
 * "recall"). Three full attempts, three targeted rewrites, $0.047, no quiz.
 *
 * 1. THE MODEL KEPT WRITING DUPLICATE OPTIONS — q4, then q1 and q6, then q5 —
 *    and the rewrite prompt never told it the three options must differ. Every
 *    other repeated fault this week was answered by stating its rule in the
 *    prompt (the length caps, the multi-select shape, the آپ address, the
 *    teacher fields); this one had no rule line at all.
 *
 * 2. THE LIFT LINE CONTRADICTED ITSELF on an all-recall lesson. It read "a
 *    'recall' question on an SLO the lesson reached at 'recall'; ask the SAME
 *    idea at 'understand'" — while the neighbouring rule requires 60% of the
 *    set at or below its taught level. Both are satisfiable at exactly 3
 *    understand + 5 recall, and the model oscillated across attempts: over-
 *    correcting to "apply" on attempt 2, back to too-few on attempt 3. The
 *    instruction must say WHY it is allowed and how far it may go, once.
 */
const P = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy.js');
const RW = require('../../bot/shared/services/quiz/transcript-quiz-rewrite.js');

const DIGEST_ALL_RECALL = {
  subject: 'urdu', grade_band: '3-5', topic: 'اسم اور فعل',
  slos: [1, 2, 3, 4, 5].map((n) => ({ id: `S${n}`, statement: `s${n}`, taught_level: 'recall' })),
};
const q = (i, level = 'recall') => ({
  slo_id: `S${(i % 5) + 1}`, level, question: `سوال ${i}`, options: ['ا', 'ب', 'ج'], correct_index: 0,
  selected_because: 'سبق سے', option_feedback: { correct: 'ٹھیک', wrong: { 1: 'نہیں', 2: 'نہیں' } },
});

describe('1 — the lift line on an all-recall lesson explains itself instead of contradicting', () => {
  const qs = [q(0), q(1), q(2), q(3), q(4), q(5), q(6, 'understand'), q(7, 'understand')];
  const lifts = P.levelLiftDefects(qs, DIGEST_ALL_RECALL).map((d) => d.message);
  test('it names a question to lift', () => {
    expect(lifts.length).toBeGreaterThanOrEqual(1);
  });
  test('it never claims the lesson "reached" a level it did not, and never reads recall→recall', () => {
    lifts.forEach((m) => {
      expect(m).not.toMatch(/reached at "recall"/);
    });
  });
  test('it says the lift is the one level above the lesson that is allowed, and caps how many', () => {
    const m = lifts[0];
    expect(m).toMatch(/one level above/i);
    expect(m).toMatch(/at most|only (one|two|\d)/i);
  });
});

describe('2 — a repeated duplicate-options fault gets its rule stated in the repair prompt', () => {
  const questions = [q(0), q(1), q(2), q(3), q(4), q(5), q(6), q(7)];
  test('the prompt carries the distinct-options rule when that complaint is targeted', () => {
    const targets = RW.rewriteTargets(['q4: duplicate options']);
    expect(targets.indices).toEqual([4]);
    const p = RW.buildRewritePrompt({ digest: DIGEST_ALL_RECALL, language: 'ur', questions, targets });
    expect(p).toMatch(/DISTINCT OPTIONS|three options must all be different|no two options/i);
  });
  test('it is stated for an empty or a bad-index option fault too — the same family', () => {
    ['q4: empty option', 'q4: bad correct_index 5'].forEach((e) => {
      const p = RW.buildRewritePrompt({ digest: DIGEST_ALL_RECALL, language: 'ur', questions, targets: RW.rewriteTargets([e]) });
      expect(p).toMatch(/DISTINCT OPTIONS|three options must all be different|no two options/i);
    });
  });
  test('a question with no options fault does not get the rule', () => {
    const p = RW.buildRewritePrompt({ digest: DIGEST_ALL_RECALL, language: 'ur', questions, targets: RW.rewriteTargets(['q4: PEDAGOGY_UNANSWERABLE — …']) });
    expect(p).not.toMatch(/DISTINCT OPTIONS/);
  });
});
