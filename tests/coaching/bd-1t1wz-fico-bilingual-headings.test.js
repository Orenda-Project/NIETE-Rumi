/**
 * bd-1t1wz — the Urdu-variant DC report carries Qurat's bracketed Urdu section
 * labels; the English variant stays English-only (operator scoping, 2026-08-26).
 * Ports the main bot's bd-43483 displayName_ur pattern onto FICO.
 */
const { buildFicoGroups } = require('../../bot/shared/services/coaching/report-v2/score-adapters/fico-adapter');
const { buildScoreViewModel } = require('../../bot/shared/services/coaching/report-v2/score-adapter.service');

const analysis = { framework: 'fico', domains: {
  lesson_plan_fidelity:      { domain_score: 30, domain_max: 40, indicators: [] },
  high_leverage_practices:   { domain_score: 36, domain_max: 48, indicators: [] },
  student_engagement:        { domain_score: 20, domain_max: 28, indicators: [] },
  teacher_subject_knowledge: { domain_score: 24, domain_max: 32, indicators: [] },
} };

describe('bd-1t1wz — FICO section labels are language-aware', () => {
  it('ur → all four bilingual bracketed labels, verbatim (Qurat 2026-08-26)', () => {
    const names = buildFicoGroups(analysis, 'ur').map((g) => g.name);
    expect(names).toEqual([
      'Lesson Plan Fidelity (سبق کے منصوبے پر عمل درآمد)',
      'High-Leverage Practices (مؤثر تدریسی طریقے)',
      'Student Engagement (طلبہ کی شمولیت)',
      'Teacher Subject Knowledge (استاد کا مضمون سے متعلق علم)',
    ]);
  });

  it('en → English-only labels, zero Arabic-block characters', () => {
    const names = buildFicoGroups(analysis, 'en').map((g) => g.name);
    expect(names).toEqual([
      'Lesson Plan Fidelity', 'High-Leverage Practices',
      'Student Engagement', 'Teacher Subject Knowledge',
    ]);
    names.forEach((n) => expect(n).not.toMatch(/[؀-ۿ]/));
  });

  it('every group exposes domainKey (why-mapping key) alongside the sheet letter', () => {
    const groups = buildFicoGroups(analysis, 'en');
    expect(groups.map((g) => g.key)).toEqual(['B', 'C', 'D', 'F']);
    expect(groups.map((g) => g.domainKey)).toEqual([
      'lesson_plan_fidelity', 'high_leverage_practices',
      'student_engagement', 'teacher_subject_knowledge',
    ]);
  });

  it('flows through buildScoreViewModel with opts.language', () => {
    const vm = buildScoreViewModel(analysis, { framework: 'fico', language: 'ur' });
    expect(vm.groups[0].name).toContain('سبق کے منصوبے پر عمل درآمد');
  });
});
