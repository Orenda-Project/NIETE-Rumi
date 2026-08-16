/**
 * FEAT-059 / bd-fg3p4 — v8 NavigationList item builders (TDD, red first).
 *
 * The builders are pure so the caps, the ✓/○ tick and the pagination split are
 * testable without Meta, R2 or a DB — the storybooks/training convention.
 */

const V8 = require('../../shared/services/lp-v8-catalog.service');

const cps = (s) => [...String(s)].length;
const TITLE_CAP = 30;
const DESC_CAP = 20;
const META_CAP = 80;
const PAGE_SIZE = 20;

// A tiny fake catalog with the shapes that matter: a normal chapter, an
// over-20 chapter, and a chapter with nothing available yet.
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 3, lessons: 27 },
  books: [{
    stem: 'grade_1_maths',
    grade: 1,
    subject: 'Math',
    subject_key: 'math',
    rtl: false,
    chapters: [
      {
        number: 1,
        title: 'Counting Capers',
        title_short: 'Counting Capers',
        pages_label: 'p.1-3',
        lessons: [1, 2, 3].map((i) => ({
          lesson_id: `grade_1_maths_ch1_seg${i}`,
          segment_index: i,
          lp_type: 'content',
          day_label: `Day ${i}`,
          section: 'Memory Lane',
          section_short: 'Memory Lane',
          topic: `Topic ${i}`,
          pages: [i],
          pages_label: `p.${i}`,
          row: { title: 'Memory Lane', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
        })),
      },
      {
        number: 3,
        title: 'Sum and Difference Detectives',
        title_short: 'Sum and Difference Detect…',
        pages_label: 'p.1-24',
        lessons: Array.from({ length: 24 }, (_, k) => ({
          lesson_id: `grade_1_maths_ch3_seg${k + 1}`,
          segment_index: k + 1,
          lp_type: 'content',
          day_label: `Day ${k + 1}`,
          section: 'Leap and Learn',
          section_short: 'Leap and Learn',
          topic: `T${k + 1}`,
          pages: [k + 1],
          pages_label: `p.${k + 1}`,
          row: { title: 'Leap and Learn', description: `Day ${k + 1}`, metadata: `T${k + 1} · p.${k + 1}` },
        })),
      },
      {
        // A title past the 30-cp NavigationList cap ("Ch 4: " + 38 = 44), so the
        // full title must resurface in metadata ahead of the page range.
        number: 4,
        title: 'Wonderful Measurement Adventures Galore',
        title_short: 'Wonderful Measurement Adve…',
        pages_label: 'p.50-61',
        lessons: [{
          lesson_id: 'grade_1_maths_ch4_seg1',
          segment_index: 1,
          lp_type: 'content',
          day_label: 'Day 1',
          section: 'Measure Up',
          section_short: 'Measure Up',
          topic: 'Length and height',
          pages: [50],
          pages_label: 'p.50',
          row: { title: 'Measure Up', description: 'Day 1', metadata: 'Length and height · p.50' },
        }],
      },
      {
        number: 9,
        title: 'Not Rendered Yet',
        title_short: 'Not Rendered Yet',
        pages_label: 'p.90',
        lessons: [{
          lesson_id: 'grade_1_maths_ch9_seg1',
          segment_index: 1,
          lp_type: 'content',
          day_label: 'Day 1',
          section: 'Memory Lane',
          section_short: 'Memory Lane',
          topic: 'Nothing',
          pages: [1],
          pages_label: 'p.1',
          row: { title: 'Memory Lane', description: 'Day 1', metadata: 'Nothing · p.1' },
        }],
      },
    ],
  }],
};

// ch1 fully available, ch3 fully available, ch9 nothing.
const AVAILABLE = new Set([
  ...CATALOG.books[0].chapters[0].lessons.map((l) => l.lesson_id),
  ...CATALOG.books[0].chapters[1].lessons.map((l) => l.lesson_id),
]);

beforeAll(() => V8.__setCatalogForTests(CATALOG));
afterAll(() => V8.__setCatalogForTests(null));

describe('grade + subject screens', () => {
  test('grades 1-5 are the v8 corpus, 6-10 hand off to Oxbridge', () => {
    const items = V8.buildGradeItems([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(items).toHaveLength(10);
    expect(items[0]['main-content'].title).toBe('Grade 1');
    expect(items[0]['on-click-action'].payload).toEqual({ step: 'grade', grade: '1' });
    for (const i of items) expect(cps(i['main-content'].title)).toBeLessThanOrEqual(TITLE_CAP);
    // INVERTED (staging feedback round 1, bd-fel74): the corpus subheading
    // repeated on every row read as noise on the phone — the grade screen now
    // carries the grade name and the tap hint, nothing else.
    for (const i of items) {
      expect(i['main-content'].description).toBe('Tap to open');
      expect(i['main-content'].metadata).toBeUndefined();
    }
  });

  test('a subject with no available chapter is hidden, not shown then dead-ended', () => {
    const items = V8.buildSubjectItems(1, AVAILABLE);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('math');
    const none = V8.buildSubjectItems(1, new Set());
    expect(none).toEqual([]);
  });

  test('the subject row counts only AVAILABLE lessons, not catalog lessons', () => {
    const [item] = V8.buildSubjectItems(1, AVAILABLE);
    expect(item['main-content'].metadata).toContain('27');   // 3 + 24 available
    expect(item['main-content'].metadata).not.toContain('28');
    for (const k of ['title', 'description', 'metadata']) {
      expect(cps(item['main-content'][k])).toBeLessThanOrEqual({ title: TITLE_CAP, description: DESC_CAP, metadata: META_CAP }[k]);
    }
  });
});

describe('chapter screen', () => {
  test('hides a chapter whose lessons are all unavailable', () => {
    const items = V8.buildChapterItems(1, 'math', AVAILABLE);
    expect(items.map((i) => i.id)).toEqual(['1', '3']);      // ch9 hidden
  });

  test('shows the available lesson count, not the catalog count', () => {
    const partial = new Set(['grade_1_maths_ch1_seg1', 'grade_1_maths_ch1_seg2']);
    const [ch1] = V8.buildChapterItems(1, 'math', partial);
    expect(ch1['main-content'].description).toBe('2 lessons');
  });

  test('singular reads "1 lesson", not "1 lessons"', () => {
    const [ch1] = V8.buildChapterItems(1, 'math', new Set(['grade_1_maths_ch1_seg1']));
    expect(ch1['main-content'].description).toBe('1 lesson');
  });

  test('respects the caps and the 20-row screen limit', () => {
    const items = V8.buildChapterItems(1, 'math', AVAILABLE);
    expect(items.length).toBeLessThanOrEqual(PAGE_SIZE);
    for (const i of items) {
      expect(cps(i['main-content'].title)).toBeLessThanOrEqual(TITLE_CAP);
      expect(cps(i['main-content'].description)).toBeLessThanOrEqual(DESC_CAP);
      expect(cps(i['main-content'].metadata || '')).toBeLessThanOrEqual(META_CAP);
    }
  });
});

describe('lesson screen — the ✓/○ resume tick', () => {
  test('downloaded lessons get ✓, the rest ○', () => {
    const downloaded = new Set(['grade_1_maths_ch1_seg2']);
    const { items } = V8.buildLessonItems(1, 'math', 1, AVAILABLE, downloaded, 1);
    expect(items[0]['main-content'].title).toBe('○ Memory Lane');
    expect(items[1]['main-content'].title).toBe('✓ Memory Lane');
  });

  test('the tick never pushes the title past 30 cp — checked at the real 28-cp worst case', () => {
    const long = 'X'.repeat(28);
    const cat = JSON.parse(JSON.stringify(CATALOG));
    cat.books[0].chapters[0].lessons[0].row.title = long;
    V8.__setCatalogForTests(cat);
    const { items } = V8.buildLessonItems(1, 'math', 1, AVAILABLE, new Set(['grade_1_maths_ch1_seg1']), 1);
    expect(cps(items[0]['main-content'].title)).toBe(30);
    expect(items[0]['main-content'].title.startsWith('✓ ')).toBe(true);
    V8.__setCatalogForTests(CATALOG);
  });

  test('unavailable lessons never appear', () => {
    const { items } = V8.buildLessonItems(1, 'math', 1, new Set(['grade_1_maths_ch1_seg1']), new Set(), 1);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('V8-grade_1_maths_ch1_seg1');
  });

  test('lesson ids carry the V8- prefix so the delivery pipeline is unambiguous', () => {
    const { items } = V8.buildLessonItems(1, 'math', 1, AVAILABLE, new Set(), 1);
    for (const i of items) {
      expect(i.id).toMatch(/^V8-/);
      expect(i['on-click-action'].payload).toEqual({ step: 'lesson', lesson: i.id });
    }
  });
});

describe('lesson screen — pagination (the 24-lesson chapter)', () => {
  test('page 1 of a 24-lesson chapter is 19 lessons + a More row', () => {
    const { items, hasMore } = V8.buildLessonItems(1, 'math', 3, AVAILABLE, new Set(), 1);
    expect(hasMore).toBe(true);
    expect(items).toHaveLength(20);
    expect(items[19].id).toBe('__more__');
    expect(items[19]['on-click-action'].payload).toEqual({ step: 'lesson_page', page: '2' });
    expect(items[19]['main-content'].title).toBe('More lessons →');
    expect(items[19]['main-content'].metadata).toContain('5');   // 24 - 19
  });

  test('page 2 holds the remaining 5 and offers no further page', () => {
    const { items, hasMore } = V8.buildLessonItems(1, 'math', 3, AVAILABLE, new Set(), 2);
    expect(hasMore).toBe(false);
    expect(items).toHaveLength(5);
    expect(items.some((i) => i.id === '__more__')).toBe(false);
    expect(items[0].id).toBe('V8-grade_1_maths_ch3_seg20');
  });

  test('a <=20-lesson chapter emits no More row at all', () => {
    const { items, hasMore } = V8.buildLessonItems(1, 'math', 1, AVAILABLE, new Set(), 1);
    expect(hasMore).toBe(false);
    expect(items).toHaveLength(3);
    expect(items.some((i) => i.id === '__more__')).toBe(false);
  });

  test('every page is within the 20-row screen cap', () => {
    for (const page of [1, 2]) {
      const { items } = V8.buildLessonItems(1, 'math', 3, AVAILABLE, new Set(), page);
      expect(items.length).toBeLessThanOrEqual(PAGE_SIZE);
    }
  });

  test('exactly 20 available lessons still fits one page — the off-by-one', () => {
    const cat = JSON.parse(JSON.stringify(CATALOG));
    cat.books[0].chapters[1].lessons = cat.books[0].chapters[1].lessons.slice(0, 20);
    V8.__setCatalogForTests(cat);
    const avail = new Set(cat.books[0].chapters[1].lessons.map((l) => l.lesson_id));
    const { items, hasMore } = V8.buildLessonItems(1, 'math', 3, avail, new Set(), 1);
    expect(hasMore).toBe(false);
    expect(items).toHaveLength(20);
    V8.__setCatalogForTests(CATALOG);
  });
});

describe('id prefixes — three delivery pipelines must never collide', () => {
  test('V8- / PK- / OX- are mutually exclusive', () => {
    expect(V8.parseLessonId('V8-grade_1_maths_ch1_seg1')).toEqual({ source: 'v8', rawId: 'grade_1_maths_ch1_seg1' });
    expect(V8.parseLessonId('PK-abc-uuid')).toEqual({ source: 'pakistan', rawId: 'abc-uuid' });
    expect(V8.parseLessonId('OX-123')).toEqual({ source: 'oxbridge', rawId: '123' });
  });

  test('an unprefixed id stays the legacy pakistan path (back-compat)', () => {
    expect(V8.parseLessonId('abc-uuid')).toEqual({ source: 'pakistan', rawId: 'abc-uuid' });
  });

  test('a v8 lesson_id is never mistaken for an Oxbridge row', () => {
    const { source } = V8.parseLessonId('V8-grade_5_general_science_ch1_seg990');
    expect(source).toBe('v8');
  });
});

describe('catalog lookups', () => {
  test('lessonById finds a lesson and its chapter/book context', () => {
    const hit = V8.lessonById('grade_1_maths_ch1_seg2');
    expect(hit.lesson.lesson_id).toBe('grade_1_maths_ch1_seg2');
    expect(hit.chapter.number).toBe(1);
    expect(hit.book.grade).toBe(1);
    expect(hit.book.subject).toBe('Math');
  });

  test('an unknown lesson_id returns null rather than throwing', () => {
    expect(V8.lessonById('nope')).toBeNull();
  });

  test('gradesWithContent reports only grades that have an available lesson', () => {
    expect(V8.gradesWithContent(AVAILABLE)).toEqual([1]);
    expect(V8.gradesWithContent(new Set())).toEqual([]);
  });
});

// ─── Staging feedback round 1 (bd-fel74) — chapter rows ─────────────────────
// The operator's device test read the old chapter metadata (first lesson's
// topic + its pages) as "the chapter's starting page". The row now carries the
// chapter's FULL page span, and — when the 30-cp cap clips the title — the full
// chapter title ahead of it.
describe('chapter rows: full page range + unclipped title in metadata', () => {
  test('metadata is the chapter page span, not the first lesson topic', () => {
    const items = V8.buildChapterItems(1, 'math', AVAILABLE);
    const ch1 = items.find((i) => i.id === '1');
    expect(ch1['main-content'].metadata).toBe('p.1-3');
    // ch3's title ("Ch 3: Sum and Difference Detectives", 34 cp) is past the
    // title cap, so its metadata correctly leads with the full title.
    const ch3 = items.find((i) => i.id === '3');
    expect(ch3['main-content'].metadata).toBe('Sum and Difference Detectives · p.1-24');
  });

  test('a clipped chapter title reappears IN FULL in metadata, range still terminal', () => {
    const avail = new Set(['grade_1_maths_ch4_seg1']);
    const [ch4] = V8.buildChapterItems(1, 'math', avail);
    expect(cps(`Ch 4: Wonderful Measurement Adventures Galore`)).toBeGreaterThan(TITLE_CAP);
    expect(ch4['main-content'].title.endsWith('…')).toBe(true);
    expect(ch4['main-content'].metadata).toContain('Wonderful Measurement Adventures Galore');
    expect(ch4['main-content'].metadata).toMatch(/p\.50-61$/);
    expect(cps(ch4['main-content'].metadata)).toBeLessThanOrEqual(META_CAP);
  });
});
