/**
 * bd-aqotzx — her Digital Coach list (GET /teacher/coaching/history) when a recording did not sound like a class:
 *   waiting for her answer → the row says "Needs your answer" (not "Analysing");
 *   closed after 24 hours unanswered → the row stays, marked stopped, and opens the note saying why;
 *   neither one counts in her numbers (sessions, minutes, reports) or the trend.
 * Every other stopped session stays out of the list, as before.
 */
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const S = () => require('../../dashboard/services/teacher-coaching.service');

function fakeQuery(rows) {
  const calls = [];
  const query = jest.fn(async (sql, params) => { calls.push({ sql, params }); return { rows: String(sql).includes('teacher-coaching:history') ? rows : [] }; });
  query.calls = calls;
  return query;
}
const row = (o) => ({ status: 'completed', failed_step: null, audio_duration_seconds: 1800, scores: null, topic: null, subject: null, grade: null, ...o });
const RANGE = { key: 'all', from: null, to: null };

beforeEach(() => { jest.resetModules(); });

test('waiting for her answer, and closed unanswered: in the list with their state, out of the numbers', async () => {
  const query = fakeQuery([
    row({ id: 'w', created_at: '2026-10-19T04:00:00Z', status: 'awaiting_class_confirm' }),
    row({ id: 'x', created_at: '2026-10-17T04:00:00Z', status: 'cancelled', failed_step: 'not_a_class_no_answer', audio_duration_seconds: 1587 }),
    row({ id: 'd', created_at: '2026-10-16T04:00:00Z', scores: { overall_percentage: 64 } }),
  ]);
  const out = await S().dcHistory(query, TEACHER, { range: RANGE });

  expect(out.items.map((i) => [i.id, i.state])).toEqual([['w', 'needs_answer'], ['x', 'stopped'], ['d', undefined]]);
  expect(out.items.find((i) => i.id === 'x').reportReady).toBe(false);
  expect(out.kpis.sessions.value).toBe(2);          // w and d; the stopped one is not a lesson she sent
  expect(out.kpis.minutes.value).toBe(60);
  expect(out.kpis.reports.value).toBe(1);
  expect(out.total).toBe(2);
  expect(out.trend.points.reduce((a, b) => a + b, 0)).toBe(2);
});

test('the query keeps only the not-a-class close among stopped sessions', async () => {
  const query = fakeQuery([]);
  await S().dcHistory(query, TEACHER, { range: RANGE });
  const sql = query.calls[0].sql;
  expect(sql).toMatch(/failed_step/);
  expect(sql).toMatch(/not_a_class_no_answer/);
});
