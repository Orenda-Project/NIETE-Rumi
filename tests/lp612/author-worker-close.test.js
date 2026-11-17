/**
 * bd-snkn32.50 — the READY-MADE 6-12 plan gets the same "Before they write" close her own plan got in bd-snkn32.48
 * (#4911): the plan's own "You can …" objectives read aloud + thumbs up/sideways/down, so the shelf reviewer's 5D can
 * pass on the catalogue lessons too. Added by code after the gates accept the document, so the printed PDF and the
 * stored .lp.json both carry it; the Urdu toggle keeps the worker's fixed wording, not the overlay model's.
 * Harness copied from overlay-pass-worker.test.js (one module-mock factory per file).
 */

describe('a ready-made 6-12 plan ends with the "Before they write" close, as her own plans do', () => {
  const mockAuthorLessonPlan = jest.fn();
  const mockOverlayLessonPlan = jest.fn();
  const mockRenderLessonPlan = jest.fn();
  const mockUploadBuffer = jest.fn();
  const mockDeliverRender = jest.fn();
  const mockReadFile = jest.fn();
  const mockLogEvent = jest.fn();

  jest.mock('../../bot/shared/services/lp612-author.service', () => ({
    authorLessonPlan: (...a) => mockAuthorLessonPlan(...a),
    overlayLessonPlan: (...a) => mockOverlayLessonPlan(...a),
  }));
  jest.mock('../../bot/shared/services/lp612-render.service', () => ({
    renderLessonPlan: (...a) => mockRenderLessonPlan(...a),
  }));
  jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: (...a) => mockUploadBuffer(...a) }));
  jest.mock('../../bot/shared/services/lp612-serving.service', () => {
    const real = jest.requireActual('../../bot/shared/services/lp612-serving.service');
    return {
      ...real,
      deliverRender: (...a) => mockDeliverRender(...a),
      r2KeyFor: (s, l, t) => `lp612/${t}/${l}/${s}.pdf`,
      assertKeyInPrefix: real.assertKeyInPrefix,
    };
  });
  jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a) }));
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
  const WAITERS = [{ user_id: 'u1', phone: '923001111111' }];
  const mockRpc = jest.fn(() => Promise.resolve({ data: WAITERS, error: null }));
  jest.mock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((t) => mockBuilder(t)),
    rpc: (...a) => mockRpc(...a),
  }));

  const Worker = require('../../bot/workers/lp612-author.worker');

  const JOB = {
    renderId: 'render-1',
    segmentId: 'grade_8_mathematics.c01.p006-009',
    lang: 'ur',
    templateVersion: 'v9.1',
    correlationId: 'corr-1',
  };
  const SEGMENT = {
    segment_id: JOB.segmentId, book_stem: 'grade_8_mathematics', grade: 8, subject: 'Mathematics',
    subtopic_title: 'Rational & irrational numbers', printed_page_start: 6, printed_page_end: 9,
    language: 'en', is_religious: false,
  };
  // The overlay model translated our box its own way; the worker's fixed Urdu wins.
  const OVERLAY = {
    '/one_screen': 'خلاصہ',
    '/objectives/items/0/text': 'آپ ناطق اعداد پہچان سکتے ہیں۔',
    '/sections/0/blocks/1/title': 'لکھائی سے پہلے',
  };
  const DOC = {
    lesson_id: 'x',
    objectives: { items: [{ text: 'You can tell rational from irrational numbers.' }] },
    sections: [{
      id: 'conclusion',
      blocks: [{ type: 'paragraph', text: 'Recap the two kinds of number.' }],
      exit_ticket: [{ q: 'Is root 2 rational?', a: 'No' }],
    }],
  };

  const englishRender = () => ({
    pdfPath: '/tmp/en.pdf', htmlPath: '/tmp/en.html', pageCount: 11, warnings: [],
    pagesByPart: { teach: 6, support: 5 }, overlayApplied: [],
  });
  const urduRender = () => ({
    pdfPath: '/tmp/ur.pdf', htmlPath: '/tmp/ur.html', pageCount: 12, warnings: [],
    pagesByPart: { teach: 7, support: 5 }, overlayApplied: Object.keys(OVERLAY),
  });

  function seed(seg = SEGMENT) {
    mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null });
    mockDbResults.push({ data: seg, error: null });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbCalls.length = 0;
    mockDbResults.length = 0;
    mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: WAITERS, error: null }));
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
    mockUploadBuffer.mockResolvedValue('ok');
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: JSON.parse(JSON.stringify(DOC)), lintClean: true, fails: [], warns: [], rounds: 1,
      model: 'anthropic/claude-sonnet-5',
    });
    mockOverlayLessonPlan.mockResolvedValue({
      overlay: OVERLAY, usage: { calls: 1, completion_tokens: 7000, total_tokens: 15000 },
    });
    // The ladder's gate renders, then the final English render, then the overlaid render.
    mockRenderLessonPlan.mockResolvedValue(englishRender());
  });

  const readyPatch = () => mockDbCalls.filter((c) => c.op === 'update' && c.payload && c.payload.status === 'ready').pop();
  const eventNames = () => mockLogEvent.mock.calls.map((c) => c[0]);

  const finalDoc = () => mockRenderLessonPlan.mock.calls.find((c) => c[0].phase === 'final')[0].lpDoc;
  const overlayDoc = () => mockRenderLessonPlan.mock.calls.find((c) => c[0].phase === 'overlay')[0].lpDoc;
  const storedDoc = () => JSON.parse(mockUploadBuffer.mock.calls.find((c) => String(c[1]).endsWith('.lp.json'))[0].toString('utf8'));
  const box = (doc) => doc.sections[0].blocks.find((b) => b.type === 'key_points' && b.title === 'Before they write');

  it('the printed and the stored English plan both end the conclusion with the close', async () => {
    seed();
    await Worker.process({ ...JOB, lang: 'en' });
    for (const doc of [finalDoc(), storedDoc()]) {
      expect(doc.sections[0].blocks.map((b) => b.title || b.type)).toEqual(['paragraph', 'Before they write']);
      expect(box(doc).items[0]).toBe('Read the success criteria aloud: You can tell rational from irrational numbers.');
      expect(box(doc).items[1]).toMatch(/thumbs up/);
    }
  });

  it('the Urdu toggle carries the fixed Urdu close, not the overlay model\'s wording', async () => {
    mockRenderLessonPlan.mockResolvedValueOnce(englishRender()).mockResolvedValueOnce(urduRender());
    seed();
    await Worker.process(JOB);
    const ov = overlayDoc().ur_overlay;
    expect(ov['/sections/0/blocks/1/title']).toBe('لکھنے سے پہلے');
    expect(ov['/sections/0/blocks/1/items/0']).toContain('آپ ناطق اعداد پہچان سکتے ہیں۔');
    expect(storedDoc().ur_overlay['/sections/0/blocks/1/title']).toBe('لکھنے سے پہلے');
  });

  it('an Urdu-medium book gets the close in Urdu in the block itself', async () => {
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: { ...JSON.parse(JSON.stringify(DOC)), provenance: { medium: 'ur' } },
      lintClean: true, fails: [], warns: [], rounds: 1, model: 'anthropic/claude-sonnet-5',
    });
    seed({ ...SEGMENT, language: 'ur' });
    await Worker.process(JOB);
    expect(finalDoc().sections[0].blocks[1].title).toBe('لکھنے سے پہلے');
  });

  it('THE 4-PAGE CAP HOLDS: a lesson the close pushes over the cap goes out without it', async () => {
    const over = new Error('render produced 1 defect(s): PAGE COUNT: teach needs 5 pages; the cap is 4.');
    over.code = 'RENDER_FAILED';
    Object.assign(over, { problems: ['PAGE COUNT: teach needs 5 pages; the cap is 4.'], infra: false, pdfPath: '/tmp/over.pdf', pagesByPart: { teach: 5, support: 2 } });
    mockRenderLessonPlan.mockImplementation(async ({ lpDoc }) => {
      if (box(lpDoc)) throw over;
      return { ...englishRender(), pdfPath: '/tmp/fits.pdf', pagesByPart: { teach: 4, support: 2 } };
    });
    seed();
    const out = await Worker.process({ ...JOB, lang: 'en' });
    expect(out.status).toBe('ready');
    expect(box(storedDoc())).toBeUndefined();
    expect(readyPatch().payload).toMatchObject({ over_cap: false });
  });

  it('a lesson that is over the cap even without the close keeps it', async () => {
    const over = new Error('render produced 1 defect(s): PAGE COUNT: teach needs 6 pages; the cap is 4.');
    over.code = 'RENDER_FAILED';
    Object.assign(over, { problems: ['PAGE COUNT: teach needs 6 pages; the cap is 4.'], infra: false, pdfPath: '/tmp/over.pdf', pagesByPart: { teach: 6, support: 2 } });
    mockRenderLessonPlan.mockRejectedValue(over);
    seed();
    await Worker.process({ ...JOB, lang: 'en' });
    expect(box(storedDoc())).toBeDefined();
  });
});
