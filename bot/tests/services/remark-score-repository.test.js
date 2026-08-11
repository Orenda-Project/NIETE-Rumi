/**
 * bd-2531 — the s_pct accessor contract.
 *
 * The score is computed by a Postgres VIEW, which is invisible to grep. These
 * tests are the second half of that fix: they NAME the view, so an agent
 * searching for "where is s_pct calculated" lands here even if they never open
 * the migration.
 *
 * What is asserted is the CONTRACT, not Supabase's behaviour:
 *   * every read goes to v_supervisor_remark_scores — never to the raw tables,
 *     which would bypass the submitted/complete guarantees
 *   * the flat sub-score columns STEPS consumes are all selected
 *   * an absent row surfaces as null ("no score"), never as 0 ("scored zero")
 */
const path = require('path');

const SUPABASE_PATH = path.join(__dirname, '../../shared/config/supabase.js');

// Minimal chainable stub standing in for the PostgREST builder.
function makeStub(result) {
  const calls = { from: [], select: [], eq: [] };
  const chain = {
    select(cols) { calls.select.push(cols); return chain; },
    eq(col, val) { calls.eq.push([col, val]); return chain; },
    maybeSingle() { return Promise.resolve(result); },
    then(resolve) { return Promise.resolve(result).then(resolve); },
  };
  return {
    calls,
    client: { from(t) { calls.from.push(t); return chain; } },
  };
}

function loadRepo(stubClient) {
  jest.resetModules();
  jest.doMock(SUPABASE_PATH, () => stubClient, { virtual: false });
  return require('../../shared/services/remark/remark-score.repository');
}

afterEach(() => { jest.resetModules(); jest.dontMock(SUPABASE_PATH); });

describe('bd-2531 — reads target the VIEW, not the tables', () => {
  test('VIEW is the s_pct view', () => {
    const { VIEW } = loadRepo(makeStub({ data: null, error: null }).client);
    expect(VIEW).toBe('v_supervisor_remark_scores');
  });

  test('getTeacherScore queries the view, scoped by teacher + cycle', async () => {
    const stub = makeStub({ data: null, error: null });
    const repo = loadRepo(stub.client);
    await repo.getTeacherScore('t-1', 'c-1');
    expect(stub.calls.from).toEqual(['v_supervisor_remark_scores']);
    expect(stub.calls.eq).toEqual([['teacher_id', 't-1'], ['cycle_id', 'c-1']]);
  });

  test('getCycleScores and getPrincipalScores also hit the view', async () => {
    for (const [fn, args] of [['getCycleScores', ['c-1']], ['getPrincipalScores', ['p-1', 'c-1']]]) {
      const stub = makeStub({ data: [], error: null });
      const repo = loadRepo(stub.client);
      await repo[fn](...args);
      expect(stub.calls.from).toEqual(['v_supervisor_remark_scores']);
    }
  });
});

describe('bd-2531 — the STEPS export columns are all selected', () => {
  test('SCORE_COLUMNS are the five published sub-score names, in rubric order', () => {
    const { SCORE_COLUMNS } = loadRepo(makeStub({ data: null, error: null }).client);
    expect(SCORE_COLUMNS).toEqual([
      'score_growth', 'score_collaboration', 'score_leadership',
      'score_student_support', 'score_parents',
    ]);
  });

  test('the select list carries every sub-score plus s_score and s_pct', async () => {
    const stub = makeStub({ data: null, error: null });
    const repo = loadRepo(stub.client);
    await repo.getTeacherScore('t-1', 'c-1');
    const select = stub.calls.select[0];
    for (const col of [...repo.SCORE_COLUMNS, 's_score', 's_pct']) {
      expect(select).toContain(col);
    }
  });

  test('SCORE_COLUMNS match the rubric object exactly (drift guard)', () => {
    // Two lists of the same published contract WILL drift. Fail loudly here
    // rather than silently exporting a renamed column to BigQuery.
    const { SCORE_COLUMNS } = loadRepo(makeStub({ data: null, error: null }).client);
    const { INDICATORS } = require('../../shared/services/remark/remark-rubric');
    expect(SCORE_COLUMNS).toEqual(INDICATORS.map((i) => i.key));
  });
});

describe('bd-2531 — absent means NO SCORE, never zero', () => {
  test('a missing row returns null, not a zeroed object', async () => {
    // The dangerous misread: treating "not submitted yet" as 0% in someone's
    // ACR. The view omits partials entirely, so the accessor must surface that
    // as null and force the caller to decide.
    const stub = makeStub({ data: null, error: null });
    const repo = loadRepo(stub.client);
    await expect(repo.getTeacherScore('t-1', 'c-1')).resolves.toBeNull();
  });

  test('an empty cycle returns [] rather than throwing', async () => {
    const stub = makeStub({ data: null, error: null });
    const repo = loadRepo(stub.client);
    await expect(repo.getCycleScores('c-1')).resolves.toEqual([]);
  });

  test('a query error throws with the view named (so the failure is findable)', async () => {
    const stub = makeStub({ data: null, error: { message: 'relation missing' } });
    const repo = loadRepo(stub.client);
    await expect(repo.getTeacherScore('t-1', 'c-1')).rejects.toThrow(/getTeacherScore failed/);
  });
});
