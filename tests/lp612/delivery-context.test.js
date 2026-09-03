/**
 * A 6-12 lesson must leave a trace the chat can see.
 *
 * THE HOLE THIS CLOSES. Until now `deliverRender` sent two WhatsApp messages and returned. It
 * wrote no conversation state, no shelf entry and no download row — and the shelf plus
 * `niete_lp_downloads` are exactly the two stores `buildLpContext` reads. So when a teacher
 * replied "what does the activity mean?" after a 6-12 lesson, `buildLpContext` found nothing,
 * returned null, and she was answered by a small model that had never seen her lesson. The reply
 * looked like an answer, which is worse than an error.
 *
 * K-5 has recorded its deliveries three ways since it shipped (`lp-v8-delivery.service.js`).
 * This is the 6-12 lane catching up, and it is worth shipping on its own merits — every question
 * about a 6-12 lesson gets grounded by it, whether or not the edit flow ever lands.
 *
 * THE SHAPE IS CONSTRAINED BY A SHARED CONSUMER. The shelf is read by `lp-context.service`,
 * whose `renderEntry` calls two K-5 resolvers on every entry:
 *
 *   resolveMoveList({lesson_id, content_hash})  → returns null immediately when lesson_id is absent
 *   getVoicenoteScript({r2_key})                → derives a .txt key and fetches it from R2
 *
 * The first is free. The SECOND IS NOT: hand it an `r2_key` and it will round-trip to R2 for a
 * voicenote transcript that a 6-12 lesson has never had. So the entry deliberately carries no
 * `lesson_id`, no `content_hash` and no `r2_key` — both resolvers no-op, the entry costs zero
 * extra I/O, and K-5 entries are untouched because nothing here changes their fields.
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockPushToShelf = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage,
  sendDocumentByLink: mockSendDocumentByLink,
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  pushToShelf: (...a) => mockPushToShelf(...a),
  getDeliveryType: () => 'segment',
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/x.pdf'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
const mockSegmentById = jest.fn();
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

// Enough of a Supabase double to walk requestLesson's cache-hit branch.
const mockDbResults = [];
function mockBuilder() {
  const settle = () => Promise.resolve(
    mockDbResults.length ? mockDbResults.shift() : { data: null, error: null },
  );
  const b = {
    insert: () => b, update: () => b, select: () => b, eq: () => b,
    single: settle, maybeSingle: settle, then: (r, j) => settle().then(r, j),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => mockBuilder() }));

const SEGMENT = {
  segment_id: 'grade_8_mathematics.c05.p071-073',
  book_stem: 'grade_8_mathematics',
  chapter_key: 'c05',
  grade: 8,
  subject: 'Mathematics',
  chapter_number: 5,
  chapter_title: 'Sets',
  subtopic_title: 'Set-builder notation',
  menu_title: 'Sets & notation',
  printed_page_start: 71,
  printed_page_end: 73,
};

const ONE_SCREEN = 'Today the class turns a listed set into set-builder form, using p.71-73.';

let Serving;
beforeEach(() => {
  jest.resetModules();
  mockSendMessage.mockReset().mockResolvedValue(undefined);
  mockSendDocumentByLink.mockReset().mockResolvedValue(undefined);
  mockPushToShelf.mockReset().mockResolvedValue(undefined);
  Serving = require('../../bot/shared/services/lp612-serving.service');
});

const deliver = (over = {}) => Serving.deliverRender({
  phone: '9203001234567',
  userId: 'user-uuid-1',
  r2Key: 'lp612/v9.1/en/grade_8_mathematics.c05.p071-073.pdf',
  segment: SEGMENT,
  lang: 'en',
  oneScreen: ONE_SCREEN,
  ...over,
});

describe('lp612 delivery leaves a trace the chat can read', () => {
  test('the delivery is recorded on the LP shelf', async () => {
    await deliver();
    expect(mockPushToShelf).toHaveBeenCalledTimes(1);
    const [userId, entry] = mockPushToShelf.mock.calls[0];
    expect(userId).toBe('user-uuid-1');
    expect(entry.segment_id).toBe(SEGMENT.segment_id);
  });

  test('the entry carries the identity buildLpContext renders a heading from', async () => {
    await deliver();
    const [, entry] = mockPushToShelf.mock.calls[0];
    expect(entry.grade).toBe(8);
    expect(entry.subject).toBe('Mathematics');
    expect(entry.chapter_number).toBe(5);
    expect(entry.chapter_title).toBe('Sets');
    expect(entry.topic).toBe('Set-builder notation');
    expect(entry.pages_label).toBe('71-73');
    expect(typeof entry.delivered_at).toBe('string');
    expect(Number.isFinite(Date.parse(entry.delivered_at))).toBe(true);
  });

  test('the one-screen summary rides along — this is what actually grounds her question', async () => {
    await deliver();
    const [, entry] = mockPushToShelf.mock.calls[0];
    expect(entry.one_screen).toBe(ONE_SCREEN);
  });

  test('a single-page segment gets a single-page label, not a degenerate range', async () => {
    await deliver({ segment: { ...SEGMENT, printed_page_start: 71, printed_page_end: 71 } });
    const [, entry] = mockPushToShelf.mock.calls[0];
    expect(entry.pages_label).toBe('71');
  });

  describe('the entry must not wake the K-5 resolvers', () => {
    test.each(['lesson_id', 'content_hash', 'r2_key'])(
      'carries no %s — an r2_key would cost a pointless R2 fetch for a voicenote that does not exist',
      async (field) => {
        await deliver();
        const [, entry] = mockPushToShelf.mock.calls[0];
        expect(entry[field]).toBeUndefined();
      },
    );

    test('it is discoverable as a 6-12 entry without guessing from absent fields', async () => {
      await deliver();
      const [, entry] = mockPushToShelf.mock.calls[0];
      expect(entry.lane).toBe('lp612');
    });
  });

  describe('recording must never cost her the lesson', () => {
    test('the PDF still sends when the shelf write throws', async () => {
      mockPushToShelf.mockRejectedValue(new Error('redis down'));
      await expect(deliver()).resolves.not.toThrow();
      expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    });

    test('no userId means no shelf write, and still a delivered lesson', async () => {
      await deliver({ userId: undefined });
      expect(mockPushToShelf).not.toHaveBeenCalled();
      expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    });

    // The OTHER hop. requestLesson knows the userId; deliverRender needs it. This test walks the
    // real cache-hit branch rather than asserting on source text, because a threading bug is
    // invisible to a grep and fatal in production: every second-and-later teacher for a lesson
    // is served from cache, so dropping it here would leave the shelf empty for the MAJORITY of
    // deliveries while the worker path looked fine.
    test('a cache hit threads her userId through to the recording', async () => {
      mockSegmentById.mockResolvedValue(SEGMENT);
      mockDbResults.push({
        data: {
          id: 'render-1', status: 'ready', one_screen: ONE_SCREEN,
          r2_key: 'lp612/v9.1/en/grade_8_mathematics.c05.p071-073.pdf',
        },
        error: null,
      });

      const out = await Serving.requestLesson({
        segmentId: SEGMENT.segment_id, userId: 'cache-hit-user', phone: '923009999999', lang: 'en',
      });

      expect(out.outcome).toBe('cache_hit');
      expect(mockPushToShelf).toHaveBeenCalledTimes(1);
      expect(mockPushToShelf.mock.calls[0][0]).toBe('cache-hit-user');
    });

    test('the document is still sent AFTER the body, as before', async () => {
      await deliver();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.invocationCallOrder[0])
        .toBeLessThan(mockSendDocumentByLink.mock.invocationCallOrder[0]);
    });
  });
});
