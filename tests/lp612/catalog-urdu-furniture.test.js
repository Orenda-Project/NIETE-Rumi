/**
 * bd-t8mbl — an Urdu menu row should be in Urdu, furniture included.
 *
 * Caught by rendering the fixed chapter picker and looking at it: a grade 9
 * Urdu row read `۶ lessons`. The digit was Urdu, the noun was English, and in
 * a right-to-left row the English word lands FIRST, so the line reads
 * "lessons ۶". The K-5 lane solved this a month earlier and says
 * `${urD(n)} اسباق` (lp-v8-catalog.service.js buildChapterItems); the 6-12 lane
 * only ever localised the digits.
 *
 * The same gap runs through the subtopic row: `p7-8` where K-5 writes `ص ۷-۸`,
 * and an English "More lessons →" where K-5 has `مزید اسباق ←`.
 *
 * And one hazard that is not merely cosmetic. In Noto Nastaliq Urdu a middle
 * dot `·` adjacent to an Extended Arabic-Indic digit RENDERS AS A ZERO —
 * measured on the NIETE FICO card, where `7 اشارے · ۲۸` came out as
 * `۷ اشارے ۲۸۰`, turning 28 into 280. The subtopic row builds
 * `ص ۷-۸ · 🎬` and `<subtopic> · <kind>`, putting that separator directly
 * against a digit. Urdu rows use the Urdu comma `،` instead. The dot stays
 * where both sides are words.
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
const URDU_DIGITS = /[۰-۹]/;

const ur = (over = {}) => ({
  segment_id: 'grade_9_urdu.c02.p012-014',
  grade: 9,
  subject: 'Urdu',
  language: 'ur',
  chapter_number: 2,
  chapter_title: 'کتبہ (افسانہ) — غلام عباس',
  chapter_key: 'c02',
  part: null,
  subtopic_title: 'افسانے کا مرکزی خیال اور کردار نگاری',
  menu_title: 'مرکزی خیال',
  printed_page_start: 12,
  printed_page_end: 14,
  order_index: 1,
  lp_type: 'content',
  is_religious: false,
  ...over,
});

const en = (over = {}) => ({
  ...ur(), segment_id: 'grade_9_physics.c02.p007', grade: 9, subject: 'Physics', language: 'en',
  chapter_title: 'KINEMATICS', chapter_key: 'c02', subtopic_title: 'Distance and displacement',
  menu_title: 'Distance and displacement', printed_page_start: 7, printed_page_end: 8, ...over,
});

beforeEach(() => {
  mockDbCalls.length = 0;
  mockRows = [];
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

// ── chapter rows ────────────────────────────────────────────────────────────

describe('the chapter row counts lessons in Urdu', () => {
  test('an Urdu book says اسباق, not "lessons"', async () => {
    mockRows = [ur(), ur({ segment_id: 's2', order_index: 2 })];
    const mc = (await Catalog.buildChapterItems(9, 'Urdu')).items[0]['main-content'];
    expect(mc.description).toContain('اسباق');
    expect(mc.description).not.toContain('lessons');
  });

  test('the count itself is still an Urdu digit', async () => {
    mockRows = [ur(), ur({ segment_id: 's2', order_index: 2 })];
    const mc = (await Catalog.buildChapterItems(9, 'Urdu')).items[0]['main-content'];
    expect(mc.description).toContain('۲');
  });

  test('an English book is untouched', async () => {
    mockRows = [en()];
    const mc = (await Catalog.buildChapterItems(9, 'Physics')).items[0]['main-content'];
    expect(mc.description).toBe('1 lessons');
    expect(mc.description).not.toContain('اسباق');
  });
});

// ── subtopic rows ───────────────────────────────────────────────────────────

describe('the subtopic row gives its page range in Urdu', () => {
  test('an Urdu book says ص with Urdu digits, not "p12-14"', async () => {
    mockRows = [ur()];
    const { items } = await Catalog.buildSegmentItems(9, 'Urdu', 'c02');
    const mc = items[0]['main-content'];
    expect(mc.description).toContain('ص');
    expect(mc.description).not.toMatch(/p\d/);
    expect(mc.description).toContain('۱۲');
  });

  test('a single-page subtopic does not render a range', async () => {
    mockRows = [ur({ printed_page_start: 12, printed_page_end: 12 })];
    const { items } = await Catalog.buildSegmentItems(9, 'Urdu', 'c02');
    expect(items[0]['main-content'].description).not.toContain('-');
  });

  test('an English book still says p12-14', async () => {
    mockRows = [en()];
    const { items } = await Catalog.buildSegmentItems(9, 'Physics', 'c02');
    expect(items[0]['main-content'].description).toMatch(/p7-8/);
  });
});

// ── the separator that eats a digit ─────────────────────────────────────────

describe('no middle dot ever touches an Urdu digit', () => {
  // `·` beside an Extended Arabic-Indic digit renders as a ZERO in Nastaliq:
  // `ص ۷-۸ · 🎬` would read as page 80. Measured, not theorised.
  test('the video marker does not follow a page number with a dot', async () => {
    mockRows = [ur({ yt: { url: 'https://youtu.be/abc' } })];
    const { items } = await Catalog.buildSegmentItems(9, 'Urdu', 'c02');
    const d = items[0]['main-content'].description;
    expect(d).toContain('🎬');
    expect(d).not.toContain('·');
  });

  test('the lesson kind does not follow Urdu text with a dot', async () => {
    mockRows = [ur({ lp_type: 'end_of_chapter' })];
    const { items } = await Catalog.buildSegmentItems(9, 'Urdu', 'c02');
    const m = items[0]['main-content'].metadata || '';
    expect(m).not.toContain('·');
  });

  test('an English row keeps the dot — the hazard is Nastaliq-specific', async () => {
    mockRows = [en({ yt: { url: 'https://youtu.be/abc' } })];
    const { items } = await Catalog.buildSegmentItems(9, 'Physics', 'c02');
    expect(items[0]['main-content'].description).toContain('·');
  });

  test('no Urdu row anywhere in the menu pairs a dot with a digit', async () => {
    mockRows = [
      ur({ yt: { url: 'u' }, lp_type: 'end_of_chapter' }),
      ur({ segment_id: 's2', order_index: 2 }),
    ];
    const { items: chapters } = await Catalog.buildChapterItems(9, 'Urdu');
    const { items } = await Catalog.buildSegmentItems(9, 'Urdu', 'c02');
    for (const it of [...chapters, ...items]) {
      const mc = it['main-content'];
      for (const field of [mc.title, mc.description, mc.metadata]) {
        if (!field) continue;
        // the exact adjacency that renders as a zero, either side
        expect(field).not.toMatch(new RegExp(`[۰-۹]\\s*·|·\\s*[۰-۹]`));
      }
    }
  });
});

// ── the More row ────────────────────────────────────────────────────────────

describe('the overflow row speaks the book language', () => {
  const many = () => Array.from({ length: 25 }, (_, i) => ur({
    segment_id: `s${i}`, order_index: i + 1,
  }));

  test('an Urdu chapter overflows into مزید اسباق', async () => {
    mockRows = many();
    const { items, hasMore } = await Catalog.buildSegmentItems(9, 'Urdu', 'c02');
    expect(hasMore).toBe(true);
    const more = items[items.length - 1];
    expect(more.id).toBe('__more__');
    expect(more['main-content'].title).toContain('اسباق');
    expect(more['main-content'].title).not.toContain('More');
  });

  test('the More row still carries the whole path in its payload', async () => {
    mockRows = many();
    const { items } = await Catalog.buildSegmentItems(9, 'Urdu', 'c02');
    const p = items[items.length - 1]['on-click-action'].payload;
    expect(p).toMatchObject({
      step: 'lp612_segment_page', grade: '9', subject: 'Urdu', chapter_key: 'c02', page: '2',
    });
  });

  test('an English chapter still overflows into "More lessons"', async () => {
    mockRows = Array.from({ length: 25 }, (_, i) => en({ segment_id: `e${i}`, order_index: i + 1 }));
    const { items } = await Catalog.buildSegmentItems(9, 'Physics', 'c02');
    expect(items[items.length - 1]['main-content'].title).toContain('More');
  });
});

// ── caps still hold ─────────────────────────────────────────────────────────

describe('Urdu furniture does not push a row over its cap', () => {
  test('every field of every Urdu row is inside its cap, in code points', async () => {
    mockRows = [
      ur({ yt: { url: 'u' }, lp_type: 'end_of_chapter' }),
      ur({ segment_id: 's2', order_index: 2, printed_page_start: 128, printed_page_end: 134 }),
    ];
    const { items: chapters } = await Catalog.buildChapterItems(9, 'Urdu');
    const { items } = await Catalog.buildSegmentItems(9, 'Urdu', 'c02');
    for (const it of [...chapters, ...items]) {
      const mc = it['main-content'];
      expect(cps(mc.title)).toBeLessThanOrEqual(TITLE_CAP);
      expect(cps(mc.description || '')).toBeLessThanOrEqual(DESC_CAP);
      expect(cps(mc.metadata || '')).toBeLessThanOrEqual(META_CAP);
    }
  });

  test('an Urdu description leads with an Urdu character so the row renders RTL', async () => {
    mockRows = [ur()];
    const mc = (await Catalog.buildChapterItems(9, 'Urdu')).items[0]['main-content'];
    const first = [...mc.description][0];
    expect(first === '‏' || URDU_DIGITS.test(first) || /[؀-ۿ]/.test(first)).toBe(true);
  });
});
