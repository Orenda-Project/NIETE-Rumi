'use strict';
/**
 * bd-rj6w0n.14.16.6 — the v10 card on a GB lesson written at runtime. With LP_GB_V10_CARD_ENABLED on, the
 * worker adds the card (moves → card → gate → merged ahead of v9) after the v9 render; the card's own deadline
 * is what is left of ICT's clock, so a GB lesson never takes longer than an ICT one. A card that is late or
 * refused never holds the lesson back: the teacher gets v9. Flag off, the worker is unchanged.
 */
const mockAuthorLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockUploadBuffer = jest.fn();
const mockDeliver = jest.fn();
const mockReadFile = jest.fn();
const mockRpc = jest.fn();
const mockAttachCard = jest.fn();
const mockLogEvent = jest.fn();

jest.mock('../../bot/shared/services/lp612-author.service', () => ({ authorLessonPlan: (...a) => mockAuthorLessonPlan(...a) }));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({ renderLessonPlan: (...a) => mockRenderLessonPlan(...a) }));
jest.mock('../../bot/shared/services/lp612-pagetruth.service', () => ({ refsFromDoc: () => [], stageFigures: jest.fn() }));
jest.mock('../../bot/shared/services/lp-v10-card/attach', () => ({
  attachCard: (...a) => mockAttachCard(...a),
  cardDay: jest.requireActual('../../bot/shared/services/lp-v10-card/attach').cardDay,
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: (...a) => mockUploadBuffer(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a) }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: (...a) => mockReadFile(...a) },
}));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: 'select', filters: [] };
  const settle = () => {
    mockDbCalls.push(state);
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle, maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)), rpc: (...a) => mockRpc(...a),
}));

const GbLane = require('../../bot/shared/services/gb-lp-serving.service');
const Worker = require('../../bot/workers/gb-lp-author.worker');

const SEG = {
  segment_id: 'nbf_snc_grade_3_maths.c04.s002', grade: 3, subject: 'Maths', language: 'en',
  curriculum: 'nbf_snc', book_stem: 'nbf_snc_grade_3_maths',
};
const JOB = { renderId: 'r-1', segmentId: SEG.segment_id, lang: 'en', templateVersion: 'gb_k5_v10', correlationId: 'c-1' };
const W1 = { user_id: 'u-1', phone: '920000000001', ui_lang: 'en', correlation_id: 'c-1', asked_at: '2026-11-07T08:00:00Z' };
const PDF_KEY = 'gb-lp/gb_k5_v10/en/nbf_snc_grade_3_maths.c04.s002.pdf';

function happyReads() {
  mockDbResults.push(
    { data: { id: 'r-1', status: 'authoring', waiters: [W1] }, error: null },
    { data: [{ id: 'r-1' }], error: null },
    { data: SEG, error: null },
  );
}
const ready = () => mockDbCalls.find((c) => c.op === 'update' && c.payload.status === 'ready');
const uploadedTo = (key) => mockUploadBuffer.mock.calls.find((c) => c[1] === key);
const readyEvent = () => mockLogEvent.mock.calls.find((c) => c[0] === 'gb_lp.author.ready')[1];

const ENV = ['LP_GB_V10_CARD_ENABLED', 'LP_GB_V10_CARD_DEADLINE_MS', 'LP612_AUTHOR_TIMEOUT_MS'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  ENV.forEach((k) => delete process.env[k]);
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockAuthorLessonPlan.mockResolvedValue({ lpDoc: { title: 'x' }, model: 'm', rounds: 1 });
  mockRenderLessonPlan.mockResolvedValue({ pdfPath: '/tmp/v9.pdf', htmlPath: '/tmp/v9.html', pageCount: 4 });
  mockReadFile.mockImplementation(async (p) => Buffer.from(`bytes of ${p}`));
  mockUploadBuffer.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({ data: [W1], error: null });
  jest.spyOn(GbLane, 'deliver').mockImplementation((...a) => mockDeliver(...a));
  mockDeliver.mockResolvedValue(undefined);
  mockAttachCard.mockResolvedValue({
    pdfPath: '/tmp/v10.pdf', pageCount: 5, card: { header: { title: 'T' } }, moves: { moves: [] },
    timings: { moves_ms: 30000, card_ms: 90000, render_ms: 4000 },
  });
});
afterEach(() => ENV.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

describe('flag off: the worker is unchanged', () => {
  test('no card is attempted and the v9 PDF is sent', async () => {
    happyReads();
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockAttachCard).not.toHaveBeenCalled();
    expect(uploadedTo(PDF_KEY)[0].toString()).toBe('bytes of /tmp/v9.pdf');
  });
});

describe('flag on: the v10 card goes ahead of v9', () => {
  beforeEach(() => { process.env.LP_GB_V10_CARD_ENABLED = 'true'; });

  test('the card is built from the v9 lesson and the merged PDF is what the teacher gets', async () => {
    happyReads();
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockAttachCard).toHaveBeenCalledWith(expect.objectContaining({
      lpDoc: { title: 'x' }, v9HtmlPath: '/tmp/v9.html', v9PdfPath: '/tmp/v9.pdf', segment: SEG, lang: 'en',
      stem: 'nbf_snc_grade_3_maths.c04.s002',
    }));
    expect(uploadedTo(PDF_KEY)[0].toString()).toBe('bytes of /tmp/v10.pdf');
    expect(ready().payload.page_count).toBe(5);
    expect(mockDeliver).toHaveBeenCalledWith(expect.objectContaining({ r2Key: PDF_KEY }));
  });

  test('the card and the moves are stored beside the PDF, in GB storage', async () => {
    happyReads();
    await Worker.process(JOB);
    const keys = mockUploadBuffer.mock.calls.map((c) => c[1]);
    expect(keys).toEqual(expect.arrayContaining([
      'gb-lp/gb_k5_v10/en/nbf_snc_grade_3_maths.c04.s002.card.json',
      'gb-lp/gb_k5_v10/en/nbf_snc_grade_3_maths.c04.s002.moves.json',
    ]));
    expect(keys.every((k) => k.startsWith('gb-lp/'))).toBe(true);
  });

  test('each step\'s time is recorded on the row and in the ready event', async () => {
    happyReads();
    await Worker.process(JOB);
    expect(ready().payload.timings).toMatchObject({ moves_ms: 30000, card_ms: 90000, render_ms: 4000, v10: 'ok' });
    expect(ready().payload.timings.total_ms).toEqual(expect.any(Number));
    expect(readyEvent()).toMatchObject({ v10: 'ok', moves_ms: 30000, card_ms: 90000 });
  });

  test('the card\'s deadline is what is left of ICT\'s clock, capped by its own setting', async () => {
    process.env.LP612_AUTHOR_TIMEOUT_MS = '600000';
    process.env.LP_GB_V10_CARD_DEADLINE_MS = '240000';
    happyReads();
    await Worker.process(JOB);
    const { deadlineMs } = mockAttachCard.mock.calls[0][0];
    expect(deadlineMs).toBeLessThanOrEqual(240000);
    expect(deadlineMs).toBeGreaterThan(200000);

    process.env.LP_GB_V10_CARD_DEADLINE_MS = '900000'; // a setting longer than ICT's clock never wins
    happyReads();
    await Worker.process(JOB);
    expect(mockAttachCard.mock.calls[1][0].deadlineMs).toBeLessThanOrEqual(600000);
  });

  test.each(['card_timeout', 'card_refused', 'MOVES_FAILED'])('a card that fails (%s) never holds the lesson back: v9 is sent', async (code) => {
    happyReads();
    mockAttachCard.mockRejectedValue(Object.assign(new Error('no card'), { code }));
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(uploadedTo(PDF_KEY)[0].toString()).toBe('bytes of /tmp/v9.pdf');
    expect(ready().payload.page_count).toBe(4);
    expect(ready().payload.timings.v10).toBe(code);
    expect(mockDeliver).toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith('gb_lp.v10card.failed', expect.objectContaining({ renderId: 'r-1', code }));
  });

  test('a revision or assessment day gets no card, as offline: v9 is sent', async () => {
    mockDbResults.push(
      { data: { id: 'r-1', status: 'authoring', waiters: [W1] }, error: null },
      { data: [{ id: 'r-1' }], error: null },
      { data: { ...SEG, skill_type: 'revision' }, error: null },
    );
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockAttachCard).not.toHaveBeenCalled();
    expect(uploadedTo(PDF_KEY)[0].toString()).toBe('bytes of /tmp/v9.pdf');
    expect(ready().payload.timings.v10).toBe('no_card_day');
  });

  test('no time left on the clock: the card is skipped, v9 is sent', async () => {
    process.env.LP612_AUTHOR_TIMEOUT_MS = '1000';
    happyReads();
    mockAuthorLessonPlan.mockImplementation(() => new Promise((r) => setTimeout(() => r({ lpDoc: {}, model: 'm' }), 990)));
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockAttachCard).not.toHaveBeenCalled();
    expect(ready().payload.timings.v10).toBe('no_time');
  });
});
