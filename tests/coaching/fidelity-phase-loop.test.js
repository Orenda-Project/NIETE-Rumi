/**
 * The fidelity half of Section B: when a plan resolved to graded moves, coach
 * the PHASE she repeatedly fails to execute, so she builds the muscle of
 * following her own plan. RED FIRST.
 *
 * Why a phase and not a move: move_id is per-plan and cannot carry; `phase` is
 * in the move schema and recurs in every plan.
 *
 * Why this is not the C1 treadmill: across 46 prod teachers with 3+ graded
 * lessons the worst phase is teacher-specific — warm_up 28%, hook 20%,
 * independent 11%, exit 11%, announce 9%, spread over nine phases. But 18 of
 * those 46 miss EVERY phase, and for them "the worst" is arbitrary, so they get
 * the CHEAPEST phase to adopt instead of the most-failed one.
 *
 * Uptake needs no model: the next lesson's own move verdicts decide it.
 */
const fs = require('fs');
const path = require('path');
const loop = require('../../bot/shared/services/coaching/uptake-loop.service');
const { choosePhaseTarget, derivePhaseUptake, targetApplicable, PHASE_ADOPTION_COST } = loop;

const mv = (phase, verdict, { counted = true, bucket = 'must_happen' } = {}) => ({ phase, verdict, counted, bucket });
const plan = (moves) => ({ status: 'ok', fidelity_pct: 40, moves });
const hist = (...plans) => plans.map((p) => ({ lp_fidelity: p }));

describe('choosePhaseTarget', () => {
  test('a phase must be prescribed in at least two of her lessons to be a pattern', () => {
    const once = hist(plan([mv('exit', 'not_done'), mv('explain', 'executed')]),
                      plan([mv('explain', 'executed')]),
                      plan([mv('explain', 'executed')]));
    expect(choosePhaseTarget(once)).toBeNull();
  });

  test('she does some phases well and fails one → the repeated miss with the most prescriptions', () => {
    const h = hist(
      plan([mv('explain', 'executed'), mv('exit', 'not_done'), mv('hook', 'not_done')]),
      plan([mv('explain', 'executed'), mv('exit', 'not_done'), mv('hook', 'executed')]),
      plan([mv('explain', 'executed'), mv('exit', 'not_done')]),
    );
    const t = choosePhaseTarget(h);
    expect(t).toMatchObject({ kind: 'phase', phase: 'exit' });
    expect(t.name).toMatch(/./);
  });

  test('she misses EVERYTHING → the cheapest phase to adopt, not the most-failed', () => {
    const h = hist(
      plan([mv('independent', 'not_done'), mv('announce', 'not_done'), mv('guided', 'not_done')]),
      plan([mv('independent', 'not_done'), mv('announce', 'not_done'), mv('guided', 'not_done')]),
      plan([mv('independent', 'not_done'), mv('announce', 'not_done'), mv('guided', 'not_done')]),
    );
    expect(choosePhaseTarget(h).phase).toBe('announce');
    expect(PHASE_ADOPTION_COST.indexOf('announce')).toBeLessThan(PHASE_ADOPTION_COST.indexOf('independent'));
  });

  test('a phase she reliably executes is never chosen', () => {
    const h = hist(
      plan([mv('exit', 'executed'), mv('hook', 'not_done')]),
      plan([mv('exit', 'executed'), mv('hook', 'not_done')]),
      plan([mv('exit', 'substituted_better'), mv('hook', 'partial')]),
    );
    expect(choosePhaseTarget(h).phase).toBe('hook');
  });

  test('uncounted and not_adjudicable moves never create or condemn a phase', () => {
    const h = hist(
      plan([mv('exit', 'not_adjudicable'), mv('hook', 'not_done', { counted: false }), mv('explain', 'not_done')]),
      plan([mv('exit', 'not_adjudicable'), mv('hook', 'not_done', { counted: false }), mv('explain', 'not_done')]),
    );
    const t = choosePhaseTarget(h);
    expect(t.phase).toBe('explain');
  });

  test('no graded history at all → null', () => {
    expect(choosePhaseTarget([])).toBeNull();
    expect(choosePhaseTarget(null)).toBeNull();
    expect(choosePhaseTarget(hist({ status: 'lp_absent' }, { status: 'lp_absent' }))).toBeNull();
  });

  test('over the REAL graded plans: every pick is a phase she was actually prescribed and actually missed', () => {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'fico-graded-plans.json'), 'utf8')).plans;
    const byTeacher = {};
    for (const p of fx) (byTeacher[p.teacher] = byTeacher[p.teacher] || []).push(p);
    const picks = {};
    let considered = 0;
    for (const plans of Object.values(byTeacher)) {
      const h = plans.slice(-5).map((p) => ({ lp_fidelity: { status: 'ok', moves: p.moves } }));
      const t = choosePhaseTarget(h);
      if (!t) continue;
      considered += 1;
      picks[t.phase] = (picks[t.phase] || 0) + 1;
      const counted = h.flatMap((s) => s.lp_fidelity.moves).filter((m) => m.phase === t.phase && m.counted);
      expect(counted.length).toBeGreaterThanOrEqual(2);                       // a real pattern
      expect(counted.some((m) => m.verdict !== 'executed')).toBe(true);       // actually missed
    }
    expect(considered).toBeGreaterThan(5);
    const top = Math.max(...Object.values(picks)) / considered;
    // eslint-disable-next-line no-console
    console.log(`[phase-loop] ${considered} teachers, picks:`, picks, `top share ${(100 * top).toFixed(0)}%`);
    expect(Object.keys(picks).length).toBeGreaterThan(1);                     // not one answer for everyone
  });
});

describe('derivePhaseUptake — graded from the next lesson\'s own verdicts, no model', () => {
  test('every counted move in the phase executed → achieved', () => {
    expect(derivePhaseUptake(plan([mv('exit', 'executed'), mv('exit', 'substituted_equivalent'), mv('hook', 'not_done')]), 'exit')).toBe('achieved');
  });
  test('some done, some not → partial', () => {
    expect(derivePhaseUptake(plan([mv('exit', 'executed'), mv('exit', 'not_done')]), 'exit')).toBe('partial');
    expect(derivePhaseUptake(plan([mv('exit', 'partial')]), 'exit')).toBe('partial');
  });
  test('none done → not_seen', () => {
    expect(derivePhaseUptake(plan([mv('exit', 'not_done'), mv('exit', 'not_done')]), 'exit')).toBe('not_seen');
  });
  test('the phase is not in this plan, or she brought no plan → not_applicable (bridge)', () => {
    expect(derivePhaseUptake(plan([mv('hook', 'executed')]), 'exit')).toBe('not_applicable');
    expect(derivePhaseUptake({ status: 'lp_absent' }, 'exit')).toBe('not_applicable');
    expect(derivePhaseUptake(null, 'exit')).toBe('not_applicable');
  });
  test('only not_adjudicable moves for the phase → unknown, never a punishment', () => {
    expect(derivePhaseUptake(plan([mv('exit', 'not_adjudicable')]), 'exit')).toBe('unknown');
  });
});

describe('a phase target inside the existing loop', () => {
  const phaseTarget = { kind: 'phase', phase: 'exit', name: 'Closing check' };
  const prior = {
    target: phaseTarget, action: 'do the closing check your plan asks for',
    action_spec: { count_target: { phase_moves_executed: 1 } },
    attempt: 2, angle: 'cue', achieved_streak: 0, target_status: 'open', session_id: 'p1',
  };
  const withFidelity = (p) => ({ framework: 'fico', domains: { high_leverage_practices: { indicators: [{ id: 'C4', name: 'C4', score: 1, applicable: true }] } }, lp_fidelity: p });

  test('deriveUptakeStatus dispatches on the target kind', () => {
    expect(loop.deriveUptakeStatus(null, prior, withFidelity(plan([mv('exit', 'executed')])))).toBe('achieved');
    expect(loop.deriveUptakeStatus(null, prior, withFidelity(plan([mv('exit', 'not_done')])))).toBe('not_seen');
  });

  test('she brings no plan → not_applicable → the bridge freezes the attempt', () => {
    const a = withFidelity({ status: 'lp_absent' });
    const status = loop.deriveUptakeStatus(null, prior, a);
    expect(status).toBe('not_applicable');
    const next = loop.nextTarget(prior, status, a);
    expect(next.bridge).toBe(true);
    expect(next.attempt).toBe(2);
    expect(next.target).toEqual(phaseTarget);
  });

  test('the ladder advances on a miss, and two consecutive achieved close it', () => {
    const a = withFidelity(plan([mv('exit', 'not_done')]));
    expect(loop.nextTarget(prior, 'not_seen', a)).toMatchObject({ attempt: 3, angle: 'show' });
    const streaked = { ...prior, achieved_streak: 1 };
    const closed = loop.nextTarget(streaked, 'achieved', withFidelity(plan([mv('exit', 'executed')])));
    expect(closed.closed).toEqual(phaseTarget);
  });

  test('targetApplicable knows both kinds', () => {
    expect(targetApplicable(withFidelity(plan([mv('exit', 'executed')])), phaseTarget)).toBe(true);
    expect(targetApplicable(withFidelity(plan([mv('hook', 'executed')])), phaseTarget)).toBe(false);
    expect(targetApplicable(withFidelity(plan([])), { indicator: 'C4' })).toBe(true);
  });

  test('buildRecord round-trips a phase target', () => {
    const a = withFidelity(plan([mv('exit', 'not_done')]));
    const rec = loop.buildRecord(loop.nextTarget(prior, 'not_seen', a), {
      prior, analysis: a, card: { action: 'next class, do the closing check' }, instrument: 'self', uptakeStatus: 'not_seen',
    });
    expect(rec.target).toEqual(phaseTarget);
    expect(rec.attempt).toBe(3);
    expect(rec.uptake.status).toBe('not_seen');
    expect(rec.action_spec.count_target).toBeTruthy();
  });
});
