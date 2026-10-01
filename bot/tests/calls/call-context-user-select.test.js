/**
 * The caller lookup must ask only for columns that exist (bd-1hae7.20).
 *
 * #888 moved everyone onto users.name and trimmed first_name/last_name out of
 * fetchUser's select. The trim took the trailing ", " with it, so the two string
 * literals now concatenate into `subjects_taughtgrade` — a column that does not
 * exist — and `grade` itself has since left the users table too. PostgREST
 * rejects the WHOLE select when any column is unknown:
 *
 *   staging, 2026-09-30:  column users.subjects_taughtgrade does not exist  (400)
 *
 * fetchUser throws on that, the context build treats it as a soft failure, and
 * every call proceeds as an anonymous one: no name, no role, no coaching, no
 * lessons. Nothing errors loudly — the assistant simply never knows who rang.
 *
 * `grade` and `subject` are only ever read as fallbacks behind `grades_taught`
 * and `subjects_taught` (call-context.service), so they are dropped, not fixed:
 * `grade` is gone from the database and `subject` is absent from the canonical
 * schema a fresh clone is built from.
 */

function capturingClient(captured) {
  const b = {};
  ['eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'gte', 'lte'].forEach((m) => { b[m] = () => b; });
  b.select = (cols) => { captured.push(cols); return b; };
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  return { from: () => b };
}

function selectedColumns() {
  jest.resetModules();
  const captured = [];
  const client = capturingClient(captured);
  jest.doMock('../../shared/config/supabase', () => client);
  jest.doMock('../../shared/config/supabase-replica', () => ({
    readWithFallback: (run) => run(client),
    isReplicaEnabled: () => false,
  }));
  const repo = require('../../shared/calls/call-context.repo');
  return repo.fetchUser('923001234567').then(() => captured[0]
    .split(',').map((c) => c.trim()).filter(Boolean));
}

// Every column here was checked against the live staging users table on
// 2026-09-30 (each returned 200 on its own).
const LIVE_USERS_COLUMNS = new Set([
  'id', 'name', 'school_name', 'grades_taught', 'subjects_taught',
  'preferred_language', 'role', 'region', 'organization',
]);

describe('fetchUser asks only for columns that exist', () => {
  test('no two column names are glued together by a missing comma', async () => {
    const cols = await selectedColumns();
    expect(cols).not.toContain('subjects_taughtgrade');
    cols.forEach((c) => expect(c).toMatch(/^[a-z_]+$/));
  });

  test('every selected column exists on the live users table', async () => {
    const cols = await selectedColumns();
    const unknown = cols.filter((c) => !LIVE_USERS_COLUMNS.has(c));
    expect(unknown).toEqual([]);
  });

  test('the columns the call actually needs are still asked for', async () => {
    const cols = await selectedColumns();
    ['id', 'name', 'grades_taught', 'subjects_taught', 'preferred_language', 'role']
      .forEach((c) => expect(cols).toContain(c));
  });
});
