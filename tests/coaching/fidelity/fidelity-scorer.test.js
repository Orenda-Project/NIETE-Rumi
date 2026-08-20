'use strict';
/**
 * P3.2 — deterministic fidelity scorer. Pure, no LLM (RES-004: models drift on arithmetic).
 * Encodes decisions D4/D5/D11/D16/D19/D22/D23. Ported from the offline-validated eval/scorer.py.
 */
const { scoreFidelity, band } = require('../../../bot/shared/services/coaching/fidelity/fidelity-scorer');

const mv = (id, over = {}) => ({
  move_id: id, phase: 'explain', bucket: 'must_happen', selection: 'none',
  track_time_on_task: false, prescribed_minutes: null, adjudicable: true, ...over,
});

describe('fidelity-scorer', () => {
  test('credit map: executed=1, partial=0.5, not_done=0 → bounded %', () => {
    const moves = [mv('m1'), mv('m2'), mv('m3'), mv('m4')];
    const verdicts = [
      { move_id: 'm1', verdict: 'executed' },
      { move_id: 'm2', verdict: 'partial' },
      { move_id: 'm3', verdict: 'not_done' },
      { move_id: 'm4', verdict: 'executed' },
    ];
    const r = scoreFidelity(moves, verdicts);
    expect(r.executed_credit).toBe(2.5);
    expect(r.prescribed_count).toBe(4);
    expect(r.fidelity_pct).toBe(62.5); // 2.5/4
    expect(r.band).toBe('partial');
  });

  test('bounds: all executed → 100 high; all not_done → 0 low', () => {
    const moves = [mv('m1'), mv('m2')];
    expect(scoreFidelity(moves, [{ move_id: 'm1', verdict: 'executed' }, { move_id: 'm2', verdict: 'executed' }]).fidelity_pct).toBe(100);
    expect(scoreFidelity(moves, [{ move_id: 'm1', verdict: 'not_done' }, { move_id: 'm2', verdict: 'not_done' }]).fidelity_pct).toBe(0);
    expect(band(100)).toBe('high');
    expect(band(0)).toBe('low');
  });

  test('substitution: equivalent & better both = full credit; better → strengths (D4)', () => {
    const moves = [mv('m1'), mv('m2')];
    const r = scoreFidelity(moves, [
      { move_id: 'm1', verdict: 'substituted_equivalent' },
      { move_id: 'm2', verdict: 'substituted_better', evidence: '[10:00] used a number line' },
    ]);
    expect(r.fidelity_pct).toBe(100);
    expect(r.strengths).toHaveLength(1);
    expect(r.strengths[0].move_id).toBe('m2');
  });

  test('not_adjudicable is DROPPED from the denominator, reported not_assessed (D11)', () => {
    const moves = [mv('m1'), mv('m2'), mv('m3')];
    const r = scoreFidelity(moves, [
      { move_id: 'm1', verdict: 'executed' },
      { move_id: 'm2', verdict: 'not_adjudicable' },
      { move_id: 'm3', verdict: 'not_done' },
    ]);
    expect(r.prescribed_count).toBe(2); // m2 dropped
    expect(r.fidelity_pct).toBe(50); // 1/2
    expect(r.not_assessed).toEqual(['m2']);
  });

  test('a move flagged adjudicable:false is never scored as a miss', () => {
    const moves = [mv('m1'), mv('m2', { adjudicable: false })];
    const r = scoreFidelity(moves, [
      { move_id: 'm1', verdict: 'executed' },
      { move_id: 'm2', verdict: 'not_done' },
    ]);
    expect(r.prescribed_count).toBe(1);
    expect(r.fidelity_pct).toBe(100);
    expect(r.not_assessed).toEqual(['m2']);
  });

  test('optional_extension: attempted → enrichment (out of ratio); skipped → ignored, no penalty (D11.2)', () => {
    const moves = [mv('m1'), mv('m2', { bucket: 'optional_extension' }), mv('m3', { bucket: 'optional_extension' })];
    const r = scoreFidelity(moves, [
      { move_id: 'm1', verdict: 'executed' },
      { move_id: 'm2', verdict: 'executed' }, // optional attempted
      { move_id: 'm3', verdict: 'not_done' }, // optional skipped
    ]);
    expect(r.prescribed_count).toBe(1); // only m1 in the core ratio
    expect(r.fidelity_pct).toBe(100);
    expect(r.enrichment_uptake.map((e) => e.move_id)).toEqual(['m2']);
  });

  test('adaptive_set member that applied counts; skipping a group she taught IS a miss', () => {
    const moves = [mv('m1', { bucket: 'adaptive_set' }), mv('m2', { bucket: 'adaptive_set' })];
    const r = scoreFidelity(moves, [
      { move_id: 'm1', verdict: 'executed' },
      { move_id: 'm2', verdict: 'not_done' },
    ]);
    expect(r.prescribed_count).toBe(2);
    expect(r.fidelity_pct).toBe(50);
  });

  test('coverage + recording_unusable: all core not_adjudicable → null pct, flagged (D19)', () => {
    const moves = [mv('m1'), mv('m2'), mv('m3')];
    const r = scoreFidelity(moves, [
      { move_id: 'm1', verdict: 'not_adjudicable' },
      { move_id: 'm2', verdict: 'not_adjudicable' },
      { move_id: 'm3', verdict: 'not_adjudicable' },
    ]);
    expect(r.fidelity_pct).toBeNull();
    expect(r.band).toBeNull();
    expect(r.recording_unusable).toBe(true);
    expect(r.low_confidence).toBe(true);
    expect(r.coverage).toBe(0);
  });

  test('low_confidence when <50% of intended moves were adjudicable (partly-garbled)', () => {
    const moves = [mv('m1'), mv('m2'), mv('m3'), mv('m4')];
    const r = scoreFidelity(moves, [
      { move_id: 'm1', verdict: 'executed' },
      { move_id: 'm2', verdict: 'not_adjudicable' },
      { move_id: 'm3', verdict: 'not_adjudicable' },
      { move_id: 'm4', verdict: 'not_adjudicable' },
    ]);
    expect(r.coverage).toBe(0.25);
    expect(r.low_confidence).toBe(true);
    expect(r.fidelity_pct).toBe(100); // computed only from the 1 adjudicable move…
    expect(r.prescribed_count).toBe(1); // …and flagged low-confidence so it isn't over-trusted
  });

  test('time-on-task passthrough: assigned + worked_minutes surfaced, never gates the score (D22)', () => {
    const moves = [mv('m1'), mv('m2', { phase: 'independent', track_time_on_task: true, prescribed_minutes: 3 })];
    const r = scoreFidelity(moves, [
      { move_id: 'm1', verdict: 'executed' },
      { move_id: 'm2', verdict: 'executed', assigned: true, worked_minutes: 5, on_task_band: 'medium' },
    ]);
    expect(r.time_on_task).toEqual({ move_id: 'm2', assigned: true, worked_minutes: 5, prescribed_minutes: 3, on_task_band: 'medium' });
    expect(r.fidelity_pct).toBe(100); // full credit regardless of over/under time
  });

  test('phase breakdown data present per move; a missing verdict defaults to not_done', () => {
    const moves = [mv('m1', { phase: 'warm_up' }), mv('m2', { phase: 'exit' })];
    const r = scoreFidelity(moves, [{ move_id: 'm1', verdict: 'executed' }]); // m2 has no verdict
    const byId = Object.fromEntries(r.moves.map((x) => [x.move_id, x]));
    expect(byId.m1.phase).toBe('warm_up');
    expect(byId.m2.verdict).toBe('not_done');
    expect(r.fidelity_pct).toBe(50);
  });
});
