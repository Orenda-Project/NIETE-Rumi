'use strict';
/**
 * A coach must be able to mark an indicator not-applicable, and her correction to
 * a wrongly-excluded one must actually count.
 *
 * The scorer learned to abstain: it marks a subject-gated row `applicable: false`
 * with a null score, and those rows leave both sides of the total. The coach's
 * review form was never told, and it is now inconsistent with the scorer in three
 * ways:
 *
 * 1. The scale it serves is 1-4 with no "not applicable" option at all, which is
 *    the option a coach asked for.
 * 2. An excluded row arrives with a null score, the prefill's finite-number guard
 *    fails, and it falls to the floor — so her Section F screen shows
 *    "Subject-Specific Pedagogy: MATH" pre-set to "1 · Not Observed / Emerging"
 *    on an Urdu lesson, with nothing saying it was excluded. 4,955 of 4,957
 *    sessions since the abstention shipped carry at least one such row, so this
 *    is every form served.
 * 3. If she corrects a row the model wrongly excluded, `applyObserverEdits` writes
 *    the score but never clears `applicable`, so `computeScores` drops it again.
 *    Her edit is accepted and her teacher's score does not move. Live, not
 *    hypothetical: one Grade 1 Urdu lesson had LITERACY/LANGUAGE itself excluded.
 *
 * No Flow republish is needed, and that was checked against the live asset rather
 * than assumed: the published Flow declares every rating radio's options as
 * `${data.scale}`, a runtime array of {id, title} our endpoint supplies, with the
 * 1-4 set present only as `__example__`. There are zero inline option lists on
 * the screen, and the init value is a plain string.
 *
 * Real functions, no mocks.
 */
const { getObservePack } = require('../../bot/shared/services/observe/observe-framework');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const F_KEY = 'teacher_subject_knowledge';

function ficoPack() {
  const prev = process.env.OBSERVE_FRAMEWORK;
  process.env.OBSERVE_FRAMEWORK = 'fico';
  const pack = getObservePack();
  if (prev === undefined) delete process.env.OBSERVE_FRAMEWORK;
  else process.env.OBSERVE_FRAMEWORK = prev;
  return pack;
}

describe('the scale the coach is served', () => {
  test('THE BUG: there is no way to say "not applicable"', () => {
    const opts = ficoPack().scaleOptions;
    expect(opts.map((o) => o.id)).toContain('na');
  });

  test('the N/A option fits the field, measured in code points', () => {
    const na = ficoPack().scaleOptions.find((o) => o.id === 'na');
    expect([...na.title].length).toBeLessThanOrEqual(30);
  });

  test('the four rating rungs are untouched, in order', () => {
    const ids = ficoPack().scaleOptions.map((o) => o.id);
    expect(ids.slice(0, 4)).toEqual(['1', '2', '3', '4']);
  });

  test('the clamp still reads 1-4 — a non-numeric option cannot move the bounds', () => {
    // scaleBounds derives min/max from the numeric ids, so a "4 · Highly
    // Effective" must not become anything else.
    const { scaleBoundsForTest } = require('../../bot/shared/services/observe/observe-draft.service');
    process.env.OBSERVE_FRAMEWORK = 'fico';
    expect(scaleBoundsForTest()).toEqual({ min: 1, max: 4 });
    delete process.env.OBSERVE_FRAMEWORK;
  });
});

describe('what the form shows for an excluded row', () => {
  const { buildScreenPrefill } = require('../../bot/shared/services/observe/observe-draft.service');
  const prevFw = process.env.OBSERVE_FRAMEWORK;
  beforeEach(() => { process.env.OBSERVE_FRAMEWORK = 'fico'; });
  afterAll(() => {
    if (prevFw === undefined) delete process.env.OBSERVE_FRAMEWORK;
    else process.env.OBSERVE_FRAMEWORK = prevFw;
  });

  const analysis = () => ({
    framework: 'fico',
    domains: {
      [F_KEY]: {
        indicators: [
          { id: 'F1', score: 3, evidence_summary: 'clear explanation' },
          { id: 'F5', score: null, applicable: false, evidence_summary: 'Not applicable — lesson subject is LITERACY/LANGUAGE, not MATH.' },
          { id: 'F6', score: null, applicable: false, evidence_summary: 'Not applicable — lesson subject is LITERACY/LANGUAGE, not SCIENCE.' },
          { id: 'F7', score: 2, evidence_summary: 'read aloud with the class' },
        ],
      },
    },
  });

  test('THE BUG: an excluded row is pre-set to "not applicable", not to the bottom rung', () => {
    const d = buildScreenPrefill(analysis(), F_KEY);
    expect(d.s_F5).toBe('na');
    expect(d.s_F6).toBe('na');
  });

  test('a scored row is unaffected', () => {
    const d = buildScreenPrefill(analysis(), F_KEY);
    expect(d.s_F1).toBe('3');
    expect(d.s_F7).toBe('2');
  });

  test('a row the analysis never emitted still falls to the bottom rung, as before', () => {
    const d = buildScreenPrefill({ framework: 'fico', domains: { [F_KEY]: { indicators: [] } } }, F_KEY);
    expect(d.s_F1).toBe('1');
  });
});

describe('the round trip', () => {
  const { applyObserverEditsToAnalysis } = require('../../bot/shared/services/observe/observe-draft.service');
  const prevFw = process.env.OBSERVE_FRAMEWORK;
  beforeEach(() => { process.env.OBSERVE_FRAMEWORK = 'fico'; });
  afterAll(() => {
    if (prevFw === undefined) delete process.env.OBSERVE_FRAMEWORK;
    else process.env.OBSERVE_FRAMEWORK = prevFw;
  });

  const stored = () => ({
    framework: 'fico',
    domains: {
      [F_KEY]: {
        indicators: [
          { id: 'F1', score: 3 },
          { id: 'F5', score: null, applicable: false },
          // the model wrongly excluded literacy on a Grade 1 Urdu lesson and left a 2 on it
          { id: 'F7', score: 2, applicable: false },
          { id: 'F8', score: 2 },
        ],
      },
    },
  });

  const indicatorOf = (a, id) => a.domains[F_KEY].indicators.find((i) => i.id === id);

  test('THE BUG: correcting a wrongly-excluded row brings it back into the score', () => {
    const a = stored();
    applyObserverEditsToAnalysis(a, {}, { r_F7: '3' });
    const f7 = indicatorOf(a, 'F7');
    expect(f7.applicable).toBe(true);
    expect(f7.score).toBe(3);

    fico.computeScores(a);
    const f = a.domains[F_KEY];
    // F1 3 + F7 3 + F8 2 = 8, out of three applicable rows
    expect(f.domain_score).toBe(8);
    expect(f.indicators_applicable).toBe(3);
  });

  test("'na' excludes a row: applicable false, score null, out of the denominator", () => {
    const a = stored();
    applyObserverEditsToAnalysis(a, {}, { r_F8: 'na' });
    const f8 = indicatorOf(a, 'F8');
    expect(f8.applicable).toBe(false);
    expect(f8.score).toBeNull();

    fico.computeScores(a);
    // only F1 is applicable now — F5 and F7 were already excluded and untouched
    expect(a.domains[F_KEY].indicators_applicable).toBe(1);
    expect(a.domains[F_KEY].domain_score).toBe(3);
  });

  test('an untouched excluded row stays excluded', () => {
    const a = stored();
    applyObserverEditsToAnalysis(a, {}, { r_F1: '4' });
    expect(indicatorOf(a, 'F5').applicable).toBe(false);
    expect(indicatorOf(a, 'F5').score).toBeNull();
  });

  test('an empty or absent edit changes nothing', () => {
    const a = stored();
    applyObserverEditsToAnalysis(a, {}, { r_F1: '', r_F5: null });
    expect(indicatorOf(a, 'F1').score).toBe(3);
    expect(indicatorOf(a, 'F5').applicable).toBe(false);
  });

  test('re-including and then excluding again is stable', () => {
    const a = stored();
    applyObserverEditsToAnalysis(a, {}, { r_F7: '3' });
    applyObserverEditsToAnalysis(a, {}, { r_F7: 'na' });
    expect(indicatorOf(a, 'F7').applicable).toBe(false);
    expect(indicatorOf(a, 'F7').score).toBeNull();
  });

  test('the rescored count reflects real changes, including an exclusion', () => {
    const a = stored();
    const s = applyObserverEditsToAnalysis(a, a, { r_F7: '3', r_F8: 'na', r_F1: '3' });
    // F7 re-included and rescored, F8 excluded; F1 unchanged at 3
    expect(s.rescored).toBe(2);
  });

  test('BACK-COMPAT LOCK: a pack whose scale has no N/A option is byte-identical', () => {
    const prev = process.env.OBSERVE_FRAMEWORK;
    process.env.OBSERVE_FRAMEWORK = 'mewaka';
    try {
      const pack = getObservePack();
      expect((pack.scaleOptions || []).map((o) => o.id)).not.toContain('na');
      const a = { framework: 'mewaka', domains: { d1: { indicators: [{ id: 'C3.7', score: 1 }] } } };
      // 'na' is not on this pack's scale, so it is not a rating and not an exclusion:
      // the value is ignored exactly as any other unparseable one was.
      applyObserverEditsToAnalysis(a, {}, { r_C3_7: 'na' });
      const ind = a.domains.d1.indicators[0];
      expect(ind.applicable).toBeUndefined();
      expect(ind.score).toBe(0); // the pack's floor, as before
    } finally {
      if (prev === undefined) delete process.env.OBSERVE_FRAMEWORK;
      else process.env.OBSERVE_FRAMEWORK = prev;
    }
  });
});
