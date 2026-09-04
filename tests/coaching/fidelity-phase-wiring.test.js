/**
 * The phase loop, wired. RED FIRST — without this the selector is dead code.
 *
 *  - loadRecentFidelity gives the carry step her last graded plans
 *  - the carry step computes a phase target only when THIS lesson was graded
 *  - the card coaches the PHASE (quoting what her plan asked for), never an
 *    indicator, when the target is a phase
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
const mockOpenAI = { chat: { completions: { create: jest.fn() } } };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: mockOpenAI }));

const { loadRecentFidelity } = require('../../bot/shared/services/coaching/coaching-trend.service');
const { buildPrompt, cardTarget } = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');

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
beforeEach(() => { jest.clearAllMocks(); mockOpenAI.chat.completions.create.mockReset(); });

describe('loadRecentFidelity', () => {
  test('returns the graded blobs newest first, shaped for choosePhaseTarget', async () => {
    stub([{ fid: { status: 'ok', moves: [{ phase: 'exit', verdict: 'not_done', counted: true }] } },
          { fid: { status: 'lp_absent' } }]);
    const out = await loadRecentFidelity('u1', { excludeSessionId: 's9' });
    expect(out).toEqual([
      { lp_fidelity: { status: 'ok', moves: [{ phase: 'exit', verdict: 'not_done', counted: true }] } },
      { lp_fidelity: { status: 'lp_absent' } },
    ]);
    expect(calls.select[0][0]).toContain('analysis_data->lp_fidelity');
    expect(calls.select[0][0]).not.toMatch(/(^|,)\s*analysis_data\s*(,|$)/);
    expect(calls.neq).toContainEqual(['id', 's9']);
    expect(calls.order[0]).toEqual(['created_at', { ascending: false }]);
  });
  test('empty, error, no user and a throw all yield [] — never throws', async () => {
    stub([]); expect(await loadRecentFidelity('u1')).toEqual([]);
    stub(null, { error: { message: 'boom' } }); expect(await loadRecentFidelity('u1')).toEqual([]);
    expect(await loadRecentFidelity(null)).toEqual([]);
    mockSupabase.from.mockImplementation(() => { throw new Error('down'); });
    expect(await loadRecentFidelity('u1')).toEqual([]);
  });
});

describe('the carry step computes a phase target only for a graded lesson', () => {
  const SRC = require('fs').readFileSync(
    require.resolve('../../bot/shared/services/coaching/report-generator.service'), 'utf8');
  test('it loads the fidelity history and passes a phaseTarget to nextTarget', () => {
    expect(SRC).toContain('loadRecentFidelity');
    expect(SRC).toMatch(/phaseTarget\s*=\s*choosePhaseTarget\(/);
    // the option must actually reach the state machine, not just be computed
    expect(SRC).toMatch(/nextTarget\([^;]*phaseTarget/);
  });
  test('it is gated on this lesson being fidelity-derived, so a no-plan lesson skips the query', () => {
    const i = SRC.indexOf('loadRecentFidelity');
    const around = SRC.slice(Math.max(0, i - 700), i + 200);
    expect(around).toMatch(/sectionBIsProxy|fidelity_derived|lp_fidelity/);
  });
});

describe('the card coaches the phase, not an indicator', () => {
  const PHASE = { kind: 'phase', phase: 'exit', name: 'The closing check' };
  const analysis = {
    framework: 'fico',
    strengths: [{ title: 'Warm questions' }],
    domains: { high_leverage_practices: { indicators: [{ id: 'C4', name: 'Student Agency & Voice', score: 0, applicable: true }] } },
    lp_fidelity: {
      status: 'ok',
      moves: [
        { phase: 'exit', verdict: 'not_done', counted: true, text: 'Exit ticket: each child writes one sentence naming a proper fraction they can now spot.' },
        { phase: 'explain', verdict: 'executed', counted: true, text: 'Model two examples on the board.' },
      ],
    },
  };
  const loop = { prior: null, status: 'no_prior', state: { target: PHASE, attempt: 1, angle: 'tell', target_status: 'open' } };

  test('cardTarget returns the phase, never an indicator', () => {
    const t = cardTarget(analysis, loop);
    expect(t.kind).toBe('phase');
    expect(t.phase).toBe('exit');
    expect(t.indicator).toBeUndefined();
  });
  test('the prompt names the phase and quotes what THIS plan asked for', () => {
    const p = buildPrompt('en', analysis, null, null, loop);
    expect(p).toMatch(/THE TARGET/);
    expect(p).toMatch(/closing check/i);
    expect(p).toContain('Exit ticket: each child writes one sentence');
    expect(p).toMatch(/lesson plan/i);
    expect(p).not.toMatch(/indicator C4/);
  });
  test('it asks for the phase NEXT lesson, not for this lesson\'s exact step', () => {
    const p = buildPrompt('en', analysis, null, null, loop);
    expect(p).toMatch(/next (class|lesson)/i);
  });
  test('an indicator target is unaffected', () => {
    const ind = { prior: null, status: 'no_prior', state: { target: { indicator: 'C4', domain: 'high_leverage_practices', name: 'Student Agency & Voice' }, attempt: 1, angle: 'tell', target_status: 'open' } };
    const p = buildPrompt('en', analysis, null, null, ind);
    expect(p).toMatch(/C4/);
    expect(p).not.toMatch(/closing check/i);
  });
});
