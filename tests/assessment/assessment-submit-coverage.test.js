/**
 * A request must record WHICH PAGES it covers, whichever way she chose them.
 *
 * She can pick a chapter or type page numbers. The chapter path set
 * `pageRanges: null` and stored it, so every chapter request died on
 * `page_ranges NOT NULL` (23502) — no row, no job, and a terminal screen that
 * said both "something went wrong" and "it will arrive in this chat".
 *
 * The insert is asserted here rather than the screen, because the screen was
 * the one part that looked fine.
 */

const mockSupabase = { from: jest.fn() };
const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });
const mockListChapters = jest.fn();

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: (...a) => mockListChapters(...a),
  parsePageRanges: jest.requireActual(
    '../../bot/shared/services/assessment/book-content.service').parsePageRanges,
}));

const CHAPTERS = [
  { chapterNumber: 1, title: 'Hello World!', pageStart: 4, pageEnd: 14 },
  { chapterNumber: 3, title: "Pinky's Yummy Tummy", pageStart: 28, pageEnd: 40 },
];

const BOOK = { id: 'book-uuid', total_pages: 166 };

let inserted;

function wireDb() {
  inserted = null;
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'textbooks') {
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: () => Promise.resolve({ data: BOOK, error: null }),
      }) }) }) }) };
    }
    if (table === 'assessment_requests') {
      return {
        insert: (row) => {
          inserted = row;
          // The live column is NOT NULL; a null here is a 23502, not a row.
          if (row.page_ranges === null || row.page_ranges === undefined) {
            return { select: () => ({ single: () => Promise.resolve({
              data: null,
              error: { code: '23502', message: 'null value in column "page_ranges" violates not-null constraint' },
            }) }) };
          }
          return { select: () => ({ single: () => Promise.resolve({
            data: { id: 'req-1' }, error: null,
          }) }) };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

describe('a chapter choice records the pages it covers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    wireDb();
    mockListChapters.mockResolvedValue(CHAPTERS);
  });

  test('the chapter is resolved to its page range before the request is stored', async () => {
    const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

    await _internal.submit({
      userId: 'u1', grade: 1, subject: 'english',
      chapterNumber: 1, chapterTitle: 'Hello World!', pageRanges: null,
      questionCount: 10, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });

    expect(inserted).not.toBeNull();
    expect(inserted.page_ranges).toBe('4-14');
    expect(inserted.chapter_number).toBe(1);
  });

  test('a typed page range is stored as she typed it', async () => {
    const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

    await _internal.submit({
      userId: 'u1', grade: 1, subject: 'english',
      chapterNumber: null, pageRanges: '4-14, 20',
      questionCount: 10, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });

    expect(inserted.page_ranges).toBe('4-14, 20');
    expect(inserted.chapter_number).toBeNull();
  });

  test('the queued job carries the same pages the row records', async () => {
    const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

    await _internal.submit({
      userId: 'u1', grade: 1, subject: 'english',
      chapterNumber: 3, chapterTitle: "Pinky's Yummy Tummy", pageRanges: null,
      questionCount: 10, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });

    expect(inserted.page_ranges).toBe('28-40');
    expect(mockQueueJob).toHaveBeenCalledWith('u1', 'assessment_generate',
      expect.objectContaining({ chapterNumber: 3, pageRanges: '28-40' }));
  });

  test('the queued job carries the question count, so the limit can govern the whole paper (bd-60015)', async () => {
    const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');
    await _internal.submit({
      userId: 'u1', grade: 1, subject: 'english',
      chapterNumber: 1, chapterTitle: 'Hello World!', pageRanges: null,
      questionCount: 10, contentSource: 'both',
      outputFormat: 'pdf', answerLines: true, answerKey: true,
    });
    expect(mockQueueJob).toHaveBeenCalledWith('u1', 'assessment_generate',
      expect.objectContaining({ questionCount: 10, contentSource: 'both', includeAnswerKey: true }));
  });
});
