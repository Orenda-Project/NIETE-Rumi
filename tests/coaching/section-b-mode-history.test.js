/**
 * The "prefer C/D/F when she usually attaches a plan" rule needs real history,
 * or it is dead code. RED FIRST — loadRecentSectionBModes does not exist and
 * nextTarget does not thread the option through to chooseTarget.
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const { loadRecentSectionBModes } = require('../../bot/shared/services/coaching/coaching-trend.service');
const loop = require('../../bot/shared/services/coaching/uptake-loop.service');

let calls;
function stub(rows, { error = null } = {}) {
  calls = { select: [], eq: [], neq: [], order: [], limit: [] };
  mockSupabase.from.mockImplementation(() => {
    const chain = {};
    for (const m of ['select', 'eq', 'neq', 'order', 'limit', 'in', 'is', 'not']) {
      chain[m] = jest.fn((...a) => { if (calls[m]) calls[m].push(a); return chain; });
    }
    chain.then = (resolve) => resolve({ data: rows, error });
    return chain;
  });
}
beforeEach(() => jest.clearAllMocks());

describe('loadRecentSectionBModes', () => {
  test('maps the nested flag to derived/proxy, newest first', async () => {
    stub([{ mode: true }, { mode: null }, { mode: true }]);
    expect(await loadRecentSectionBModes('u1')).toEqual(['derived', 'proxy', 'derived']);
  });
  test('selects only the nested flag — never the whole analysis_data blob', async () => {
    stub([]);
    await loadRecentSectionBModes('u1', { excludeSessionId: 's9', limit: 3 });
    const sel = calls.select[0][0];
    expect(sel).toContain('analysis_data->domains->lesson_plan_fidelity->fidelity_derived');
    expect(sel).not.toMatch(/(^|,)\s*analysis_data\s*(,|$)/);
    expect(calls.neq).toContainEqual(['id', 's9']);
    expect(calls.order[0]).toEqual(['created_at', { ascending: false }]);
    expect(calls.limit[0]).toEqual([3]);
  });
  test('empty, error and missing user all yield [] — never throws', async () => {
    stub([]); expect(await loadRecentSectionBModes('u1')).toEqual([]);
    stub(null, { error: { message: 'boom' } }); expect(await loadRecentSectionBModes('u1')).toEqual([]);
    expect(await loadRecentSectionBModes(null)).toEqual([]);
    mockSupabase.from.mockImplementation(() => { throw new Error('down'); });
    expect(await loadRecentSectionBModes('u1')).toEqual([]);
  });
});

describe('nextTarget threads the history through to chooseTarget', () => {
  const ok = (id, score) => ({ id, name: id, score, applicable: true });
  const a = {
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: [ok('B1', 0)] },
      high_leverage_practices: { indicators: [ok('C4', 1)] },
    },
    focus_area: { domain: 'lesson_plan_fidelity', indicator: 'B1', try_this_tomorrow: 'x' },
  };
  test('no history → the B row wins; a derived-heavy history → C/D/F', () => {
    expect(loop.nextTarget(null, 'no_prior', a).target.indicator).toBe('B1');
    expect(loop.nextTarget(null, 'no_prior', a, { recentModes: ['derived', 'derived', 'derived'] }).target.indicator).toBe('C4');
  });
  test('the history also applies when a closed target reopens a fresh one', () => {
    const prior = {
      target: { indicator: 'C1', domain: 'high_leverage_practices', name: 'C1' },
      action_spec: { count_target: loop.countBarFor('C1') }, baseline: { rung: 1, count: {} },
      attempt: 2, angle: 'cue', achieved_streak: 1, target_status: 'open',
    };
    const withC1 = JSON.parse(JSON.stringify(a));
    withC1.domains.high_leverage_practices.indicators.push(ok('C1', 2));
    const out = loop.nextTarget(prior, 'achieved', withC1, { recentModes: ['derived', 'derived'] });
    expect(out.closed.indicator).toBe('C1');
    expect(out.target.indicator).not.toBe('B1');
  });
});

describe('the carry step actually asks for the history', () => {
  const SRC = require('fs').readFileSync(
    require.resolve('../../bot/shared/services/coaching/report-generator.service'), 'utf8');
  test('report-generator loads the modes and passes them to nextTarget', () => {
    expect(SRC).toContain('loadRecentSectionBModes');
    const i = SRC.indexOf('loadRecentSectionBModes');
    expect(SRC.slice(i, i + 900)).toMatch(/nextTarget\([^)]*recentModes|recentModes/);
  });
});
