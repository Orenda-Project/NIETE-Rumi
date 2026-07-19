/**
 * FEAT-093 bd-52 — the observe FRAMEWORK PACK: /observe runs HOTS in Pakistan
 * and MEWAKA in Tanzania from ONE pipeline, selected by config
 * (OBSERVE_FRAMEWORK env), never by code.
 *
 * The load-bearing invariants:
 *  - mewaka pack is a PASSTHROUGH of the mewaka module — TZ is byte-identical;
 *  - hots pack normalizes HOTS's 5 areas/16 indicators into the SAME
 *    domains shape the draft/endpoint/report pipeline already speaks,
 *    with Urdu domain titles (self-describing analysis data);
 *  - the hots pack implements the full framework interface analyzePedagogy
 *    consumes (name/getSystemPrompt/buildAnalysisPrompt/computeScores/…);
 *  - the hots observe analysis prompt demands the SAME JSON contract the
 *    form prefill reads (per-indicator score + evidence + improvement), in Urdu.
 */
const mewaka = require('../../shared/services/coaching/frameworks/mewaka-framework');
const {
  getObservePack,
  OBSERVE_FRAMEWORK_KEYS,
} = require('../../shared/services/observe/observe-framework');

afterEach(() => { delete process.env.OBSERVE_FRAMEWORK; });

describe('pack selection is config, not code', () => {
  test('default (no env) → mewaka', () => {
    expect(getObservePack().key).toBe('mewaka');
  });
  test('OBSERVE_FRAMEWORK=hots → hots', () => {
    process.env.OBSERVE_FRAMEWORK = 'hots';
    expect(getObservePack().key).toBe('hots');
  });
  test('junk env → mewaka (never crash a market on a typo)', () => {
    process.env.OBSERVE_FRAMEWORK = 'santa';
    expect(getObservePack().key).toBe('mewaka');
  });
});

describe('mewaka pack — TZ byte-identical passthrough', () => {
  test('module IS the mewaka module; domains/computeScores identical references', () => {
    const p = getObservePack();
    expect(p.module).toBe(mewaka);
    expect(p.domains).toBe(mewaka.getScoringConstants().domains);
    expect(p.screenIds).toEqual(['DOMAIN_A', 'DOMAIN_B', 'DOMAIN_C', 'DOMAIN_D', 'DOMAIN_E', 'DOMAIN_F']);
    expect(p.lang).toBe('sw');
  });
});

describe('hots pack — normalized to the pipeline shape', () => {
  beforeEach(() => { process.env.OBSERVE_FRAMEWORK = 'hots'; });

  test('5 domains, 16 indicators, in the domains shape the draft service reads', () => {
    const p = getObservePack();
    const keys = Object.keys(p.domains);
    expect(keys).toEqual([
      'classroom_environment', 'lesson_planning', 'instructional_strategies',
      'student_engagement', 'assessment_feedback',
    ]);
    let n = 0;
    for (const k of keys) {
      expect(p.domains[k].title).toBeTruthy();        // Urdu title
      expect(p.domains[k].title_en).toBeTruthy();
      for (const ind of p.domains[k].indicators) {
        expect(ind.id).toBeTruthy();
        expect(ind.name).toBeTruthy();
        n += 1;
      }
    }
    expect(n).toBe(16);
    expect(p.screenIds).toEqual(['DOMAIN_A', 'DOMAIN_B', 'DOMAIN_C', 'DOMAIN_D', 'DOMAIN_E']);
    expect(p.lang).toBe('ur');
  });

  test('module implements the full framework interface analyzePedagogy consumes', () => {
    const m = getObservePack().module;
    expect(m.name).toBe('hots');
    for (const fn of ['getSystemPrompt', 'buildAnalysisPrompt', 'computeScores', 'getScoringConstants', 'getPerformanceBand']) {
      expect(typeof m[fn]).toBe('function');
    }
    expect(m.maxMarks).toBe(48);   // 16 × 3
  });

  test('the observe analysis prompt is Urdu and demands the form-prefill JSON contract', () => {
    const m = getObservePack().module;
    const prompt = m.buildAnalysisPrompt('استاد نے سوال پوچھا', { teacherName: 'Ms. Test' });
    expect(prompt).toMatch(/اردو/);                       // instructs Urdu output
    expect(prompt).toContain('"evidence_sw"');            // same keys the prefill reads
    expect(prompt).toContain('"improvement_sw"');
    expect(prompt).toContain('classroom_environment');    // domains keyed as normalized
    expect(prompt).toMatch(/"score": 0-3/);
  });

  test('computeScores fills per-domain totals + overall percentage + self-describing titles', () => {
    const p = getObservePack();
    const analysis = { domains: {} };
    for (const [k, d] of Object.entries(p.domains)) {
      analysis.domains[k] = {
        indicators: d.indicators.map((i) => ({ id: i.id, score: 2, evidence_sw: 'x', improvement_sw: 'y' })),
      };
    }
    p.computeScores(analysis);
    expect(analysis.scores.overall_percentage).toBeCloseTo((16 * 2 / 48) * 100, 1);
    expect(analysis.scores.overall_marks).toBe(32);
    expect(analysis.scores.overall_max_marks).toBe(48);
    for (const k of Object.keys(p.domains)) {
      expect(analysis.domains[k].domain_score).toBe(p.domains[k].indicators.length * 2);
      expect(analysis.domains[k].domain_max).toBe(p.domains[k].indicators.length * 3);
      expect(analysis.domains[k].title).toBe(p.domains[k].title);   // report is self-describing
    }
    expect(analysis.framework).toBe('hots');
  });

  test('scores clamp to 0..3 and missing indicators count as 0 — never NaN', () => {
    const p = getObservePack();
    const analysis = { domains: { classroom_environment: { indicators: [{ id: 1, score: 99 }] } } };
    p.computeScores(analysis);
    expect(Number.isFinite(analysis.scores.overall_percentage)).toBe(true);
    expect(analysis.domains.classroom_environment.domain_score).toBeLessThanOrEqual(3);
  });
});

describe('pickObservationFramework routes through the pack', () => {
  const { pickObservationFramework } = require('../../shared/services/observe/observe-gate');
  const getFramework = require('../../shared/services/coaching/frameworks/framework-registry').getFramework;

  test('leader observation + hots config → the hots observe module', async () => {
    process.env.OBSERVE_FRAMEWORK = 'hots';
    const fw = await pickObservationFramework(
      { observation_type: 'leader_observation', user_id: 'u1' },
      { selectFramework: async () => mewaka, getFramework });
    expect(fw.name).toBe('hots');
    expect(fw.maxMarks).toBe(48);
  });

  test('leader observation + default config → mewaka, exactly as before', async () => {
    const fw = await pickObservationFramework(
      { observation_type: 'leader_observation', user_id: 'u1' },
      { selectFramework: async () => null, getFramework });
    expect(fw).toBe(getFramework('mewaka'));
  });

  test('teacher self-recordings keep per-user selection, untouched', async () => {
    process.env.OBSERVE_FRAMEWORK = 'hots';
    const sentinel = { name: 'per-user' };
    const fw = await pickObservationFramework(
      { observation_type: null, user_id: 'u1' },
      { selectFramework: async () => sentinel, getFramework });
    expect(fw).toBe(sentinel);
  });
});
