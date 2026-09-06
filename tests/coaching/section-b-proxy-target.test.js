/**
 * Section B is computed two ways, and only one of them can be coached.
 *
 * DERIVED (a lesson plan resolved to graded moves): applyLpFidelity overwrites
 * domains.lesson_plan_fidelity.domain_score from executed÷prescribed and stamps
 * fidelity_derived, but never touches indicators[]. Those seven scores then
 * drive nothing and are not shown to the teacher — improving B4 would move her
 * score by exactly zero.
 *
 * PROXY (no moves resolved — 45% of 581 prod sessions): computeScores sums the
 * seven generic B indicators and they ARE the section. They are stable teacher
 * behaviours and they map onto the plan phases the fidelity grader scores
 * (B1→announce, B4→recall, B5→hook, B6→grouping, B7→exit), so the habit built
 * here is the one that raises fidelity later.
 *
 * RED FIRST: today isLoopSection excludes all of B, so the proxy half is lost.
 * Staging session cb4c9cf0 was proxy with B1 at 0 and the scorer's own
 * lesson-rooted objective ask was discarded by that blanket exclusion.
 */
const loop = require('../../bot/shared/services/coaching/uptake-loop.service');
const { chooseTarget, applicableToday, countBarFor, isLoopTarget, sectionBIsProxy } = loop;

const ok = (id, score) => ({ id, name: id, score, applicable: true });
function analysis({ derived = false, b1 = 0, b6 = 1, c4 = 1, d2 = 2, focus = null } = {}) {
  const a = {
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { domain_score: 9, domain_max: 14, indicators: [ok('B1', b1), ok('B2', 2), ok('B3', 1), ok('B4', 1), ok('B5', 2), ok('B6', b6), ok('B7', 2)] },
      high_leverage_practices: { indicators: [ok('C1', 2), ok('C4', c4)] },
      student_engagement: { indicators: [ok('D2', d2)] },
      teacher_subject_knowledge: { indicators: [ok('F1', 2)] },
    },
  };
  if (derived) { a.domains.lesson_plan_fidelity.fidelity_derived = true; a.domains.lesson_plan_fidelity.fidelity_pct = 39; }
  if (focus) a.focus_area = { domain: 'lesson_plan_fidelity', indicator: focus, try_this_tomorrow: 'state a measurable objective and check it at the end' };
  return a;
}

describe('mode detection', () => {
  test('proxy when the flag is absent, derived when it is true', () => {
    expect(sectionBIsProxy(analysis())).toBe(true);
    expect(sectionBIsProxy(analysis({ derived: true }))).toBe(false);
    expect(sectionBIsProxy({ framework: 'fico', domains: {} })).toBe(true); // no section at all → nothing derived
  });
});

describe('isLoopTarget — B is eligible only in proxy mode', () => {
  const proxy = analysis(); const derived = analysis({ derived: true });
  test('C, D and F are always eligible in both modes', () => {
    for (const id of ['C1', 'C4', 'D2', 'F1']) {
      expect(isLoopTarget(proxy, id)).toBe(true);
      expect(isLoopTarget(derived, id)).toBe(true);
    }
  });
  test('B is eligible in proxy mode and never in derived mode', () => {
    for (const id of ['B1', 'B2', 'B4', 'B5', 'B6', 'B7']) {
      expect(isLoopTarget(proxy, id)).toBe(true);
      expect(isLoopTarget(derived, id)).toBe(false);
    }
  });
  test('B3 is never eligible — its rung-2 bar is a universal, not a count', () => {
    expect(isLoopTarget(proxy, 'B3')).toBe(false);
    expect(countBarFor('B3')).toBeNull();
  });
});

describe('COUNT bars for the six eligible B indicators', () => {
  test('each carries the rubric\'s own countable unit, every threshold >= 1', () => {
    const bars = { B1: 'objective', B2: 'transition', B4: 'prior', B5: 'connection', B6: 'task', B7: 'closure' };
    for (const [id, hint] of Object.entries(bars)) {
      const bar = countBarFor(id);
      expect(bar).toBeTruthy();
      expect(Object.keys(bar).length).toBeGreaterThan(0);
      for (const v of Object.values(bar)) expect(v).toBeGreaterThanOrEqual(1);
      expect(Object.keys(bar).join(' ')).toContain(hint);
    }
  });
  test('B1 needs the objective stated AND referred back; B2 and B4 and B6 need two', () => {
    expect(Object.keys(countBarFor('B1')).length).toBe(2);
    expect(Object.values(countBarFor('B2'))[0]).toBe(2);
    expect(Object.values(countBarFor('B4'))[0]).toBe(2);
    expect(Object.values(countBarFor('B6'))[0]).toBe(2);
  });
});

describe('chooseTarget', () => {
  test('proxy: the scorer\'s B focus_area is honoured (this is the staging case we lost)', () => {
    const t = chooseTarget(analysis({ b1: 0, focus: 'B1' }), null);
    expect(t.indicator).toBe('B1');
  });
  test('proxy: with no focus_area the lowest applicable rung wins even when it is a B row', () => {
    const t = chooseTarget(analysis({ b1: 0, c4: 2, d2: 2, b6: 2 }), null);
    expect(t.indicator).toBe('B1');
  });
  test('derived: the same B focus_area is skipped, and a C/D/F target is chosen instead', () => {
    const t = chooseTarget(analysis({ derived: true, b1: 0, c4: 1, focus: 'B1' }), null);
    expect(t.indicator).toBe('C4');
    expect(t.indicator[0]).not.toBe('B');
  });
  test('derived with every C/D/F at the top → no target rather than a meaningless B one', () => {
    expect(chooseTarget(analysis({ derived: true, b1: 0, c4: 2, d2: 2 }), null)).toBeNull();
  });
});

describe('a B target when the mode flips', () => {
  const prior = {
    target: { indicator: 'B1', domain: 'lesson_plan_fidelity', name: 'Instructional Clarity & Learning Objectives' },
    action: 'state the objective and check it at the end',
    action_spec: { count_target: countBarFor('B1') },
    baseline: { rung: 0, count: null }, attempt: 1, angle: 'tell', achieved_streak: 0, target_status: 'open', session_id: 'p1',
  };
  test('still proxy next lesson → the target is applicable and sticky', () => {
    const a = analysis({ b1: 1 });
    expect(applicableToday(a, 'B1')).toBe(true);
    expect(chooseTarget(a, prior).indicator).toBe('B1');
    expect(chooseTarget(a, prior).carried).toBe(true);
  });
  test('she attaches a plan → B is derived → not applicable, and the loop bridges', () => {
    const a = analysis({ derived: true, b1: 1 });
    expect(applicableToday(a, 'B1')).toBe(false);
    const status = loop.deriveUptakeStatus({ count: {} }, prior, a);
    expect(status).toBe('not_applicable');
    const next = loop.nextTarget(prior, status, a);
    expect(next.bridge).toBe(true);
    expect(next.attempt).toBe(1);                       // frozen
    expect(next.target.indicator).toBe('B1');           // kept
  });
  test('a C/D/F target is unaffected by the mode flip', () => {
    const cPrior = { ...prior, target: { indicator: 'C4', domain: 'high_leverage_practices', name: 'Student Agency & Voice' }, action_spec: { count_target: countBarFor('C4') } };
    expect(applicableToday(analysis({ derived: true }), 'C4')).toBe(true);
    expect(loop.deriveUptakeStatus({ count: { student_choice_or_unprompted_reasoning: 1 } }, cPrior, analysis({ derived: true }))).toBe('achieved');
  });
});

describe('a tie at the lowest rung breaks AWAY from Section B', () => {
  // B6 (differentiation) sits at the floor for nearly everyone: on the real
  // staging fixture it TIED with the lowest C/D/F in 16 of 21 sessions and won
  // outright only 4 times, yet it took 62% of all targets purely because B
  // sorts first. That is the C1 treadmill re-forming on the B side. The
  // tie-break is not cosmetic: a B target is only measurable while Section B is
  // the proxy, so it bridges the moment she attaches a plan, while C/D/F are
  // measured either way. On equal evidence, carry the durable one.
  test('B and C/D/F tied at 0 → the C/D/F row wins', () => {
    const t = chooseTarget(analysis({ b1: 0, b6: 0, c4: 0, d2: 2 }), null);
    expect(t.indicator).toBe('C4');
  });
  test('B strictly below every C/D/F → the B row still wins', () => {
    const t = chooseTarget(analysis({ b1: 0, b6: 1, c4: 1, d2: 2 }), null);
    expect(t.indicator).toBe('B1');
  });
  test('a TIED Section B focus_area does not override the tie-break', () => {
    const t = chooseTarget(analysis({ b1: 0, b6: 2, c4: 0, d2: 2, focus: 'B1' }), null);
    expect(t.indicator).toBe('C4');
  });
  test('a STRICTLY lowest Section B focus_area is honoured', () => {
    const t = chooseTarget(analysis({ b1: 0, b6: 2, c4: 1, d2: 2, focus: 'B1' }), null);
    expect(t.indicator).toBe('B1');
  });
  test('a C/D/F focus_area is unaffected — it still wins its tie', () => {
    const a = analysis({ b1: 0, b6: 2, c4: 0, d2: 0 });
    a.focus_area = { domain: 'student_engagement', indicator: 'D2', try_this_tomorrow: 'x' };
    expect(chooseTarget(a, null).indicator).toBe('D2');
  });
});

describe('prefer C/D/F when her recent lessons are consistently derived', () => {
  test('three recent derived lessons → a B row is not chosen even in a proxy lesson', () => {
    const t = chooseTarget(analysis({ b1: 0, c4: 1, focus: 'B1' }), null, { recentModes: ['derived', 'derived', 'derived'] });
    expect(t.indicator).toBe('C4');
  });
  test('mixed history → B stays eligible', () => {
    const t = chooseTarget(analysis({ b1: 0, c4: 1, focus: 'B1' }), null, { recentModes: ['derived', 'proxy', 'proxy'] });
    expect(t.indicator).toBe('B1');
  });
  test('no history → B stays eligible (nothing to infer from)', () => {
    expect(chooseTarget(analysis({ b1: 0, c4: 1, focus: 'B1' }), null, {}).indicator).toBe('B1');
  });
  test('an already-open B target is still carried even on a derived-heavy history', () => {
    const p = { target: { indicator: 'B1', domain: 'lesson_plan_fidelity', name: 'B1' }, target_status: 'open', attempt: 2, angle: 'cue' };
    const t = chooseTarget(analysis({ b1: 1 }), p, { recentModes: ['derived', 'derived', 'derived'] });
    expect(t.indicator).toBe('B1');
  });
});
