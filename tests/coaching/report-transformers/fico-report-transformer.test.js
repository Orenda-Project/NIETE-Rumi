/**
 * FICO Report Transformer Tests — ICT Canonical Rubric.
 *
 * Transforms FICO analysis (4 scored sections B/C/D/F, 26 indicators, max 104)
 * into the generic reportData shape consumed by pdf-report.service.js and the
 * hero renderer.
 */

jest.mock('../../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

const { transformFICOToReportData } = require(
  '../../../bot/shared/services/coaching/report-transformers/fico-report-transformer'
);

// ─── Shared mock data ────────────────────────────────────────────────

const mockSession = {
  id: 'session-uuid-fico',
  user_id: 'user-uuid-fico',
  created_at: '2026-03-04T12:00:00Z',
  lesson_plan_structured: null,
  _isPartialReport: false,
};

const mockFICOAnalysis = {
  domains: {
    lesson_plan_fidelity: {
      domain_score: 20, domain_max: 28,
      indicators: [
        { id: 'B1', name: 'Instructional Clarity & Learning Objectives', score: 3, evidence: 'Clear goal stated', timestamp: '0:30' },
        { id: 'B2', name: 'Lesson Structure & Sequence',                 score: 3, evidence: 'Clear phases',      timestamp: '2:00' },
        { id: 'B3', name: 'Activities & Tasks Alignment',                score: 3, evidence: 'Aligned',            timestamp: '4:00' },
        { id: 'B4', name: 'Activation of Prior Knowledge',               score: 3, evidence: 'Recalled',           timestamp: '1:00' },
        { id: 'B5', name: 'Meaningful & Real-World Connections',         score: 2, evidence: 'One mention',        timestamp: '6:00' },
        { id: 'B6', name: 'Differentiation / Catering to Learning Levels', score: 3, evidence: 'Two groups',       timestamp: '10:00' },
        { id: 'B7', name: 'Lesson Closure & Consolidation',              score: 3, evidence: 'Recap done',         timestamp: '25:00' },
      ],
    },
    high_leverage_practices: {
      domain_score: 12, domain_max: 16,
      indicators: [
        { id: 'C1', name: "Quality Questioning (Bloom's Aligned)",          score: 3, evidence: 'Mix of questions', timestamp: '5:00' },
        { id: 'C2', name: 'Responsive Re-explanation & Adaptive Teaching', score: 3, evidence: 'Adapted',           timestamp: '9:00' },
        { id: 'C3', name: 'Effective Feedback',                            score: 3, evidence: 'Specific',          timestamp: '11:00' },
        { id: 'C4', name: 'Student Agency & Voice',                        score: 3, evidence: 'Some choice',       timestamp: '15:00' },
      ],
    },
    student_engagement: {
      domain_score: 15, domain_max: 20,
      indicators: [
        { id: 'D1', name: 'Diversity of Conceptual Expression',            score: 3, evidence: 'Two phrasings',     timestamp: '7:00' },
        { id: 'D2', name: 'Student Reasoning in Responses',                score: 3, evidence: 'Reasoning heard',   timestamp: '8:00' },
        { id: 'D3', name: 'Student-Initiated Questions',                   score: 3, evidence: 'One clarification', timestamp: '12:00' },
        { id: 'D4', name: 'Spontaneous Transfer & Connection-Making',      score: 3, evidence: 'Prompted',          timestamp: '14:00' },
        { id: 'D5', name: 'Visible Learning Progression Across the Lesson', score: 3, evidence: 'Progression',      timestamp: '25:00' },
      ],
    },
    teacher_subject_knowledge: {
      domain_score: 25, domain_max: 40,
      indicators: [
        { id: 'F1', name: 'Content Accuracy',                        score: 3, evidence: 'Accurate',   timestamp: '3:00' },
        { id: 'F2', name: 'Use of Academic Language',                score: 3, evidence: 'Terms used', timestamp: '4:00' },
        { id: 'F3', name: 'Anticipation of Student Misconceptions',  score: 3, evidence: 'Anticipated', timestamp: '13:00' },
        { id: 'F4', name: 'Mathematical Discourse & Reasoning',      score: 1, evidence: 'Not applicable — Science', timestamp: null },
        { id: 'F5', name: 'Problem-Solving & Productive Struggle',   score: 1, evidence: 'Not applicable — Science', timestamp: null },
        { id: 'F6', name: 'Inquiry-Based Approach',                  score: 3, evidence: 'Inquiry opening', timestamp: '2:00' },
        { id: 'F7', name: 'Science Talk & Student Sense-Making',     score: 3, evidence: 'Own words',   timestamp: '10:00' },
        { id: 'F8', name: 'Explicit Phonics / Decoding',             score: 1, evidence: 'Not applicable — Science', timestamp: null },
        { id: 'F9', name: 'Comprehension Strategy Instruction',      score: 1, evidence: 'Not applicable — Science', timestamp: null },
        { id: 'F10', name: 'Reading-Writing Connections',            score: 1, evidence: 'Not applicable — Science', timestamp: null },
      ],
    },
  },
  scores: { overall_marks: 72, overall_max_marks: 104, overall_percentage: 69.2 },
  executive_summary: 'Hassan demonstrated developing practices with strong lesson structure.',
  framework: 'fico',
  framework_version: '2.0',
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('FICO Report Transformer (ICT canonical rubric)', () => {

  test('SCENARIO: Produces 4 goals from 4 FICO sections (B/C/D/F)', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    expect(reportData.goals).toHaveLength(4);
  });

  test('SCENARIO: Section titles are prefixed with Section letter', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    expect(reportData.goals[0].title).toContain('Section B');
    expect(reportData.goals[1].title).toContain('Section C');
    expect(reportData.goals[2].title).toContain('Section D');
    expect(reportData.goals[3].title).toContain('Section F');
  });

  test('SCENARIO: Indicators have max 4 (FICO 1-4 scale)', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    reportData.goals.forEach(goal => {
      goal.criteria.forEach(c => {
        expect(c.max).toBe(4);
      });
    });
  });

  test('SCENARIO: Criteria have name (id-prefixed), score, max, evidence, timestamp', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    const c = reportData.goals[0].criteria[0];
    // Section B, first indicator = B1
    expect(c.name).toBe('B1 Instructional Clarity & Learning Objectives');
    expect(c.score).toBe(3);
    expect(c.max).toBe(4);
    expect(c.evidence).toBe('Clear goal stated');
    expect(c.timestamp).toBe('0:30');
    expect(c.photoEvidence).toBeNull();
  });

  test('SCENARIO: maxScore is 104 (26 indicators × 4)', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    expect(reportData.maxScore).toBe(104);
  });

  test('SCENARIO: photoEvidence is always null (rubric is audio-scoreable)', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    reportData.goals.forEach(goal => {
      goal.criteria.forEach(c => {
        expect(c.photoEvidence).toBeNull();
      });
    });
  });

  test('SCENARIO: debriefReflection is null', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    expect(reportData.debriefReflection).toBeNull();
  });

  test('SCENARIO: priorFeedback is null', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    expect(reportData.priorFeedback).toBeNull();
  });

  test('SCENARIO: frameworkDisplayName is "FICO Framework"', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    expect(reportData.frameworkDisplayName).toBe('FICO Framework');
  });

  test('SCENARIO: totalScore matches sum of section scores', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    const goalSum = reportData.goals.reduce((sum, g) => sum + g.score, 0);
    expect(reportData.totalScore).toBe(goalSum);
    expect(reportData.totalScore).toBe(72); // 20+12+15+25
  });

  test('SCENARIO: Missing sections produce empty goals array', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', { scores: {}, domains: {} });
    expect(reportData.goals).toEqual([]);
    expect(reportData.totalScore).toBe(0);
  });

  test('SCENARIO: Correct metadata fields', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    expect(reportData.teacherName).toBe('Hassan');
    expect(reportData.observerName).toBe('Rumi Digital Coach');
    expect(reportData.feedback).toContain('Hassan demonstrated');
  });

  test('SCENARIO: framework key preserved on reportData (drives renderer dispatch)', () => {
    const reportData = transformFICOToReportData(mockSession, 'Hassan', mockFICOAnalysis);
    expect(reportData.framework).toBe('fico');
  });
});
