/**
 * A paper may cover as much of the book as the teacher needs.
 *
 * Field report from a coach: "We can maximum choose 6 chapters as of now, but
 * teachers are asking they need to select at least 50% of whole syllabus to
 * make an exam paper." The 6 was `max-selected-items` on the COVERAGE
 * CheckboxGroup. Of the 35 WhatsApp requests made on the two biggest books,
 * more multi-chapter picks were exactly six than any other size — teachers
 * were hitting the wall.
 *
 * Removing the 6 is not enough on its own. Meta caps ONE CheckboxGroup at 20
 * options (Flow components reference; the same limit class-manager splits its
 * roster for), and ICT's G4/G5 Islamiat books have 23 and 24
 * chapters. None of those 35 requests ever included a chapter past 20: they were
 * not on the screen. So the list is carried by TWO groups — chapters 1-20 and
 * 21-40 — the second drawn only for a book that needs it.
 *
 * Downstream, nothing else limits her: the typed-pages escape hatch has always
 * accepted a whole book, `page_ranges` is TEXT, and the biggest ICT book is
 * ~264K characters of page text for a model with a far larger context.
 */

const fs = require('fs');
const path = require('path');

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

/** A 24-chapter book, four pages a chapter: chapter n is pages 4n-3 .. 4n. */
const BIG_BOOK = Array.from({ length: 24 }, (_, i) => ({
  chapterNumber: i + 1,
  title: `Lesson ${i + 1}`,
  pageStart: 4 * i + 1,
  pageEnd: 4 * i + 4,
}));

const SMALL_BOOK = BIG_BOOK.slice(0, 9);

const BOOK = { id: 'book-uuid', total_pages: 114 };

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
          if (Array.isArray(row.chapter_number)) {
            return { select: () => ({ single: () => Promise.resolve({
              data: null,
              error: { code: '22P02', message: 'invalid input syntax for type integer' },
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

beforeEach(() => {
  jest.clearAllMocks();
  wireDb();
  mockListChapters.mockResolvedValue(BIG_BOOK);
});

const flow = () => JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));

function coverage() {
  const screen = flow().screens.find((s) => s.id === 'COVERAGE');
  const form = screen.layout.children.find((c) => c.type === 'Form');
  return { screen, form };
}

// ── the Flow JSON ─────────────────────────────────────────────────────────

describe('the COVERAGE screen does not stop her at six chapters', () => {
  test('no chapter picker carries a max-selected-items cap', () => {
    const boxes = coverage().form.children.filter((c) => c.type === 'CheckboxGroup');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).not.toHaveProperty('max-selected-items');
  });

  test('a second group carries chapters 21 and up, shown only when the book has them', () => {
    const { screen, form } = coverage();
    const more = form.children.find((c) => c.name === 'chapters_more');
    expect(more).toBeDefined();
    expect(more.type).toBe('CheckboxGroup');
    expect(more['data-source']).toBe('${data.chapters_more}');
    expect(more.visible).toBe('${data.has_more_chapters}');
    expect(more.required).toBe(false);
    // Bindings render literally unless declared in the screen's data.
    expect(screen.data.chapters_more).toBeDefined();
    expect(screen.data.has_more_chapters).toBeDefined();
  });

  test('the footer posts both groups', () => {
    const footer = coverage().form.children.find((c) => c.type === 'Footer');
    const payload = footer['on-click-action'].payload;
    expect(payload.chapters).toBe('${form.chapters}');
    expect(payload.chapters_more).toBe('${form.chapters_more}');
  });
});

// ── the endpoint ──────────────────────────────────────────────────────────

const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

describe('each group is drawn within Meta\'s 20 options', () => {
  test('a 24-chapter book is split 20 + 4, and every chapter is on the screen', () => {
    const data = _internal.coverageLists(BIG_BOOK);
    expect(data.chapters).toHaveLength(20);
    expect(data.chapters_more).toHaveLength(4);
    expect(data.has_more_chapters).toBe(true);
    const ids = [...data.chapters, ...data.chapters_more].map((o) => o.id);
    expect(ids).toEqual(BIG_BOOK.map((c) => String(c.chapterNumber)));
  });

  test('a book that fits one group hides the second, which is still non-empty', () => {
    const data = _internal.coverageLists(SMALL_BOOK);
    expect(data.chapters).toHaveLength(9);
    expect(data.has_more_chapters).toBe(false);
    // An empty data-source is not renderable, even hidden: the client shows
    // "Something went wrong" and the screen never draws.
    expect(data.chapters_more.length).toBeGreaterThan(0);
  });
});

describe('she can tick more than six chapters and all of them are kept', () => {
  test('picks from both groups are merged; the placeholder is ignored', () => {
    const nums = _internal.pickedChapterNumbers({
      chapters: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
      chapters_more: ['24', _internal.NO_MORE_CHAPTERS_ID],
    });
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 24]);
  });

  test('a client on the old published Flow, posting only `chapters`, still works', () => {
    expect(_internal.pickedChapterNumbers({ chapters: ['3', '2'] })).toEqual([2, 3]);
    expect(_internal.pickedChapterNumbers({ chapter: '5' })).toEqual([5]);
  });

  test('twelve chapters — half of a 24-chapter book — are stored as one paper', async () => {
    const picked = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    await _internal.submit({
      userId: 'u1', grade: 5, subject: 'islamiat',
      chapterNumbers: picked,
      chapterTitles: picked.map((n) => `Lesson ${n}`),
      pageRanges: null,
      questionCount: 30, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });

    expect(inserted.chapter_number).toBeNull();
    // Contiguous chapters read as one span, not twelve.
    expect(inserted.page_ranges).toBe('1-48');
    const [, , job] = mockQueueJob.mock.calls[0];
    expect(job.chapterNumbers).toEqual(picked);
    expect(job.chapterNumber).toBeNull();
  });

  test('every chapter of the book can go into one paper', async () => {
    const picked = BIG_BOOK.map((c) => c.chapterNumber);
    await _internal.submit({
      userId: 'u1', grade: 5, subject: 'islamiat',
      chapterNumbers: picked, chapterTitles: picked.map((n) => `Lesson ${n}`),
      pageRanges: null,
      questionCount: 50, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });
    expect(inserted.page_ranges).toBe('1-96');
  });

  test('gaps stay gaps', async () => {
    await _internal.submit({
      userId: 'u1', grade: 5, subject: 'islamiat',
      chapterNumbers: [1, 2, 3, 5, 21, 22], chapterTitles: [],
      pageRanges: null,
      questionCount: 20, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });
    expect(inserted.page_ranges).toBe('1-12, 17-20, 81-88');
  });
});

describe('the summary line stays readable for a long pick', () => {
  // A run of three or more becomes a span; two neighbours stay a list, so
  // "Chapters 2, 3" reads exactly as it did before.
  test('runs are compressed', () => {
    const all = BIG_BOOK.map((c) => c.chapterNumber);
    expect(_internal.summaryOf({ grade: 5, subject: 'islamiat', chapterNumbers: all, chapterTitles: [] }))
      .toContain('Chapters 1-24');
    expect(_internal.summaryOf({
      grade: 5, subject: 'islamiat', chapterNumbers: [1, 2, 3, 5, 7, 8], chapterTitles: [],
    })).toContain('Chapters 1-3, 5, 7, 8');
  });

  test('two non-adjacent chapters still read as a list', () => {
    expect(_internal.summaryOf({ grade: 5, subject: 'islamiat', chapterNumbers: [2, 4], chapterTitles: [] }))
      .toContain('Chapters 2, 4');
  });
});
