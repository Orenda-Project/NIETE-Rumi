/**
 * bd-tnvpg — one row shape, every chapter, every book.
 *
 * The operator, on the menu that shipped from bd-3uiev:
 *
 *   "re: menu, it is inconsistent. Some chapters have their menu in the smaller
 *    subtitle field, some in the upper field. All of them need to have it in the
 *    consistent format so it fits chapter name and looks coherent too."
 *
 * bd-3uiev ported the K-5 rule — merge the name into the title when it fits,
 * move it to the metadata line when it does not. That rule loses no information
 * and it still produced a menu that reads as broken, because LENGTH IS A
 * PROPERTY OF THE DATA: a length-conditional layout makes the shape of a row
 * depend on which book the teacher opened. Grade 9 Physics rendered as two
 * lists stapled together — `Ch 2 — KINEMATICS` in bold next to a bare `Ch 5`
 * whose name sat in small grey text below.
 *
 * The fix is not a better threshold. It is removing the condition: number in the
 * title, count in the description, NAME ON THE METADATA LINE, always.
 *
 * Which field holds the name is settled by the caps, not by preference —
 * title is 30 code points, description is 20, and 277 of 761 chapter names in
 * this corpus are longer than 30. Metadata's 80 is the only field that can hold
 * a real chapter name, so that is where the name lives, including the short ones.
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

const cps = (s) => [...String(s == null ? '' : s)].length;
const strip = (s) => String(s || '').replace(/^‏/, '');

const seg = (over = {}) => ({
  segment_id: 'grade_9_physics.c01.p007-008',
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

/** The operator's own book: names of 35, 10, 34 and 29 code points. */
const PHYSICS = [
  seg({ chapter_number: 1, chapter_key: 'c01', chapter_title: 'PHYSICAL QUANTITIES AND MEASUREMENT' }),
  seg({ segment_id: 'a', chapter_number: 2, chapter_key: 'c02', chapter_title: 'KINEMATICS' }),
  seg({ segment_id: 'b', chapter_number: 5, chapter_key: 'c05', chapter_title: 'PRESSURE AND DEFORMATION IN SOLIDS' }),
  seg({ segment_id: 'c', chapter_number: 9, chapter_key: 'c09', chapter_title: 'NATURE OF SCIENCE AND PHYSICS' }),
];

beforeEach(() => {
  mockDbCalls.length = 0;
  mockRows = [];
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

// ── the invariant ───────────────────────────────────────────────────────────

describe('the chapter name is always on the same line', () => {
  test('a SHORT name is on the metadata line, exactly like a long one', async () => {
    // The row that used to be special: "KINEMATICS" fits in the title, so the
    // old builder put it there and emitted no metadata at all.
    mockRows = PHYSICS;
    const { items } = await Catalog.buildChapterItems(9, 'Physics');
    const ch2 = items.find((i) => i.id === 'c02')['main-content'];
    expect(strip(ch2.metadata)).toBe('KINEMATICS');
  });

  test('a LONG name is on the metadata line too', async () => {
    mockRows = PHYSICS;
    const { items } = await Catalog.buildChapterItems(9, 'Physics');
    const ch1 = items.find((i) => i.id === 'c01')['main-content'];
    expect(strip(ch1.metadata)).toBe('PHYSICAL QUANTITIES AND MEASUREMENT');
  });

  test('EVERY row in a mixed-length book carries a metadata line', async () => {
    mockRows = PHYSICS;
    const { items } = await Catalog.buildChapterItems(9, 'Physics');
    expect(items).toHaveLength(4);
    for (const i of items) expect(i['main-content'].metadata).toBeTruthy();
  });

  test('no row smuggles the name into the title as well', async () => {
    // The title is the number. If a name also appears there, the list has two
    // visual weights again and the row shapes diverge.
    mockRows = PHYSICS;
    for (const i of (await Catalog.buildChapterItems(9, 'Physics')).items) {
      const mc = i['main-content'];
      expect(strip(mc.title)).toMatch(/^Ch \d+$/);
    }
  });

  test('and no title is ever truncated, because a number always fits', async () => {
    mockRows = PHYSICS;
    for (const i of (await Catalog.buildChapterItems(9, 'Physics')).items) {
      expect(i['main-content'].title).not.toContain('…');
    }
  });
});

// ── the same, stated as a property over any book ────────────────────────────

describe('row shape does not vary with the data', () => {
  const books = {
    'all short names': [
      seg({ chapter_number: 1, chapter_key: 'c1', chapter_title: 'Waves' }),
      seg({ segment_id: 'x', chapter_number: 2, chapter_key: 'c2', chapter_title: 'Sound' }),
    ],
    'all long names': [
      seg({ chapter_number: 1, chapter_key: 'c1', chapter_title: 'Heat Capacity and Modes of Heat Transfer' }),
      seg({ segment_id: 'x', chapter_number: 2, chapter_key: 'c2', chapter_title: 'Thermal Expansion and Change of State' }),
    ],
    'mixed': PHYSICS,
    'urdu': [
      seg({
        grade: 9, subject: 'Urdu', language: 'ur', chapter_number: 2, chapter_key: 'c02',
        chapter_title: 'کتبہ (افسانہ) — غلام عباس',
      }),
      seg({
        segment_id: 'x', grade: 9, subject: 'Urdu', language: 'ur', chapter_number: 5, chapter_key: 'c05',
        chapter_title: 'کلیم اور مرزا ظاہر دار بیگ (ناول: توبتہ النصوح) — ڈپٹی نذیر احمد',
      }),
    ],
  };

  test.each(Object.keys(books))('%s — every row uses the identical set of fields', async (key) => {
    mockRows = books[key];
    const subject = key === 'urdu' ? 'Urdu' : 'Physics';
    const grade = 9;
    const { items } = await Catalog.buildChapterItems(grade, subject);
    expect(items.length).toBeGreaterThan(1);
    const shapes = items.map((i) => Object.keys(i['main-content']).sort().join(','));
    expect(new Set(shapes).size).toBe(1);
    expect(shapes[0]).toBe('description,metadata,title');
  });
});

// ── books that repeat a chapter number ──────────────────────────────────────

describe('a repeated chapter number is still tellable apart — on the name line', () => {
  // bd-3uiev disambiguated these by putting the name back in the TITLE, which
  // is the very inconsistency bd-tnvpg removes. Uniqueness moves to the line
  // that every row now has.
  const g11 = [
    seg({ grade: 11, subject: 'Urdu', language: 'ur', chapter_key: 'p1c01', chapter_number: 1,
      chapter_title: 'اخلاقِ حسنہ (سیرت نگاری) — شبلی نعمانی' }),
    seg({ segment_id: 's2', grade: 11, subject: 'Urdu', language: 'ur', chapter_key: 'p2c01', chapter_number: 1,
      chapter_title: 'حمد — حفیظ تائب' }),
    seg({ segment_id: 's3', grade: 11, subject: 'Urdu', language: 'ur', chapter_key: 'p3c01', chapter_number: 1,
      chapter_title: 'پیا باج نہ آوے چین (غزل) — میر تقی میر' }),
  ];

  test('the three rows carry three different names', async () => {
    mockRows = g11;
    const { items } = await Catalog.buildChapterItems(11, 'Urdu');
    const names = items.map((i) => strip(i['main-content'].metadata));
    expect(new Set(names).size).toBe(3);
  });

  test('each name is complete, not clipped to fit', async () => {
    mockRows = g11;
    const { items } = await Catalog.buildChapterItems(11, 'Urdu');
    for (const i of items) expect(i['main-content'].metadata).not.toContain('…');
  });

  test('a part-split book still labels the part in the title', async () => {
    mockRows = [
      seg({ grade: 12, subject: 'Urdu', language: 'ur', chapter_key: 'nasr-c03', chapter_number: 3,
        part: 'حصہ نثر (Prose)', chapter_title: 'ماں جی' }),
      seg({ segment_id: 's2', grade: 12, subject: 'Urdu', language: 'ur', chapter_key: 'nazm-c03',
        chapter_number: 3, part: 'حصہ نظم (Poetry)', chapter_title: 'ستاروں سے آگے' }),
    ];
    const { items } = await Catalog.buildChapterItems(12, 'Urdu');
    const titles = items.map((i) => i['main-content'].title).join('\n');
    expect(titles).toContain('نثر');
    expect(titles).toContain('نظم');
  });
});

// ── caps ────────────────────────────────────────────────────────────────────

describe('one shape, still inside every cap', () => {
  test('a 89-code-point Urdu name is clipped at the metadata cap, not moved', async () => {
    const LONG = 'پیام لطیف (نظم؛ سندھی زبان کی شاعری، تعارف و انتخاب پروفیسر امجد اقبال) — مترجم: شیخ ایاز';
    mockRows = [seg({
      grade: 9, subject: 'Urdu', language: 'ur', chapter_key: 'c15', chapter_number: 15,
      chapter_title: LONG,
    })];
    const mc = (await Catalog.buildChapterItems(9, 'Urdu')).items[0]['main-content'];
    expect(cps(mc.metadata)).toBeLessThanOrEqual(META_CAP);
    expect(mc.title).toBe('‏باب ۱۵');       // the title is unaffected by name length
  });

  test('every field of every row is inside its cap in code points', async () => {
    mockRows = [...PHYSICS, ...[
      seg({ segment_id: 'z', grade: 9, subject: 'Urdu', language: 'ur', chapter_key: 'c15',
        chapter_number: 15, chapter_title: 'پیام لطیف (نظم؛ سندھی زبان کی شاعری) — شیخ ایاز' }),
    ]];
    for (const subject of ['Physics', 'Urdu']) {
      for (const i of (await Catalog.buildChapterItems(9, subject)).items) {
        const mc = i['main-content'];
        expect(cps(mc.title)).toBeLessThanOrEqual(TITLE_CAP);
        expect(cps(mc.description)).toBeLessThanOrEqual(DESC_CAP);
        expect(cps(mc.metadata)).toBeLessThanOrEqual(META_CAP);
      }
    }
  });
});

// ── the subtopic list, audited for the same failure mode ────────────────────

describe('subtopic rows keep their own single shape', () => {
  test('the lesson name is always the title, never relocated by length', async () => {
    mockRows = [
      seg({ menu_title: 'Short', subtopic_title: 'Short' }),
      seg({ segment_id: 'q2', order_index: 2, menu_title: 'A considerably longer subtopic label here',
        subtopic_title: 'A considerably longer subtopic label here' }),
    ];
    const { items } = await Catalog.buildSegmentItems(9, 'Physics', 'c01');
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it['main-content'].title).toBeTruthy();
      expect(cps(it['main-content'].title)).toBeLessThanOrEqual(TITLE_CAP);
    }
  });
});
