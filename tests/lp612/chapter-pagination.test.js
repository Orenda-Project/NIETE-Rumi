/**
 * 6-12 LPs · the chapter screen paginates — no chapter is unreachable.
 *
 * The chapter list used to `.slice(0, PAGE_SIZE)` with NO More row: 53 chapters
 * across 13 staging books (Islamiat, Chemistry, Urdu) simply did not exist for
 * a teacher — she could not open chapter 21 of a 27-chapter book, with no
 * error and nothing to tap. The fix is the segment lane's own pattern: page 1
 * carries PAGE_SIZE-1 real rows plus a More row (Meta rejects a self-route, so
 * overflow lands on SELECT_CHAPTER_MORE), and the More row speaks the book's
 * language («مزید ابواب ←», bd-t8mbl's rule).
 *
 * The SUCCESS screen's static copy is asserted here too: it promised "the PDF
 * arrives in a few seconds", which is true for K-5 pre-rendered plans and
 * false for a 6-12 first hit (measured median 313 s). One shared fallback
 * message across distinct states misdirects every field report — rule 24(d).
 */

const path = require('path');
const fs = require('fs');

const mockDbCalls = [];
let mockRows = [];

function mockBuilder(table) {
  const state = { table, filters: [], order: null, columns: null };
  const b = {
    select: (c) => { state.columns = c; return b; },
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    in: (c, v) => { state.filters.push([c, v]); return b; },
    or: (expr) => { state.or = expr; return b; },
    order: (c, o) => { state.order = [c, o]; return b; },
    limit: () => b,
    then: (res, rej) => {
      mockDbCalls.push({ ...state });
      let rows = mockRows.filter((r) => state.filters.every(
        ([c, v]) => r[c] === undefined || r[c] === v,
      ));
      if (state.or) {
        const m = /grade\.eq\.(\d+)/.exec(state.or);
        if (m) {
          const g = Number(m[1]);
          rows = rows.filter((r) => r.grade === undefined
            || r.grade === g || (r.also_grades || []).includes(g));
        }
      }
      return Promise.resolve({ data: rows, error: null }).then(res, rej);
    },
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Catalog = require('../../bot/shared/services/lp612-catalog.service');
const { PAGE_SIZE, MORE_ROW_ID } = require('../../bot/shared/services/lp-v8-catalog.service');

/** N distinct chapters, one segment each. */
function chapterRows(n, { language = 'en' } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    grade: 9,
    subject: 'Islamiat',
    chapter_key: `c${String(i + 1).padStart(2, '0')}`,
    chapter_number: i + 1,
    chapter_title: `Chapter title ${i + 1}`,
    part: null,
    language,
    order_index: i + 1,
    is_current: true,
    is_religious: false,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockRows = [];
  process.env.LP_612_RELIGIOUS_ENABLED = 'true'; // fixture book is Islamiat
});

afterAll(() => { delete process.env.LP_612_RELIGIOUS_ENABLED; });

// ── the catalog paginates chapters like it paginates lessons ────────────────

describe('buildChapterItems paginates', () => {
  test('27 chapters: page 1 is PAGE_SIZE-1 rows plus a More row — nothing dropped', async () => {
    mockRows = chapterRows(27);
    const { items, hasMore, total } = await Catalog.buildChapterItems(9, 'Islamiat');

    expect(total).toBe(27);
    expect(hasMore).toBe(true);
    expect(items).toHaveLength(PAGE_SIZE);
    expect(items[items.length - 1].id).toBe(MORE_ROW_ID);
    expect(items[items.length - 1]['on-click-action'].payload).toEqual({
      step: 'lp612_chapter_page', grade: '9', subject: 'Islamiat', page: '2',
    });
  });

  test('page 2 carries the remaining chapters — chapter 21+ exist again', async () => {
    mockRows = chapterRows(27);
    const { items, hasMore } = await Catalog.buildChapterItems(9, 'Islamiat', 2);

    expect(hasMore).toBe(false);
    expect(items).toHaveLength(27 - (PAGE_SIZE - 1));
    const numbers = items.map((i) => i.id);
    expect(numbers).toContain('c21');
    expect(numbers).toContain('c27');
    expect(numbers).not.toContain(MORE_ROW_ID);
  });

  test('a book that fits one page gets no More row — nothing changes for it', async () => {
    mockRows = chapterRows(7);
    const { items, hasMore, total } = await Catalog.buildChapterItems(9, 'Islamiat');
    expect(total).toBe(7);
    expect(hasMore).toBe(false);
    expect(items).toHaveLength(7);
  });

  test('an Urdu book gets an Urdu More row («مزید ابواب ←») — bd-t8mbl holds here too', async () => {
    mockRows = chapterRows(25, { language: 'ur' });
    const { items } = await Catalog.buildChapterItems(9, 'Islamiat');
    const more = items[items.length - 1];
    expect(more.id).toBe(MORE_ROW_ID);
    expect(more['main-content'].title).toContain('مزید ابواب');
    expect(more['main-content'].title).toContain('←');
  });
});

// ── the flow asset: the overflow screen exists and SUCCESS is honest ────────

describe('pakistan-lp-flow v3.2 asset', () => {
  const flow = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../docs/flows/pakistan-lp-flow-v3.json'), 'utf8',
  ));
  const screenById = (id) => flow.screens.find((s) => s.id === id);

  test('SELECT_CHAPTER can route to SELECT_CHAPTER_MORE — Meta rejects a self-route', () => {
    expect(flow.routing_model.SELECT_CHAPTER).toContain('SELECT_CHAPTER_MORE');
    expect(flow.routing_model.SELECT_CHAPTER).toContain('SELECT_LESSON');
    expect(flow.routing_model.SELECT_CHAPTER_MORE).toEqual(['SELECT_LESSON']);
  });

  test('SELECT_CHAPTER_MORE is the same generic NavigationList shape', () => {
    const s = screenById('SELECT_CHAPTER_MORE');
    expect(s).toBeTruthy();
    const nav = s.layout.children.find((c) => c.type === 'NavigationList');
    expect(nav['list-items']).toBe('${data.items}');
    expect(s.layout.children).toHaveLength(1); // NavigationList alone on its screen
  });

  test('the SUCCESS screen no longer promises seconds — a first hit is minutes', () => {
    const s = screenById('SUCCESS');
    const texts = s.layout.children.filter((c) => c.type === 'TextBody' || c.type === 'TextHeading')
      .map((c) => c.text).join(' | ');
    expect(texts).not.toMatch(/few seconds/i);
    expect(texts).toMatch(/minute/i);
  });
});
