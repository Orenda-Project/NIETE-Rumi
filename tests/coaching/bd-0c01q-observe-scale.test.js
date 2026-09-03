/**
 * The /observe HITL form must speak the SAME scale as the scorer.
 *
 * Rifat's 3 Sep staging test (Urdu lesson, واحد جمع) found two faults that the scorer itself did
 * not have — the stored analysis was correct on both counts, and the FORM misrepresented it:
 *
 *   1. Every score was shown against 1-4 labels. F1 is stored as 2, which on the three-rung scale
 *      is PROFICIENT — the top. The coach was shown "2 · Developing", one full band low, for
 *      every indicator in C, D and F.
 *   2. F4-F7 are stored applicable:false / score:null for a literacy lesson, exactly as intended.
 *      The form pre-selected them at "1 · Not Observed", so a subject-gated indicator looked
 *      scored, and submitting the form as prefilled would have written a real score onto a row
 *      the scorer had deliberately excluded.
 *
 * The root cause of both is a SECOND COPY of the scale. The framework owns scaleMax; the observe
 * pack carried its own hardcoded 1-4 list. RED FIRST.
 */
process.env.OBSERVE_FRAMEWORK = 'fico';

const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const { getObservePack } = require('../../bot/shared/services/observe/observe-framework');

describe('the observe pack takes its scale from the framework, not a second copy', () => {
  const pack = getObservePack();
  const { scaleMax } = fico.getScoringConstants();

  test('the scale offers exactly the framework rungs, plus an explicit not-applicable', () => {
    const numeric = pack.scaleOptions.filter(o => /^\d+$/.test(String(o.id)));
    expect(numeric.map(o => Number(o.id)).sort((a, b) => a - b))
      .toEqual(Array.from({ length: scaleMax + 1 }, (_, i) => i));
  });

  test('no rung label promises a fourth level', () => {
    const blob = JSON.stringify(pack.scaleOptions);
    expect(blob).not.toMatch(/Highly Effective/);
    expect(blob).not.toMatch(/\b4 ·/);
  });

  test('the top rung reads as Proficient, so a top score is not shown as Developing', () => {
    const top = pack.scaleOptions.find(o => String(o.id) === String(scaleMax));
    expect(top).toBeDefined();
    expect(top.title).toMatch(/Proficient/i);
  });

  test('there is a not-applicable option for subject-gated indicators', () => {
    expect(pack.scaleOptions.some(o => String(o.id) === 'na')).toBe(true);
  });
});

describe('a non-applicable indicator is never pre-selected as a score', () => {
  const draft = require('../../bot/shared/services/observe/observe-draft.service');

  const analysis = {
    domains: {
      teacher_subject_knowledge: {
        indicators: [
          { id: 'F1', score: 2, applicable: true, evidence: 'accurate, explains why' },
          { id: 'F6', score: null, applicable: false, evidence: 'Not applicable — literacy lesson.' },
        ],
      },
    },
  };

  test('an applicable indicator prefills its real score', () => {
    const data = draft.buildScreenPrefill(analysis, 'teacher_subject_knowledge');
    expect(data.s_F1).toBe('2');
  });

  test('a non-applicable indicator prefills the not-applicable option, not the bottom rung', () => {
    const data = draft.buildScreenPrefill(analysis, 'teacher_subject_knowledge');
    expect(data.s_F6).toBe('na');
    expect(data.s_F6).not.toBe('0');
    expect(data.s_F6).not.toBe('1');
  });
});

describe('submitting the form does not score a row the scorer excluded', () => {
  const draft = require('../../bot/shared/services/observe/observe-draft.service');

  test('applyObserverEdits maps the not-applicable choice back to applicable:false / score null', () => {
    // exercised through the pure merge helper so the test needs no DB
    expect(typeof draft.mergeIndicatorEdit).toBe('function');
    const ind = { id: 'F6', score: null, applicable: false };
    draft.mergeIndicatorEdit(ind, 'na');
    expect(ind.applicable).toBe(false);
    expect(ind.score).toBeNull();
  });

  test('a real score on a previously non-applicable row turns it applicable again', () => {
    const ind = { id: 'F6', score: null, applicable: false };
    draft.mergeIndicatorEdit(ind, '2');
    expect(ind.applicable).toBe(true);
    expect(ind.score).toBe(2);
  });
});

describe('the report adapter reads the scale from the framework too', () => {
  test('fico-adapter holds no hardcoded scale of its own', () => {
    const src = require('fs').readFileSync(
      require.resolve('../../bot/shared/services/coaching/report-v2/score-adapters/fico-adapter'),
      'utf8');
    expect(src).not.toMatch(/const SCALE_MAX = 4/);
  });

  test('a domain with no stored max falls back to the framework scale, not 4', () => {
    const { buildFicoGroups } = require(
      '../../bot/shared/services/coaching/report-v2/score-adapters/fico-adapter');
    const { scaleMax, domains } = fico.getScoringConstants();
    const groups = buildFicoGroups({ domains: { high_leverage_practices: { domain_score: 4 } } });
    const c = groups.find(g => g.key === 'C');
    expect(c.max).toBe(domains.high_leverage_practices.indicators.length * scaleMax);
  });
});
