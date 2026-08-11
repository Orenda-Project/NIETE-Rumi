/**
 * bd-2531 — REGRESSION: deriveProgress must report comment state.
 *
 * BUG FOUND BY THE STAGING E2E, NOT BY UNIT TESTS (2026-08-10).
 *
 * nextStep() branches on `p.hasComment` / `p.commentSkipped` to decide whether
 * she still owes a comment or can go to review. deriveProgress() never set
 * either field — so `!p.hasComment && !p.commentSkipped` was ALWAYS true and a
 * principal could never reach REVIEW, and therefore could never SUBMIT.
 *
 * The flow tests passed because they hand-fed `hasComment: true` into a
 * progress object. That is the failure mode of mocking the thing under test: the
 * contract between two of my own modules was never exercised, only asserted on
 * both sides separately.
 *
 * These tests exercise the REAL contract — deriveProgress output feeding
 * nextStep — so the two can never drift apart again.
 */
const { deriveProgress } = require('../../shared/services/remark/remark-cycle.repository');
const { nextStep, STEP } = require('../../shared/services/remark/remark-flow');

const TEACHERS = [{ id: 't-1', first_name: 'Ayesha' }];
const five = (rid) => [1, 2, 3, 4, 5].map((i) => ({ remark_id: rid, indicator_ordinal: i }));

describe('bd-2531 — deriveProgress reports comment state', () => {
  test('a remark with comment_text set → hasComment true', () => {
    const p = deriveProgress(
      [{ id: 'r-1', teacher_id: 't-1', submitted_at: null, comment_text: 'Doing well.' }],
      five('r-1'),
    );
    expect(p['t-1'].hasComment).toBe(true);
  });

  test("an EMPTY-STRING comment means SKIPPED, not missing", () => {
    // saveComment writes '' for a skip precisely so it is distinguishable from
    // "not asked yet" (NULL). If that distinction is lost here, the flow
    // re-prompts for a comment forever.
    const p = deriveProgress(
      [{ id: 'r-1', teacher_id: 't-1', submitted_at: null, comment_text: '' }],
      five('r-1'),
    );
    expect(p['t-1'].commentSkipped).toBe(true);
    expect(p['t-1'].hasComment).toBe(false);
  });

  test('a NULL comment is neither present nor skipped — she has not been asked', () => {
    const p = deriveProgress(
      [{ id: 'r-1', teacher_id: 't-1', submitted_at: null, comment_text: null }],
      five('r-1'),
    );
    expect(p['t-1'].hasComment).toBe(false);
    expect(p['t-1'].commentSkipped).toBe(false);
  });
});

describe('bd-2531 — THE REAL CONTRACT: deriveProgress → nextStep', () => {
  test('5 answered + no comment yet → COMMENT step', () => {
    const progress = deriveProgress(
      [{ id: 'r-1', teacher_id: 't-1', submitted_at: null, comment_text: null }],
      five('r-1'),
    );
    expect(nextStep({ teachers: TEACHERS, progress }).step).toBe(STEP.COMMENT);
  });

  test('5 answered + comment written → REVIEW step (the bug: was COMMENT)', () => {
    const progress = deriveProgress(
      [{ id: 'r-1', teacher_id: 't-1', submitted_at: null, comment_text: 'Grown a lot.' }],
      five('r-1'),
    );
    expect(nextStep({ teachers: TEACHERS, progress }).step).toBe(STEP.REVIEW);
  });

  test('5 answered + comment SKIPPED → REVIEW step', () => {
    const progress = deriveProgress(
      [{ id: 'r-1', teacher_id: 't-1', submitted_at: null, comment_text: '' }],
      five('r-1'),
    );
    expect(nextStep({ teachers: TEACHERS, progress }).step).toBe(STEP.REVIEW);
  });

  test('SUBMIT IS REACHABLE — the end-to-end path terminates', () => {
    // The whole feature is pointless if this is false. Walk the real derivation
    // from 0 answers to review, asserting we never loop.
    const rows = [{ id: 'r-1', teacher_id: 't-1', submitted_at: null, comment_text: null }];
    const seen = [];
    let scores = [];
    for (let i = 1; i <= 5; i += 1) {
      const s = nextStep({ teachers: TEACHERS, progress: deriveProgress(rows, scores) });
      seen.push(s.step);
      scores = [...scores, { remark_id: 'r-1', indicator_ordinal: s.ordinal }];
    }
    expect(seen).toEqual(Array(5).fill(STEP.SCORE_INDICATOR));

    // 5 answered → comment → review, and review is terminal until submit.
    expect(nextStep({ teachers: TEACHERS, progress: deriveProgress(rows, scores) }).step)
      .toBe(STEP.COMMENT);
    rows[0].comment_text = 'ok';
    expect(nextStep({ teachers: TEACHERS, progress: deriveProgress(rows, scores) }).step)
      .toBe(STEP.REVIEW);
    rows[0].submitted_at = 'now';
    expect(nextStep({ teachers: TEACHERS, progress: deriveProgress(rows, scores) }).step)
      .toBe(STEP.ALL_DONE);
  });
});
