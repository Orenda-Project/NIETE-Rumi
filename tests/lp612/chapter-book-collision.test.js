/**
 * bd-oak77.5 — the lp612 menu merges chapters that belong to DIFFERENT books.
 *
 * `chapter_key` ('c01', 'p3c01') is unique within a BOOK, not within a
 * (grade, subject). Three sites in lp612-catalog.service.js key on it alone, so
 * wherever two books share a (grade, subject) their chapters collapse into one
 * menu row: the first row encountered supplies the title and number, and the
 * lesson count becomes the SUM of both books.
 *
 * Measured on prod and staging (identical, so pre-existing):
 *   49 colliding (grade, subject, chapter_key) groups, 573 menu rows underneath.
 *
 * Two distinct shapes, and a fix that handles one leaves the other:
 *   - SAME LANGUAGE, DIFFERENT BOOK — `grade_9_10_chemistry_experiment` is one
 *     practicals book listed into both years via `also_grades`, landing on the
 *     same subject name as the main Chemistry textbook (19 collisions on G9,
 *     13 on G10).
 *   - SAME CONTENT, DIFFERENT LANGUAGE EDITION — Pakistan Studies ships as
 *     `_english` and `_urdu` under one subject name (6 on G10, 11 on G12).
 *
 * The fixture is 566 VERBATIM rows pulled from the live staging corpus
 * (`03_menu_fix/make_fixture.py`, read-only), not an invented collision, so a
 * corpus change that re-shapes the bug re-shapes this test.
 */

const FIXTURE = require('./__fixtures__/lp612-colliding-books.json');

// ── a Supabase fake that actually FILTERS ────────────────────────────────────
//
// It applies `.eq()` and PostgREST's `.or()` for real. A fake that ignores its
// filters would let every assertion below pass against broken code — the whole
// bug is a missing filter, so a permissive fake tests nothing (staging record
// §4.1).
let ROWS = [];
function mockChain() {
  const eqs = [];
  let ors = null;
  let order = null;
  let lim = null;

  const rows = () => {
    let out = ROWS.filter((r) => eqs.every(([c, v]) => r[c] === v));
    if (ors) {
      // only the shape this module emits: `grade.eq.N,also_grades.cs.{N}`
      const m = /^grade\.eq\.(\d+),also_grades\.cs\.\{(\d+)\}$/.exec(ors);
      if (!m) throw new Error(`fake: unsupported or() ${ors}`);
      const g = Number(m[1]);
      out = out.filter((r) => Number(r.grade) === g
        || (r.also_grades || []).map(Number).includes(g));
    }
    if (order) {
      const { col, asc } = order;
      out = [...out].sort((a, b) => ((a[col] > b[col]) ? 1 : (a[col] < b[col]) ? -1 : 0) * (asc ? 1 : -1));
    }
    if (lim != null) out = out.slice(0, lim);
    return out;
  };

  const api = {
    select: () => api,
    eq: (c, v) => { eqs.push([c, v]); return api; },
    or: (s) => { ors = s; return api; },
    order: (c, o) => { order = { col: c, asc: !o || o.ascending !== false }; return api; },
    limit: (n) => { lim = n; return api; },
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return api;
}

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => mockChain() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Catalog = require('../../bot/shared/services/lp612-catalog.service');

const cps = (s) => [...String(s == null ? '' : s)].length;
const TITLE_CAP = 30;
const DESC_CAP = 20;
const META_CAP = 80;

/** Every chapter row across every page, so pagination cannot hide a chapter. */
async function allChapters(grade, subject) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const { items, hasMore } = await Catalog.buildChapterItems(grade, subject, page);
    out.push(...items.filter((i) => i.id !== '__more__'));
    if (!hasMore) break;
  }
  return out;
}

/** What the fixture itself says the answer is — computed independently of the
 *  code under test, from the raw rows. */
function truth(grade, subject) {
  const visible = FIXTURE.filter((r) => r.subject === subject
    && (Number(r.grade) === grade || (r.also_grades || []).map(Number).includes(grade)));
  const byPair = new Map();
  for (const r of visible) {
    const k = `${r.book_stem}::${r.chapter_key}`;
    const e = byPair.get(k) || { book: r.book_stem, key: r.chapter_key,
      number: r.chapter_number, title: r.chapter_title, lessons: 0 };
    e.lessons += 1;
    byPair.set(k, e);
  }
  return byPair;
}

beforeEach(() => { ROWS = FIXTURE; });

describe('bd-oak77.5 — a chapter row belongs to exactly one book', () => {
  const CASES = [
    [9, 'Chemistry', ['grade_9_chemistry', 'grade_9_10_chemistry_experiment'], 42],
    [10, 'Chemistry', ['grade_10_chemistry', 'grade_9_10_chemistry_experiment'], 36],
    [10, 'Pakistan Studies', ['grade_10_pak_studies_english', 'grade_10_pak_studies_urdu'], 12],
    [12, 'Pakistan Studies', ['grade_12_pak_studies_english', 'grade_12_pak_studies_urdu'], 23],
  ];

  test.each(CASES)('G%i %s shows every book\'s chapters, %j -> %i rows',
    async (grade, subject, books, expected) => {
      const rows = await allChapters(grade, subject);
      // THE BUG: today this is 23 / 23 / 6 / 12 — one row per chapter_key, not
      // one per (book, chapter).
      expect(rows).toHaveLength(expected);
      expect(new Set(rows.map((r) => r.id)).size).toBe(expected); // ids unique on a screen
      const t = truth(grade, subject);
      expect(t.size).toBe(expected);
      // every row names its book in its own payload, or the next screen cannot
      // know which book was tapped (Meta does not ride screen data along).
      for (const r of rows) {
        expect(books).toContain(r['on-click-action'].payload.book_stem);
      }
      for (const b of books) {
        expect(rows.some((r) => r['on-click-action'].payload.book_stem === b)).toBe(true);
      }
    });

  test.each(CASES)('G%i %s — every row carries its OWN book\'s lesson count and title',
    async (grade, subject) => {
      const rows = await allChapters(grade, subject);
      const t = truth(grade, subject);
      for (const r of rows) {
        const p = r['on-click-action'].payload;
        const e = t.get(`${p.book_stem}::${p.chapter_key}`);
        expect(e).toBeDefined();
        // the count is THIS book's, never the sum of both
        const n = [...String(r['main-content'].description)].filter((c) => /[0-9۰-۹]/.test(c))
          .map((c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : c).join('');
        expect(Number(n)).toBe(e.lessons);
        // the name is THIS book's chapter title
        expect(r['main-content'].metadata).toContain(e.title.slice(0, 20));
      }
    });

  test('G9 Chemistry ch.1 — the textbook and the practical are two different rows', async () => {
    const rows = await allChapters(9, 'Chemistry');
    const byBook = (b) => rows.filter((r) => r['on-click-action'].payload.book_stem === b
      && r['on-click-action'].payload.chapter_key === 'c01')[0];

    const text = byBook('grade_9_chemistry');
    const prac = byBook('grade_9_10_chemistry_experiment');
    expect(text).toBeDefined();
    expect(prac).toBeDefined();
    // today ONE row survives, carrying the practical's title and 5+2 lessons pooled
    expect(text['main-content'].metadata).toContain('Nature of Chemistry');
    expect(prac['main-content'].metadata).toContain('Separating the mixture');
    expect(text['main-content'].description).not.toBe(prac['main-content'].description);
  });

  test('G10 Pakistan Studies — the English and Urdu editions are both reachable', async () => {
    const rows = await allChapters(10, 'Pakistan Studies');
    const en = rows.filter((r) => r['on-click-action'].payload.book_stem === 'grade_10_pak_studies_english');
    const ur = rows.filter((r) => r['on-click-action'].payload.book_stem === 'grade_10_pak_studies_urdu');
    expect(en).toHaveLength(6);
    expect(ur).toHaveLength(6);
    // the Urdu edition keeps Urdu row furniture — `باب` and Urdu digits, not `Ch 1`
    expect(ur.every((r) => /باب/.test(r['main-content'].title))).toBe(true);
    expect(en.every((r) => /^(?!.*باب).*Ch /.test(r['main-content'].title))).toBe(true);
  });
});

describe('bd-oak77.5 — tapping a chapter lists only THAT book\'s lessons', () => {
  test('G9 Chemistry c01 of the textbook returns 5 lessons, not the pooled 7', async () => {
    const t = truth(9, 'Chemistry');
    const want = t.get('grade_9_chemistry::c01').lessons;
    const { total } = await Catalog.buildSegmentItems(
      9, 'Chemistry', 'c01', 1, 'grade_9_chemistry');
    expect(total).toBe(want);
  });

  test('G9 Chemistry c01 of the practicals book returns only its own lessons', async () => {
    const t = truth(9, 'Chemistry');
    const want = t.get('grade_9_10_chemistry_experiment::c01').lessons;
    const { total } = await Catalog.buildSegmentItems(
      9, 'Chemistry', 'c01', 1, 'grade_9_10_chemistry_experiment');
    expect(total).toBe(want);
  });

  test('G10 Pakistan Studies c01 — Urdu edition returns Urdu rows only', async () => {
    const { items } = await Catalog.buildSegmentItems(
      10, 'Pakistan Studies', 'c01', 1, 'grade_10_pak_studies_urdu');
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      if (i.id === '__more__') continue;
      expect(i['on-click-action'].payload.segment_id).toMatch(/^grade_10_pak_studies_urdu\./);
    }
  });

  test('a chapter row built by TODAY\'s code still works — no book_stem means no book filter', async () => {
    // A teacher's scrollback outlives a deploy. An old row carries no
    // book_stem; it must degrade to today's pooled list, not throw.
    const { total } = await Catalog.buildSegmentItems(9, 'Chemistry', 'c01', 1);
    const t = truth(9, 'Chemistry');
    expect(total).toBe(t.get('grade_9_chemistry::c01').lessons
      + t.get('grade_9_10_chemistry_experiment::c01').lessons);
  });

  test('the "More lessons →" row carries the book forward', async () => {
    // grade_10_pak_studies_english c01 has enough lessons to paginate
    const { items, hasMore } = await Catalog.buildSegmentItems(
      10, 'Pakistan Studies', 'c01', 1, 'grade_10_pak_studies_english');
    if (!hasMore) return;                     // corpus-dependent; assert only when it paginates
    const more = items.find((i) => i.id === '__more__');
    expect(more['on-click-action'].payload.book_stem).toBe('grade_10_pak_studies_english');
  });
});

describe('bd-oak77.5 — the subject screen counts (book, chapter) pairs', () => {
  test('G9 Chemistry advertises 42 chapters, not 23', async () => {
    const items = await Catalog.buildSubjectItems(9);
    const chem = items.find((i) => i.id === 'Chemistry');
    expect(chem).toBeDefined();
    expect(chem['main-content'].description).toContain('42');
  });

  test('G12 Pakistan Studies advertises 23 chapters, not 12', async () => {
    const items = await Catalog.buildSubjectItems(12);
    const ps = items.find((i) => i.id === 'Pakistan Studies');
    expect(ps['main-content'].description).toContain('23');
  });

  // The same "two books under one subject" root cause, one screen up. The row's
  // RTL furniture is switched on if ANY row is Urdu, so a subject that ships an
  // English AND an Urdu edition renders an Urdu digit beside the English word
  // "chapters" — `۲۳ chapters`. On a Nastaliq handset the English word lands
  // first, so it reads "chapters ۲۳" (bd-t8mbl, the hazard this module already
  // documents for the chapter and segment rows).
  //
  // Exactly 2 of the 53 (grade, subject) pairs are mixed (both Pakistan Studies);
  // 10 are fully Urdu and MUST keep their Urdu furniture.
  test('a MIXED-edition subject uses English furniture — the subject name is English', async () => {
    for (const g of [10, 12]) {
      const ps = (await Catalog.buildSubjectItems(g)).find((i) => i.id === 'Pakistan Studies');
      expect(ps['main-content'].description).toMatch(/^\d+ chapters$/);
      expect(ps['main-content'].metadata).toMatch(/^Grade \d+ · \d+ lessons$/);
    }
  });

  test('a fully-Urdu subject KEEPS its Urdu furniture (G9 Pakistan Studies, one Urdu book)', async () => {
    const ps = (await Catalog.buildSubjectItems(9)).find((i) => i.id === 'Pakistan Studies');
    expect(ps).toBeDefined();
    expect(ps['main-content'].description).toMatch(/[۰-۹]/);
  });
});

describe('bd-oak77.5 — the book tag, and the caps it must live inside', () => {
  test('a subject with ONE book carries no tag at all', async () => {
    // G9 Physics is a single-book subject in the corpus; use any single-book pair
    const single = FIXTURE.filter((r) => r.subject === 'Pakistan Studies'
      && Number(r.grade) === 10 && r.book_stem === 'grade_10_pak_studies_english');
    ROWS = single;                                  // now a one-book (10, Pakistan Studies)
    const rows = await allChapters(10, 'Pakistan Studies');
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r['main-content'].title).toMatch(/^Ch \d+$/);   // no tag, no separator
    }
  });

  // A CONTROL that must pass before and after: an Urdu single-book subject keeps
  // its Urdu row furniture and gains no tag, so the tag logic cannot be the thing
  // that changed an RTL row.
  test('a single-book URDU subject gets Urdu furniture and still NO tag', async () => {
    const rows = await allChapters(9, 'Pakistan Studies');   // grade_9_pak_studies_urdu, alone
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r['main-content'].title.replace(/^\u200f/, '')).toMatch(/^\u0628\u0627\u0628 [\u06f0-\u06f9]+$/);
    }
  });

  test('a multi-book subject tags EVERY row on the screen, never only the intruder', async () => {
    const rows = await allChapters(9, 'Chemistry');
    for (const r of rows) {
      expect(r['main-content'].title).toMatch(/ · Ch \d+$/);
    }
    const tags = new Set(rows.map((r) => r['main-content'].title.split(' · ')[0]));
    expect(tags).toEqual(new Set(['Chemistry', 'Experiment']));
  });

  test('the language editions are tagged by LANGUAGE, in each language\'s own script', async () => {
    const rows = await allChapters(10, 'Pakistan Studies');
    const tag = (r) => r['main-content'].title.replace(/^‏/, '').split(' · ')[0];
    const en = rows.filter((r) => r['on-click-action'].payload.book_stem.endsWith('_english'));
    const ur = rows.filter((r) => r['on-click-action'].payload.book_stem.endsWith('_urdu'));
    expect(new Set(en.map(tag))).toEqual(new Set(['English']));
    expect(new Set(ur.map(tag))).toEqual(new Set(['اردو']));
  });

  test('books are ordered by size — the textbook before the practicals book', async () => {
    const rows = await allChapters(9, 'Chemistry');
    const firstPrac = rows.findIndex((r) => r['on-click-action'].payload.book_stem === 'grade_9_10_chemistry_experiment');
    const lastText = rows.map((r) => r['on-click-action'].payload.book_stem)
      .lastIndexOf('grade_9_chemistry');
    expect(lastText).toBeLessThan(firstPrac);          // no interleaving
    expect(rows[0]['on-click-action'].payload.book_stem).toBe('grade_9_chemistry');
  });

  // Splitting the pooled rows apart produces rows with exactly ONE lesson —
  // 4 of G9 Chemistry's 42. The module carries a `plural` helper for this and
  // was not using it, so those read "1 lessons".
  test('a one-lesson chapter reads "1 lesson", not "1 lessons"', async () => {
    const rows = await allChapters(9, 'Chemistry');
    const ones = rows.filter((r) => r['main-content'].description === '1 lesson');
    expect(ones.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r['main-content'].description).not.toMatch(/\b1 lessons\b/);
    }
  });

  test('every field of every row on every colliding screen is inside its cap', async () => {
    for (const [g, s] of [[9, 'Chemistry'], [10, 'Chemistry'],
      [10, 'Pakistan Studies'], [12, 'Pakistan Studies']]) {
      ROWS = FIXTURE;
      for (const r of await allChapters(g, s)) {
        const mc = r['main-content'];
        expect(cps(mc.title)).toBeLessThanOrEqual(TITLE_CAP);
        expect(cps(mc.description)).toBeLessThanOrEqual(DESC_CAP);
        expect(cps(mc.metadata)).toBeLessThanOrEqual(META_CAP);
        expect(mc.title).toMatch(/Ch |باب /);          // the number is never what gets clipped
      }
    }
  });

  test('pagination still counts every (book, chapter) — G9 Chemistry spans 3 screens', async () => {
    const seen = [];
    let page = 1; let more = true; let pages = 0;
    while (more) {
      const r = await Catalog.buildChapterItems(9, 'Chemistry', page);
      expect(r.total).toBe(42);                        // total is pairs, not chapter_keys
      seen.push(...r.items.filter((i) => i.id !== '__more__').map((i) => i.id));
      more = r.hasMore; page += 1; pages += 1;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBe(3);                             // 19 + 19 + 4
    expect(new Set(seen).size).toBe(42);               // nothing dropped or repeated
  });
});
