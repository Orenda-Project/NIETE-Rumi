'use strict';
/**
 * bd-tbprit.1 — the evidence a coach sees for each reason a C/D teacher gave for "Not accurate". Pure: the
 * session's analysis_data, her reason codes and the report's own "one thing to try" in; out, per reason, the
 * grader's own scores and quotes with the second each starts at. Nothing the grader did not write is filled in.
 */
const { secondsOf, indicatorsOf, movesOf, evidenceFor } = require('../../dashboard/services/coach-disagreement-evidence');

const IND = (id, score, extra = {}) => ({ id, name: `Ind ${id}`, score, evidence: `[0${id.length}:10] quote ${id}`, timestamp: '03:10', applicable: true, ...extra });
const A = (lp = 'ok') => ({
  scores: { has_lesson_plan: lp === 'ok', overall_marks: 80, overall_max_marks: 140 },
  domains: {
    lesson_plan_fidelity: { domain_score: 20, domain_max: 40, indicators: [IND('B1', 2), IND('B2', 4)] },
    high_leverage_practices: { domain_score: 30, domain_max: 48, indicators: [IND('C1', 1, { timestamp: '[12:05] / [14:00]' }), IND('C2', 3)] },
    student_engagement: { domain_score: 15, domain_max: 28, indicators: [IND('D1', 'N/A', { applicable: false, timestamp: 'N/A' })] },
    teacher_subject_knowledge: { domain_score: 15, domain_max: 24, indicators: [IND('F1', 2, { timestamp: '' })] },
  },
  lp_fidelity: lp === 'ok' ? {
    status: 'ok',
    moves: [
      { move_id: 'm1', text: 'Hook with apples', phase: 'hook', bucket: 'must_happen', verdict: 'executed', credit: 1, evidence: '[00:28] Teacher: ...' },
      { move_id: 'm2', text: 'Pairs count groups', phase: 'we_do', bucket: 'must_happen', verdict: 'not_done', credit: 0, evidence: '', rationale: 'No pair work heard' },
      { move_id: 'm3', text: 'Exit ticket', phase: 'closing', bucket: 'optional_extension', verdict: 'partial', credit: 0.5, evidence: '[photo 1] [31:02] Teacher: ...', evidence_translation: 'Teacher: who can tell me' },
    ],
  } : { status: lp },
});
const THING = { text: 'Ask two children to explain', why: 'Talk builds it', step: 'We Do' };

describe('secondsOf', () => {
  it('reads the first mm:ss or h:mm:ss in a grader timestamp, null when there is none', () => {
    expect(secondsOf('03:10')).toBe(190);
    expect(secondsOf('[12:05] / [14:00]')).toBe(725);
    expect(secondsOf('[photo 1] [31:02] Teacher')).toBe(1862);
    expect(secondsOf('1:02:03')).toBe(3723);
    expect(secondsOf('N/A')).toBeNull();
    expect(secondsOf('')).toBeNull();
    expect(secondsOf(null)).toBeNull();
    expect(secondsOf('12:75')).toBeNull();
  });
});

describe('indicatorsOf', () => {
  it('every section in the report order with its indicators, the AI score and the second the quote starts', () => {
    const s = indicatorsOf(A());
    expect(s.map((x) => x.key)).toEqual(['lesson_plan_fidelity', 'high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge']);
    expect(s[1]).toMatchObject({ score: 30, max: 48, counted: true });
    expect(s[1].items[0]).toEqual({ id: 'C1', name: 'Ind C1', score: 1, evidence: '[02:10] quote C1', at: 725, applicable: true });
    expect(s[2].items[0]).toMatchObject({ score: null, applicable: false, at: null });
    expect(s[3].items[0].at).toBe(130); // no timestamp field: the quote's own [mm:ss]
  });

  it('lesson plan fidelity is shown but marked not counted when no plan was linked', () => {
    expect(indicatorsOf(A('lp_absent'))[0].counted).toBe(false);
    expect(indicatorsOf(A())[0].counted).toBe(true);
  });

  it('no domains is an empty list, never invented sections', () => {
    expect(indicatorsOf({})).toEqual([]);
    expect(indicatorsOf(null)).toEqual([]);
  });
});

describe('movesOf', () => {
  it('the plan steps with the verdict and quote when the plan was checked, null otherwise', () => {
    const m = movesOf(A());
    expect(m).toHaveLength(3);
    expect(m[1]).toMatchObject({ id: 'm2', text: 'Pairs count groups', mustHappen: true, verdict: 'not_done', at: null, why: 'No pair work heard' });
    expect(m[2]).toMatchObject({ mustHappen: false, verdict: 'partial', at: 1862, translation: 'Teacher: who can tell me' });
    expect(movesOf(A('lp_absent'))).toBeNull();
    expect(movesOf(A('fidelity_unavailable'))).toBeNull();
  });
});

describe('evidenceFor', () => {
  it('score: the lowest-scored applicable indicators first, at most five', () => {
    const [r] = evidenceFor(A(), ['score'], THING);
    expect(r.code).toBe('score');
    expect(r.items.map((i) => i.id)).toEqual(['C1', 'B1', 'F1']);
  });

  it('missed: the plan steps the grader marked not done or partly done', () => {
    const [r] = evidenceFor(A(), ['missed'], THING);
    expect(r.moves.map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(r.noPlan).toBe(false);
  });

  it('missed with no plan checked: says so, and falls back to the low indicators', () => {
    const [r] = evidenceFor(A('lp_absent'), ['missed'], THING);
    expect(r.noPlan).toBe(true);
    expect(r.moves).toEqual([]);
    expect(r.items.map((i) => i.id)).toEqual(['C1', 'B1', 'F1']);
  });

  it('wont_work and unclear: what the report told her to try', () => {
    const out = evidenceFor(A(), ['wont_work', 'unclear'], THING);
    expect(out.map((r) => r.code)).toEqual(['wont_work', 'unclear']);
    expect(out[0].thing).toEqual(THING);
    expect(out[1].thing).toEqual(THING);
  });

  it('only known reasons, in the design order; a voice note alone gives no reason blocks', () => {
    expect(evidenceFor(A(), ['unclear', 'bogus', 'score'], THING).map((r) => r.code)).toEqual(['score', 'unclear']);
    expect(evidenceFor(A(), [], THING)).toEqual([]);
  });

  it('a report with no thing to try gives thing null, not a made-up one', () => {
    expect(evidenceFor(A(), ['unclear'], null)[0].thing).toBeNull();
  });
});
