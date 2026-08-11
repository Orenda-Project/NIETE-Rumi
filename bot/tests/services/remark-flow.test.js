/**
 * bd-2531 — the /remark rubric walk: 5 screens + comment + review + submit.
 *
 * NO SESSION TABLE. Every other part of this feature derives state from rows,
 * and so does this: "which teacher, which indicator" is reconstructed from the
 * score rows already written. A principal can be interrupted after indicator 3,
 * go do something else, come back on another device a week later, and land on
 * indicator 4 — because the answer is recomputed, not remembered.
 *
 * That also means this flow does NOT depend on the attendance state machine, so
 * it cannot inherit whatever shape the parallel attendance rewrite lands on.
 *
 * The step is a PURE function of (remark rows, scores, inbound reply). These
 * tests pin the transitions; the handler is a thin shell around it.
 */
const {
  nextStep,
  STEP,
  parseScoreReply,
  parseTeacherPick,
} = require('../../shared/services/remark/remark-flow');

const T = (id, name) => ({ id, first_name: name });
const TEACHERS = [T('t-1', 'Ayesha'), T('t-2', 'Bilal'), T('t-3', 'Chandni')];
const scores = (n) => Array.from({ length: n }, (_, i) => ({ ordinal: i + 1, score: 3 }));

describe('bd-2531 — parseTeacherPick', () => {
  test('a 1-based number picks the matching teacher', () => {
    expect(parseTeacherPick('2', TEACHERS)).toEqual(T('t-2', 'Bilal'));
  });

  test('whitespace and stray text around the number are tolerated', () => {
    // A principal on a phone types " 2." or "2 pls" — that is not an error.
    expect(parseTeacherPick(' 2. ', TEACHERS)).toEqual(T('t-2', 'Bilal'));
  });

  test('out-of-range and non-numeric return null', () => {
    for (const bad of ['0', '4', '-1', 'Bilal', '', null]) {
      expect(parseTeacherPick(bad, TEACHERS)).toBeNull();
    }
  });
});

describe('bd-2531 — parseScoreReply accepts 1..4 only', () => {
  test('a bare digit 1-4 is accepted', () => {
    for (const n of [1, 2, 3, 4]) expect(parseScoreReply(String(n))).toBe(n);
  });

  test('Urdu digits are accepted — an Urdu principal taps her own numerals', () => {
    expect(parseScoreReply('۴')).toBe(4);
    expect(parseScoreReply('٣')).toBe(3);
  });

  test('0, 5, words and empties are rejected', () => {
    for (const bad of ['0', '5', '10', 'four', '', null, undefined]) {
      expect(parseScoreReply(bad)).toBeNull();
    }
  });
});

describe('bd-2531 — nextStep: where is she, and what comes next?', () => {
  test('no remark row yet → she is picking a teacher', () => {
    expect(nextStep({ teachers: TEACHERS, progress: {} }).step).toBe(STEP.PICK_TEACHER);
  });

  test('an in-progress teacher resumes at the first UNANSWERED indicator', () => {
    const progress = { 't-2': { state: 'in_progress', answered: 3, remarkId: 'r-2', resumeAt: 4 } };
    const s = nextStep({ teachers: TEACHERS, progress });
    expect(s.step).toBe(STEP.SCORE_INDICATOR);
    expect(s.teacher.id).toBe('t-2');
    expect(s.ordinal).toBe(4);
  });

  test('a GAP resumes at the gap, not at max+1', () => {
    // She answered 1,2,4 (jumped, or a write failed). Resuming at 5 would
    // silently leave indicator 3 unanswered and submit would be blocked with
    // no explanation.
    const progress = { 't-1': { state: 'in_progress', answered: 3, remarkId: 'r-1', resumeAt: 3 } };
    expect(nextStep({ teachers: TEACHERS, progress }).ordinal).toBe(3);
  });

  test('all 5 answered, no comment yet → the comment step', () => {
    const progress = { 't-1': { state: 'in_progress', answered: 5, remarkId: 'r-1', resumeAt: null } };
    expect(nextStep({ teachers: TEACHERS, progress }).step).toBe(STEP.COMMENT);
  });

  test('5 answered + comment present → review', () => {
    const progress = {
      't-1': { state: 'in_progress', answered: 5, remarkId: 'r-1', resumeAt: null, hasComment: true },
    };
    const s = nextStep({ teachers: TEACHERS, progress });
    expect(s.step).toBe(STEP.REVIEW);
  });

  test('every teacher submitted → the cycle is complete for her', () => {
    const progress = Object.fromEntries(TEACHERS.map((t) => [t.id, { state: 'done' }]));
    expect(nextStep({ teachers: TEACHERS, progress }).step).toBe(STEP.ALL_DONE);
  });

  test('a done teacher is skipped; the next unstarted one is offered', () => {
    const progress = { 't-1': { state: 'done' }, 't-2': { state: 'done' } };
    const s = nextStep({ teachers: TEACHERS, progress });
    expect(s.step).toBe(STEP.PICK_TEACHER);
    expect(s.remaining.map((t) => t.id)).toEqual(['t-3']);
  });

  test('an in-progress teacher takes PRIORITY over starting a new one', () => {
    // Finish what you started — otherwise a principal accumulates five
    // half-done rubrics and none of them submit.
    const progress = {
      't-1': { state: 'done' },
      't-2': { state: 'in_progress', answered: 2, remarkId: 'r-2', resumeAt: 3 },
    };
    const s = nextStep({ teachers: TEACHERS, progress });
    expect(s.step).toBe(STEP.SCORE_INDICATOR);
    expect(s.teacher.id).toBe('t-2');
  });
});

describe('bd-2531 — submit is blocked until the rubric is whole', () => {
  test('4 of 5 answered cannot reach review', () => {
    const progress = { 't-1': { state: 'in_progress', answered: 4, remarkId: 'r-1', resumeAt: 5 } };
    const s = nextStep({ teachers: TEACHERS, progress });
    expect(s.step).toBe(STEP.SCORE_INDICATOR);
    expect(s.step).not.toBe(STEP.REVIEW);
  });

  test('the comment is OPTIONAL — she can reach review by skipping it', () => {
    // Spec §10: "all 5 required; comment optional". skipComment must not strand
    // her on a step she has nothing to say for.
    const progress = {
      't-1': { state: 'in_progress', answered: 5, remarkId: 'r-1', resumeAt: null, commentSkipped: true },
    };
    expect(nextStep({ teachers: TEACHERS, progress }).step).toBe(STEP.REVIEW);
  });
});

describe('bd-2531 — a principal with no teachers', () => {
  test('is told so, not shown an empty picker', () => {
    expect(nextStep({ teachers: [], progress: {} }).step).toBe(STEP.NO_TEACHERS);
  });
});
