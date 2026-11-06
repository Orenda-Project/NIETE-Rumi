'use strict';
/**
 * bd-rj6w0n.14.7 — serving a GB plan.
 *
 *  1. GB has its own lane (bd-rj6w0n.14.16): its own render rows (niete_gb_lp_renders), its own R2 prefix
 *     (gb-lp/), its own job (gb_lp_author). Its PDF is presigned and sent as a document through 6-12's
 *     send; only the caption is GB's. No hosted card, no link message. ICT's rows are never read for GB.
 *  2. The curriculum guard, on #4091's rule (book-curriculum.service): a GB (nbf_snc) plan is never
 *     served to an ICT teacher; an ICT plan is refused to a GB teacher only where GB has its own book
 *     for that grade+subject (elsewhere ICT's book IS hers). Refused before any render row is read,
 *     claimed or authored. Flag off, nobody reads GB: an nbf_snc plan is refused to everyone and an ICT
 *     plan is served exactly as today (no user lookup).
 *  3. A GB K-5 miss is authored at runtime like 6-12's, on GB's lane: one GB row in the BOOK's language (one
 *     plan per lesson), the teacher told it is being prepared, GB's job queued.
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
const CARD = { id: 'gr1', status: 'ready', lang: 'ur', r2_key: 'gb-lp/gb_k5_v9/ur/nbf_snc_grade_2_urdu.c07.s05.pdf', one_screen: null };
const REQ = { userId: 'user-1', phone: '923001234567', lang: 'ur', correlationId: 'corr-1' };
const renderReads = () => mockDbCalls.filter((c) => c.table === 'niete_lp612_renders');
const gbReads = () => mockDbCalls.filter((c) => c.table === 'niete_gb_lp_renders');

const saved = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  process.env = { ...saved, LP_612_TEMPLATE_VERSION: 'v9.1', LP_GB_CARD_BASE_URL: 'https://cards.example/', LP_GB_AUTHOR_ENABLED: 'true' };
  delete process.env.LP_GB_K5_ENABLED;
});
afterAll(() => { process.env = saved; });

describe('a GB K-5 plan is sent as a PDF document, like ICT', () => {
  const URDU_BOOK = { ...GB_SEG, language: 'ur' };

  test('presigned from gb-lp/ and sent as a document with the GB caption, no link text', async () => {
    await Serving.deliverRender({ phone: REQ.phone, userId: null, r2Key: CARD.r2_key, segment: URDU_BOOK, lang: 'ur' });
    expect(mockGetPresignedUrl).toHaveBeenCalledWith(`https://r2.example/${CARD.r2_key}`);
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    const [phone, url, filename, caption] = mockSendDocumentByLink.mock.calls[0];
    expect([phone, url]).toEqual([REQ.phone, 'https://signed.example/lp.pdf']);
    expect(filename).toMatch(/\.pdf$/);
    expect(caption).not.toBe(Serving.buildCaption(URDU_BOOK, 'ur'));
    expect(mockSendMessage.mock.calls.map((c) => c[1]).join('\n')).not.toContain('https://');
  });

  test('a failed document send throws, as ICT\'s does', async () => {
    mockSendDocumentByLink.mockResolvedValue(false);
    await expect(Serving.deliverRender({
      phone: REQ.phone, r2Key: CARD.r2_key, segment: GB_SEG, lang: 'ur', sendMaxAttempts: 1,
    })).rejects.toThrow(/send failed/);
    mockSendDocumentByLink.mockResolvedValue(true);
  });

  test('an ICT PDF is presigned and sent with ICT\'s own caption', async () => {
    await Serving.deliverRender({ phone: REQ.phone, r2Key: 'lp612/v9.1/en/seg.pdf', segment: ICT_SEG, lang: 'en' });
    expect(mockGetPresignedUrl).toHaveBeenCalledWith('https://r2.example/lp612/v9.1/en/seg.pdf');
    expect(mockSendDocumentByLink.mock.calls[0][3]).toBe(Serving.buildCaption(ICT_SEG, 'en'));
  });

  test('a GB grade 6-12 plan is 6-12\'s, caption included', async () => {
    const g8 = { ...GB_SEG, segment_id: 'nbf_snc_grade_8_english.c01.s01', grade: 8, subject: 'English' };
    await Serving.deliverRender({ phone: REQ.phone, r2Key: 'lp612/v9.1/en/x.pdf', segment: g8, lang: 'en' });
    expect(mockSendDocumentByLink.mock.calls[0][3]).toBe(Serving.buildCaption(g8, 'en'));
  });

  test('flag on: a ready GB lesson is a cache hit from GB\'s own table, never ICT\'s, nothing queued', async () => {
    process.env.LP_GB_K5_ENABLED = 'true';
    mockSegmentById.mockResolvedValue(URDU_BOOK);
    mockCurriculum.mockResolvedValue('nbf_snc');
    mockDbResults.push({ data: CARD, error: null });
    const out = await Serving.requestLesson({ segmentId: GB_SEG.segment_id, ...REQ, lang: 'en' });
    expect(out.outcome).toBe('cache_hit');
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(mockGetPresignedUrl).toHaveBeenCalledWith(`https://r2.example/${CARD.r2_key}`);
    expect(renderReads()).toHaveLength(0);
    expect(gbReads()[0].filters).toEqual(expect.arrayContaining([
      ['segment_id', GB_SEG.segment_id], ['lang', 'ur'], ['template_version', 'gb_k5_v9'],
    ]));
  });
});

describe('a GB K-5 miss is authored at runtime on GB\'s own lane', () => {
  const URDU_BOOK = { ...GB_SEG, language: 'ur' };
  const ENGLISH_BOOK = { ...GB_SEG, segment_id: 'nbf_snc_grade_2_english.c03.s02', subject: 'English', language: 'en' };
  beforeEach(() => {
    process.env.LP_GB_K5_ENABLED = 'true';
    mockCurriculum.mockResolvedValue('nbf_snc');
  });

  test.each([
    ['an Urdu book', URDU_BOOK, 'en', 'ur'],
    ['an English book', ENGLISH_BOOK, 'ur', 'en'],
  ])('%s: one GB row in the book\'s language under GB\'s template, GB\'s job queued', async (_n, seg, asked, bookLang) => {
    mockSegmentById.mockResolvedValue(seg);
    mockDbResults.push({ data: null, error: null }); // no render row
    mockDbResults.push({ data: { id: 'new-1' }, error: null }); // the insert
    const out = await Serving.requestLesson({ segmentId: seg.segment_id, ...REQ, lang: asked });
    expect(out).toEqual({ outcome: 'queued', renderId: 'new-1' });
    expect(renderReads()).toHaveLength(0);
    const insert = gbReads().find((c) => c.op === 'insert');
    expect(insert.payload).toEqual(expect.objectContaining({
      segment_id: seg.segment_id, lang: bookLang, template_version: 'gb_k5_v9', status: 'authoring',
    }));
    expect(mockQueueJob.mock.calls[0][1]).toBe('gb_lp_author');
    expect(mockQueueJob.mock.calls[0][2]).toEqual(expect.objectContaining({
      renderId: 'new-1', segmentId: seg.segment_id, lang: bookLang, templateVersion: 'gb_k5_v9',
    }));
  });

  test('a GB lesson already being authored is joined, not authored twice', async () => {
    mockSegmentById.mockResolvedValue(URDU_BOOK);
    const now = new Date().toISOString();
    mockDbResults.push({ data: { id: 'run-1', status: 'authoring', waiters: [], started_at: now, picked_up_at: now }, error: null });
    const out = await Serving.requestLesson({ segmentId: URDU_BOOK.segment_id, ...REQ });
    expect(out.renderId).toBe('run-1');
    expect(gbReads().some((c) => c.op === 'insert')).toBe(false);
    expect(renderReads()).toHaveLength(0);
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
