/**
 * FICO Framework Module Tests (module-interface contract)
 *
 * The FICO framework now carries the canonical ICT rubric (Sections B/C/D/F,
 * 26 indicators, max 104). Detailed shape assertions live in
 * `fico-framework-ict.test.js`. This file locks the generic framework-module
 * interface contract that every framework in the registry must satisfy.
 */

const ficoFramework = require('../../bot/shared/services/coaching/frameworks/fico-framework');

describe('FICO Framework Module', () => {

  // ─── Module interface compliance ──────────────────────────────────

  describe('Module interface', () => {

    test('SCENARIO: Framework module exports all required interface methods', () => {
      expect(ficoFramework.name).toBe('fico');
      expect(ficoFramework.version).toBeDefined();
      expect(ficoFramework.displayName).toBe('FICO Framework');
      expect(typeof ficoFramework.maxMarks).toBe('number');
      expect(typeof ficoFramework.hasDebrief).toBe('boolean');
      expect(typeof ficoFramework.hasLPBonus).toBe('boolean');

      expect(typeof ficoFramework.getSystemPrompt).toBe('function');
      expect(typeof ficoFramework.buildAnalysisPrompt).toBe('function');
      expect(typeof ficoFramework.computeScores).toBe('function');
      expect(typeof ficoFramework.getPerformanceBand).toBe('function');
      expect(typeof ficoFramework.getScoringConstants).toBe('function');
    });

    test('SCENARIO: FICO max marks matches indicator count × scale', () => {
      // ICT canonical rubric: 26 × 4 = 104.
      expect(ficoFramework.maxMarks).toBe(ficoFramework.getScoringConstants().totalIndicators * 4);
    });

    test('SCENARIO: FICO has NO debrief section', () => {
      expect(ficoFramework.hasDebrief).toBe(false);
    });

    test('SCENARIO: FICO has NO LP bonus marks', () => {
      expect(ficoFramework.hasLPBonus).toBe(false);
    });
  });

  // ─── System prompt ────────────────────────────────────────────────

  describe('getSystemPrompt()', () => {

    test('SCENARIO: System prompt is cacheable', () => {
      expect(ficoFramework.getSystemPrompt()).toBe(ficoFramework.getSystemPrompt());
    });

    test('SCENARIO: System prompt mentions FICO', () => {
      expect(ficoFramework.getSystemPrompt()).toContain('FICO');
    });

    test('SCENARIO: System prompt mentions 1-4 scale', () => {
      const prompt = ficoFramework.getSystemPrompt();
      expect(prompt).toMatch(/1[\s-]*4/);
    });
  });

  // ─── Analysis prompt ──────────────────────────────────────────────

  describe('buildAnalysisPrompt()', () => {

    test('SCENARIO: Prompt includes teacher name and context', () => {
      const prompt = ficoFramework.buildAnalysisPrompt(
        'Teacher explained photosynthesis.',
        { grade: '4', subject: 'Science', teacherFirstName: 'Nadia' },
        null
      );
      expect(prompt).toContain('Nadia');
      expect(prompt).toContain('Grade: 4');
    });

    test('SCENARIO: LP fidelity instruction included when LP provided', () => {
      const prompt = ficoFramework.buildAnalysisPrompt(
        'Transcript',
        { teacherFirstName: 'Ayesha' },
        { title: 'Fractions', objectives: ['Learn fractions'] }
      );
      expect(prompt).toMatch(/Fidelity/i);
    });

    // ─── focus_area (mirrors MEWAKA's focus_area_sw) ─────────────────

    test('SCENARIO: Analysis contract requests a focus_area object with the 6 MEWAKA sub-fields', () => {
      const prompt = ficoFramework.buildAnalysisPrompt(
        'Teacher asked recall questions only.',
        { teacherFirstName: 'Nadia', language: 'en' },
        null
      );
      expect(prompt).toContain('"focus_area"');
      // Same sub-fields as MEWAKA's focus_area_sw, un-suffixed (FICO ≠ Swahili).
      expect(prompt).toContain('"domain"');
      expect(prompt).toContain('"indicator"');
      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"rationale"');
      expect(prompt).toContain('"try_this_tomorrow"');
      expect(prompt).toContain('"lever_question"');
    });

    test('SCENARIO: focus_area language follows the teacher — English by default', () => {
      const prompt = ficoFramework.buildAnalysisPrompt(
        'Transcript', { teacherFirstName: 'Nadia', language: 'en' }, null
      );
      expect(prompt).toMatch(/FOCUS-AREA LANGUAGE/);
      expect(prompt).toMatch(/in English/);
      expect(prompt).not.toMatch(/Nastaliq/);
    });

    test('SCENARIO: focus_area language switches to Urdu (Nastaliq, RTL, gender-neutral) when teacher is ur — never hardcoded, never Swahili', () => {
      const prompt = ficoFramework.buildAnalysisPrompt(
        'Transcript', { teacherFirstName: 'Ayesha', language: 'ur' }, null
      );
      expect(prompt).toMatch(/URDU/);
      expect(prompt).toMatch(/Nastaliq/);
      expect(prompt).toMatch(/right-to-left/i);
      expect(prompt).toMatch(/gender-neutral/i);
      // FICO is English/Urdu, not Swahili.
      expect(prompt).not.toMatch(/Swahili|Kiswahili/i);
    });

    test('SCENARIO: FICO 1-4 / 26-indicator / B-C-D-F contract stays intact alongside focus_area', () => {
      const prompt = ficoFramework.buildAnalysisPrompt(
        'Transcript', { teacherFirstName: 'Nadia', language: 'en' }, null
      );
      // 26 indicators still requested, and the four FICO section keys present.
      expect(prompt).toContain('Score all 26 FICO indicators (1-4 scale)');
      expect(prompt).toContain('lesson_plan_fidelity');
      expect(prompt).toContain('high_leverage_practices');
      expect(prompt).toContain('student_engagement');
      expect(prompt).toContain('teacher_subject_knowledge');
    });
  });

  // ─── Score computation ────────────────────────────────────────────

  describe('computeScores()', () => {

    test('SCENARIO: Missing sections do not crash', () => {
      const scored = ficoFramework.computeScores({ domains: {} });
      expect(scored.scores.overall_marks).toBe(0);
    });

    test('SCENARIO: overall_max_marks equals framework maxMarks', () => {
      const scored = ficoFramework.computeScores({ domains: {} });
      expect(scored.scores.overall_max_marks).toBe(ficoFramework.maxMarks);
    });
  });

  // ─── Performance bands ────────────────────────────────────────────

  describe('getPerformanceBand()', () => {

    test('SCENARIO: Low score maps to emerging', () => {
      expect(ficoFramework.getPerformanceBand(25)).toBe('emerging');
    });

    test('SCENARIO: High score maps to excellent', () => {
      expect(ficoFramework.getPerformanceBand(90)).toBe('excellent');
    });
  });

  // ─── Scoring constants ────────────────────────────────────────────

  describe('getScoringConstants()', () => {

    test('SCENARIO: Constants include domains, totalIndicators, maxMarks, scaleMax', () => {
      const c = ficoFramework.getScoringConstants();
      expect(c.domains).toBeDefined();
      expect(typeof c.totalIndicators).toBe('number');
      expect(typeof c.maxMarks).toBe('number');
      expect(c.scaleMax).toBe(4);
    });

    test('SCENARIO: total indicators across sections matches totalIndicators constant', () => {
      const c = ficoFramework.getScoringConstants();
      let sum = 0;
      for (const section of Object.values(c.domains)) sum += section.indicatorCount;
      expect(sum).toBe(c.totalIndicators);
    });
  });
});
