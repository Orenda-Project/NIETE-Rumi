/**
 * 6-12 LPs · the two language territories inside serving, and the honesty of
 * the Urdu caption.
 *
 *  - CONTENT (`lang`) is frozen into the job and the R2 key: the document.
 *  - TEACHER-ADDRESSED (`uiLang`) is the language every ack speaks: an Urdu-UI
 *    teacher ordering an English physics plan hears «تیار کیا جا رہا ہے» and
 *    receives an English PDF. Waiters each carry their OWN ui_lang, because two
 *    teachers waiting on one render need not share a language.
 *  - The religious hold is checked on the ROW inside requestLesson, so the new
 *    lp612_serve step cannot bypass it with a forged payload — in either
 *    language, identically.
 *  - An Urdu render whose ur_overlay was dropped is an essentially-English
 *    document in RTL chrome. The render row says so (`overlay_dropped`) and the
 *    caption tells HER so («یہ سبق انگریزی کتاب سے ہے…») — rule 24(c)/(d), not
 *    a silent fallback.
 *  - The Urdu caption's {subject} and {pages} placeholders are wrapped in
 *    LRI…PDI isolates in the catalog string itself, because «صفحات 7-8» after
 *    an Urdu word otherwise paints «8-7» (UAX#9 W2/W4/N1).
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockQueueJob = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockSegmentById = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage,
  sendDocumentByLink: mockSendDocumentByLink,
}));
const queueModule = {
  __isQueueSingleton: true,
  queueJob(...args) {
    if (!this || this.__isQueueSingleton !== true) {
      throw new TypeError('queueJob called without its receiver');
    }
    return mockQueueJob(...args);
  },
};
jest.mock('../../bot/shared/services/queue', () => queueModule);
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: mockGetPresignedUrl,
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: mockSegmentById,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    mockDbCalls.push({ ...state });
    return Promise.resolve(
      mockDbResults.length ? mockDbResults.shift() : { data: null, error: null },
    );
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Serving = require('../../bot/shared/services/lp612-serving.service');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const LRI = '⁦';
const PDI = '⁩';

const SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008',
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  subtopic_title: 'Definition of chemistry and its branches',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  is_religious: false,
  language: 'en',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockSegmentById.mockResolvedValue(SEGMENT);
  mockGetPresignedUrl.mockResolvedValue('https://signed.example/lp.pdf');
  process.env.LP_612_TEMPLATE_VERSION = 'v9.1';
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

// ── the uiLang / lang split ─────────────────────────────────────────────────

describe('two territories: the document vs the acks', () => {
  test('an Urdu-UI teacher ordering an ENGLISH plan is acked in Urdu, job authored in English', async () => {
    mockDbResults.push({ data: null, error: null });                    // findRender: miss
    mockDbResults.push({ data: { id: 'r-new' }, error: null });         // insert claim

    await Serving.requestLesson({
      segmentId: SEGMENT.segment_id, userId: 'u1', phone: '92300', lang: 'en', uiLang: 'ur',
    });

    expect(mockSendMessage).toHaveBeenCalledWith('92300', UX_STRINGS.lp612Preparing.ur);
    // The 4th argument is the FIFO options bag, carrying an explicit deduplicationId that names
    // this render and this language — the shared default cannot tell the en job for a segment
    // from the ur one. Matched loosely here because this test is about the LANGUAGE territories,
    // not the dedup key; that key has its own tests in tests/lp612/golden-path-races.test.js.
    expect(mockQueueJob).toHaveBeenCalledWith(
      SEGMENT.segment_id, 'lp612_author',
      expect.objectContaining({ lang: 'en' }),
      expect.any(Object),
    );
  });

  test('the waiter entry remembers her ui language for the worker', async () => {
    mockDbResults.push({ data: null, error: null });
    mockDbResults.push({ data: { id: 'r-new' }, error: null });

    await Serving.requestLesson({
      segmentId: SEGMENT.segment_id, userId: 'u1', phone: '92300', lang: 'en', uiLang: 'ur',
    });

    const insert = mockDbCalls.find((c) => c.op === 'insert');
    expect(insert.payload.waiters[0]).toEqual(expect.objectContaining({
      user_id: 'u1', phone: '92300', ui_lang: 'ur',
    }));
  });

  test('no uiLang means the acks follow the chosen document language — she did just choose it', async () => {
    mockDbResults.push({ data: null, error: null });
    mockDbResults.push({ data: { id: 'r-new' }, error: null });

    await Serving.requestLesson({
      segmentId: SEGMENT.segment_id, userId: 'u1', phone: '92300', lang: 'ur',
    });

    expect(mockSendMessage).toHaveBeenCalledWith('92300', UX_STRINGS.lp612Preparing.ur);
  });
});

// ── the hold cannot be bypassed through the new step ────────────────────────

describe('the religious hold, reached via a lp612_serve-shaped request', () => {
  const HELD = { ...SEGMENT, segment_id: 'grade_9_islamiat.c04.p001-002', is_religious: true };

  test.each(['ur', 'en'])('declines in %s with the hold sentence and enqueues NOTHING', async (lang) => {
    mockSegmentById.mockResolvedValue(HELD);
    const res = await Serving.requestLesson({
      segmentId: HELD.segment_id, userId: 'u1', phone: '92300', lang, uiLang: lang,
    });
    expect(res.outcome).toBe('held');
    expect(mockSendMessage).toHaveBeenCalledWith('92300', UX_STRINGS.lp612Held[lang]);
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(mockDbCalls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  test('the hold speaks her UI language even when the document language differs', async () => {
    mockSegmentById.mockResolvedValue(HELD);
    await Serving.requestLesson({
      segmentId: HELD.segment_id, userId: 'u1', phone: '92300', lang: 'en', uiLang: 'ur',
    });
    expect(mockSendMessage).toHaveBeenCalledWith('92300', UX_STRINGS.lp612Held.ur);
  });
});

// ── the caption: bidi isolates + overlay honesty ────────────────────────────

describe('the Urdu caption', () => {
  test('isolates {subject} and {pages} so «صفحات 7-8» cannot paint «8-7»', () => {
    const caption = Serving.buildCaption(SEGMENT, 'ur');
    expect(caption).toContain(`${LRI}Chemistry${PDI}`);
    expect(caption).toContain(`${LRI}7-8${PDI}`);
  });

  test('the English caption carries no isolates — nothing to fix, nothing added', () => {
    const caption = Serving.buildCaption(SEGMENT, 'en');
    expect(caption).not.toContain(LRI);
    expect(caption).toContain('7-8');
  });

  test('an overlay-dropped Urdu render says so, honestly, in the caption', () => {
    const caption = Serving.buildCaption(SEGMENT, 'ur', { overlayDropped: true });
    expect(caption).toContain('یہ سبق انگریزی کتاب سے ہے');
  });

  test('a clean Urdu render carries no such line', () => {
    const caption = Serving.buildCaption(SEGMENT, 'ur', { overlayDropped: false });
    expect(caption).not.toContain('یہ سبق انگریزی کتاب سے ہے');
  });

  test('the honesty line is Urdu-territory: an English document does not carry it', () => {
    // An EN render of an EN book is the native path — nothing was dropped.
    const caption = Serving.buildCaption(SEGMENT, 'en', { overlayDropped: true });
    expect(caption).not.toContain('یہ سبق انگریزی کتاب سے ہے');
  });
});

describe('a cache hit carries the overlay honesty through', () => {
  test('a ready row with overlay_dropped=true captions the document honestly', async () => {
    mockDbResults.push({
      data: {
        id: 'r1', status: 'ready', r2_key: 'lp612/v9.1/ur/seg.pdf', overlay_dropped: true,
      },
      error: null,
    });

    await Serving.requestLesson({
      segmentId: SEGMENT.segment_id, userId: 'u1', phone: '92300', lang: 'ur',
    });

    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    const caption = mockSendDocumentByLink.mock.calls[0][3];
    expect(caption).toContain('یہ سبق انگریزی کتاب سے ہے');
  });

  test('a clean ready row captions without the line', async () => {
    mockDbResults.push({
      data: {
        id: 'r1', status: 'ready', r2_key: 'lp612/v9.1/ur/seg.pdf', overlay_dropped: false,
      },
      error: null,
    });

    await Serving.requestLesson({
      segmentId: SEGMENT.segment_id, userId: 'u1', phone: '92300', lang: 'ur',
    });

    const caption = mockSendDocumentByLink.mock.calls[0][3];
    expect(caption).not.toContain('یہ سبق انگریزی کتاب سے ہے');
  });
});
