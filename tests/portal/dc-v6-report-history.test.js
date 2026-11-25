/**
 * Queue #282 / bd-ra8xu.64.2 — a teacher's report pages when the report was scored on FICO17 v6 (the 11).
 *
 *   - The portal report journey (teacher-coaching.service journey) and the /cr page journey (coaching-report-view)
 *     draw her V3 points; beside a v6 report they would put an older V3 lesson's % as "now". For a v6 report: no
 *     journey (the WhatsApp hero already leaves it out). A V3 report keeps its V3-only line.
 *   - The /cr page's sections read V3 keys only, so a v6 report had none: they come from v6_teacher / v6_children /
 *     v6_subject (domain_score / domain_max), plus B from the plan steps; a section with no levelled row is not
 *     assessed, never "0/0".
 *
 * The portal service is answered by a tagged-SQL fake (the database is the boundary); the /cr view is pure.
 */
const S = () => require('../../dashboard/services/teacher-coaching.service');
const { buildReportView } = require('../../dashboard/services/coaching-report-view');

const TEACHER = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const SESSION = '0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

function fakeQuery(answers = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    const tag = (String(sql).match(/teacher-coaching:([a-z-]+)/) || [])[1];
    return { rows: answers[tag] || [] };
  });
  query.sqlOf = (tag) => (calls.find((c) => c.sql.includes(`teacher-coaching:${tag}`)) || {});
  return query;
}

const V6_SCORES = { overall_marks: 17, overall_max_marks: 28, overall_percentage: 60.7, counted: 7, rubric: 'fico17_v6' };
const row = (id, result) => ({ id, name: `Name of ${id}`, kind: 'dc', result, score: typeof result === 'number' ? result : null, applicable: typeof result === 'number' });
/** A switched-on self-recording: C 8/16, D every row couldn't-tell, F 9/12, its plan read at 75%. */
const V6 = {
  framework: 'fico17_v6', rubric: 'fico17_v6', indicator_set: 'dc11',
  scores: V6_SCORES,
  domains: {
    v6_teacher: { key: 'C', name: 'What the teacher does', domain_score: 8, domain_max: 16, indicators_applicable: 4, indicators: [row('C1', 2), row('C2', 2), row('C4', 2), row('C6', 2), row('C8', 'IE')] },
    v6_children: { key: 'D', name: 'What the children do', domain_score: 0, domain_max: 0, indicators_applicable: 0, indicators: [row('D1', 'IE'), row('D5', 'IE')] },
    v6_subject: { key: 'F', name: 'Subject knowledge', domain_score: 9, domain_max: 12, indicators_applicable: 3, indicators: [row('F1', 3), row('F2', 3), row('F3', 3), row('F4', 'IE')] },
  },
  lp_fidelity: { status: 'ok', fidelity_pct: 75, moves: [] },
  report_narrative: { domain_whys: { v6_teacher: 'You asked many questions.' } },
  v3_fico: { domains: { high_leverage_practices: { domain_score: 30, domain_max: 48 } }, scores: { overall_percentage: 62 } },
};

beforeEach(() => { jest.resetModules(); });

describe('queue #282 / bd-ra8xu.64.2: the portal report journey', () => {
  test('a v6 report: no journey (never V3 points beside it), and the history is not read', async () => {
    const query = fakeQuery({
      owner: [{ id: SESSION, created_at: '2026-11-24T06:00:00Z', scores: V6_SCORES, framework: 'fico17_v6' }],
      journey: [
        { created_at: '2026-11-24T06:00:00Z', scores: V6_SCORES },
        { created_at: '2026-11-10T06:00:00Z', scores: { overall_percentage: 58 } },
        { created_at: '2026-11-01T06:00:00Z', scores: { overall_percentage: 52 } },
      ],
    });
    expect(await S().journey(query, TEACHER, SESSION)).toEqual([]);
    expect(query.sqlOf('owner').sql).toMatch(/analysis_data->'scores'/); // the scores only, never the whole analysis_data
    expect(query.sqlOf('journey').sql).toBeUndefined();
  });

  test('a V3 report after v6 ones: its line keeps the V3 points only', async () => {
    const query = fakeQuery({
      owner: [{ id: SESSION, created_at: '2026-11-24T06:00:00Z', scores: { overall_percentage: 64 }, framework: 'fico' }],
      journey: [
        { created_at: '2026-11-24T06:00:00Z', scores: { overall_percentage: 64 } },
        { created_at: '2026-11-20T06:00:00Z', scores: V6_SCORES },
        { created_at: '2026-11-01T06:00:00Z', scores: { overall_percentage: 52 } },
      ],
    });
    expect(await S().journey(query, TEACHER, SESSION)).toEqual([{ date: '2026-11-01', pct: 52 }, { date: '2026-11-24', pct: 64 }]);
  });
});

describe('queue #282 / bd-ra8xu.64.2: the /cr report page of a v6 report', () => {
  const view = (language = 'en', trend = [{ pct: 52 }, { pct: 58 }]) => buildReportView({ session: { analysis_data: V6 }, firstName: 'Ayesha', language, trend });

  test('no journey beside a v6 report', () => {
    expect(view().journey).toBeNull();
  });

  test('its sections: B from the plan, then C, D, F from the v6 rows; D (nothing levelled) is not assessed, never 0/0', () => {
    expect(view().sections).toEqual([
      { key: 'lesson_plan_fidelity', name: 'Following the lesson plan', score: 30, max: 40, pct: 75, colour: 'green', notAssessed: false, why: null },
      { key: 'v6_teacher', name: 'What the teacher does', score: 8, max: 16, pct: 50, colour: 'red', notAssessed: false, why: 'You asked many questions.' },
      { key: 'v6_children', name: 'What the children do', score: null, max: null, pct: null, colour: null, notAssessed: true, why: null },
      { key: 'v6_subject', name: 'Subject knowledge', score: 9, max: 12, pct: 75, colour: 'green', notAssessed: false, why: null },
    ]);
  });

  test('in Urdu: the English name with the Urdu one in brackets, as the V3 rows', () => {
    const names = view('ur').sections.map((s) => s.name);
    expect(names[1]).toMatch(/^What the teacher does \(.+\)$/);
    expect(names[1]).not.toBe('What the teacher does ()');
  });

  test('no plan read: B is not assessed', () => {
    const out = buildReportView({ session: { analysis_data: { ...V6, lp_fidelity: { status: 'lp_absent' } } }, language: 'en', trend: [] });
    expect(out.sections[0]).toMatchObject({ key: 'lesson_plan_fidelity', notAssessed: true, score: null, max: null });
  });

  test('a V3 report keeps its journey and its V3 sections', () => {
    const v3 = { domains: { high_leverage_practices: { domain_score: 30, domain_max: 48 } }, scores: { overall_percentage: 62 } };
    const out = buildReportView({ session: { analysis_data: v3 }, language: 'en', trend: [{ pct: 52 }, { pct: 62 }] });
    expect(out.journey).toEqual({ points: [52, 62], first: 52, best: 62, now: 62 });
    expect(out.sections.map((s) => s.key)).toEqual(['high_leverage_practices']);
  });
});
