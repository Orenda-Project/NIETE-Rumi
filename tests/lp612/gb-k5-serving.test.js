'use strict';
/**
 * bd-rj6w0n.14.7 — serving a GB plan.
 *
 *  1. A ready render whose r2_key ends `.html` is the hosted v10 coach card (v9 embedded): she gets
 *     the LINK as a text message, never a PDF document, and nothing is presigned.
 *  2. The curriculum guard, on #4091's rule (book-curriculum.service): a GB (nbf_snc) plan is never
 *     served to an ICT teacher; an ICT plan is refused to a GB teacher only where GB has its own book
 *     for that grade+subject (elsewhere ICT's book IS hers). Refused before any render row is read,
 *     claimed or authored. Flag off, nobody reads GB: an nbf_snc plan is refused to everyone and an ICT
 *     plan is served exactly as today (no user lookup).
 *  3. GB plans are imported, never authored here: a GB segment with no ready card is refused, not queued.
 */
const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockSendDocumentByLink = jest.fn().mockResolvedValue(true);
const mockQueueJob = jest.fn();
const mockGetPresignedUrl = jest.fn().mockResolvedValue('https://signed.example/lp.pdf');
const mockSegmentById = jest.fn();
const mockCurriculum = jest.fn();
const mockCurriculumOf = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a), sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
}));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: (...a) => mockQueueJob(...a) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: (...a) => mockGetPresignedUrl(...a), buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a), curriculumOf: (...a) => mockCurriculumOf(...a),
}));
jest.mock('../../bot/shared/services/book-curriculum.service', () => ({
  ...jest.requireActual('../../bot/shared/services/book-curriculum.service'),
  curriculumForUser: (...a) => mockCurriculum(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: 'select', filters: [] };
  const settle = () => {
    mockDbCalls.push(state);
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    upsert: (p) => { state.op = 'upsert'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    in: () => b, order: () => b, limit: () => b,
    single: settle, maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)), rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
}));

const Serving = require('../../bot/shared/services/lp612-serving.service');

const GB_SEG = {
  segment_id: 'nbf_snc_grade_2_urdu.c07.s05', book_stem: 'nbf_snc_grade_2_urdu', chapter_key: 'c07', grade: 2, subject: 'Urdu',
  subtopic_title: 'Topic', menu_title: 'Topic', printed_page_start: 40, printed_page_end: 41,
  is_religious: false, curriculum: 'nbf_snc',
};
const ICT_SEG = { ...GB_SEG, segment_id: 'grade_9_chemistry.c01.p007-008', book_stem: 'grade_9_chemistry', grade: 9, subject: 'Chemistry', curriculum: 'ict' };
const CARD = { id: 'gr1', status: 'ready', lang: 'ur', r2_key: 'gb-k5/g2_ch7/Urdu_seg5.card.html', one_screen: null };
const REQ = { userId: 'user-1', phone: '923001234567', lang: 'ur', correlationId: 'corr-1' };
const renderReads = () => mockDbCalls.filter((c) => c.table === 'niete_lp612_renders');

const saved = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  process.env = { ...saved, LP_612_TEMPLATE_VERSION: 'v9.1', LP_GB_CARD_BASE_URL: 'https://cards.example/' };
  delete process.env.LP_GB_K5_ENABLED;
});
afterAll(() => { process.env = saved; });

describe('a hosted card (.html) is sent as a link', () => {
  test('deliverRender sends the hosted link as text, no document, nothing presigned', async () => {
    await Serving.deliverRender({ phone: REQ.phone, userId: null, r2Key: CARD.r2_key, segment: GB_SEG, lang: 'ur' });
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockGetPresignedUrl).not.toHaveBeenCalled();
    const texts = mockSendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(texts).toContain('https://cards.example/gb-k5/g2_ch7/Urdu_seg5.card.html');
  });

  test('a failed link send throws, like a failed document send', async () => {
    mockSendMessage.mockResolvedValueOnce(false);
    await expect(Serving.deliverRender({ phone: REQ.phone, r2Key: CARD.r2_key, segment: GB_SEG, lang: 'ur' }))
      .rejects.toThrow(/send failed/);
  });

  test('a PDF key still goes as a document', async () => {
    await Serving.deliverRender({ phone: REQ.phone, r2Key: 'lp612/v9.1/en/seg.pdf', segment: ICT_SEG, lang: 'en' });
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });

  test('flag on: a GB teacher tapping a ready GB lesson gets the card link, nothing queued', async () => {
    process.env.LP_GB_K5_ENABLED = 'true';
    mockSegmentById.mockResolvedValue(GB_SEG);
    mockCurriculum.mockResolvedValue('nbf_snc');
    mockDbResults.push({ data: [CARD], error: null });
    const out = await Serving.requestLesson({ segmentId: GB_SEG.segment_id, ...REQ });
    expect(out.outcome).toBe('cache_hit');
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockSendMessage.mock.calls.map((c) => c[1]).join('\n')).toContain('https://cards.example/gb-k5/g2_ch7/Urdu_seg5.card.html');
    expect(mockQueueJob).not.toHaveBeenCalled();
    const read = renderReads()[0];
    expect(read.filters).toEqual(expect.arrayContaining([
      ['segment_id', GB_SEG.segment_id], ['template_version', 'gb_v10'], ['status', 'ready'],
    ]));
  });
});

describe('the curriculum guard', () => {
  beforeEach(() => { process.env.LP_GB_K5_ENABLED = 'true'; });

  test('a GB plan is refused to an ICT teacher before any render row is touched', async () => {
    mockSegmentById.mockResolvedValue(GB_SEG);
    mockCurriculum.mockResolvedValue('ict');
    const out = await Serving.requestLesson({ segmentId: GB_SEG.segment_id, ...REQ });
    expect(out.outcome).toBe('wrong_curriculum');
    expect(renderReads()).toHaveLength(0);
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1); // the refusal, in her language
    expect(mockSendMessage.mock.calls[0][1]).toMatch(/[؀-ۿ]/);
  });

  test('an ICT plan is refused to a GB teacher where GB has its own book for that grade+subject', async () => {
    const ictUrdu = { ...ICT_SEG, segment_id: 'grade_2_urdu.c07.p040-041', grade: 2, subject: 'Urdu' };
    mockSegmentById.mockResolvedValue(ictUrdu);
    mockCurriculum.mockResolvedValue('nbf_snc');
    mockCurriculumOf.mockResolvedValue('nbf_snc');
    const out = await Serving.requestLesson({ segmentId: ictUrdu.segment_id, ...REQ, lang: 'en' });
    expect(out.outcome).toBe('wrong_curriculum');
    expect(mockCurriculumOf).toHaveBeenCalledWith(2, 'Urdu', 'nbf_snc');
    expect(renderReads()).toHaveLength(0);
    expect(mockQueueJob).not.toHaveBeenCalled();
  });

  test('an ICT plan is served to a GB teacher where GB has no book of its own (#4091: ICT\'s book is hers)', async () => {
    mockSegmentById.mockResolvedValue(ICT_SEG);
    mockCurriculum.mockResolvedValue('nbf_snc');
    mockCurriculumOf.mockResolvedValue('ict');
    mockDbResults.push({ data: { id: 'r1', status: 'ready', r2_key: 'lp612/v9.1/en/seg.pdf' }, error: null });
    const out = await Serving.requestLesson({ segmentId: ICT_SEG.segment_id, ...REQ, lang: 'en' });
    expect(out.outcome).toBe('cache_hit');
    expect(mockCurriculumOf).toHaveBeenCalledWith(9, 'Chemistry', 'nbf_snc');
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });

  test('an ICT teacher\'s ICT plan asks no book store', async () => {
    mockSegmentById.mockResolvedValue(ICT_SEG);
    mockCurriculum.mockResolvedValue('ict');
    mockDbResults.push({ data: { id: 'r1', status: 'ready', r2_key: 'lp612/v9.1/en/seg.pdf' }, error: null });
    const out = await Serving.requestLesson({ segmentId: ICT_SEG.segment_id, ...REQ, lang: 'en' });
    expect(out.outcome).toBe('cache_hit');
    expect(mockCurriculumOf).not.toHaveBeenCalled();
  });

  test('a GB segment with no ready card is refused, never authored or queued', async () => {
    mockSegmentById.mockResolvedValue(GB_SEG);
    mockCurriculum.mockResolvedValue('nbf_snc');
    mockDbResults.push({ data: [], error: null });
    const out = await Serving.requestLesson({ segmentId: GB_SEG.segment_id, ...REQ });
    expect(out.outcome).toBe('gb_not_ready');
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(renderReads().some((c) => c.op === 'insert' || c.op === 'update')).toBe(false);
  });

  test('the GB card in her language wins over one in the other language', async () => {
    mockSegmentById.mockResolvedValue(GB_SEG);
    mockCurriculum.mockResolvedValue('nbf_snc');
    mockDbResults.push({ data: [{ ...CARD, id: 'ur', lang: 'ur' }, { ...CARD, id: 'en', lang: 'en', r2_key: 'gb-k5/g2_ch7/en.card.html' }], error: null });
    const out = await Serving.requestLesson({ segmentId: GB_SEG.segment_id, ...REQ, lang: 'en' });
    expect(out.renderId).toBe('en');
  });
});

describe('LP_GB_K5_ENABLED off', () => {
  test('an ICT plan is served exactly as today, with no user lookup', async () => {
    mockSegmentById.mockResolvedValue(ICT_SEG);
    mockDbResults.push({ data: { id: 'r1', status: 'ready', r2_key: 'lp612/v9.1/en/seg.pdf' }, error: null });
    const out = await Serving.requestLesson({ segmentId: ICT_SEG.segment_id, ...REQ, lang: 'en' });
    expect(out.outcome).toBe('cache_hit');
    expect(mockCurriculum).not.toHaveBeenCalled();
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    expect(renderReads()[0].filters).toEqual(expect.arrayContaining([['template_version', 'v9.1']]));
  });

  test('a GB plan is refused to everyone (nobody reads GB while the flag is off)', async () => {
    mockSegmentById.mockResolvedValue(GB_SEG);
    const out = await Serving.requestLesson({ segmentId: GB_SEG.segment_id, ...REQ });
    expect(out.outcome).toBe('wrong_curriculum');
    expect(mockCurriculum).not.toHaveBeenCalled();
    expect(renderReads()).toHaveLength(0);
  });
});
