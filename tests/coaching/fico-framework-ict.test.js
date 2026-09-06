/**
 * FICO Framework — ICT Canonical Rubric Tests (TDD)
 *
 * Validates bd-2039: FICO framework replaced with the canonical ICT rubric.
 * 4 scored sections (B/C/D/F), 26 indicators, three rungs 0-2, 52 marks defined.
 * The per-session denominator is derived from the APPLICABLE indicators, so a scored
 * lesson is out of 42 (maths/science), 44 (literacy) or 38 (subject unknown).
 *
 * Source of truth: Google Sheet 1UZaHrXARlJ2cWiZAGFEuc-_o1zOiC5LNXaz11_XVkFU
 * (authored by Hammad Sarfraz, ICT team).
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const ficoFramework = require('../../bot/shared/services/coaching/frameworks/fico-framework');

describe('FICO Framework — ICT Canonical Rubric (bd-2039)', () => {

  // ─── Section counts (locked to sheet's Scoring Summary tab) ─────────

  describe('Section shape', () => {
    const constants = ficoFramework.getScoringConstants();
    const DOMAINS = constants.domains;

    test('exposes 4 scored sections (B, C, D, F)', () => {
      expect(Object.keys(DOMAINS)).toHaveLength(4);
      const sectionLetters = Object.values(DOMAINS).map(d => d.key).sort();
      expect(sectionLetters).toEqual(['B', 'C', 'D', 'F']);
    });

    test('Section B (Lesson Plan Fidelity) has 7 indicators (B1-B7)', () => {
      const section = DOMAINS.lesson_plan_fidelity;
      expect(section.key).toBe('B');
      expect(section.indicatorCount).toBe(7);
      expect(section.indicators).toHaveLength(7);
      expect(section.indicators.map(i => i.id)).toEqual([
        'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7',
      ]);
    });

    test('Section C (High-Leverage Practices) has 4 indicators (C1-C4)', () => {
      const section = DOMAINS.high_leverage_practices;
      expect(section.key).toBe('C');
      expect(section.indicatorCount).toBe(4);
      expect(section.indicators.map(i => i.id)).toEqual([
        'C1', 'C2', 'C3', 'C4',
      ]);
    });

    test('Section D (Student Engagement) has 5 indicators (D1-D5)', () => {
      const section = DOMAINS.student_engagement;
      expect(section.key).toBe('D');
      expect(section.indicatorCount).toBe(5);
      expect(section.indicators.map(i => i.id)).toEqual([
        'D1', 'D2', 'D3', 'D4', 'D5',
      ]);
    });

    test('Section F (Teacher Subject Knowledge) has 10 indicators (F1-F10)', () => {
      const section = DOMAINS.teacher_subject_knowledge;
      expect(section.key).toBe('F');
      expect(section.indicatorCount).toBe(10);
      expect(section.indicators.map(i => i.id)).toEqual([
        'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10',
      ]);
    });

    test('total indicators is 26 (per Scoring Summary tab)', () => {
      expect(constants.totalIndicators).toBe(26);
    });

    test('max marks is 52 (26 × 2) DEFINED', () => {
      expect(constants.maxMarks).toBe(52);
      expect(ficoFramework.maxMarks).toBe(52);
    });

    test('every indicator has a scoring method (1-4 levels) + AI detection method', () => {
      for (const section of Object.values(DOMAINS)) {
        for (const ind of section.indicators) {
          // Marks scheme
          expect(ind.levels).toBeDefined();
          expect(ind.levels[0]).toEqual(expect.any(String));
          expect(ind.levels[1]).toEqual(expect.any(String));
          expect(ind.levels[2]).toEqual(expect.any(String));
          expect(ind.levels[3]).toBeUndefined();
          // AI detection method (from sheet, verbatim)
          // v4 replaces the free-text "AI Detection Method" with a countable unit plus the
          // non-examples that stop the model over-crediting.
          expect(ind.count).toEqual(expect.any(String));
          expect(ind.notCounted).toEqual(expect.any(String));
          expect(ind.notCounted.length).toBeGreaterThan(20);
        }
      }
    });
  });

  // ─── Section F subject grouping (sheet's F1-F3 general / F4-F5 math /
  //     F6-F7 science / F8-F10 literacy) ────────────────────────────────

  describe('Section F subject grouping', () => {
    const DOMAINS = ficoFramework.getScoringConstants().domains;
    const F = DOMAINS.teacher_subject_knowledge.indicators;

    test('F1-F3 tagged general', () => {
      expect(F.find(i => i.id === 'F1').subject).toBeUndefined();
      expect(F.find(i => i.id === 'F2').subject).toBeUndefined();
      expect(F.find(i => i.id === 'F3').subject).toBeUndefined();
    });

    test('F4-F5 tagged mathematics', () => {
      expect(F.find(i => i.id === 'F4').subject).toBe('maths');
      expect(F.find(i => i.id === 'F5').subject).toBe('maths');
    });

    test('F6-F7 tagged science', () => {
      expect(F.find(i => i.id === 'F6').subject).toBe('science');
      expect(F.find(i => i.id === 'F7').subject).toBe('science');
    });

    test('F8-F10 tagged literacy', () => {
      expect(F.find(i => i.id === 'F8').subject).toBe('literacy');
      expect(F.find(i => i.id === 'F9').subject).toBe('literacy');
      expect(F.find(i => i.id === 'F10').subject).toBe('literacy');
    });
  });

  // ─── getFramework('fico') returns the new shape ─────────────────────

  describe("framework-registry: getFramework('fico') returns ICT shape", () => {
    const { getFramework } = require('../../bot/shared/services/coaching/frameworks/framework-registry');

    test('fico framework has name=fico, maxMarks=52', () => {
      const fw = getFramework('fico');
      expect(fw.name).toBe('fico');
      expect(fw.maxMarks).toBe(52);
    });

    test('fico framework does NOT expose the legacy 5-domain shape', () => {
      const fw = getFramework('fico');
      const DOMAINS = fw.getScoringConstants().domains;
      // Legacy keys that must NOT appear:
      expect(DOMAINS.lesson_structure).toBeUndefined();
      expect(DOMAINS.instructional_quality).toBeUndefined();
      expect(DOMAINS.classroom_climate).toBeUndefined();
      expect(DOMAINS.assessment_feedback).toBeUndefined();
      // The one 'student_engagement' key that appears in BOTH shapes lives
      // here under the ICT rubric (5 indicators D1-D5), so its indicator IDs
      // must be D-prefixed (not 4.x-prefixed from the legacy shape).
      expect(DOMAINS.student_engagement).toBeDefined();
      expect(DOMAINS.student_engagement.indicators[0].id).toBe('D1');
    });
  });

  // ─── System prompt contains sheet-authored content ──────────────────

  describe('getSystemPrompt() bakes in the sheet rubric', () => {
    const prompt = ficoFramework.getSystemPrompt();

    test('contains FICO name (fidelity/impact)', () => {
      expect(prompt).toMatch(/FICO/);
      expect(prompt).toMatch(/Fidelity/i);
    });

    test('references all 4 scored sections', () => {
      expect(prompt).toMatch(/SECTION B/);
      expect(prompt).toMatch(/SECTION C/);
      expect(prompt).toMatch(/SECTION D/);
      expect(prompt).toMatch(/SECTION F/);
    });

    test('every indicator carries a COUNT line and a DOES NOT COUNT line', () => {
      // v4 replaced the sheet's free-text "AI Detection Method" with two harder things: the unit
      // to tally, and the non-examples that stop the model over-crediting. Both must reach the
      // model, for every indicator — that is what makes the rung a count rather than a judgement.
      const DOMAINS = ficoFramework.getScoringConstants().domains;
      const n = Object.values(DOMAINS).reduce((a, d) => a + d.indicators.length, 0);
      expect((prompt.match(/^   COUNT: /gm) || []).length).toBe(n);
      expect((prompt.match(/^   DOES NOT COUNT: /gm) || []).length).toBe(n);
      expect(prompt).toContain("THE COUNT WINS");
      // F8's countable unit survives the rewrite
      expect(prompt).toContain('phonics stages');
    });

    test('states the three-rung 0-2 scale', () => {
      expect(prompt).toMatch(/scale 0-2/);
      expect(prompt).toMatch(/0 = Not observed/);
      expect(prompt).toMatch(/2 = Proficient/);
      expect(prompt).not.toMatch(/Highly Effective/);
    });

    test('is cacheable', () => {
      expect(ficoFramework.getSystemPrompt()).toBe(ficoFramework.getSystemPrompt());
    });
  });

  // ─── buildAnalysisPrompt() ──────────────────────────────────────────

  describe('buildAnalysisPrompt() emits new section keys', () => {
    test('requests JSON with the 4 ICT section keys', () => {
      const prompt = ficoFramework.buildAnalysisPrompt(
        'Transcript',
        { teacherFirstName: 'Ali' },
        null
      );
      expect(prompt).toContain('lesson_plan_fidelity');
      expect(prompt).toContain('high_leverage_practices');
      expect(prompt).toContain('student_engagement');
      expect(prompt).toContain('teacher_subject_knowledge');
      // Legacy shape keys must NOT appear:
      expect(prompt).not.toContain('lesson_structure');
      expect(prompt).not.toContain('instructional_quality');
      expect(prompt).not.toContain('classroom_climate');
      expect(prompt).not.toContain('assessment_feedback');
    });

    test('includes teacher name and grade context', () => {
      const prompt = ficoFramework.buildAnalysisPrompt(
        'Transcript',
        { grade: '4', subject: 'Science', teacherFirstName: 'Nadia' },
        null
      );
      expect(prompt).toContain('Nadia');
      expect(prompt).toContain('Grade: 4');
    });

    test('LP fidelity note appears when LP provided', () => {
      const prompt = ficoFramework.buildAnalysisPrompt(
        'Transcript',
        { teacherFirstName: 'Ayesha' },
        { title: 'Fractions', objectives: ['Learn fractions'] }
      );
      expect(prompt).toMatch(/LP Fidelity/i);
    });
  });

  // ─── computeScores() ────────────────────────────────────────────────

  describe('computeScores() sums the new section shape', () => {
    test('all 4 sections at max → 52 marks', () => {
      const DOMAINS = ficoFramework.getScoringConstants().domains;
      const analysis = { domains: {} };
      for (const [key, def] of Object.entries(DOMAINS)) {
        analysis.domains[key] = {
          indicators: def.indicators.map(i => ({ id: i.id, score: 2 })),
        };
      }
      const scored = ficoFramework.computeScores(analysis);
      expect(scored.scores.overall_marks).toBe(52);
      expect(scored.scores.overall_max_marks).toBe(52);
      expect(scored.scores.overall_percentage).toBe(100);
    });

    test('per-section max follows the indicators actually scored, not the section size', () => {
      // v4: the denominator is derived from the rows the scorer returned as applicable, so a
      // domain that emitted ONE row is out of 1 x scaleMax — not out of its declared size.
      const SCALE = ficoFramework.getScoringConstants().scaleMax;
      const analysis = {
        domains: {
          lesson_plan_fidelity:      { indicators: [{ score: 2 }] },
          high_leverage_practices:   { indicators: [{ score: 2 }] },
          student_engagement:        { indicators: [{ score: 2 }] },
          teacher_subject_knowledge: { indicators: [{ score: 2 }] },
        },
      };
      ficoFramework.computeScores(analysis);
      for (const d of Object.values(analysis.domains)) expect(d.domain_max).toBe(SCALE);
      expect(analysis.scores.overall_max_marks).toBe(4 * SCALE);
    });

    test('a full section is out of its declared size when every row is applicable', () => {
      const DOMAINS = ficoFramework.getScoringConstants().domains;
      const SCALE = ficoFramework.getScoringConstants().scaleMax;
      const analysis = { domains: {} };
      for (const [key, def] of Object.entries(DOMAINS)) {
        analysis.domains[key] = { indicators: def.indicators.map(i => ({ id: i.id, score: 0 })) };
      }
      ficoFramework.computeScores(analysis);
      expect(analysis.domains.lesson_plan_fidelity.domain_max).toBe(7 * SCALE);
      expect(analysis.domains.high_leverage_practices.domain_max).toBe(4 * SCALE);
      expect(analysis.domains.student_engagement.domain_max).toBe(5 * SCALE);
      expect(analysis.domains.teacher_subject_knowledge.domain_max).toBe(10 * SCALE);
    });

    test('missing sections do not crash', () => {
      const scored = ficoFramework.computeScores({ domains: {} });
      expect(scored.scores.overall_marks).toBe(0);
      expect(scored.scores.overall_max_marks).toBe(52);
    });
  });

  // ─── Performance bands (per sheet's Interpretation Guide) ───────────

  describe('getPerformanceBand() matches sheet interpretation guide', () => {
    test('≥85 → excellent (Highly Effective)', () => {
      expect(ficoFramework.getPerformanceBand(90)).toBe('excellent');
      expect(ficoFramework.getPerformanceBand(85)).toBe('excellent');
    });
    test('70-84 → proficient (Effective)', () => {
      expect(ficoFramework.getPerformanceBand(75)).toBe('proficient');
      expect(ficoFramework.getPerformanceBand(70)).toBe('proficient');
    });
    test('50-69 → developing (Emerging/Developing)', () => {
      expect(ficoFramework.getPerformanceBand(60)).toBe('developing');
      expect(ficoFramework.getPerformanceBand(50)).toBe('developing');
    });
    test('<50 → emerging (Needs Support)', () => {
      expect(ficoFramework.getPerformanceBand(30)).toBe('emerging');
      expect(ficoFramework.getPerformanceBand(0)).toBe('emerging');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REGION_FRAMEWORK_MAP — all 6 ICT sectors route to `fico`
// ═══════════════════════════════════════════════════════════════════════

describe('REGION_FRAMEWORK_MAP: 6 ICT sectors → fico (bd-2039)', () => {
  const ICT_SECTORS = ['Urban-I', 'Urban-II', 'Tarnol', 'B.K', 'Sihala', 'Nilore'];

  test.each(ICT_SECTORS)(
    'sector %s (any case) resolves to fico via REGION_FRAMEWORK_MAP',
    (sector) => {
      const ORIG = { ...process.env };
      try {
        jest.resetModules();
        process.env.REGION_FRAMEWORK_MAP = JSON.stringify({
          'urban-i':  'fico',
          'urban-ii': 'fico',
          'tarnol':   'fico',
          'b.k':      'fico',
          'sihala':   'fico',
          'nilore':   'fico',
        });
        const { defaultFrameworkForRegion } = require('../../bot/shared/config/region-config');
        expect(defaultFrameworkForRegion(sector)).toBe('fico');
        expect(defaultFrameworkForRegion(sector.toLowerCase())).toBe('fico');
        expect(defaultFrameworkForRegion(sector.toUpperCase())).toBe('fico');
      } finally {
        process.env = { ...ORIG };
        jest.resetModules();
      }
    }
  );

  test('unknown sector falls back to deployment default (not fico)', () => {
    const ORIG = { ...process.env };
    try {
      jest.resetModules();
      process.env.REGION_FRAMEWORK_MAP = JSON.stringify({ 'urban-i': 'fico' });
      delete process.env.DEFAULT_OBSERVATION_FRAMEWORK;
      const { defaultFrameworkForRegion } = require('../../bot/shared/config/region-config');
      expect(defaultFrameworkForRegion('unknown-sector')).toBe('oecd');
    } finally {
      process.env = { ...ORIG };
      jest.resetModules();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FRAMEWORK_LABELS still includes fico (dispatch touchpoint #4)
// ═══════════════════════════════════════════════════════════════════════

describe('FRAMEWORK_LABELS still exposes fico (dispatch #4)', () => {
  test('FRAMEWORK_LABELS.fico is defined', () => {
    jest.resetModules();
    const { FRAMEWORK_LABELS } = require('../../bot/shared/config/region-config');
    expect(FRAMEWORK_LABELS.fico).toBeDefined();
    expect(typeof FRAMEWORK_LABELS.fico).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// All 4 dispatch touchpoints have fico wired (no silent fallback risk)
// ═══════════════════════════════════════════════════════════════════════

describe('All 4 dispatch touchpoints wire fico (bd-2039 audit)', () => {
  test('report-transformer-dispatch: fico → transformFICOToReportData (not OECD)', () => {
    jest.resetModules();
    const { getReportTransformer } = require(
      '../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch'
    );
    const ficoFn = getReportTransformer('fico');
    const oecdFn = getReportTransformer('oecd');
    expect(typeof ficoFn).toBe('function');
    expect(ficoFn).not.toBe(oecdFn); // MUST NOT silently fall back to OECD
  });

  test('score-adapter dispatch: fico → buildFicoGroups (not empty)', () => {
    jest.resetModules();
    const { getScoreAdapter } = require(
      '../../bot/shared/services/coaching/report-v2/score-adapters/dispatch'
    );
    const adapter = getScoreAdapter('fico');
    const groups = adapter({
      domains: {
        lesson_plan_fidelity:      { domain_score: 20, domain_max: 28 },
        high_leverage_practices:   { domain_score: 12, domain_max: 16 },
        student_engagement:        { domain_score: 15, domain_max: 20 },
        teacher_subject_knowledge: { domain_score: 30, domain_max: 40 },
      },
    });
    expect(groups).toHaveLength(4);
    expect(groups.map(g => g.key)).toEqual(['B', 'C', 'D', 'F']);
    expect(groups[0].name).toBe('Lesson Plan Fidelity');
    expect(groups[0].score).toBe(20);
    expect(groups[0].max).toBe(28);
  });

  test('renderer-registry: fico → hero renderer (not the pdfkit fallback)', () => {
    jest.resetModules();
    const { getReportRenderer } = require(
      '../../bot/shared/services/coaching/report-renderers/renderer-registry'
    );
    const r = getReportRenderer('fico');
    expect(r).toBeDefined();
    expect(r.key).toBe('hero');
  });
});
