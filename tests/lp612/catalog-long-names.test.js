/**
 * bd-3uiev — long chapter and subtopic names must not lose information.
 *
 * The operator's device test on the grade 9 Physics book showed three of nine
 * chapter rows ending in an ellipsis:
 *
 *     1. PHYSICAL QUANTITIES AND ME…
 *     5. PRESSURE AND DEFORMATION I…
 *     9. NATURE OF SCIENCE AND PHYS…
 *
 * The name was not merely shortened, it was GONE: the 6-12 chapter builder put
 * everything on the 30-code-point title line and emitted no metadata line at
 * all, so whatever did not fit was dropped on the floor. Measured against the
 * real staging corpus that was 277 of 761 chapters — 36% — and 16 of the 19
 * chapters in grade 9 Urdu, one of them showing 28 code points of an 89-point
 * title.
 *
 * The K-5 lane solved this a month earlier (lp-v8-catalog.service.js
 * buildChapterItems): the chapter NUMBER leads the title, the name merges in
 * only when the whole thing fits, and a name that does not fit moves IN FULL to
 * the 80-code-point metadata line. Nothing is lost, only reseated. These tests
 * pin that behaviour onto the 6-12 lane.
 *
 * One thing the 6-12 lane needs that K-5 did not. Urdu books are split into
 * parts (حصہ نثر / حصہ نظم / حصہ غزل) and RESTART their chapter numbering in
 * each part, which is the whole reason `chapter_key` is part-prefixed. Reseat
 * the title down to a bare number and three different chapters in grade 12 Urdu
 * all render as `باب ۳` — a collision the K-5 corpus could never produce and
 * that a naive port would have introduced. The part rides in the number token.
 */

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
const { TITLE_CAP, DESC_CAP, META_CAP } = require('../../bot/shared/services/lp-v8-catalog.service');

/** The one measure Meta applies. `.length` is a different number on Urdu. */
const cps = (s) => [...String(s == null ? '' : s)].length;

const seg = (over = {}) => ({
  segment_id: 'grade_9_physics.c01.p007-008',
  book_stem: 'grade_9_physics',
  grade: 9,
  subject: 'Physics',
  language: 'en',
  chapter_number: 1,
  chapter_title: 'PHYSICAL QUANTITIES AND MEASUREMENT',
  chapter_key: 'c01',
  part: null,
  subtopic_title: 'Definition of physical quantities',
  menu_title: 'Physical quantities',
  printed_page_start: 7,
  printed_page_end: 8,
  order_index: 1,
  lp_type: 'content',
  is_religious: false,
  ...over,
});

beforeEach(() => {
  mockDbCalls.length = 0;
  mockRows = [];
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

const only = (items) => { expect(items).toHaveLength(1); return items[0]['main-content']; };

// ── 1. the operator's three rows ────────────────────────────────────────────

describe("the operator's grade 9 Physics rows keep their whole name", () => {
  // These are the exact chapter titles from the staging corpus, at the exact
  // lengths that broke: 35, 34 and 29 code points against a 30-point title.
  const REPORTED = [
    [1, 'PHYSICAL QUANTITIES AND MEASUREMENT'],
    [5, 'PRESSURE AND DEFORMATION IN SOLIDS'],
    [9, 'NATURE OF SCIENCE AND PHYSICS'],
  ];

  test.each(REPORTED)('chapter %i keeps "%s" somewhere on the row, in full', async (number, title) => {
    mockRows = [seg({ chapter_number: number, chapter_title: title, chapter_key: `c0${number}` })];
    const mc = only((await Catalog.buildChapterItems(9, 'Physics')).items);

    const row = [mc.title, mc.description, mc.metadata].filter(Boolean).join(' | ');
    expect(row).toContain(title);          // the name survives, uncut
    expect(row).not.toContain('…');        // and nothing on the row was clipped
  });

  test('the chapter number is still what leads the title', async () => {
    mockRows = [seg()];
    const mc = only((await Catalog.buildChapterItems(9, 'Physics')).items);
    expect(mc.title).toMatch(/\b1\b/);
  });
});

// ── 2. merge when it fits, reseat when it does not ──────────────────────────

describe('a short name stays on the title line', () => {
  // SUPERSEDED BY bd-tnvpg. This used to assert the opposite: that a short name
  // merges into the title and emits no metadata line. That is exactly the
  // length-conditional layout the operator called broken — "some chapters have
  // their menu in the smaller subtitle field, some in the upper field" — so the
  // short name now goes where every other name goes. The assertion is kept,
  // inverted, so nothing quietly reintroduces the special case.
  test('"KINEMATICS" is short enough to merge, and deliberately does NOT', async () => {
    mockRows = [seg({ chapter_number: 2, chapter_key: 'c02', chapter_title: 'KINEMATICS' })];
    const mc = only((await Catalog.buildChapterItems(9, 'Physics')).items);

    expect(mc.title).toBe('Ch 2');
    expect(mc.metadata).toBe('KINEMATICS');
    expect(cps(mc.title)).toBeLessThanOrEqual(TITLE_CAP);
  });
});

describe('a long name is reseated, not truncated', () => {
  test('the title falls back to the number and the full name moves to metadata', async () => {
    mockRows = [seg()];
    const mc = only((await Catalog.buildChapterItems(9, 'Physics')).items);

    expect(mc.metadata).toBe('PHYSICAL QUANTITIES AND MEASUREMENT');
    // The title carries the number only — a half-word plus the same words again
    // one line below is the echo this design exists to avoid.
    expect(mc.title).not.toContain('…');
    expect(mc.title).not.toContain('PHYSICAL');
  });

  test('the lesson count keeps its own line either way', async () => {
    mockRows = [seg(), seg({ segment_id: 'x2', order_index: 2 })];
    const mc = only((await Catalog.buildChapterItems(9, 'Physics')).items);
    expect(mc.description).toContain('2');
  });
});

// ── 3. Urdu ─────────────────────────────────────────────────────────────────

describe('Urdu rows reseat in Urdu', () => {
  const UR_TITLE = 'کلیم اور مرزا ظاہر دار بیگ (ناول: توبتہ النصوح) — ڈپٹی نذیر احمد';

  test('a 64-code-point Urdu chapter name arrives whole on the metadata line', async () => {
    mockRows = [seg({
      grade: 9, subject: 'Urdu', language: 'ur',
      chapter_number: 5, chapter_key: 'c05', chapter_title: UR_TITLE,
    })];
    const mc = only((await Catalog.buildChapterItems(9, 'Urdu')).items);
    expect(mc.metadata).toContain(UR_TITLE);
  });

  test('the title still leads with a right-to-left mark and an Urdu digit', async () => {
    mockRows = [seg({
      grade: 9, subject: 'Urdu', language: 'ur',
      chapter_number: 5, chapter_key: 'c05', chapter_title: UR_TITLE,
    })];
    const mc = only((await Catalog.buildChapterItems(9, 'Urdu')).items);
    expect(mc.title.startsWith('‏')).toBe(true);
    expect(mc.title).toContain('۵');
    expect(mc.title).not.toContain('5');
  });

  test('the metadata line is right-to-left too, or it renders left-aligned', async () => {
    mockRows = [seg({
      grade: 9, subject: 'Urdu', language: 'ur',
      chapter_number: 5, chapter_key: 'c05', chapter_title: UR_TITLE,
    })];
    const mc = only((await Catalog.buildChapterItems(9, 'Urdu')).items);
    expect(mc.metadata.startsWith('‏')).toBe(true);
  });
});

// ── 4. the collision a naive K-5 port would have introduced ─────────────────

describe('parts keep reseated titles distinct', () => {
  // Grade 12 Urdu restarts numbering in each part. Three chapter 3s.
  const rows = () => [
    seg({
      grade: 12, subject: 'Urdu', language: 'ur', chapter_key: 'nasr-c03',
      chapter_number: 3, part: 'حصہ نثر (Prose)', chapter_title: 'ماں جی اور گھر کی یادیں',
    }),
    seg({
      segment_id: 's2', grade: 12, subject: 'Urdu', language: 'ur', chapter_key: 'nazm-c03',
      chapter_number: 3, part: 'حصہ نظم (Poetry)', chapter_title: 'ستاروں سے آگے جہاں اور بھی ہیں',
    }),
    seg({
      segment_id: 's3', grade: 12, subject: 'Urdu', language: 'ur', chapter_key: 'ghazal-c03',
      chapter_number: 3, part: 'حصہ غزل (Ghazal)', chapter_title: 'نقش فریادی ہے کس کی شوخی تحریر کا',
    }),
  ];

  test('three chapter 3s in one book do not render as three identical titles', async () => {
    mockRows = rows();
    const { items } = await Catalog.buildChapterItems(12, 'Urdu');
    expect(items).toHaveLength(3);
    const titles = items.map((i) => i['main-content'].title);
    expect(new Set(titles).size).toBe(3);
  });

  test('each title names its part, so the teacher can tell them apart', async () => {
    mockRows = rows();
    const { items } = await Catalog.buildChapterItems(12, 'Urdu');
    const titles = items.map((i) => i['main-content'].title).join('\n');
    expect(titles).toContain('نثر');
    expect(titles).toContain('نظم');
    expect(titles).toContain('غزل');
  });

  test('the part is not repeated on the metadata line it already led the title with', async () => {
    mockRows = rows();
    const { items } = await Catalog.buildChapterItems(12, 'Urdu');
    for (const i of items) {
      const mc = i['main-content'];
      if (mc.metadata) expect(mc.metadata).not.toContain('حصہ');
    }
  });
});

// ── 4b. the same collision, in the two shapes the `part` column does NOT catch ──
//
// Found by rendering the whole staging corpus through this builder rather than
// by reasoning about it: the fix above cleared grade 12 Urdu and left seven
// duplicate titles standing, because two other books encode the same idea
// differently. A number-only title is only usable when the number identifies
// the chapter, and in this corpus that is a property of the data, not a given.

// REVISED BY bd-tnvpg. These two books still matter, but what they must prove
// changed. Uniqueness used to come from putting the name back in the TITLE,
// which is the length-conditional layout the operator rejected. Every row now
// renders its name on the metadata line, so two chapter 1s DO share a title —
// and are told apart on the line every row has, rather than on whichever field
// that particular row happened to use.

describe('a repeated chapter number is still tellable apart, on the name line', () => {
  test('grade 11 Urdu keeps its parts in the chapter_key, not the part column', async () => {
    // p1c01 / p2c01 / p3c01 — three chapter 1s, `part` NULL on all three.
    mockRows = [
      seg({ grade: 11, subject: 'Urdu', language: 'ur', chapter_key: 'p1c01', chapter_number: 1,
        part: null, chapter_title: 'اخلاقِ حسنہ (سیرت نگاری) — شبلی نعمانی' }),
      seg({ segment_id: 's2', grade: 11, subject: 'Urdu', language: 'ur', chapter_key: 'p2c01', chapter_number: 1,
        part: null, chapter_title: 'حمد — حفیظ تائب' }),
      seg({ segment_id: 's3', grade: 11, subject: 'Urdu', language: 'ur', chapter_key: 'p3c01', chapter_number: 1,
        part: null, chapter_title: 'پیا باج نہ آوے چین (غزل) — میر تقی میر' }),
    ];
    const { items } = await Catalog.buildChapterItems(11, 'Urdu');
    expect(items).toHaveLength(3);
    // Same title by design — the number is the title now.
    expect(new Set(items.map((i) => i['main-content'].title)).size).toBe(1);
    // Distinguished, in full, on the line all three share.
    const names = items.map((i) => i['main-content'].metadata);
    expect(new Set(names).size).toBe(3);
    for (const n of names) expect(n).not.toContain('\u2026');
  });

  test('grade 6 English splits chapter 1 into c01a and c01b', async () => {
    mockRows = [
      seg({ grade: 6, subject: 'English', chapter_key: 'c01a', chapter_number: 1, part: null,
        chapter_title: 'Hazrat Muhammad صلى الله عليه وسلم (biography)' }),
      seg({ segment_id: 's2', grade: 6, subject: 'English', chapter_key: 'c01b', chapter_number: 1, part: null,
        chapter_title: 'Dedicated to Humanity (Abdul Sattar Edhi / Mother Teresa / Helen Keller)' }),
    ];
    const { items } = await Catalog.buildChapterItems(6, 'English');
    expect(items).toHaveLength(2);
    // Both are "Ch 1"; the biography and the Edhi chapter are told apart by the
    // names, which every row now renders (bd-tnvpg).
    expect(new Set(items.map((i) => i['main-content'].title)).size).toBe(1);
    expect(new Set(items.map((i) => i['main-content'].metadata)).size).toBe(2);
  });

  test('a collided row still carries its full name on the metadata line', async () => {
    const LONG = 'پیا باج نہ آوے چین (غزل) — میر تقی میر';
    mockRows = [
      seg({ grade: 11, subject: 'Urdu', language: 'ur', chapter_key: 'p1c01', chapter_number: 1,
        part: null, chapter_title: 'اخلاقِ حسنہ (سیرت نگاری) — شبلی نعمانی' }),
      seg({ segment_id: 's2', grade: 11, subject: 'Urdu', language: 'ur', chapter_key: 'p3c01', chapter_number: 1,
        part: null, chapter_title: LONG }),
    ];
    const { items } = await Catalog.buildChapterItems(11, 'Urdu');
    const row = items.find((i) => i.id === 'p3c01')['main-content'];
    expect(row.metadata).toContain(LONG);
  });

  test('a number that DOES identify one chapter still gets the clean number-only title', async () => {
    mockRows = [
      seg({ chapter_number: 1, chapter_key: 'c01' }),
      seg({ segment_id: 's2', chapter_number: 2, chapter_key: 'c02', chapter_title: 'KINEMATICS' }),
    ];
    const { items } = await Catalog.buildChapterItems(9, 'Physics');
    const ch1 = items.find((i) => i.id === 'c01')['main-content'];
    expect(ch1.title).toBe('Ch 1');
    expect(ch1.metadata).toBe('PHYSICAL QUANTITIES AND MEASUREMENT');
  });
});

// ── 5. the caps themselves ──────────────────────────────────────────────────

describe('every field stays inside its cap, measured in code points', () => {
  test('chapter rows across a mixed book', async () => {
    mockRows = [
      seg(),
      seg({ segment_id: 'a', chapter_number: 2, chapter_key: 'c02', chapter_title: 'KINEMATICS' }),
      seg({
        segment_id: 'b', grade: 9, subject: 'Urdu', language: 'ur', chapter_key: 'c15',
        chapter_number: 15,
        chapter_title: 'پیام لطیف (نظم؛ سندھی زبان کی شاعری، تعارف و انتخاب پروفیسر امجد اقبال) — مترجم: شیخ ایاز',
      }),
    ];
    for (const subject of ['Physics', 'Urdu']) {
      const { items } = await Catalog.buildChapterItems(9, subject);
      for (const i of items) {
        const mc = i['main-content'];
        expect(cps(mc.title)).toBeLessThanOrEqual(TITLE_CAP);
        expect(cps(mc.description || '')).toBeLessThanOrEqual(DESC_CAP);
        expect(cps(mc.metadata || '')).toBeLessThanOrEqual(META_CAP);
      }
    }
  });
});

// ── 6. the subtopic step, audited alongside ────────────────────────────────

describe('subtopic rows do not echo themselves', () => {
  test('metadata is dropped when it would just repeat the title', async () => {
    // 278 rows in the staging corpus have menu_title === subtopic_title.
    mockRows = [seg({ menu_title: 'Branches of chemistry', subtopic_title: 'Branches of chemistry' })];
    const { items } = await Catalog.buildSegmentItems(9, 'Physics', 'c01');
    expect(items[0]['main-content'].metadata).toBeFalsy();
  });

  test('a genuinely different subtopic still gets its line', async () => {
    mockRows = [seg({ menu_title: 'Physical quantities', subtopic_title: 'Definition of physical quantities' })];
    const { items } = await Catalog.buildSegmentItems(9, 'Physics', 'c01');
    expect(items[0]['main-content'].metadata).toContain('Definition of physical quantities');
  });

  test('the lesson KIND survives a long subtopic instead of being the bit that is cut', async () => {
    // 103 corpus rows overflow the metadata line; today the lp_type marker is
    // appended last and so is always the first thing lost.
    mockRows = [seg({
      lp_type: 'end_of_chapter',
      menu_title: 'Chapter review',
      subtopic_title: 'End-of-chapter exercise: MCQs, constructed response, short answer, '
        + 'long answer and numerical problems drawn from the whole chapter',
    })];
    const { items } = await Catalog.buildSegmentItems(9, 'Physics', 'c01');
    const mc = items[0]['main-content'];
    expect(cps(mc.metadata)).toBeLessThanOrEqual(META_CAP);
    expect(mc.metadata).toContain('end of chapter');
  });
});
