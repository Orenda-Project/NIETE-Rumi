'use strict';
/** NIGHTLY_JOB §4 stage 3; DESIGN §5 (the M rule): coachip_session_steps and coachip_moments rows. Fictional fixtures. */
const F = require('./fixtures/analysis');
const { lpFact, ficoFact, signal } = require('./fixtures/moments');
const M = require('../../lib/insights/moments');

const MOMENT_COLS = ['fact_id', 'session_id', 'w_id', 'kind', 'move_id', 'phase', 'from_s', 'to_s', 'moment_s', 'confidence',
  'credit', 'gloss_en', 'gloss_ur', 'gloss_status', 'gloss_model_run_id', 'clip_r2_key', 'clip_status'].sort();
const STEP_COLS = ['fact_id', 'ordinal', 'move_id', 'phase', 'verdict', 'is_counted', 'from_s', 'to_s'].sort();

// The DB CHECKs on coachip_moments, asserted on every row a test sees.
function assertMomentChecks(r) {
  expect(Object.keys(r).sort()).toEqual(MOMENT_COLS);
  expect(r.from_s).toBeGreaterThanOrEqual(0);
  expect(r.to_s).toBeGreaterThan(r.from_s);
  expect(r.to_s - r.from_s).toBeLessThanOrEqual(90);
  if (r.move_id != null) expect(r.move_id).toMatch(/^m[0-9]{1,2}$/);
  if (r.phase != null) expect(r.phase).toMatch(/^[a-z_]+$/);
  if (r.confidence === 'none') expect(['not_applicable', 'not_evaluated']).toContain(r.gloss_status);
  expect(r.gloss_status === 'ok').toBe(r.gloss_en != null && r.gloss_ur != null);
}

describe('buildMoments: the M rule per kind', () => {
  const moves = [
    F.move('m1', 'warm_up', 'executed', { at: '01:00' }),
    F.move('m2', 'explain', 'executed', { at: '03:00', credit: 0.8 }),
    F.move('m6', 'explain', 'executed', { at: '05:00', credit: 1 }),
    F.move('m3', 'guided', 'partial', { at: '08:00' }),
    F.move('m4', 'independent', 'not_done'),
    F.move('m5', 'exit', 'not_done'),
  ];

  test('a skipped move: from last_done_s, medium, to the recording end capped at 90 s', () => {
    const fact = lpFact(moves);
    const rows = M.buildMoments(fact, [signal(fact, 'W-IP', true)]);
    const r = rows.find((x) => x.w_id === 'W-IP' && x.kind === 'missing');
    assertMomentChecks(r);
    expect(r).toMatchObject({ from_s: 480, to_s: 570, moment_s: 480, confidence: 'medium', move_id: 'm4', phase: 'independent',
      gloss_status: 'pending', clip_status: 'pending', fact_id: fact.id, session_id: fact.session_id });
  });

  test('a skipped move ends at the next stamp when it comes before the cap', () => {
    const fact = lpFact([
      F.move('m1', 'guided', 'executed', { at: '10:00' }),
      F.move('m2', 'independent', 'not_done'),
      F.move('m3', 'homework', 'not_done', { at: '10:40' }),
    ]);
    const r = M.buildMoments(fact, [signal(fact, 'W-IP', true)]).find((x) => x.kind === 'missing');
    assertMomentChecks(r);
    expect([r.from_s, r.to_s]).toEqual([600, 640]);
  });

  test('a skipped move starts at the last done move BEFORE it in plan order, not the lesson\'s last done move', () => {
    const fact = lpFact([
      F.move('m1', 'explain', 'executed', { at: '02:00' }),
      F.move('m2', 'recall', 'not_done'),
      F.move('m3', 'guided', 'executed', { at: '12:00' }),
      F.move('m4', 'exit', 'executed', { at: '15:00' }),
    ]);
    expect(fact.last_done_s).toBe(900);
    const r = M.buildMoments(fact, [signal(fact, 'W-WARM', true)])[0];
    assertMomentChecks(r);
    expect(r).toMatchObject({ w_id: 'W-WARM', move_id: 'm2', phase: 'recall', from_s: 120, to_s: 210, moment_s: 120, confidence: 'medium' });
  });

  test('W-WARM at the start of the lesson: nothing done before it, so from 0', () => {
    const fact = lpFact([
      F.move('m1', 'warm_up', 'not_done'),
      F.move('m2', 'hook', 'not_done'),
      F.move('m3', 'explain', 'executed', { at: '01:00' }),
    ]);
    const r = M.buildMoments(fact, [signal(fact, 'W-WARM', true)])[0];
    assertMomentChecks(r);
    expect(r).toMatchObject({ move_id: 'm1', phase: 'warm_up', from_s: 0, to_s: 60, moment_s: 0, confidence: 'medium' });
  });

  test('a partial move (W-IP-PARTIAL): its own stamp, high; minutes above 59 parse', () => {
    const fact = lpFact([
      F.move('m1', 'explain', 'executed', { at: '70:00' }),
      F.move('m2', 'independent', 'partial', { at: '75:05', credit: 0.5 }),
      F.move('m3', 'exit', 'executed', { at: '76:00' }),
    ], { audio_s: 5000, ends_at: '83:00', last_stamp_s: 4560 });
    const r = M.buildMoments(fact, [signal(fact, 'W-IP-PARTIAL', true)]).find((x) => x.kind === 'missing');
    assertMomentChecks(r);
    expect(r).toMatchObject({ from_s: 4505, to_s: 4560, moment_s: 4505, confidence: 'high', move_id: 'm2', credit: 0.5 });
  });

  test('a long gap is capped at from + 90 s', () => {
    const fact = lpFact([
      F.move('m1', 'independent', 'partial', { at: '62:00' }),
    ], { audio_s: 5000, ends_at: '80:00', last_stamp_s: 3720 });
    const r = M.buildMoments(fact, [signal(fact, 'W-IP-PARTIAL', true)])[0];
    assertMomentChecks(r);
    expect([r.from_s, r.to_s]).toEqual([3720, 3810]);
  });

  test('a FICO W: indicator timestamp − 15 s for 45 s, high, gloss not_evaluated (O9)', () => {
    const fact = ficoFact(F.v3({ C1: 2 }));
    const r = M.buildMoments(fact, [signal(fact, 'W-Q', true, { source: 'fico_v3', value: 2 })])[0];
    assertMomentChecks(r);
    expect(r).toMatchObject({ w_id: 'W-Q', kind: 'missing', from_s: 295, to_s: 340, moment_s: 310, confidence: 'high',
      gloss_status: 'not_evaluated', move_id: null, phase: null });
  });

  test('a FICO W near the start never goes below 0', () => {
    const ad = F.v3({ C3: 1 });
    ad.domains.high_leverage_practices.indicators.find((i) => i.id === 'C3').timestamp = '00:05';
    const fact = ficoFact(ad);
    const r = M.buildMoments(fact, [signal(fact, 'W-FB', true, { source: 'fico_v3' })])[0];
    assertMomentChecks(r);
    expect([r.from_s, r.to_s, r.moment_s]).toEqual([0, 45, 5]);
  });

  test('no stamp: confidence none, from 0 to min(90, audio_s), gloss not_applicable', () => {
    const fact = lpFact([F.move('m1', 'explain', 'executed'), F.move('m2', 'independent', 'not_done')],
      { no_timestamps: true, audio_s: 60, ends_at: '01:00', last_stamp_s: 0 });
    const r = M.buildMoments(fact, [signal(fact, 'W-IP', true)]).find((x) => x.kind === 'missing');
    assertMomentChecks(r);
    expect(r).toMatchObject({ confidence: 'none', from_s: 0, to_s: 60, moment_s: null, gloss_status: 'not_applicable' });
    const long = lpFact([F.move('m1', 'independent', 'not_done')], { no_timestamps: true, audio_s: 1800 });
    const r2 = M.buildMoments(long, [signal(long, 'W-IP', true)])[0];
    expect([r2.from_s, r2.to_s, r2.confidence]).toEqual([0, 90, 'none']);
  });

  test('a FICO W with no timestamp is confidence none too', () => {
    const ad = F.v3({ C1: 1 });
    ad.domains.high_leverage_practices.indicators.find((i) => i.id === 'C1').timestamp = null;
    const fact = ficoFact(ad, { audio_s: 40 });
    const r = M.buildMoments(fact, [signal(fact, 'W-Q', true, { source: 'fico_v3' })])[0];
    assertMomentChecks(r);
    expect(r).toMatchObject({ confidence: 'none', from_s: 0, to_s: 40 });
  });

  test('a good moment per (fact, W) on the W\'s phase: the executed move with the highest credit', () => {
    const fact = lpFact(moves);
    const rows = M.buildMoments(fact, [signal(fact, 'W-EXPLAIN', false)]);
    const g = rows.filter((x) => x.kind === 'good');
    expect(g).toHaveLength(1);
    assertMomentChecks(g[0]);
    expect(g[0]).toMatchObject({ w_id: 'W-EXPLAIN', move_id: 'm6', phase: 'explain', from_s: 300, to_s: 390, moment_s: 300,
      confidence: 'high', credit: 1, gloss_status: 'pending' });
    expect(rows.filter((x) => x.kind === 'missing')).toHaveLength(0);
  });

  test('no missing moment for a W that did not fire, none outside the denominator, one per (fact, W, kind)', () => {
    const fact = lpFact(moves);
    const rows = M.buildMoments(fact, [
      signal(fact, 'W-IP', true), signal(fact, 'W-IP', true), signal(fact, 'W-PEER', false, { in_denominator: false }),
      signal(fact, 'W-EXIT', true),
    ]);
    const keys = rows.map((r) => `${r.w_id}|${r.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === 'W-IP|missing')).toHaveLength(1);
    expect(keys.some((k) => k.startsWith('W-PEER'))).toBe(false);
    rows.forEach(assertMomentChecks);
  });

  test('a move id outside ^m\\d{1,2}$ is stored as null; signals of another fact are ignored', () => {
    const fact = lpFact([F.move('m1', 'guided', 'executed', { at: '02:00' }), F.move('step-9', 'independent', 'not_done')]);
    const other = lpFact([F.move('m1', 'exit', 'not_done')]);
    const rows = M.buildMoments(fact, [signal(fact, 'W-IP', true), signal(other, 'W-EXIT', true)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].move_id).toBeNull();
  });
});

describe('phonics moments (W-PHON, W-PHON-NAMES)', () => {
  const det = (stages, extra = {}) => ({ score: 1, stages_heard: stages, letter_name_routine_only: false, read_alone_s: 0, ...extra });
  const phon = (detector, audio_s = 1200) => ({ ...lpFact([F.move('m1', 'explain', 'executed', { at: '01:00' })], { audio_s }), detector });
  const src = { source: 'coachip_detector' };

  test('W-PHON: from the first grounded stage for 45 s, high, gloss not_evaluated', () => {
    const fact = phon(det([{ stage: 'hijje', at_s: 500 }, { stage: 'syllables', at_s: 300 }]));
    const rows = M.buildMoments(fact, [signal(fact, 'W-PHON', true, src)]);
    expect(rows).toHaveLength(1);
    assertMomentChecks(rows[0]);
    expect(rows[0]).toMatchObject({ w_id: 'W-PHON', kind: 'phonics', from_s: 300, to_s: 345, moment_s: 300, confidence: 'high',
      gloss_status: 'not_evaluated', move_id: null, phase: null });
  });

  test('W-PHON-NAMES: the first stage flagged as letter-name / hijje, capped by audio_s; else the first stage', () => {
    const fact = phon(det([{ stage: 'syllables', at_s: 300 }, { stage: 'hijje', at_s: 500 }], { letter_name_routine_only: true }), 520);
    const r = M.buildMoments(fact, [signal(fact, 'W-PHON-NAMES', true, src)])[0];
    assertMomentChecks(r);
    expect(r).toMatchObject({ kind: 'phonics', from_s: 500, to_s: 520, confidence: 'high' });
    const plain = phon(det([{ stage: 'syllables', at_s: 300 }]));
    expect(M.buildMoments(plain, [signal(plain, 'W-PHON-NAMES', true, src)])[0]).toMatchObject({ from_s: 300, to_s: 345 });
  });

  test('no detector result: no moment, and the skip is counted for the job log', () => {
    const fact = phon(undefined);
    const sigs = [signal(fact, 'W-PHON', true, src), signal(fact, 'W-PHON-NAMES', true, src)];
    expect(M.buildMoments(fact, sigs)).toEqual([]);
    expect(M.buildMomentsWithStats(fact, sigs)).toEqual({ rows: [], skippedNoDetector: 2 });
  });

  test('a detector hit with no grounded stage: confidence none over the opening of the recording', () => {
    const fact = phon(det([], { score: 0 }));
    const r = M.buildMoments(fact, [signal(fact, 'W-PHON', true, src)])[0];
    assertMomentChecks(r);
    expect(r).toMatchObject({ kind: 'phonics', confidence: 'none', from_s: 0, to_s: 90, gloss_status: 'not_applicable' });
  });

  test('egra (child-result) Ws never get a moment', () => {
    const fact = phon(det([{ stage: 'syllables', at_s: 300 }]));
    expect(M.buildMoments(fact, ['W-LN', 'W-LS', 'W-ORF', 'W-NUM'].map((w) => signal(fact, w, true, { source: 'egra' })))).toEqual([]);
  });
});

describe('buildSessionSteps: the S4 chapter strip', () => {
  test('one row per move in plan order; substituted collapsed; not_reached after the last done move when time ran out', () => {
    const fact = lpFact([
      F.move('m1', 'explain', 'executed', { at: '02:00' }),
      F.move('m2', 'guided', 'substituted_better', { at: '06:00' }),
      F.move('m3', 'independent', 'not_done'),
      F.move('m4', 'exit', 'not_done'),
      F.move('m5', 'recall', 'not_adjudicable', { counted: false }),
    ], { short: true });
    expect(fact.is_ran_out_of_time).toBe(true);
    const rows = M.buildSessionSteps(fact);
    rows.forEach((r) => expect(Object.keys(r).sort()).toEqual(STEP_COLS));
    expect(rows.map((r) => [r.ordinal, r.move_id, r.verdict, r.is_counted, r.from_s, r.to_s])).toEqual([
      [1, 'm1', 'executed', true, 120, 360],
      [2, 'm2', 'substituted', true, 360, 1200],
      [3, 'm3', 'not_reached', true, null, null],
      [4, 'm4', 'not_reached', true, null, null],
      [5, 'm5', 'not_adjudicable', false, null, null],
    ]);
  });

  test('a not_done move stays not_done when the lesson did not run out of time; a partial stays partial', () => {
    const fact = lpFact([
      F.move('m1', 'explain', 'partial', { at: '02:00' }),
      F.move('m2', 'independent', 'not_done'),
      F.move('m3', 'exit', 'not_done'),
    ], { last_stamp_s: 600 });
    expect(fact.is_ran_out_of_time).toBe(false);
    expect(M.buildSessionSteps(fact).map((r) => r.verdict)).toEqual(['partial', 'not_done', 'not_done']);
  });

  test('to_s is the next stamp, else ends_at, always above from_s', () => {
    const fact = lpFact([
      F.move('m1', 'explain', 'executed', { at: '19:59' }),
      F.move('m2', 'guided', 'executed', { at: '03:00' }),
    ]);
    const rows = M.buildSessionSteps(fact);
    expect(rows[0]).toMatchObject({ from_s: 1199, to_s: 1200 });
    expect(rows[1]).toMatchObject({ from_s: 180, to_s: 1199 });
    rows.forEach((r) => { if (r.from_s != null) expect(r.to_s).toBeGreaterThan(r.from_s); });
  });

  test('carries no text and no quote', () => {
    const fact = lpFact([F.move('m1', 'explain', 'executed', { at: '02:00' })]);
    const s = JSON.stringify(M.buildSessionSteps(fact));
    expect(s).not.toMatch(/placeholder|Plan step/);
  });

  test('a fact with no lp moves gives no rows', () => {
    expect(M.buildSessionSteps(ficoFact(F.v3({})))).toEqual([]);
  });
});
