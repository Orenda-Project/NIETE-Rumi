/**
 * bd-xkkw9.5 — THE PAGE-CAP CHECK MUST MEASURE THE PAGE THE TEACHER GETS.
 *
 * niete-logs, production, 19-28 Nov: 24 of 188 delivered 6-12 lessons were over the cap. In 5 of
 * them every draft the ladder kept had passed the page check at 4 TEACH pages, and the final file
 * came out at 5. All 5 carry book figures. The worker staged the book crops (`stageFigures`) only
 * AFTER the ladder, right before the final render, so every gate render printed each book figure
 * as its words-only "book reference" card, and the final render printed the picture. Re-rendering
 * the 5 stored lessons locally: 4 TEACH pages without the crops, 5 with them.
 *
 * So the gate must stage a candidate's crops before it renders it. Then the ladder is told the
 * real page count while it can still act on it.
 *
 * Drives `Worker.process()` (the production call path); the ladder is mocked and calls the
 * `renderCheck` the worker hands it, which is the thing under test.
 */

const mockAuthorLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockStageFigures = jest.fn();
const mockOrder = [];

jest.mock('../../bot/shared/services/lp612-author.service', () => ({
  authorLessonPlan: (...a) => mockAuthorLessonPlan(...a),
}));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: (...a) => mockRenderLessonPlan(...a),
}));
jest.mock('../../bot/shared/services/lp612-pagetruth.service', () => ({
  refsFromDoc: (d) => (d && d.figs) || [],
  stageFigures: (...a) => mockStageFigures(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn().mockResolvedValue('k') }));
jest.mock('../../bot/shared/services/lp612-serving.service', () => {
  const real = jest.requireActual('../../bot/shared/services/lp612-serving.service');
  return {
    deliverRender: jest.fn().mockResolvedValue(undefined),
    r2KeyFor: (s, l, t) => `lp612/${t}/${l}/${s}.pdf`,
    assertKeyInPrefix: real.assertKeyInPrefix,
    docKeyFor: real.docKeyFor,
    SEND_TOTAL_BUDGET_MS: real.SEND_TOTAL_BUDGET_MS,
    readStoredDoc: jest.fn().mockResolvedValue(null),   // nothing to reuse: the ladder runs
  };
});
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 fake')) },
}));

const mockDbResults = [];
function mockBuilder() {
  const state = { op: null, filters: [] };
  const settle = () => {
    if (state.op === 'update') {
      const idFilter = state.filters.find((f) => f[0] === 'id');
      return Promise.resolve({ data: { id: idFilter ? idFilter[1] : 'row' }, error: null });
    }
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    update: () => { state.op = 'update'; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => mockBuilder()),
  rpc: jest.fn(async () => ({ data: [{ user_id: 'u1', phone: '923001111111' }], error: null })),
}));

const Worker = require('../../bot/workers/lp612-author.worker');

const SEG = {
  segment_id: 'grade_7_geography.c06.p073-073', book_stem: 'grade_7_geography', grade: 7,
  subject: 'Geography', subtopic_title: 'Climate', printed_page_start: 73, printed_page_end: 73, is_religious: false,
};
const JOB = { renderId: 'render-1', segmentId: SEG.segment_id, lang: 'en', templateVersion: 'v9.7', correlationId: 'corr-1' };
const FIGS = ['grade_7_geography/pg_073_f0', 'grade_7_geography/pg_073_f1'];

let gateResult;
beforeEach(() => {
  jest.clearAllMocks();
  mockOrder.length = 0;
  mockDbResults.length = 0;
  mockDbResults.push(
    { data: { id: 'render-1', status: 'authoring', waiters: [{ user_id: 'u1', phone: '923001111111' }] }, error: null },
    { data: SEG, error: null },
  );
  mockStageFigures.mockImplementation(async ({ refs, outDir }) => { mockOrder.push(['stage', refs, outDir]); });
  mockRenderLessonPlan.mockImplementation(async ({ phase, outDir }) => {
    mockOrder.push(['render', phase, outDir]);
    return { pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 2, pagesByPart: { teach: 4, support: 2 }, warnings: [] };
  });
  // The ladder: it gate-checks the draft it holds, which names two book figures.
  mockAuthorLessonPlan.mockImplementation(async ({ model, renderCheck }) => {
    gateResult = await renderCheck({ lesson_id: 'x', figs: FIGS });
    return { lpDoc: { lesson_id: 'x', figs: FIGS }, lintClean: true, fails: [], warns: [], rounds: 1, model };
  });
});

describe('the page-cap check renders a draft with its book pictures in place', () => {
  test('a draft\'s book crops are staged before its gate render, into the directory that render reads', async () => {
    await Worker.process(JOB);

    const gate = mockOrder.findIndex((e) => e[0] === 'render' && e[1] === 'gate');
    expect(gate).toBeGreaterThanOrEqual(0);
    const staged = mockOrder.slice(0, gate).filter((e) => e[0] === 'stage');
    expect(staged).toHaveLength(1);
    expect(staged[0][1]).toEqual(FIGS);
    expect(staged[0][2]).toBe(mockOrder[gate][2]);
    expect(gateResult).toEqual([]);
  });

  test('a draft with no book figures stages nothing before its gate render', async () => {
    mockAuthorLessonPlan.mockImplementation(async ({ model, renderCheck }) => {
      await renderCheck({ lesson_id: 'x' });
      return { lpDoc: { lesson_id: 'x' }, lintClean: true, fails: [], warns: [], rounds: 1, model };
    });
    await Worker.process(JOB);

    const gate = mockOrder.findIndex((e) => e[0] === 'render' && e[1] === 'gate');
    expect(mockOrder.slice(0, gate).filter((e) => e[0] === 'stage')).toHaveLength(0);
  });

  test('a crop that fails to arrive never fails the check: the draft is still measured', async () => {
    mockStageFigures.mockRejectedValue(new Error('crop missing'));
    await Worker.process(JOB);

    expect(mockOrder.some((e) => e[0] === 'render' && e[1] === 'gate')).toBe(true);
    expect(gateResult).toEqual([]);
  });
});
