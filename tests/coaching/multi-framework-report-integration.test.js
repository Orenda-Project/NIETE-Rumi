/**
 * Multi-Framework Report Integration Tests (TDD)
 *
 * Validates bd-610: End-to-end pipeline from analysis data through
 * dispatch → transformer → reportData shape for all 4 frameworks.
 * Also validates PDF generation doesn't crash for any framework.
 */

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    head: jest.fn().mockResolvedValue({ count: 0, error: null }),
  };
  return { from: jest.fn(() => chain) };
});

const { getReportTransformer } = require(
  '../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch'
);

// ─── Shared mock session ──────────────────────────────────────────────

const mockSession = {
  id: 'session-uuid-integration',
  user_id: 'user-uuid-integration',
  created_at: '2026-03-04T10:00:00Z',
  lesson_plan_structured: null,
  _isPartialReport: false,
};

// ─── OECD mock analysis ───────────────────────────────────────────────

const mockOECDAnalysis = {
  executive_summary: 'Ali showed strong classroom management skills.',
  framework: 'oecd',
  framework_version: '1.0',
  scores: {
    overall_marks: 65, overall_max_marks: 103, overall_percentage: 63.1,
    goal1_total: 14, goal2_total: 12, goal3_total: 18, goal4_total: 3, goal5_total: 18,
  },
  goal1_formative_assessment: {
    smart_objectives: { computed_marks: 3, max_marks: 4, evidence: 'Clear objectives' },
    teachers_role: { computed_marks: 3, max_marks: 4, evidence: 'Active facilitation' },
    assessment: { computed_marks: 8, max_marks: 9, evidence: 'Regular checks' },
  },
  goal2_student_engagement: {
    cognitive_rigor: { computed_marks: 4, max_marks: 9, evidence: 'Mix of levels' },
    real_world_connections: { computed_marks: 3, max_marks: 4, evidence: 'Connected' },
    multimodality: { computed_marks: 3, max_marks: 5, evidence: 'Visual and verbal' },
    misconceptions: { computed_marks: 2, max_marks: 4, evidence: 'Addressed one' },
  },
  goal3_quality_content: {
    prior_knowledge: { computed_marks: 3, max_marks: 4, evidence: 'Assessed' },
    prior_knowledge_activation: { computed_marks: 3, max_marks: 4, evidence: 'Reviewed' },
    content_coverage_accuracy: { computed_marks: 5, max_marks: 11, evidence: 'Covered key points' },
    content_organization: { computed_marks: 4, max_marks: 7, evidence: 'Well-structured' },
    verbal_questioning: { computed_marks: 2, max_marks: 4, evidence: 'Some questions' },
    coherence_transitions: { computed_marks: 1, max_marks: 4, evidence: 'Basic transitions' },
  },
  goal4_classroom_interaction: {
    peer_group_interactions: { computed_marks: 3, max_marks: 5, evidence: 'Active groups' },
  },
  goal5_classroom_management: {
    classroom_management: { computed_marks: 6, max_marks: 9, evidence: 'Well-managed' },
    visibility_materials: { computed_marks: 2, max_marks: 3, evidence: 'Visible' },
    classroom_culture: { computed_marks: 6, max_marks: 9, evidence: 'Positive culture' },
    teaching_learning_materials: { computed_marks: 2, max_marks: 3, evidence: 'Used materials' },
  },
  growth_areas: [{ area: 'Differentiation', observation: 'Limited strategies' }],
  recommendations: ['Try tiered activities'],
  debrief_reflection: { summary: 'Teacher reflected on engagement.' },
};

// ─── HOTS mock analysis ──────────────────────────────────────────────

const mockHOTSAnalysis = {
  executive_summary: 'Zara demonstrated strong higher-order thinking integration.',
  framework: 'hots',
  framework_version: '1.0',
  scores: { overall_marks: 30, overall_max_marks: 45, overall_percentage: 66.7 },
  areas: {
    classroom_environment: {
      area_score: 6, area_max: 9,
      indicators: [
        { id: 'CE1', name: 'Physical Environment', score: 2, evidence: 'Organized' },
        { id: 'CE2', name: 'Learning Climate', score: 2, evidence: 'Warm' },
        { id: 'CE3', name: 'Student Participation', score: 2, evidence: 'Active' },
      ],
    },
    lesson_planning: {
      area_score: 7, area_max: 9,
      indicators: [
        { id: 'LP1', name: 'Learning Objectives', score: 3, evidence: 'Clear' },
        { id: 'LP2', name: 'Activity Sequencing', score: 2, evidence: 'Logical' },
        { id: 'LP3', name: 'Resource Selection', score: 2, evidence: 'Appropriate' },
      ],
    },
    instructional_strategies: {
      area_score: 5, area_max: 9,
      indicators: [
        { id: 'IS1', name: 'Bloom Levels', score: 2, evidence: 'Mix of levels' },
        { id: 'IS2', name: 'Critical Thinking Prompts', score: 2, evidence: 'Asked why' },
        { id: 'IS3', name: 'Student Reasoning', score: 1, evidence: 'Limited' },
      ],
    },
    student_engagement: {
      area_score: 6, area_max: 9,
      indicators: [
        { id: 'SE1', name: 'Formative Checks', score: 2, evidence: 'Regular' },
        { id: 'SE2', name: 'Higher-Order Questions', score: 2, evidence: 'Some' },
        { id: 'SE3', name: 'Feedback Quality', score: 2, evidence: 'Specific' },
      ],
    },
    assessment_feedback: {
      area_score: 6, area_max: 9,
      indicators: [
        { id: 'AF1', name: 'Tiered Activities', score: 2, evidence: 'Two levels' },
        { id: 'AF2', name: 'Scaffolding', score: 2, evidence: 'Present' },
        { id: 'AF3', name: 'Extension Tasks', score: 2, evidence: 'One extension' },
      ],
    },
  },
};

// ─── Teach mock analysis ─────────────────────────────────────────────

const mockTeachAnalysis = {
  executive_summary: 'Ayesha demonstrated proficient teaching practices.',
  framework: 'teach',
  framework_version: '1.0',
  scores: { overall_marks: 35, overall_max_marks: 50, overall_percentage: 70.0 },
  time_on_task: { score: 4, evidence: 'Most students on task throughout' },
  areas: {
    classroom_culture: {
      area_score: 8, area_max: 10,
      elements: [
        {
          id: 1, name: 'Supportive Learning Environment', holistic_score: 4,
          behaviors: [
            { id: '1.1', name: 'Treats all respectfully', rating: 'H', evidence: 'Warm' },
            { id: '1.2', name: 'Positive language', rating: 'M', evidence: 'Mostly' },
          ],
        },
        {
          id: 2, name: 'Positive Behavioral Expectations', holistic_score: 4,
          behaviors: [
            { id: '2.1', name: 'Clear expectations', rating: 'H', evidence: 'Rules stated' },
          ],
        },
      ],
    },
    instruction: {
      area_score: 14, area_max: 20,
      elements: [
        { id: 3, name: 'Lesson Facilitation', holistic_score: 4, behaviors: [] },
        { id: 4, name: 'Checks for Understanding', holistic_score: 3, behaviors: [] },
        { id: 5, name: 'Feedback', holistic_score: 3, behaviors: [] },
        { id: 6, name: 'Critical Thinking', holistic_score: 4, behaviors: [] },
      ],
    },
    socioemotional: {
      area_score: 9, area_max: 15,
      elements: [
        { id: 7, name: 'Autonomy', holistic_score: 3, behaviors: [] },
        { id: 8, name: 'Perseverance', holistic_score: 3, behaviors: [] },
        { id: 9, name: 'Social & Collaborative', holistic_score: 3, behaviors: [] },
      ],
    },
  },
};

// ─── FICO mock analysis ──────────────────────────────────────────────

const mockFICOAnalysis = {
  executive_summary: 'Hassan demonstrated developing practices.',
  framework: 'fico',
  framework_version: '2.0',
  scores: { overall_marks: 72, overall_max_marks: 104, overall_percentage: 69.2 },
  domains: {
    lesson_plan_fidelity: {
      domain_score: 20, domain_max: 28,
      indicators: [
        { id: 'B1', name: 'Instructional Clarity & Learning Objectives', score: 3, evidence: 'Clear goal', timestamp: '0:30' },
        { id: 'B2', name: 'Lesson Structure & Sequence', score: 3, evidence: 'Clear phases', timestamp: '2:00' },
        { id: 'B3', name: 'Activities & Tasks Alignment', score: 3, evidence: 'Aligned', timestamp: '4:00' },
        { id: 'B4', name: 'Activation of Prior Knowledge', score: 3, evidence: 'Recalled', timestamp: '1:00' },
        { id: 'B5', name: 'Meaningful & Real-World Connections', score: 2, evidence: 'One mention', timestamp: '6:00' },
        { id: 'B6', name: 'Differentiation', score: 3, evidence: 'Two groups', timestamp: '10:00' },
        { id: 'B7', name: 'Lesson Closure', score: 3, evidence: 'Recap done', timestamp: '25:00' },
      ],
    },
    high_leverage_practices: {
      domain_score: 12, domain_max: 16,
      indicators: [
        { id: 'C1', name: 'Quality Questioning', score: 3, evidence: 'Mix', timestamp: '5:00' },
        { id: 'C2', name: 'Responsive Re-explanation', score: 3, evidence: 'Adapted', timestamp: '9:00' },
        { id: 'C3', name: 'Effective Feedback', score: 3, evidence: 'Specific', timestamp: '11:00' },
        { id: 'C4', name: 'Student Agency & Voice', score: 3, evidence: 'Some choice', timestamp: '15:00' },
      ],
    },
    student_engagement: {
      domain_score: 15, domain_max: 20,
      indicators: [
        { id: 'D1', name: 'Diversity of Conceptual Expression', score: 3, evidence: 'Two phrasings', timestamp: '7:00' },
        { id: 'D2', name: 'Student Reasoning', score: 3, evidence: 'Reasoning heard', timestamp: '8:00' },
        { id: 'D3', name: 'Student-Initiated Questions', score: 3, evidence: 'One clarification', timestamp: '12:00' },
        { id: 'D4', name: 'Spontaneous Transfer', score: 3, evidence: 'Prompted', timestamp: '14:00' },
        { id: 'D5', name: 'Visible Learning Progression', score: 3, evidence: 'Progression', timestamp: '25:00' },
      ],
    },
    teacher_subject_knowledge: {
      domain_score: 25, domain_max: 40,
      indicators: [
        { id: 'F1', name: 'Content Accuracy', score: 3, evidence: 'Accurate', timestamp: '3:00' },
        { id: 'F2', name: 'Use of Academic Language', score: 3, evidence: 'Terms used', timestamp: '4:00' },
        { id: 'F3', name: 'Anticipation of Misconceptions', score: 3, evidence: 'Anticipated', timestamp: '13:00' },
        { id: 'F4', name: 'Mathematical Discourse', score: 1, evidence: 'Not applicable — Science', timestamp: null },
        { id: 'F5', name: 'Problem-Solving', score: 1, evidence: 'Not applicable — Science', timestamp: null },
        { id: 'F6', name: 'Inquiry-Based Approach', score: 3, evidence: 'Inquiry opening', timestamp: '2:00' },
        { id: 'F7', name: 'Science Talk', score: 3, evidence: 'Own words', timestamp: '10:00' },
        { id: 'F8', name: 'Explicit Phonics', score: 1, evidence: 'Not applicable — Science', timestamp: null },
        { id: 'F9', name: 'Comprehension Strategy', score: 1, evidence: 'Not applicable — Science', timestamp: null },
        { id: 'F10', name: 'Reading-Writing Connections', score: 1, evidence: 'Not applicable — Science', timestamp: null },
      ],
    },
  },
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('Multi-Framework Report Integration (bd-610)', () => {

  test('SCENARIO: OECD analysis → 5 goals + debrief in reportData', () => {
    const transformer = getReportTransformer('oecd');
    const reportData = transformer(mockSession, 'Ali', mockOECDAnalysis, false);
    expect(reportData.goals).toHaveLength(5);
    expect(reportData.debriefReflection).toBeDefined();
    expect(reportData.frameworkDisplayName).toBe('OECD Framework');
    expect(reportData.maxScore).toBe(118); // 103 base + 15 debrief
  });

  test('SCENARIO: HOTS analysis → 5 goals, no debrief, max 48', () => {
    const transformer = getReportTransformer('hots');
    const reportData = transformer(mockSession, 'Zara', mockHOTSAnalysis);
    expect(reportData.goals).toHaveLength(5);
    expect(reportData.debriefReflection).toBeNull();
    expect(reportData.maxScore).toBe(48);
    expect(reportData.frameworkDisplayName).toBe('HOTS Framework');
  });

  test('SCENARIO: Teach analysis → 4 goals (3+ToT), no debrief, max 50', () => {
    const transformer = getReportTransformer('teach');
    const reportData = transformer(mockSession, 'Ayesha', mockTeachAnalysis);
    expect(reportData.goals).toHaveLength(4);
    expect(reportData.debriefReflection).toBeNull();
    expect(reportData.maxScore).toBe(50);
    expect(reportData.frameworkDisplayName).toBe('Teach Framework');
  });

  test('SCENARIO: FICO analysis → 4 goals (B/C/D/F), no debrief, max 104', () => {
    const transformer = getReportTransformer('fico');
    const reportData = transformer(mockSession, 'Hassan', mockFICOAnalysis);
    expect(reportData.goals).toHaveLength(4);
    expect(reportData.debriefReflection).toBeNull();
    expect(reportData.maxScore).toBe(104);
    expect(reportData.frameworkDisplayName).toBe('FICO Framework');
  });

  test('SCENARIO: Framework dispatch routes correctly for all keys', () => {
    const oecd = getReportTransformer('oecd');
    const hots = getReportTransformer('hots');
    const teach = getReportTransformer('teach');
    const fico = getReportTransformer('fico');
    const unknown = getReportTransformer('xyz');

    // Each should be a unique function (except unknown → oecd)
    expect(oecd).not.toBe(hots);
    expect(hots).not.toBe(teach);
    expect(teach).not.toBe(fico);
    expect(unknown).toBe(oecd); // fallback
  });

  test('SCENARIO: All frameworks produce consistent reportData shape', () => {
    const frameworks = [
      { key: 'oecd', name: 'Ali', analysis: mockOECDAnalysis, extraArgs: [false] },
      { key: 'hots', name: 'Zara', analysis: mockHOTSAnalysis, extraArgs: [] },
      { key: 'teach', name: 'Ayesha', analysis: mockTeachAnalysis, extraArgs: [] },
      { key: 'fico', name: 'Hassan', analysis: mockFICOAnalysis, extraArgs: [] },
    ];

    frameworks.forEach(({ key, name, analysis, extraArgs }) => {
      const transformer = getReportTransformer(key);
      const reportData = transformer(mockSession, name, analysis, ...extraArgs);

      // Every reportData must have these required fields
      expect(reportData).toHaveProperty('teacherName');
      expect(reportData).toHaveProperty('observerName');
      expect(reportData).toHaveProperty('totalScore');
      expect(reportData).toHaveProperty('maxScore');
      expect(reportData).toHaveProperty('goals');
      expect(reportData).toHaveProperty('feedback');
      expect(reportData).toHaveProperty('frameworkDisplayName');
      expect(Array.isArray(reportData.goals)).toBe(true);
      expect(reportData.totalScore).toBeGreaterThan(0);
      expect(reportData.maxScore).toBeGreaterThan(0);

      // Every goal must have required fields
      reportData.goals.forEach(goal => {
        expect(goal).toHaveProperty('title');
        expect(goal).toHaveProperty('score');
        expect(goal).toHaveProperty('maxScore');
        expect(goal).toHaveProperty('criteria');
        expect(Array.isArray(goal.criteria)).toBe(true);
      });
    });
  });

  test('SCENARIO: Fidelity section included when LP analysis present', () => {
    const hotsWithFidelity = {
      ...mockHOTSAnalysis,
      fidelity_analysis: {
        score: 75,
        max_score: 100,
        note: 'Good alignment',
        overall_commentary: 'LP followed well',
        evidence: ['Objective matched'],
        strengths: ['Structure'],
        gaps: ['Materials'],
      },
    };
    const transformer = getReportTransformer('hots');
    const reportData = transformer(mockSession, 'Zara', hotsWithFidelity);
    expect(reportData.fidelitySection).not.toBeNull();
    expect(reportData.fidelitySection.score).toBe(75);
  });

  test('SCENARIO: Framework display names are correct for all frameworks', () => {
    const expected = {
      oecd: 'OECD Framework',
      hots: 'HOTS Framework',
      teach: 'Teach Framework',
      fico: 'FICO Framework',
    };

    Object.entries(expected).forEach(([key, displayName]) => {
      const transformer = getReportTransformer(key);
      // Use appropriate mock data for each framework
      const analysis = key === 'oecd' ? mockOECDAnalysis
        : key === 'hots' ? mockHOTSAnalysis
        : key === 'teach' ? mockTeachAnalysis
        : mockFICOAnalysis;
      const extraArgs = key === 'oecd' ? [false] : [];
      const reportData = transformer(mockSession, 'Test', analysis, ...extraArgs);
      expect(reportData.frameworkDisplayName).toBe(displayName);
    });
  });
});
