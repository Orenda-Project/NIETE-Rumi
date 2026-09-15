/**
 * An exam may span more than one chapter.
 *
 * The COVERAGE screen offered a Dropdown — Meta's SINGLE-select — so a teacher
 * whose test covers chapters 2 and 3 could ask for exactly half of it. Reported
 * from the field (NIETE bug sheet row 2, Mubasher Zia): "exam questions often
 * need to span several chapters."
 *
 * The widening is `chapterNumber` -> `chapterNumbers`, an array, threaded
 * through the picker, the summary line, the page resolver and the stored row.
 *
 * The storage shape is the interesting part and is asserted here rather than
 * taken on trust. `assessment_requests.chapter_number` is an INTEGER and stays
 * one: what a multi-chapter request covers is recorded in `page_ranges`, the
 * column that already exists for exactly that purpose and that the orchestrator
 * already knows how to load. See the schema note in the endpoint.
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
  { chapterNumber: 2, title: 'The Thirsty Crow', pageStart: 15, pageEnd: 27 },
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
          // The live column is INTEGER. An array reaches Postgres as a 22P02
          // (invalid input syntax), not a row — so a test that let one through
          // would be green on code that cannot store what it claims to.
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
  mockListChapters.mockResolvedValue(CHAPTERS);
});

describe('the COVERAGE screen lets her tick more than one chapter', () => {
  const fs = require('fs');
  const path = require('path');
  const flow = () => JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));

  function chapterField() {
    const coverage = flow().screens.find((s) => s.id === 'COVERAGE');
    const form = coverage.layout.children.find((c) => c.type === 'Form');
    return form.children.find((c) => c.name === 'chapters' || c.name === 'chapter');
  }

  test('the chapter picker is a multi-select, not a Dropdown', () => {
    const field = chapterField();
    // A Dropdown is single-select: whatever its label says, she can only ever
    // send one chapter back.
    expect(field.type).toBe('CheckboxGroup');
  });

  test('the picker sends every ticked chapter back to the endpoint', () => {
    const coverage = flow().screens.find((s) => s.id === 'COVERAGE');
    const form = coverage.layout.children.find((c) => c.type === 'Form');
    const footer = form.children.find((c) => c.type === 'Footer');
    const payload = footer['on-click-action'].payload;
    const field = chapterField();
    expect(payload[field.name]).toBe(`\${form.${field.name}}`);
  });
});

describe('the summary line reads properly however many she picked', () => {
  const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

  test('two chapters are named as a list, pluralised', () => {
    const line = _internal.summaryOf({
      grade: 1, subject: 'english',
      chapterNumbers: [2, 3],
      chapterTitles: ['The Thirsty Crow', "Pinky's Yummy Tummy"],
    });
    expect(line).toContain('Chapters 2, 3');
    // The bug this guards: a scalar template over an array yields
    // "Chapter 2,3 · undefined".
    expect(line).not.toContain('undefined');
    expect(line).not.toMatch(/Chapter \d+,\d+/);
  });

  test('one chapter reads exactly as it always did', () => {
    const line = _internal.summaryOf({
      grade: 1, subject: 'english',
      chapterNumbers: [1],
      chapterTitles: ['Hello World!'],
    });
    expect(line).toContain('Chapter 1 · Hello World!');
    expect(line).not.toContain('Chapters');
  });

  test('a page-range request still says pages, not chapters', () => {
    const line = _internal.summaryOf({
      grade: 1, subject: 'english',
      chapterNumbers: null, chapterTitles: null, pageRanges: '4-14',
    });
    expect(line).toContain('Pages 4-14');
  });
});

describe('a multi-chapter request is stored so the worker can build it', () => {
  test('the pages of every ticked chapter are unioned into page_ranges', async () => {
    const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

    await _internal.submit({
      userId: 'u1', grade: 1, subject: 'english',
      chapterNumbers: [2, 3],
      chapterTitles: ['The Thirsty Crow', "Pinky's Yummy Tummy"],
      pageRanges: null,
      questionCount: 10, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });

    expect(inserted).not.toBeNull();
    expect(inserted.page_ranges).toBe('15-27, 28-40');
  });

  test('chapter_number stays a scalar the INTEGER column can hold', async () => {
    const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

    await _internal.submit({
      userId: 'u1', grade: 1, subject: 'english',
      chapterNumbers: [2, 3],
      chapterTitles: ['The Thirsty Crow', "Pinky's Yummy Tummy"],
      pageRanges: null,
      questionCount: 10, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });

    expect(Array.isArray(inserted.chapter_number)).toBe(false);
    // Multi-chapter coverage is carried by page_ranges; pinning the row to the
    // FIRST chapter would make the orchestrator load that chapter alone and
    // silently drop the rest.
    expect(inserted.chapter_number).toBeNull();
  });

  test('the queued job covers both chapters', async () => {
    const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

    await _internal.submit({
      userId: 'u1', grade: 1, subject: 'english',
      chapterNumbers: [2, 3],
      chapterTitles: ['The Thirsty Crow', "Pinky's Yummy Tummy"],
      pageRanges: null,
      questionCount: 10, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });

    expect(mockQueueJob).toHaveBeenCalled();
    const [, jobType, job] = mockQueueJob.mock.calls[0];
    expect(jobType).toBe('assessment_generate');
    expect(job.pageRanges).toBe('15-27, 28-40');
    // The orchestrator branches on `chapterNumber != null` and would load ONE
    // chapter. A multi-chapter job must take the page-range branch.
    expect(job.chapterNumber).toBeNull();
    expect(job.chapterNumbers).toEqual([2, 3]);
  });
});

describe('the single-chapter path is untouched', () => {
  test('one chapter still stores its own number and its own pages', async () => {
    const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

    await _internal.submit({
      userId: 'u1', grade: 1, subject: 'english',
      chapterNumbers: [1], chapterTitles: ['Hello World!'], pageRanges: null,
      questionCount: 10, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });

    // Unchanged from the single-select era: the row names the chapter, and the
    // job takes the loadChapterContent branch.
    expect(inserted.chapter_number).toBe(1);
    expect(inserted.page_ranges).toBe('4-14');
    const [, , job] = mockQueueJob.mock.calls[0];
    expect(job.chapterNumber).toBe(1);
  });

  test('a request made the old way, with a scalar chapterNumber, still works', async () => {
    const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');

    // A session written before this change is still in Redis when it deploys.
    await _internal.submit({
      userId: 'u1', grade: 1, subject: 'english',
      chapterNumber: 3, chapterTitle: "Pinky's Yummy Tummy", pageRanges: null,
      questionCount: 10, contentSource: 'unseen',
      outputFormat: 'pdf', answerLines: true, answerKey: false,
    });

    expect(inserted.chapter_number).toBe(3);
    expect(inserted.page_ranges).toBe('28-40');
  });
});
