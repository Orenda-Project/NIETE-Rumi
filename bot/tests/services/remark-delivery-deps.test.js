/**
 * The seam between the live wiring and the pure service.
 *
 * remark-delivery.test.js exercises submitRemark with hand-built deps, and every
 * score row it writes is already shaped {ordinal, score}. Nothing exercised
 * makeDeliveryDeps — the code that actually produces those rows in production —
 * so the suite stayed green while no teacher ever received a coaching note.
 *
 * What broke: loadScores selected `indicator_ordinal` and returned the rows
 * untouched, while computeS requires `ordinal` and throws on anything else. That
 * throw happens ABOVE both try/catch blocks in submitRemark, so it took the
 * narrative, the teacher's note AND the principal's confirmation with it. Scores
 * still persisted and the principal still saw SUCCESS, which is why it looked
 * healthy from the outside.
 *
 * The retry worker got this right all along (it maps indicator_ordinal → ordinal),
 * so these tests pin the contract at the boundary the two halves disagreed about:
 * whatever loadScores returns must be something computeS accepts.
 */
const path = require('path');

const SUPABASE_PATH = path.join(__dirname, '../../shared/config/supabase.js');

/** Chainable stub returning the row shape PostgREST really hands back. */
function makeStub(rows) {
  const calls = { from: [], select: [], eq: [] };
  const chain = {
    select(cols) { calls.select.push(cols); return chain; },
    eq(col, val) { calls.eq.push([col, val]); return chain; },
    then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
  };
  return { calls, client: { from(t) { calls.from.push(t); return chain; } } };
}

function loadDeps(stubClient) {
  jest.resetModules();
  jest.doMock(SUPABASE_PATH, () => stubClient, { virtual: false });
  jest.doMock(path.join(__dirname, '../../shared/utils/logger.js'), () => ({
    logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
  }));
  const { makeDeliveryDeps } = require('../../shared/services/remark/remark-delivery.deps');
  return makeDeliveryDeps({
    principal: { id: 'p-1', phone_number: '923001234567', first_name: 'Sara' },
    teacherLabelFor: () => 'Ayesha Bibi',
  });
}

afterEach(() => { jest.resetModules(); jest.dontMock(SUPABASE_PATH); });

// The five STEPS indicators as Postgres returns them.
const DB_ROWS = [
  { indicator_ordinal: 1, score: 3 },
  { indicator_ordinal: 2, score: 4 },
  { indicator_ordinal: 3, score: 2 },
  { indicator_ordinal: 4, score: 3 },
  { indicator_ordinal: 5, score: 4 },
];

describe('loadScores returns rows computeS can read', () => {
  test('every row carries a numeric `ordinal`, not just `indicator_ordinal`', async () => {
    const deps = loadDeps(makeStub(DB_ROWS).client);
    const rows = await deps.loadScores('r-1');

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(typeof row.ordinal).toBe('number');
      expect(typeof row.score).toBe('number');
    }
  });

  test('computeS accepts them — the throw that killed every delivery', async () => {
    const deps = loadDeps(makeStub(DB_ROWS).client);
    const rows = await deps.loadScores('r-1');

    // Required after the mock so the module under test shares it.
    const { computeS } = require('../../shared/services/remark/remark-rubric');
    expect(() => computeS(rows)).not.toThrow();

    const { s_score, s_pct } = computeS(rows);
    expect(s_score).toBe(16);
    expect(typeof s_pct).toBe('number');
  });

  test('the ordinals survive the mapping in order', async () => {
    const deps = loadDeps(makeStub(DB_ROWS).client);
    const rows = await deps.loadScores('r-1');
    expect(rows.map((r) => r.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.score)).toEqual([3, 4, 2, 3, 4]);
  });

  test('an empty result stays empty rather than becoming a bad row', async () => {
    const deps = loadDeps(makeStub([]).client);
    await expect(deps.loadScores('r-1')).resolves.toEqual([]);
  });

  test('still reads the scores table, scoped to the remark', async () => {
    const stub = makeStub(DB_ROWS);
    const deps = loadDeps(stub.client);
    await deps.loadScores('r-1');
    expect(stub.calls.from).toEqual(['supervisor_remark_scores']);
    expect(stub.calls.eq).toEqual([['remark_id', 'r-1']]);
  });
});
