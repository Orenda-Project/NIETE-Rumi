'use strict';
/** NIGHTLY_JOB §4 stage 4 (code legs): minutes over plan, the check-signal evaluator (four shapes), the check strip. */
const path = require('path');
const F = require('./fixtures/analysis');
const { lpFact, ficoFact, uuid } = require('./fixtures/moments');
const P = require('../../lib/insights/predicates');
const L = require('../../lib/insights/legs');

const LIBRARY = require(path.join(__dirname, '../../data/coachip/INTERVENTIONS.json'));
const sig = (iId) => LIBRARY.interventions.find((i) => i.id === iId).check_it_worked.signal;

// A stand-in for the signal stage's per-session predicate: W-IP = skipped(independent) on an lp fact.
const evalW = (wId, fact) => {
  const moves = fact.allowed && fact.allowed.lp ? fact.allowed.lp.moves : null;
  if (!moves || wId !== 'W-IP') return { in_denominator: false, hit: false };
  const o = P.phaseOutcome(moves, 'independent');
  return { in_denominator: o.graded, hit: o.skipped };
};

const ip = (verdict, opts = {}) => lpFact([
  F.move('m1', 'explain', 'executed', { at: '02:00' }),
  F.move('m2', 'independent', verdict, { at: verdict === 'not_done' ? undefined : '10:00', tot: opts.tot }),
], opts);

describe('minutesOverPlan and the W-IP-TIME median', () => {
  const planned = (stamps) => lpFact([
    F.move('m1', 'warm_up', 'executed', { at: '01:00', tot: { prescribed_minutes: 3 } }),
    F.move('m2', 'explain', 'executed', { at: stamps[0], tot: { prescribed_minutes: 5 } }),
    F.move('m3', 'guided', 'executed', { at: stamps[1], tot: { prescribed_minutes: 7 } }),
    F.move('m4', 'independent', 'not_done', { tot: { prescribed_minutes: 10 } }),
  ]);

  test('last explain/guided stamp minus the prescribed minutes up to and including that move', () => {
    expect(L.minutesOverPlan(planned(['10:00', '20:00']))).toBe(5);
    expect(L.minutesOverPlan(planned(['10:00', '15:15']))).toBeCloseTo(0.25, 5);
  });

  test('a guided move with no stamp falls back to the last stamped explain/guided move', () => {
    const f = lpFact([
      F.move('m1', 'explain', 'executed', { at: '12:00', tot: { prescribed_minutes: 5 } }),
      F.move('m2', 'guided', 'not_done', { tot: { prescribed_minutes: 7 } }),
    ]);
    expect(L.minutesOverPlan(f)).toBe(7);
  });

  test('null with no prescribed minutes or no explain/guided stamp', () => {
    expect(L.minutesOverPlan(lpFact([F.move('m1', 'explain', 'executed', { at: '10:00' })]))).toBeNull();
    expect(L.minutesOverPlan(lpFact([F.move('m1', 'explain', 'not_done', { tot: { prescribed_minutes: 5 } })]))).toBeNull();
    expect(L.minutesOverPlan(ficoFact(F.v3({})))).toBeNull();
  });

  test('statForIpTime: the median over lessons with a value, 1 dp, with its base', () => {
    const facts = [planned(['10:00', '20:00']), planned(['10:00', '16:00']), planned(['10:00', '18:15']),
      lpFact([F.move('m1', 'explain', 'executed', { at: '10:00' })])];
    expect(L.statForIpTime(facts)).toEqual({ stat_kind: 'median', stat_unit: 'min', stat_value: 3.3, stat_base: 3 });
    expect(L.statForIpTime([planned(['10:00', '20:00']), planned(['10:00', '16:00'])]).stat_value).toBe(3);
  });

  test('statForIpTime is null when no fact has a value', () => {
    expect(L.statForIpTime([])).toBeNull();
    expect(L.statForIpTime([lpFact([F.move('m1', 'explain', 'executed', { at: '10:00' })])])).toBeNull();
  });
});

describe('evaluateCheckSignal: one evaluator, four shapes', () => {
  test('shape 1, a W id with comparison absent (I-IP-1): hit when the W did not fire, miss when it did', () => {
    const s = sig('I-IP-1');
    expect(s).toMatchObject({ signal_id: 'W-IP', comparison: 'absent' });
    expect(L.evaluateCheckSignal(s, ip('executed'), evalW)).toBe('hit');
    expect(L.evaluateCheckSignal(s, ip('not_done'), evalW)).toBe('miss');
  });

  test('shape 1: a phase that moved from not_done to partial is partial (progress), not a hit or a miss', () => {
    expect(L.evaluateCheckSignal(sig('I-IP-1'), ip('partial'), evalW)).toBe('partial');
  });

  test('shape 1: outside the W\'s denominator on this instrument is null', () => {
    expect(L.evaluateCheckSignal(sig('I-IP-1'), ficoFact(F.v3({})), evalW)).toBeNull();
  });

  test('shape 2, a verdict list (I-IP-TIME-1, comparison in)', () => {
    const s = sig('I-IP-TIME-1');
    expect(s).toMatchObject({ signal_id: 'lp_fidelity.independent.verdict', comparison: 'in' });
    expect(L.evaluateCheckSignal(s, ip('executed'), evalW)).toBe('hit');
    expect(L.evaluateCheckSignal(s, ip('substituted_better'), evalW)).toBe('hit');
    expect(L.evaluateCheckSignal(s, ip('partial'), evalW)).toBe('partial');
    expect(L.evaluateCheckSignal(s, ip('not_done'), evalW)).toBe('miss');
    expect(L.evaluateCheckSignal(s, lpFact([F.move('m1', 'explain', 'executed', { at: '01:00' })]), evalW)).toBeNull();
    expect(L.evaluateCheckSignal(s, ficoFact(F.v3({})), evalW)).toBeNull();
  });

  test('shape 3, a ratio with >= (I-IP-PARTIAL-1, worked_ratio >= 0.6)', () => {
    const s = sig('I-IP-PARTIAL-1');
    expect(s).toMatchObject({ signal_id: 'lp_fidelity.independent.worked_ratio', comparison: '>=', value: 0.6 });
    expect(L.evaluateCheckSignal(s, ip('executed', { tot: { worked_minutes: 6, prescribed_minutes: 10 } }), evalW)).toBe('hit');
    expect(L.evaluateCheckSignal(s, ip('partial', { tot: { worked_minutes: 3, prescribed_minutes: 10 } }), evalW)).toBe('partial');
    expect(L.evaluateCheckSignal(s, ip('executed', { tot: { worked_minutes: 2, prescribed_minutes: 10 } }), evalW)).toBe('miss');
    expect(L.evaluateCheckSignal(s, ip('executed'), evalW)).toBeNull();
  });

  test('shape 4, an indicator score with >= on the recording\'s own instrument (fico.<v3>|<v4>.score)', () => {
    const v3s = sig('I-GROUP-1');
    expect(v3s).toMatchObject({ signal_id: 'fico.C9|-.score', comparison: '>=', value: 3 });
    expect(L.evaluateCheckSignal(v3s, ficoFact(F.v3({ C9: 3 })), evalW)).toBe('hit');
    expect(L.evaluateCheckSignal(v3s, ficoFact(F.v3({ C9: 2 })), evalW)).toBe('miss');
    expect(L.evaluateCheckSignal(v3s, ficoFact(F.v4({})), evalW)).toBeNull();
    expect(L.evaluateCheckSignal(v3s, ip('executed'), evalW)).toBeNull();
    const v4s = sig('I-RC-1');
    expect(v4s.signal_id).toBe('fico.-|F9.score');
    expect(L.evaluateCheckSignal(v4s, ficoFact(F.v4({ F9: 2 })), evalW)).toBe('hit');
    expect(L.evaluateCheckSignal(v4s, ficoFact(F.v4({ F9: 1 })), evalW)).toBe('miss');
    expect(L.evaluateCheckSignal(v4s, ficoFact(F.v3({})), evalW)).toBeNull();
  });

  test('the detector field (detector.F8.stages_heard >= 3): read from the fact\'s detector result, null without one', () => {
    const s = sig('I-PHON-1');
    const f = ip('executed');
    expect(L.evaluateCheckSignal(s, f, evalW)).toBeNull();
    expect(L.evaluateCheckSignal(s, { ...f, detector: { stages_heard: [{ stage: 'a', at_s: 1 }, { stage: 'b', at_s: 2 }, { stage: 'c', at_s: 3 }] } }, evalW)).toBe('hit');
    expect(L.evaluateCheckSignal(s, { ...f, detector: { stages_heard: [{ stage: 'a', at_s: 1 }] } }, evalW)).toBe('miss');
  });

  test('every signal in the library is evaluable or null, never throws; uptake is never read', () => {
    const f = ip('executed');
    const guarded = new Proxy(f, { get(t, p, r) { if (p === 'uptake' || p === 'analysis_data') throw new Error(`read ${String(p)}`); return Reflect.get(t, p, r); } });
    for (const i of LIBRARY.interventions) {
      const out = L.evaluateCheckSignal(i.check_it_worked.signal, guarded, evalW);
      expect([null, 'hit', 'partial', 'miss']).toContain(out);
    }
  });
});

describe('checkStrips', () => {
  const K = 'a1b2c3d4e5f60718';
  const OTHER = '0f0e0d0c0b0a0908';
  const at = (d) => new Date(Date.UTC(2026, 9, 10) + d * 86400000).toISOString();
  const step = (id, extra = {}) => ({ id: uuid(9000 + id), status: 'open', i_id: 'I-IP-1', w_id: 'W-IP', set_at: at(0), teacher_key: K, ...extra });

  test('the next 3 graded recordings after set_at within 14 days; seq 1..3; a partial is progress', () => {
    const facts = [
      ip('not_done', { recorded_at: at(-1) }),
      ip('executed', { recorded_at: at(2) }),
      ip('not_done', { recorded_at: at(4) }),
      ip('partial', { recorded_at: at(6) }),
      ip('executed', { recorded_at: at(8) }),
    ];
    const { rows, summaries } = L.checkStrips({ openSteps: [step(1)], factsByTeacherKey: { [K]: facts }, interventions: LIBRARY.interventions, evalW, jobRunId: uuid(1) });
    expect(rows.map((r) => [r.seq, r.hit, r.session_id])).toEqual([
      [1, 'hit', facts[1].session_id], [2, 'miss', facts[2].session_id], [3, 'partial', facts[3].session_id]]);
    rows.forEach((r) => expect(Object.keys(r).sort()).toEqual(['hit', 'job_run_id', 'recorded_at', 'seq', 'session_id', 'step_id'].sort()));
    expect(rows[0]).toMatchObject({ step_id: uuid(9001), job_run_id: uuid(1), recorded_at: at(2) });
    expect(summaries).toEqual([{ step_id: uuid(9001), hits: 1, n: 3, worked: false, to_come: 0 }]);
  });

  test('2 of 3 = worked', () => {
    const facts = [ip('executed', { recorded_at: at(1) }), ip('not_done', { recorded_at: at(2) }), ip('executed', { recorded_at: at(3) })];
    const { summaries } = L.checkStrips({ openSteps: [step(2)], factsByTeacherKey: { [K]: facts }, interventions: LIBRARY.interventions, evalW, jobRunId: uuid(1) });
    expect(summaries[0]).toMatchObject({ hits: 2, n: 3, worked: true, to_come: 0 });
  });

  test('fewer than 3: to_come; worked can already show at 2 hits', () => {
    const one = L.checkStrips({ openSteps: [step(3)], factsByTeacherKey: { [K]: [ip('executed', { recorded_at: at(5) })] }, interventions: LIBRARY.interventions, evalW, jobRunId: uuid(1) });
    expect(one.summaries[0]).toEqual({ step_id: uuid(9003), hits: 1, n: 1, worked: false, to_come: 2 });
    const none = L.checkStrips({ openSteps: [step(4)], factsByTeacherKey: {}, interventions: LIBRARY.interventions, evalW, jobRunId: uuid(1) });
    expect(none.rows).toEqual([]);
    expect(none.summaries[0]).toEqual({ step_id: uuid(9004), hits: 0, n: 0, worked: false, to_come: 3 });
  });

  test('the 14-day cut and never before set_at; excluded and other teachers\' recordings never count', () => {
    const facts = [
      ip('executed', { recorded_at: at(0) }), // at set_at exactly: not after
      ip('executed', { recorded_at: at(15) }),
      { ...ip('executed', { recorded_at: at(3) }), is_unusable: true },
      { ...ip('executed', { recorded_at: at(3) }), is_duplicate: true },
      { ...ip('executed', { recorded_at: at(3) }), status: 'mismatch', is_mismatch: true },
      ip('executed', { recorded_at: at(14) }),
    ];
    const { rows } = L.checkStrips({ openSteps: [step(5)], factsByTeacherKey: { [K]: facts, [OTHER]: [ip('executed', { recorded_at: at(2) })] }, interventions: LIBRARY.interventions, evalW, jobRunId: uuid(1) });
    expect(rows.map((r) => r.session_id)).toEqual([facts[5].session_id]);
  });

  test('a recording its instrument cannot judge is skipped, not a miss; one row per session; closed steps are skipped', () => {
    const lp = ip('executed', { recorded_at: at(2) });
    const fico = ficoFact(F.v3({}), { recorded_at: at(1) });
    const twin = { ...ficoFact(F.v3({}), { recorded_at: at(2) }), session_id: lp.session_id };
    const { rows, summaries } = L.checkStrips({ openSteps: [step(6), step(7, { status: 'completed' })], factsByTeacherKey: { [K]: [fico, lp, twin] }, interventions: LIBRARY.interventions, evalW, jobRunId: uuid(1) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 1, hit: 'hit', session_id: lp.session_id });
    expect(summaries.map((s) => s.step_id)).toEqual([uuid(9006)]);
  });
});
