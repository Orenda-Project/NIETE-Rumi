/**
 * Per-framework score adapter conformance.
 *
 * Each adapter takes a framework's `analysis_data` and produces the normalized
 * `{ key, name, score, max, pct }[]` rows that the hero template renders. These
 * tests lock the expected shape, group counts, display names sourced from the
 * framework module, and the canonical-input → expected-groups mapping per
 * framework. They also confirm the dispatcher's unknown-framework safety net.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { buildScoreViewModel } = require('../../bot/shared/services/coaching/report-v2/score-adapter.service');
const { getScoreAdapter } = require('../../bot/shared/services/coaching/report-v2/score-adapters/dispatch');

describe('Score Adapter — buildScoreViewModel() per framework', () => {
  describe('OECD — 5 goals at goal altitude', () => {
    const a = {
      framework: 'oecd',
      scores: {
        overall_percentage: 75,
        goal1_total: 18,
        goal2_total: 16,
        goal3_total: 28,
        goal4_total: 4,
        goal5_total: 20,
      },
    };

    it('returns 5 groups in canonical order G1..G5', () => {
      const vm = buildScoreViewModel(a);
      expect(vm.groups).toHaveLength(5);
      expect(vm.groups.map((g) => g.key)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
    });

    it('G1 = Formative Assessment & Feedback, 18 / 22 / 82%', () => {
      const vm = buildScoreViewModel(a);
      const g1 = vm.groups[0];
      expect(g1.name).toBe('Formative Assessment & Feedback');
      expect(g1.score).toBe(18);
      expect(g1.max).toBe(22);
      expect(g1.pct).toBe(82);
    });

    it('G3 = Quality Subject Content, 28 / 34 / 82%', () => {
      const vm = buildScoreViewModel(a);
      const g3 = vm.groups[2];
      expect(g3.name).toBe('Quality Subject Content');
      expect(g3.score).toBe(28);
      expect(g3.max).toBe(34);
      expect(g3.pct).toBe(82);
    });

    it('missing goalN_total → score 0, full max, pct 0', () => {
      const vm = buildScoreViewModel({ framework: 'oecd', scores: { overall_percentage: 0 } });
      // G1 still shows its full rubric max even though score is 0.
      expect(vm.groups[0].score).toBe(0);
      expect(vm.groups[0].max).toBe(22);
      expect(vm.groups[0].pct).toBe(0);
    });

    it('overall, marks, max pull from analysis.scores', () => {
      const vm = buildScoreViewModel({ framework: 'oecd', scores: { overall_percentage: 75, overall_marks: 86, overall_max_marks: 115 } });
      expect(vm.overall).toBe(75);
      expect(vm.marks).toBe(86);
      expect(vm.max).toBe(115);
    });
  });

  describe('HOTS — 5 areas', () => {
    const a = {
      framework: 'hots',
      areas: {
        classroom_environment: { area_score: 7, area_max: 9 },
        lesson_planning: { area_score: 5, area_max: 9 },
        instructional_strategies: { area_score: 8, area_max: 12 },
        student_engagement: { area_score: 6, area_max: 9 },
        assessment_feedback: { area_score: 4, area_max: 9 },
      },
      scores: { overall_percentage: 62 },
    };

    it('returns 5 groups A1..A5 with displayName from rubric', () => {
      const vm = buildScoreViewModel(a);
      expect(vm.groups).toHaveLength(5);
      expect(vm.groups.map((g) => g.key)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
      expect(vm.groups[0].name).toBe('Classroom Environment');
      expect(vm.groups[3].name).toBe('Student Engagement');
    });

    it('A1 score/max land at 7 / 9 / 78%', () => {
      const vm = buildScoreViewModel(a);
      expect(vm.groups[0].score).toBe(7);
      expect(vm.groups[0].max).toBe(9);
      expect(vm.groups[0].pct).toBe(78);
    });

    it('missing areas → 0 score, indicatorCount × 3 max', () => {
      const vm = buildScoreViewModel({ framework: 'hots', areas: {}, scores: {} });
      // classroom_environment: 3 indicators × 3 = 9
      expect(vm.groups[0].score).toBe(0);
      expect(vm.groups[0].max).toBe(9);
    });
  });

  describe('TEACH — 3 areas + Time on Task = 4 groups', () => {
    const a = {
      framework: 'teach',
      areas: {
        classroom_culture: { area_score: 8, area_max: 10 },
        instruction: { area_score: 14, area_max: 20 },
        socioemotional: { area_score: 10, area_max: 15 },
      },
      time_on_task: { score: 4 },
      scores: { overall_percentage: 72 },
    };

    it('returns 4 groups T1..T4 with Time on Task first', () => {
      const vm = buildScoreViewModel(a);
      expect(vm.groups).toHaveLength(4);
      expect(vm.groups.map((g) => g.key)).toEqual(['T1', 'T2', 'T3', 'T4']);
      expect(vm.groups[0].name).toBe('Time on Task');
    });

    it('T1 = Time on Task, max 5, score 4, pct 80', () => {
      const vm = buildScoreViewModel(a);
      expect(vm.groups[0].score).toBe(4);
      expect(vm.groups[0].max).toBe(5);
      expect(vm.groups[0].pct).toBe(80);
    });

    it('missing time_on_task → T1 score 0', () => {
      const vm = buildScoreViewModel({ framework: 'teach', areas: {}, scores: {} });
      expect(vm.groups[0].score).toBe(0);
      expect(vm.groups[0].max).toBe(5);
    });
  });

  describe('FICO — 5 domains', () => {
    const a = {
      framework: 'fico',
      domains: {
        lesson_structure: { domain_score: 12, domain_max: 16 },
        instructional_quality: { domain_score: 14, domain_max: 20 },
        classroom_climate: { domain_score: 13, domain_max: 16 },
        student_engagement: { domain_score: 11, domain_max: 16 },
        assessment_feedback: { domain_score: 10, domain_max: 16 },
      },
      scores: { overall_percentage: 71 },
    };

    it('returns 5 groups D1..D5 from domain_score/domain_max', () => {
      const vm = buildScoreViewModel(a);
      expect(vm.groups).toHaveLength(5);
      expect(vm.groups.map((g) => g.key)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
      expect(vm.groups[0].name).toBe('Lesson Structure');
      expect(vm.groups[0].score).toBe(12);
      expect(vm.groups[0].max).toBe(16);
      expect(vm.groups[0].pct).toBe(75);
    });

    it('falls back to area_score/area_max when domain_* missing', () => {
      const a2 = {
        framework: 'fico',
        areas: { lesson_structure: { area_score: 9, area_max: 16 } },
      };
      const vm = buildScoreViewModel(a2);
      expect(vm.groups[0].score).toBe(9);
      expect(vm.groups[0].max).toBe(16);
    });
  });

  describe('MEWAKA — 6 domains at domain altitude', () => {
    const a = {
      framework: 'mewaka',
      language: 'sw',
      domains: {
        introduction:         { domain_score: 4,  domain_max: 6 },
        content_delivery:     { domain_score: 18, domain_max: 24 },
        teaching_methods:     { domain_score: 14, domain_max: 21 },
        learner_involvement:  { domain_score: 6,  domain_max: 9 },
        classroom_management: { domain_score: 7,  domain_max: 9 },
        conclusion:           { domain_score: 4,  domain_max: 6 },
      },
      scores: { overall_percentage: 70 },
    };

    it('returns 6 groups A..F in rubric order', () => {
      const vm = buildScoreViewModel(a);
      expect(vm.groups).toHaveLength(6);
      expect(vm.groups.map((g) => g.key)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    });

    it('language="sw" returns displayName_sw, "en" returns displayName', () => {
      const sw = buildScoreViewModel({ ...a, language: 'sw' }).groups[0].name;
      const en = buildScoreViewModel({ ...a, language: 'en' }).groups[0].name;
      expect(sw).toBe('Utangulizi');
      expect(en).toBe('Introduction');
      expect(sw).not.toBe(en);
    });

    it('A1 = Utangulizi, 4/6, 67%', () => {
      const vm = buildScoreViewModel(a);
      expect(vm.groups[0].name).toBe('Utangulizi');
      expect(vm.groups[0].score).toBe(4);
      expect(vm.groups[0].max).toBe(6);
      expect(vm.groups[0].pct).toBe(67);
    });

    it('falls back to area_score/area_max if a session has the legacy shape', () => {
      const legacy = {
        framework: 'mewaka',
        areas: { introduction: { area_score: 3, area_max: 6 } },
      };
      const vm = buildScoreViewModel(legacy);
      expect(vm.groups[0].score).toBe(3);
      expect(vm.groups[0].max).toBe(6);
    });
  });

  describe('Unknown framework — empty groups (safety net)', () => {
    it('framework="unknown" returns groups: []', () => {
      const vm = buildScoreViewModel({ framework: 'unknown' });
      expect(vm.framework).toBe('unknown');
      expect(vm.groups).toEqual([]);
    });

    it('getScoreAdapter returns a function for any input (never throws)', () => {
      const fn = getScoreAdapter('completely-made-up');
      expect(typeof fn).toBe('function');
      expect(fn({})).toEqual([]);
    });
  });
});
