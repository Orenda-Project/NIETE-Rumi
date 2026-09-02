/**
 * Loading the segmentation corpus into the menu table.
 *
 * The importer runs many times, not once: books finish over hours and the fleet
 * can be re-run on any of them. So the two properties that matter are that a
 * second run changes nothing, and that a re-run which MOVED a boundary retires
 * the segment it replaced instead of leaving both in the menu.
 *
 * The third thing tested here is the operator's hold. `is_religious` is computed
 * once, here, and stored — serving never re-derives it from a title — so this is
 * the only place the rule exists and the only place it can be got wrong.
 */

const Import = require('../../bot/scripts/import-lp612-segments');

const { isReligiousSegment, validateSegment, toRow, reconcilePlan } = Import;

const seg = (over = {}) => ({
  segment_id: 'grade_9_chemistry.c01.p007-008',
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  medium: 'English',
  language: 'en',
  chapter_number: 1,
  chapter_title: 'Nature of Chemistry in Science',
  chapter_key: 'c01',
  subtopic_title: 'Definition of chemistry and its branches',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  pages_covered: [7, 8],
  order_index: 1,
  lp_type: 'content',
  ...over,
});

// ── the operator's hold ─────────────────────────────────────────────────────

describe('is_religious is computed at import and stored', () => {
  test('an Islamiat book is held whole', () => {
    expect(isReligiousSegment(seg({
      book_stem: 'grade_7_islamiat', subject: 'Islamiat',
    }))).toBe(true);
  });

  test.each([
    ['Islamiyat spelling', { subject: 'Islamiyat' }],
    ['Urdu subject name', { subject: 'اسلامیات' }],
    ['book stem only', { book_stem: 'grade_10_islamiat', subject: 'Religious Studies' }],
  ])('%s is held', (_label, over) => {
    expect(isReligiousSegment(seg(over))).toBe(true);
  });

  test('seerah content inside a NON-Islamiat book is held too', () => {
    // The hold is on content, not on a subject label. A seerah chapter in an
    // Urdu reader is exactly the case a subject-name check would miss.
    expect(isReligiousSegment(seg({
      book_stem: 'grade_8_urdu',
      subject: 'Urdu',
      chapter_title: 'سیرتِ نبوی ﷺ',
    }))).toBe(true);
    expect(isReligiousSegment(seg({
      book_stem: 'grade_8_english', subject: 'English',
      subtopic_title: 'The Seerah of the Prophet',
    }))).toBe(true);
  });

  test.each(['حدیث', 'قرآن', 'نعت', 'Hadith', 'Quran', 'Sunnah'])(
    'the marker %p holds a segment wherever it appears',
    (marker) => {
      expect(isReligiousSegment(seg({ subtopic_title: `Lesson on ${marker}` }))).toBe(true);
    },
  );

  test('ordinary science is NOT held — the hold must not swallow the corpus', () => {
    expect(isReligiousSegment(seg())).toBe(false);
    expect(isReligiousSegment(seg({ subject: 'Physics', chapter_title: 'Motion and Force' }))).toBe(false);
  });

  test('Pakistan Studies history is not held by an incidental word', () => {
    // Deliberate boundary: "Islamic civilisation" as history is not seerah, and
    // holding all of Pak Studies would silently remove a whole subject from the
    // menu rather than holding a lesson.
    expect(isReligiousSegment(seg({
      book_stem: 'grade_10_pak_studies_english',
      subject: 'Pakistan Studies',
      chapter_title: 'The Islamic civilisation in South Asia',
    }))).toBe(false);
  });
});

// ── validation ──────────────────────────────────────────────────────────────

describe('validation', () => {
  test('a well-formed segment passes clean', () => {
    expect(validateSegment(seg())).toEqual({ errors: [], warnings: [] });
  });

  test.each(['segment_id', 'book_stem', 'grade', 'subject', 'chapter_key',
    'subtopic_title', 'menu_title', 'printed_page_start', 'order_index'])(
    'a missing %s is an ERROR — the row cannot be imported',
    (field) => {
      const s = seg();
      delete s[field];
      expect(validateSegment(s).errors.length).toBeGreaterThan(0);
    },
  );

  test('a grade outside 6-12 is an error', () => {
    expect(validateSegment(seg({ grade: 5 })).errors.length).toBeGreaterThan(0);
    expect(validateSegment(seg({ grade: 13 })).errors.length).toBeGreaterThan(0);
  });

  test('an over-cap menu_title is a WARNING, not an error', () => {
    // The catalogue clips defensively at render time, so an over-cap title costs
    // a slightly clipped row, not a missing lesson. Reported so the corpus can
    // be fixed at source.
    const r = validateSegment(seg({ menu_title: 'x'.repeat(45) }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/menu_title/);
  });

  test('caps are measured in code points, not bytes', () => {
    // 25 Urdu characters: well under the 30 cap, well over 30 bytes.
    const urdu = 'ا'.repeat(25);
    expect(validateSegment(seg({ menu_title: urdu })).warnings).toEqual([]);
    expect(Buffer.byteLength(urdu, 'utf8')).toBeGreaterThan(30);
  });

  test('an unknown lp_type is an error rather than a row the CHECK will reject', () => {
    expect(validateSegment(seg({ lp_type: 'lecture' })).errors.length).toBeGreaterThan(0);
  });
});

// ── the row ─────────────────────────────────────────────────────────────────

describe('the row that reaches the table', () => {
  test('carries the corpus fields through unchanged', () => {
    const row = toRow(seg(), { corpusVersion: 'v2' });
    expect(row).toMatchObject({
      segment_id: 'grade_9_chemistry.c01.p007-008',
      grade: 9,
      subject: 'Chemistry',
      chapter_key: 'c01',
      printed_page_start: 7,
      printed_page_end: 8,
      order_index: 1,
      corpus_version: 'v2',
      is_current: true,
      is_religious: false,
    });
  });

  test('a null yt is stored as null, not as an empty object', () => {
    // Serving reads `yt && yt.url`. An empty object would pass a truthiness
    // check and render an empty video line.
    expect(toRow(seg({ yt: null })).yt).toBeNull();
    expect(toRow(seg()).yt).toBeNull();
  });

  test('a filled yt is carried through whole', () => {
    const yt = { url: 'https://youtu.be/x', title: 'T', video_id: 'x' };
    expect(toRow(seg({ yt })).yt).toEqual(yt);
  });

  test('page numbers are taken verbatim — never recomputed from an offset', () => {
    // Three books in this corpus shift offset mid-book and one prints duplicate
    // page numbers. Recomputation is how a lesson opens the wrong pages.
    const row = toRow(seg({ printed_page_start: 140, printed_page_end: 144, pages_covered: [140, 141, 144] }));
    expect(row.printed_page_start).toBe(140);
    expect(row.pages_covered).toEqual([140, 141, 144]);
  });
});

// ── idempotency + reconcile ─────────────────────────────────────────────────

describe('re-running the importer', () => {
  test('a boundary that moved retires the segment it replaced', () => {
    // Ids are derived from the page range, so a re-segmented chapter produces
    // new ids. Leaving the old ones current would show a teacher two versions
    // of the same lesson.
    const plan = reconcilePlan({
      bookStem: 'grade_9_chemistry',
      incomingIds: ['grade_9_chemistry.c01.p007-009'],
      existingIds: ['grade_9_chemistry.c01.p007-008', 'grade_9_chemistry.c01.p010-011'],
    });
    expect(plan.retire.sort()).toEqual([
      'grade_9_chemistry.c01.p007-008',
      'grade_9_chemistry.c01.p010-011',
    ]);
  });

  test('an unchanged re-run retires nothing', () => {
    const ids = ['a', 'b', 'c'];
    expect(reconcilePlan({
      bookStem: 'x', incomingIds: ids, existingIds: ids,
    }).retire).toEqual([]);
  });

  test('a partial corpus does not retire the books it does not mention', () => {
    // Books finish over hours. Importing one must never touch another's rows.
    const plan = reconcilePlan({
      bookStem: 'grade_9_chemistry',
      incomingIds: ['grade_9_chemistry.c01.p007-008'],
      existingIds: ['grade_9_chemistry.c01.p007-008'],
    });
    expect(plan.retire).toEqual([]);
    expect(plan.bookStem).toBe('grade_9_chemistry');
  });
});
