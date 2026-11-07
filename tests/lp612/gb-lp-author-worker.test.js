'use strict';
/**
 * bd-rj6w0n.14.16.12 — the gb_lp_author job: a GB lesson nobody pregenerated is written at runtime, on
 * the SAME author and renderer as ICT's 6-12 lane (so it takes no longer), but stored in GB's own rows
 * (niete_gb_lp_renders) and keys (gb-lp/). It never reads or writes niete_lp612_renders or lp612/.
 */
const mockAuthorLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockUploadBuffer = jest.fn();
const mockDeliverRender = jest.fn();
const mockSendMessage = jest.fn();
const mockReadFile = jest.fn();
const mockRpc = jest.fn();
const mockStageFigures = jest.fn();

jest.mock('../../bot/shared/services/lp612-author.service', () => ({ authorLessonPlan: (...a) => mockAuthorLessonPlan(...a) }));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({ renderLessonPlan: (...a) => mockRenderLessonPlan(...a) }));
jest.mock('../../bot/shared/services/lp612-pagetruth.service', () => ({
  refsFromDoc: (d) => (d && d.figs) || [], stageFigures: (...a) => mockStageFigures(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: (...a) => mockUploadBuffer(...a) }));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({ deliverRender: (...a) => mockDeliverRender(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: (...a) => mockSendMessage(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
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

const Worker = require('../../bot/workers/gb-lp-author.worker');

const SEG = {
  segment_id: 'nbf_snc_grade_3_maths.c04.s002', grade: 3, subject: 'Maths', language: 'en',
  curriculum: 'nbf_snc', book_stem: 'nbf_snc_grade_3_maths',
};
const JOB = {
  renderId: 'r-1', segmentId: SEG.segment_id, lang: 'en', templateVersion: 'gb_k5_v10', correlationId: 'c-1',
};
const W1 = { user_id: 'u-1', phone: '920000000001', ui_lang: 'ur', correlation_id: 'c-1', asked_at: '2026-11-07T08:00:00Z' };
const W2 = { user_id: 'u-2', phone: '920000000002', ui_lang: 'en', correlation_id: 'c-2', asked_at: '2026-11-07T08:01:00Z' };

/** Queue the reads in the order the worker makes them: row, pickup claim, segment. */
function happyReads() {
  mockDbResults.push(
    { data: { id: 'r-1', status: 'authoring', waiters: [W1] }, error: null }, // loadRender
    { data: [{ id: 'r-1' }], error: null }, // claimPickup
    { data: SEG, error: null }, // loadSegment
  );
}
const tables = () => [...new Set(mockDbCalls.map((c) => c.table))];
const update = (status) => mockDbCalls.find((c) => c.op === 'update' && c.payload.status === status);

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockAuthorLessonPlan.mockResolvedValue({ lpDoc: { title: 'x' }, model: 'm', rounds: 1 });
  mockRenderLessonPlan.mockResolvedValue({ pdfPath: '/tmp/x.pdf', pageCount: 4 });
  mockReadFile.mockResolvedValue(Buffer.from('%PDF'));
  mockUploadBuffer.mockResolvedValue(undefined);
  mockDeliverRender.mockResolvedValue(undefined);
  mockSendMessage.mockResolvedValue(true);
  mockStageFigures.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({ data: [W1, W2], error: null });
});

describe('a GB miss is written at runtime on ICT\'s author and renderer, into GB storage', () => {
  test('authors the GB segment, stores the PDF under gb-lp/, marks the row ready, sends to every waiter', async () => {
    happyReads();
    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).toHaveBeenCalledWith(expect.objectContaining({ segment: SEG, lang: 'en' }));
    const keys = mockUploadBuffer.mock.calls.map((c) => c[1]);
    expect(keys).toContain('gb-lp/gb_k5_v10/en/nbf_snc_grade_3_maths.c04.s002.pdf');
    expect(keys.every((k) => k.startsWith('gb-lp/'))).toBe(true);
    expect(update('ready').payload.r2_key).toBe('gb-lp/gb_k5_v10/en/nbf_snc_grade_3_maths.c04.s002.pdf');
    expect(mockRpc).toHaveBeenCalledWith('gb_lp_claim_waiters', { p_render_id: 'r-1' });
    expect(mockDeliverRender).toHaveBeenCalledTimes(2);
    expect(mockDeliverRender.mock.calls[0][0]).toMatchObject({
      phone: W1.phone, userId: 'u-1', renderId: null, segment: SEG, lang: 'en',
      r2Key: 'gb-lp/gb_k5_v10/en/nbf_snc_grade_3_maths.c04.s002.pdf',
    });
  });

  test('never touches ICT\'s renders table', async () => {
    happyReads();
    await Worker.process(JOB);
    expect(tables()).not.toContain('niete_lp612_renders');
    expect(tables()).toEqual(expect.arrayContaining(['niete_gb_lp_renders', 'niete_lp612_segments']));
  });

  test('a picture that fails to arrive never holds the lesson back', async () => {
    happyReads();
    mockAuthorLessonPlan.mockResolvedValue({ lpDoc: { figs: [{ page: 3 }] }, model: 'm', rounds: 1 });
    mockStageFigures.mockRejectedValue(new Error('crop missing'));
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockDeliverRender).toHaveBeenCalled();
  });

  test('a lesson that is only long is still delivered (same rule as ICT)', async () => {
    happyReads();
    const e = Object.assign(new Error('defects'), {
      pdfPath: '/tmp/x.pdf', infra: false, problems: ['PAGE COUNT: teach needs 6 pages; the cap is 5'],
    });
    mockRenderLessonPlan.mockRejectedValue(e);
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockDeliverRender).toHaveBeenCalled();
  });
});

describe('idempotency and failure', () => {
  test('a row no longer authoring is skipped without writing anything', async () => {
    mockDbResults.push({ data: { id: 'r-1', status: 'ready', waiters: [] }, error: null });
    const out = await Worker.process(JOB);
    expect(out.status).toBe('skipped');
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
  });

  test('a lost pickup race is skipped', async () => {
    mockDbResults.push(
      { data: { id: 'r-1', status: 'authoring', waiters: [W1] }, error: null },
      { data: [], error: null },
    );
    const out = await Worker.process(JOB);
    expect(out).toMatchObject({ status: 'skipped', reason: 'pickup_lost' });
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
  });

  test('an author failure marks the row failed and tells every waiter, nothing uploaded', async () => {
    happyReads();
    mockAuthorLessonPlan.mockRejectedValue(Object.assign(new Error('boom'), { code: 'AUTHOR_FAILED' }));
    const out = await Worker.process(JOB);
    expect(out.status).toBe('failed');
    expect(update('failed').payload.error_code).toBe('AUTHOR_FAILED');
    expect(mockUploadBuffer).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  test('a missing segment fails the row', async () => {
    mockDbResults.push(
      { data: { id: 'r-1', status: 'authoring', waiters: [W1] }, error: null },
      { data: [{ id: 'r-1' }], error: null },
      { data: null, error: null },
    );
    const out = await Worker.process(JOB);
    expect(out.status).toBe('failed');
    expect(update('failed').payload.error_code).toBe('SEGMENT_MISSING');
  });
});
