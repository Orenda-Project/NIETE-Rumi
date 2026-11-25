/**
 * Queue #282 / bd-ra8xu.64.2 — the portal report's breakdown of a self-recording scored on FICO17 v6 (the 11).
 *
 *   - Section B (the plan steps followed) is one of the v6 adapter's groups, marked outsideTotal, with domainKey
 *     'lesson_plan_fidelity'. A v6 analysis has no such domain, so the breakdown dropped it although her WhatsApp
 *     image shows it. It is kept, and it never joins the marks.
 *   - A v6 section whose rows were all couldn't-tell comes out not assessed (with the adapter's words), never 0/0.
 *
 * The breakdown runs for real over the real adapter; nothing is mocked.
 */
const { buildBreakdown } = require('../../bot/shared/services/coaching/coaching-breakdown.service');

const row = (id, result) => ({ id, name: `Name of ${id}`, kind: 'dc', result, score: typeof result === 'number' ? result : null, applicable: typeof result === 'number', evidence: '' });
const V6 = (lp) => ({
  framework: 'fico17_v6', rubric: 'fico17_v6', indicator_set: 'dc11',
  scores: { overall_marks: 17, overall_max_marks: 28, overall_percentage: 60.7, counted: 7, rubric: 'fico17_v6' },
  domains: {
    v6_teacher: { key: 'C', name: 'What the teacher does', domain_score: 8, domain_max: 16, indicators: [row('C1', 2), row('C2', 2), row('C4', 2), row('C6', 2), row('C8', 'IE')] },
    v6_children: { key: 'D', name: 'What the children do', domain_score: 0, domain_max: 0, indicators: [row('D1', 'IE'), row('D5', 'IE')] },
    v6_subject: { key: 'F', name: 'Subject knowledge', domain_score: 9, domain_max: 12, indicators: [row('F1', 3), row('F2', 3), row('F3', 3), row('F4', 'IE')] },
  },
  ...(lp ? { lp_fidelity: lp } : {}),
});

describe('queue #282 / bd-ra8xu.64.2: the portal breakdown of a v6 report', () => {
  test('Section B (plan steps) is kept, outside the total; the marks are the v6 ones', () => {
    const b = buildBreakdown(V6({ status: 'ok', fidelity_pct: 75, moves: [] }), 'en');
    const plan = b.groups.find((g) => g.domainKey === 'lesson_plan_fidelity');
    expect(plan).toMatchObject({ key: 'B', score: 30, max: 40, pct: 75, outsideTotal: true });
    expect(b.groups.map((g) => g.domainKey).sort()).toEqual(['lesson_plan_fidelity', 'v6_children', 'v6_subject', 'v6_teacher']);
    expect(b).toMatchObject({ overall: 61, marks: 17, max: 28 });
  });

  test('no plan read: B is there and says not assessed, never a zero', () => {
    const b = buildBreakdown(V6({ status: 'lp_absent' }), 'en');
    expect(b.groups.find((g) => g.domainKey === 'lesson_plan_fidelity')).toMatchObject({ notAssessed: true, score: null, max: null });
  });

  test('a section whose rows were all couldn\'t-tell is not assessed with words, never 0/0', () => {
    const b = buildBreakdown(V6(), 'en');
    const d = b.groups.find((g) => g.domainKey === 'v6_children');
    expect(d).toMatchObject({ notAssessed: true, score: null, max: null });
    expect(typeof d.notAssessedWords).toBe('string');
    expect(d.notAssessedWords.length).toBeGreaterThan(0);
    expect(b.groups.some((g) => g.max === 0)).toBe(false);
  });

  test('a V3 report keeps only the sections it was scored on (unchanged)', () => {
    const v3 = { framework: 'fico', scores: { overall_marks: 30, overall_max_marks: 48, overall_percentage: 62.5 },
      domains: { high_leverage_practices: { domain_score: 30, domain_max: 48, indicators: [] } } };
    expect(buildBreakdown(v3, 'en').groups.map((g) => g.domainKey)).toEqual(['high_leverage_practices']);
  });
});
