/**
 * bd-oak77.20 — the copy a teacher received must be reconstructable from the logs.
 *
 * Until now, the only trace of an lp612 outbound WhatsApp send was whatsapp.service's
 * `✅ WhatsApp message sent` line: `{region, messageId}` and nothing else. The 2026-09-06 prod
 * Urdu post-mortem could not say what the teacher had actually been sent. The fix is lp612-scoped
 * on purpose (not a platform-wide body log in whatsapp.service): every successful lp612 send
 * emits `lp612.send.sent` carrying the exact text / caption that went to Meta, plus the ux key
 * (template id) where the text came from the string catalog.
 *
 * No new PII: the event carries the copy and the ids already on lp612's other events
 * (userId/segmentId/renderId), never the phone number.
 *
 * `whatsapp.service` is mocked at the network boundary; `lp612-serving.service` is the real module.
 */

const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockSendDocumentByLink = jest.fn().mockResolvedValue(true);
const mockLogEvent = jest.fn();
const mockSegmentById = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../bot/shared/services/lp612-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/x.pdf'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));
function mockBuilder() {
  const settle = () => Promise.resolve({ data: null, error: null });
  const b = {
    insert: () => b, update: () => b, select: () => b, eq: () => b,
    single: settle, maybeSingle: settle, then: (r, j) => settle().then(r, j),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => mockBuilder(), rpc: jest.fn() }));

const Serving = require('../../bot/shared/services/lp612-serving.service');

const PHONE = '923001234567';
const SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008', book_stem: 'grade_9_chemistry', chapter_key: 'c01',
  grade: 9, subject: 'Chemistry', chapter_number: 1, chapter_title: 'Chapter One',
  subtopic_title: 'Branches of chemistry', menu_title: 'Branches of chemistry',
  printed_page_start: 7, printed_page_end: 8,
};
const sent = () => mockLogEvent.mock.calls.filter((c) => c[0] === 'lp612.send.sent').map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks();
  mockSendMessage.mockResolvedValue(true);
  mockSendDocumentByLink.mockResolvedValue(true);
});

describe('deliverRender logs the copy it sent', () => {
  const deliver = () => Serving.deliverRender({
    phone: PHONE, userId: 'user-1', r2Key: 'lp612/v9.1/ur/x.pdf', segment: SEGMENT, lang: 'ur',
    oneScreen: 'خلاصہ: کیمیا کی شاخیں', renderId: 'r-1', sendRetryDelaysMs: [0, 0],
  });

  test('the summary body and the document caption each land on lp612.send.sent, verbatim', async () => {
    await deliver();

    const events = sent();
    const body = events.find((e) => e.kind === 'body');
    const doc = events.find((e) => e.kind === 'document');
    expect(body).toBeDefined();
    expect(doc).toBeDefined();

    // exactly what went to Meta — rebuildable from the log alone
    expect(body.copy).toBe(mockSendMessage.mock.calls[0][1]);
    const [, , filename, caption] = mockSendDocumentByLink.mock.calls[0];
    expect(doc.copy).toBe(caption);
    expect(doc.filename).toBe(filename);

    for (const e of [body, doc]) {
      expect(e).toMatchObject({ segmentId: SEGMENT.segment_id, lang: 'ur', renderId: 'r-1', userId: 'user-1' });
      expect(e).not.toHaveProperty('phone'); // no new PII
      expect(JSON.stringify(e)).not.toContain(PHONE);
    }
  });

  test('a document that never went out logs no sent event for it', async () => {
    mockSendDocumentByLink.mockResolvedValue(false);
    await expect(deliver()).rejects.toThrow();
    expect(sent().filter((e) => e.kind === 'document')).toHaveLength(0);
  });
});

describe('a narrated catalog message logs its template key and the resolved copy', () => {
  test('requestLesson on an unknown segment: lp612NotFound, with the text she was sent', async () => {
    mockSegmentById.mockResolvedValue(null);

    await Serving.requestLesson({ segmentId: 'nope', userId: 'user-1', phone: PHONE, lang: 'ur' });

    const text = sent().find((e) => e.kind === 'text');
    expect(text).toBeDefined();
    expect(text.uxKey).toBe('lp612NotFound');
    expect(text.lang).toBe('ur');
    expect(text.copy).toBe(mockSendMessage.mock.calls[0][1]);
    expect(text).not.toHaveProperty('phone');
  });

  test('a text send that failed logs no sent event', async () => {
    mockSegmentById.mockResolvedValue(null);
    mockSendMessage.mockResolvedValue(false);

    await Serving.requestLesson({ segmentId: 'nope', userId: 'user-1', phone: PHONE, lang: 'en' });

    expect(sent()).toHaveLength(0);
  });
});
