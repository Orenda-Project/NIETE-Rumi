/**
 * A DROPPED URDU TOGGLE IS AN EVENT, NOT ONLY A COLUMN — bd-vnyuw.
 *
 * `overlay_dropped` has been on `niete_lp612_renders` since V1.3.3 and it was written correctly
 * every time. It still took a 17-cell diagram review to notice that it was `true` on 6 of 6
 * delivered Urdu lessons — because a boolean on a row is only seen by someone who thinks to run
 * the query, and nobody did for the whole life of the lane.
 *
 * Rule 24(b): a silent fallback is a regression mask, and the mask here was that the fallback
 * left no trace anywhere anyone was looking. So the worker emits the RATE: `lp612.overlay.dropped`
 * when the toggle is missing, and `lp612.overlay.applied` when it is not — because a denominator
 * that only exists on failures is not a denominator, and "did the fix hold?" is a question about
 * the ratio.
 *
 * Red-first: on this branch's base the worker emits neither event, in any case.
 */

const mockAuthorLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockUploadBuffer = jest.fn();
const mockDeliverRender = jest.fn();
const mockSendMessage = jest.fn();
const mockReadFile = jest.fn();
const mockLogEvent = jest.fn();

jest.mock('../../bot/shared/services/lp612-author.service', () => ({
  authorLessonPlan: mockAuthorLessonPlan,
}));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: mockRenderLessonPlan,
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: mockUploadBuffer }));
jest.mock('../../bot/shared/services/lp612-serving.service', () => {
  const real = jest.requireActual('../../bot/shared/services/lp612-serving.service');
  return {
    deliverRender: mockDeliverRender,
    r2KeyFor: (s, l, t) => `lp612/${t}/${l}/${s}.pdf`,
    assertKeyInPrefix: real.assertKeyInPrefix,
  };
});
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: mockSendMessage }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../bot/shared/utils/structured-logger'),
  logEvent: (...a) => mockLogEvent(...a),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: (...a) => mockReadFile(...a) },
}));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    mockDbCalls.push({ ...state });
    if (state.op === 'update') {
      const idFilter = state.filters.find((f) => f[0] === 'id');
      return Promise.resolve({ data: { id: idFilter ? idFilter[1] : 'row' }, error: null });
    }
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
let seededWaiters = [];
const mockRpc = jest.fn(() => Promise.resolve({ data: seededWaiters, error: null }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const Worker = require('../../bot/workers/lp612-author.worker');

const EN_SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008',
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  subtopic_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  is_religious: false,
  language: 'en',
};
const UR_SEGMENT = { ...EN_SEGMENT, language: 'ur' };

const jobFor = (lang) => ({
  renderId: 'render-1',
  segmentId: EN_SEGMENT.segment_id,
  lang,
  templateVersion: 'v9.1',
  correlationId: 'corr-1',
});

function seed(segment) {
  seededWaiters = [{ user_id: 'u1', phone: '92300', ui_lang: 'ur' }];
  mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: seededWaiters }, error: null });
  mockDbResults.push({ data: segment, error: null });
}

const events = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockUploadBuffer.mockResolvedValue('ok');
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'x' }, lintClean: true, fails: [], rounds: 3,
    model: 'anthropic/claude-sonnet-5',
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 12, warnings: [], overlayApplied: [],
  });
  mockDeliverRender.mockResolvedValue();
});

describe('the worker emits the overlay RATE, not just a boolean on a row', () => {
  it('a dropped toggle emits lp612.overlay.dropped, naming the segment and the media', async () => {
    seed(EN_SEGMENT);
    await Worker.process(jobFor('ur'));

    expect(events('lp612.overlay.dropped')).toHaveLength(1);
    expect(events('lp612.overlay.dropped')[0][1]).toEqual(expect.objectContaining({
      renderId: 'render-1',
      segmentId: EN_SEGMENT.segment_id,
      correlationId: 'corr-1',
      lang: 'ur',
      medium: 'en',
      pointers: 0,
    }));
    expect(events('lp612.overlay.applied')).toHaveLength(0);
  });

  it('an applied toggle emits lp612.overlay.applied with the pointer count — the denominator', async () => {
    seed(EN_SEGMENT);
    mockRenderLessonPlan.mockResolvedValue({
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 12, warnings: [],
      overlayApplied: ['/objectives/outcome', '/sections/0/blocks/0/text'],
    });

    await Worker.process(jobFor('ur'));

    expect(events('lp612.overlay.dropped')).toHaveLength(0);
    expect(events('lp612.overlay.applied')).toHaveLength(1);
    expect(events('lp612.overlay.applied')[0][1]).toEqual(expect.objectContaining({ pointers: 2 }));
  });

  it('says nothing at all for an Urdu-MEDIUM book — there is no toggle to lose', async () => {
    seed(UR_SEGMENT);
    await Worker.process(jobFor('ur'));
    expect(events('lp612.overlay.dropped')).toHaveLength(0);
    expect(events('lp612.overlay.applied')).toHaveLength(0);
  });

  it('says nothing at all for an English delivery', async () => {
    seed(EN_SEGMENT);
    await Worker.process(jobFor('en'));
    expect(events('lp612.overlay.dropped')).toHaveLength(0);
    expect(events('lp612.overlay.applied')).toHaveLength(0);
  });

  it('the event and the column can never disagree — both come from the same decision', async () => {
    seed(EN_SEGMENT);
    await Worker.process(jobFor('ur'));
    const ready = mockDbCalls.find((c) => c.op === 'update' && c.payload && c.payload.status === 'ready');
    expect(ready.payload.overlay_dropped).toBe(true);
    expect(events('lp612.overlay.dropped')).toHaveLength(1);
  });
});
