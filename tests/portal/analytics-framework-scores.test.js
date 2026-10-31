/**
 * FICO averages hold FICO scores only (bd-97daxo.10).
 *
 * Gilgit-Baltistan's coaching history came from main Rumi scored on HOTS (Moawin's framework); the
 * migration keeps it with coaching_sessions.framework = 'hots'. A HOTS percentage is a different rubric,
 * so the analytics' "Avg FICO" / HITL averages and the FICO section averages must not take it in. The
 * session still COUNTS (an observation happened); it just carries no FICO score.
 *
 * FDE's numbers do not move: ICT sessions are framework 'fico' or unset, and those score as before.
 * An 'oecd' session also scores as before — FDE's v8 populations hold some, and re-basing FDE's averages
 * is not this change.
 */

const { loadCountedSessions, createScoreMemo } = require('../../dashboard/services/schools-analytics.service');

const session = (id, framework, observation_type = null) => ({
  id, updated_at: '2026-10-02T00:00:00Z', user_id: `u-${id}`, school_id: 's1', is_test: false, observation_type, framework,
});
const scoreRow = (id) => ({
  id, updated_at: '2026-10-02T00:00:00Z', scores: { overall_marks: 60, overall_max_marks: 100 },
  b_score: '20', b_max: '40', b_assessed: null, c_score: '24', c_max: '48', c_assessed: null, d_score: '14', d_max: '28', d_assessed: null,
});

function fakeQuery(sessions) {
  return async (sql, params) => {
    if (/FROM coaching_sessions c\s+JOIN users u/.test(sql)) {
      // the sessions read must carry the framework, or no caller can tell a HOTS score apart
      expect(sql).toMatch(/c\.framework/);
      return { rows: sessions };
    }
    if (/analysis_data #> '\{\}'/.test(sql)) return { rows: params[0].map(scoreRow) };
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  };
}

describe('FICO averages take FICO scores only', () => {
  it('a HOTS session counts but carries no FICO score; fico, unset and oecd score as before', async () => {
    const rows = [session('f', 'fico'), session('n', null), session('o', 'oecd'), session('h', 'hots'),
      session('hh', 'hots', 'leader_observation')];
    const { sessions } = await loadCountedSessions(fakeQuery(rows), {}, { memo: createScoreMemo() });
    const by = Object.fromEntries(sessions.map((s) => [s.id, s]));

    expect(sessions).toHaveLength(5);
    for (const id of ['f', 'n', 'o']) {
      expect(by[id].pct).toBe(60);
      expect(by[id].sections).toEqual({ b: 50, c: 50, d: 50 });
    }
    for (const id of ['h', 'hh']) {
      expect(by[id].pct).toBeNull();
      expect(by[id].sections).toEqual({ b: null, c: null, d: null });
    }
    expect(by.hh.observation_type).toBe('leader_observation');
  });
});
