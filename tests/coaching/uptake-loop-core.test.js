/**
 * The feedback-uptake loop, pure core. RED FIRST — the module does not exist.
 *
 * Decisions (operator, 3 Sep): uptake is never a mark; a target closes after
 * TWO consecutive achieved lessons; after FOUR attempts the teacher is handed
 * to a coach; targets come from sections C/D/F only (B is measured per plan by
 * the fidelity engine and changes every lesson); the verdict is computed in
 * code from the model's tally, never read from the model.
 */
const fs = require('fs');
const path = require('path');

const loop = require('../../bot/shared/services/coaching/uptake-loop.service');
const { chooseTarget, nextTarget, tooSimilar, applicableToday, deriveUptakeStatus, buildRecord, countBarFor, LADDER, MAX_ATTEMPTS, CLOSE_AFTER } = loop;

const ok = (id, score) => ({ id, name: id, score, applicable: true });
const na = (id) => ({ id, name: id, score: null, applicable: false });
function analysis({ c1 = 1, c3 = 1, d2 = 1, f4 = 'na', b4 = 0, focus = 'C3' } = {}) {
  return {
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: [ok('B1', 2), ok('B4', b4)] },
      high_leverage_practices: { indicators: [ok('C1', c1), ok('C2', 2), ok('C3', c3), ok('C4', 2)] },
      student_engagement: { indicators: [ok('D1', 2), ok('D2', d2)] },
      teacher_subject_knowledge: { indicators: [ok('F1', 2), f4 === 'na' ? na('F4') : ok('F4', f4)] },
    },
    focus_area: focus ? { domain: 'high_leverage_practices', indicator: focus, try_this_tomorrow: 'try this' } : undefined,
  };
}
const openPrior = (over = {}) => ({
  target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' },
  action: 'After every wrong answer, say one sentence that names the next step.',
  action_spec: { count_target: { specific_feedback_moves: 3, next_step_feedback: 1 } },
  attempt: 1, angle: 'tell', achieved_streak: 0, target_status: 'open',
  baseline: { rung: 1, count: { specific_feedback_moves: 1, next_step_feedback: 0 } },
  lineage: [], session_id: 'prior-1', created_at: '2026-09-01T08:00:00Z', instrument: 'self',
  ...over,
});

describe('constants', () => {
  test('the ladder, the caps', () => {
    expect(LADDER).toEqual(['tell', 'cue', 'show', 'shrink', 'hand_over']);
    expect(MAX_ATTEMPTS).toBe(4);
    expect(CLOSE_AFTER).toBe(2);
  });
  test('every C/D/F indicator has a COUNT bar; B has none', () => {
    for (const id of ['C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4', 'D5', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']) {
      const bar = countBarFor(id);
      expect(bar && Object.keys(bar).length).toBeGreaterThan(0);
      for (const v of Object.values(bar)) expect(v).toBeGreaterThan(0);
    }
    expect(countBarFor('B4')).toBeNull();
  });
});

describe('chooseTarget', () => {
  test('an open prior target that is applicable today is sticky', () => {
    const t = chooseTarget(analysis({ c3: 1, c1: 0 }), openPrior());
    expect(t.indicator).toBe('C3');
    expect(t.carried).toBe(true);
  });
  test('an open prior target NOT applicable today is not carried into the choice', () => {
    const t = chooseTarget(analysis({ c1: 0 }), openPrior({ target: { indicator: 'F4', domain: 'teacher_subject_knowledge', name: 'Maths' } }));
    expect(t.indicator).not.toBe('F4');
  });
  test('the scorer\'s focus_area wins when it is a C/D/F indicator with room to grow', () => {
    expect(chooseTarget(analysis({ c1: 0, c3: 1, focus: 'C3' }), null).indicator).toBe('C3');
  });
  test('a Section B focus_area is never a loop target — falls to the lowest applicable C/D/F rung', () => {
    const t = chooseTarget(analysis({ c1: 0, c3: 1, b4: 0, focus: 'B4' }), null);
    expect(t.indicator).toBe('C1');
    expect(t.indicator[0]).not.toBe('B');
  });
  test('never a non-applicable indicator, never one already at the top rung', () => {
    const a = analysis({ c1: 2, c3: 2, d2: 2, f4: 'na' });
    expect(chooseTarget(a, null)).toBeNull();
    const b = analysis({ c1: 2, c3: 2, d2: 1, f4: 'na', focus: 'F4' });
    expect(chooseTarget(b, null).indicator).toBe('D2');
  });
  test('table-driven over the real staging v4 sessions: never B, never non-applicable, never rung 2', () => {
    const p = path.join(__dirname, '..', 'fixtures', 'fico-v4-staging-sessions.json');
    const fx = JSON.parse(fs.readFileSync(p, 'utf8')).sessions;
    expect(fx.length).toBeGreaterThan(10);
    let chosen = 0;
    for (const s of fx) {
      const a = { framework: 'fico', domains: {}, focus_area: s.focus_area ? { ...s.focus_area, try_this_tomorrow: 'x' } : undefined };
      for (const [k, inds] of Object.entries(s.domains)) a.domains[k] = { indicators: inds.map((i) => ({ ...i, name: i.id })) };
      const t = chooseTarget(a, null);
      if (!t) continue;
      chosen += 1;
      expect(t.indicator[0]).not.toBe('B');
      expect(applicableToday(a, t.indicator)).toBe(true);
      const row = Object.values(a.domains).flatMap((d) => d.indicators).find((i) => i.id === t.indicator);
      expect(row.score).toBeLessThan(2);
    }
    expect(chosen).toBeGreaterThan(0);
  });
});

describe('nextTarget — the state machine', () => {
  const a = analysis({ c3: 1, c1: 0 });
  test('no prior → attempt 1, tell, a fresh target', () => {
    const n = nextTarget(null, 'no_prior', a);
    expect(n).toMatchObject({ attempt: 1, angle: 'tell', achieved_streak: 0, target_status: 'open' });
    expect(n.target.indicator).toBe('C3');
  });
  test('not_applicable today keeps the target and the attempt, flags a bridge', () => {
    const n = nextTarget(openPrior({ attempt: 2, angle: 'cue' }), 'not_applicable', a);
    expect(n).toMatchObject({ attempt: 2, angle: 'cue', bridge: true, target_status: 'open' });
    expect(n.target.indicator).toBe('C3');
  });
  test('unknown keeps everything — our parse failure never punishes the teacher', () => {
    const n = nextTarget(openPrior({ attempt: 2, angle: 'cue', achieved_streak: 1 }), 'unknown', a);
    expect(n).toMatchObject({ attempt: 2, angle: 'cue', achieved_streak: 1, target_status: 'open' });
  });
  test('achieved once → same target, streak 1, angle unchanged', () => {
    const n = nextTarget(openPrior({ attempt: 2, angle: 'cue' }), 'achieved', a);
    expect(n).toMatchObject({ attempt: 2, angle: 'cue', achieved_streak: 1, target_status: 'open', reason: 'once_more' });
  });
  test('achieved twice in a row → the target closes and a new one opens at tell', () => {
    const n = nextTarget(openPrior({ attempt: 2, angle: 'cue', achieved_streak: 1 }), 'achieved', analysis({ c3: 2, c1: 0 }));
    expect(n.closed && n.closed.indicator).toBe('C3');
    expect(n.target.indicator).toBe('C1');
    expect(n).toMatchObject({ attempt: 1, angle: 'tell', achieved_streak: 0, reason: 'closed_after_two' });
  });
  test('partial or not_seen → same target, the next rung of the ladder, streak reset', () => {
    expect(nextTarget(openPrior({ attempt: 1, angle: 'tell', achieved_streak: 1 }), 'partial', a)).toMatchObject({ attempt: 2, angle: 'cue', achieved_streak: 0 });
    expect(nextTarget(openPrior({ attempt: 2, angle: 'cue' }), 'not_seen', a)).toMatchObject({ attempt: 3, angle: 'show' });
    expect(nextTarget(openPrior({ attempt: 3, angle: 'show' }), 'not_seen', a)).toMatchObject({ attempt: 4, angle: 'shrink' });
  });
  test('four attempts without uptake → hand over to a coach, target stays open, coaching continues', () => {
    const n = nextTarget(openPrior({ attempt: 4, angle: 'shrink' }), 'not_seen', a);
    expect(n).toMatchObject({ attempt: 5, angle: 'hand_over', hand_over: true, target_status: 'open' });
    expect(n.target.indicator).toBe('C3');
    const n2 = nextTarget({ ...openPrior({ attempt: 5, angle: 'hand_over' }), hand_over: true }, 'not_seen', a);
    expect(n2).toMatchObject({ attempt: 6, angle: 'hand_over', hand_over: true });
  });
  test('a prior whose target is no longer open starts fresh', () => {
    const n = nextTarget(openPrior({ target_status: 'closed' }), 'achieved', a);
    expect(n).toMatchObject({ attempt: 1, angle: 'tell' });
  });
  test('deterministic: the same prior + verdict + analysis yields the same state (re-runs are idempotent)', () => {
    const p = openPrior({ attempt: 2, angle: 'cue' });
    expect(nextTarget(p, 'not_seen', a)).toEqual(nextTarget(p, 'not_seen', a));
  });
});

describe('tooSimilar — the sameness guard', () => {
  const s1 = 'Next class, when a child gives a wrong answer, say one sentence that names the next step instead of "galat".';
  const s2 = 'Next class, when you hear the first wrong answer in the number line activity, ask: "which step did you skip?" and wait.';
  test('two different framings of one target are not similar; a string is similar to itself', () => {
    expect(tooSimilar(s1, s2)).toBe(false);
    expect(tooSimilar(s1, s1)).toBe(true);
    expect(tooSimilar(s1, s1 + ' Then move on.')).toBe(true);
  });
  test('Urdu tokens count too; empty strings are never similar', () => {
    const u = 'ہر غلط جواب کے بعد ایک جملہ کہیں جو اگلا قدم بتائے';
    expect(tooSimilar(u, u)).toBe(true);
    expect(tooSimilar(u, 'اگلی کلاس میں تین open-ended questions پوچھیں اور ایک follow-up کریں')).toBe(false);
    expect(tooSimilar('', s1)).toBe(false);
  });
});

describe('deriveUptakeStatus — computed, never read', () => {
  const bar = { specific_feedback_moves: 3, next_step_feedback: 1 };
  const prior = openPrior({ action_spec: { count_target: bar }, baseline: { rung: 1, count: { specific_feedback_moves: 1, next_step_feedback: 0 } } });
  test('no prior → no_prior', () => expect(deriveUptakeStatus({ count: bar }, null, analysis())).toBe('no_prior'));
  test('target not applicable today → not_applicable', () => {
    const p = openPrior({ target: { indicator: 'F4', domain: 'teacher_subject_knowledge', name: 'x' } });
    expect(deriveUptakeStatus({ count: {} }, p, analysis({ f4: 'na' }))).toBe('not_applicable');
  });
  test('the bar met on every key → achieved', () => {
    expect(deriveUptakeStatus({ count: { specific_feedback_moves: 3, next_step_feedback: 1 } }, prior, analysis({ c3: 1 }))).toBe('achieved');
  });
  test('rung 2 today → achieved regardless of the tally', () => {
    expect(deriveUptakeStatus({ count: { specific_feedback_moves: 0, next_step_feedback: 0 } }, prior, analysis({ c3: 2 }))).toBe('achieved');
  });
  test('any count rose against the baseline but the bar is not met → partial', () => {
    expect(deriveUptakeStatus({ count: { specific_feedback_moves: 2, next_step_feedback: 0 } }, prior, analysis({ c3: 1 }))).toBe('partial');
  });
  test('nothing rose → not_seen', () => {
    expect(deriveUptakeStatus({ count: { specific_feedback_moves: 1, next_step_feedback: 0 } }, prior, analysis({ c3: 1 }))).toBe('not_seen');
    expect(deriveUptakeStatus({ count: { specific_feedback_moves: 0, next_step_feedback: 0 } }, prior, analysis({ c3: 1 }))).toBe('not_seen');
  });
  test('malformed or missing tally, or keys that no longer match the bar → unknown', () => {
    expect(deriveUptakeStatus(null, prior, analysis({ c3: 1 }))).toBe('unknown');
    expect(deriveUptakeStatus({ count: 'three' }, prior, analysis({ c3: 1 }))).toBe('unknown');
    expect(deriveUptakeStatus({ count: { open_questions: 5 } }, prior, analysis({ c3: 1 }))).toBe('unknown');
    expect(deriveUptakeStatus({ count: bar }, openPrior({ action_spec: null }), analysis({ c3: 1 }))).toBe('unknown');
  });
});

describe('buildRecord — the record written to prioritized_action', () => {
  test('carries the card, the loop state, the baseline, the lineage and this lesson\'s verdict on the prior', () => {
    const a = analysis({ c3: 1, c1: 0 });
    const prior = openPrior({ attempt: 1, angle: 'tell' });
    const state = nextTarget(prior, 'partial', a);
    const card = { commitment: 'c', action: 'Next class, when…', highlights: [], lesson_label: 'FICO', language: 'ur', _source: 'llm', action_spec: { cue: 'when a child answers wrongly', move: 'name the next step', count_target: countBarFor('C3'), model_line: 'اب یہ کریں…' } };
    const rec = buildRecord(state, { prior, analysis: a, card, instrument: 'self', uptake: { count: { specific_feedback_moves: 2, next_step_feedback: 0 }, evidence: 'q', moment: 'm' }, uptakeStatus: 'partial' });
    expect(rec).toMatchObject({
      commitment: 'c', action: 'Next class, when…', _source: 'llm', language: 'ur',
      target: { indicator: 'C3' }, attempt: 2, angle: 'cue', achieved_streak: 0, target_status: 'open',
      baseline: { rung: 1 }, lineage: ['prior-1'], instrument: 'self', framework: 'fico',
      uptake: { status: 'partial', count: { specific_feedback_moves: 2, next_step_feedback: 0 } },
    });
    expect(rec.action_spec.count_target).toEqual(countBarFor('C3'));
    expect(rec.loop_version).toBe(1);
  });
  test('with no card the action_spec is built from the target\'s rubric bar', () => {
    const a = analysis({ c3: 1 });
    const rec = buildRecord(nextTarget(null, 'no_prior', a), { prior: null, analysis: a, card: null, instrument: 'observe' });
    expect(rec.target.indicator).toBe('C3');
    expect(rec.action_spec.count_target).toEqual(countBarFor('C3'));
    expect(rec.lineage).toEqual([]);
    expect(rec.instrument).toBe('observe');
  });
  test('never carries a teacher_response of its own (that is merged later by the button handler)', () => {
    const a = analysis({ c3: 1 });
    const rec = buildRecord(nextTarget(null, 'no_prior', a), { prior: null, analysis: a, card: { action: 'x', teacher_response: 'yes' } });
    expect(rec.teacher_response).toBeUndefined();
  });
  test('no target (every C/D/F at the top) → a record with target null and status none', () => {
    const a = analysis({ c1: 2, c3: 2, d2: 2 });
    const rec = buildRecord(nextTarget(null, 'no_prior', a), { prior: null, analysis: a, card: { action: 'x' } });
    expect(rec.target).toBeNull();
    expect(rec.target_status).toBe('none');
  });
});
