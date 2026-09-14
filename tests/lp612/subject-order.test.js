/**
 * The subject menu is ordered core-first, on BOTH surfaces — bd-y5vx3.
 *
 * Grade 9 opened with `Biology, Chemistry, Computer Science, English, …`: both menus sorted with
 * a bare `localeCompare`, which put the three elective science papers ahead of every compulsory
 * subject and English — the likeliest pick in the list — sixth. A WhatsApp NavigationList is read
 * from the top, so alphabetical is not a neutral order there; it is a ranking, and it ranked the
 * subjects the fewest teachers teach highest.
 *
 * THERE ARE TWO MENUS AND FIXING ONE IS NOT FIXING THE BUG. `buildSubjectItems` builds the
 * WhatsApp Flow rows (`pakistan-lp-endpoint.js:300`, the SELECT_SUBJECT screen the operator was
 * looking at); `Browse.listSubjects` answers the portal and the internal API
 * (`internal-api.routes.js:908, 1014, 1281`). They read the same table through different code, so
 * both are asserted here against the same corpus — a teacher who checks the portal and then the
 * bot must not be shown two different orders.
 *
 * Each test drives the REAL service with only Supabase faked at the network boundary, so the sort
 * under test is the one that ships. The ordering policy itself is
 * `bot/shared/config/lp612-subject-order.js`; its normalisation is exercised here through the
 * services rather than in isolation, because a comparator that is correct in a unit test and
 * unreferenced by either menu is exactly the bug this file exists to prevent.
 */

// ── Supabase, faked at the boundary. Both services page with `.range()`. ─────────────────────
let mockTable = [];

function mockBuilder() {
  const state = { filters: [] };
  const rows = () => {
    let out = mockTable;
    for (const [c, v] of state.filters) out = out.filter((r) => r[c] === v);
    return out;
  };
  const api = {
    select: () => api,
    eq: (c, v) => { state.filters.push([c, v]); return api; },
    or: () => api,
    in: () => api,
    gte: () => api,
    lte: () => api,
    order: () => api,
    limit: () => Promise.resolve({ data: rows(), error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    range: (from, to) => Promise.resolve({ data: rows().slice(from, to + 1), error: null }),
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return api;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Catalog = require('../../bot/shared/services/lp612-catalog.service');
const Browse = require('../../bot/shared/services/lp612-browse.service');

/**
 * One segment row per subject is enough: the order is decided by the subject strings, not by how
 * many chapters sit behind each one. Listed here in the alphabetical order the bug produced, so
 * the fixture cannot be accused of pre-sorting the answer into place.
 */
function corpus(grade, subjects) {
  mockTable = subjects.map((subject, i) => ({
    grade,
    subject,
    book_stem: `bk${i}`,
    chapter_key: 'c01',
    language: 'en',
    is_current: true,
    is_religious: false,
  }));
}

const G9_ALPHABETICAL = [
  'Biology', 'Chemistry', 'Computer Science', 'English', 'General Science',
  'Islamiyat', 'Mathematics', 'Pakistan Studies', 'Physics', 'Urdu',
];

const G9_CORE_FIRST = [
  'English', 'Urdu', 'Mathematics', 'General Science', 'Islamiyat', 'Pakistan Studies',
  'Physics', 'Chemistry', 'Biology', 'Computer Science',
];

describe('the WhatsApp subject menu lists core subjects before electives', () => {
  test('grade 9 opens on English, not Biology', async () => {
    corpus(9, G9_ALPHABETICAL);
    const items = await Catalog.buildSubjectItems(9);
    expect(items.map((i) => i.id)).toEqual(G9_CORE_FIRST);
  });

  test('the operator\'s four named subjects lead, in the order they named them', async () => {
    // "the subjects should show in the order of core and then electives? English / Urdu / Math /
    // General Science, etc etc" — operator, 2026-09-12.
    corpus(6, ['General Science', 'Urdu', 'English', 'Mathematics']);
    const items = await Catalog.buildSubjectItems(6);
    expect(items.map((i) => i.id)).toEqual(['English', 'Urdu', 'Mathematics', 'General Science']);
  });

  test('a subject the order list has never heard of keeps its place, at the end', async () => {
    // The one failure an ordering policy must not have: a subject that vanishes because nobody
    // added it to a list. Zarai Taleem and Astronomy are real corpus subjects and are not named.
    corpus(10, ['Zarai Taleem', 'English', 'Astronomy', 'Urdu']);
    const items = await Catalog.buildSubjectItems(10);
    expect(items.map((i) => i.id)).toEqual(['English', 'Urdu', 'Astronomy', 'Zarai Taleem']);
  });

  test('the corpus\'s own spelling variants rank with the subject they name', async () => {
    // `subject` is free text from the segmentation import: the corpus carries `mathematics` and
    // `Mathematics`, `Science` and `General Science`, `Islamiat` and `Islamiyat`. Matching the
    // literal would rank one spelling and drop its twin into the alphabetical tail, so the menu
    // would look sorted in one grade and unsorted in the next with nothing to show why.
    corpus(7, ['Science', 'Islamiat', 'mathematics', 'English']);
    const items = await Catalog.buildSubjectItems(7);
    expect(items.map((i) => i.id)).toEqual(['English', 'mathematics', 'Science', 'Islamiat']);
  });
});

describe('the portal subject list is ordered the same way', () => {
  test('listSubjects returns core-first, so the two surfaces cannot disagree', async () => {
    corpus(9, G9_ALPHABETICAL);
    const subjects = await Browse.listSubjects(9);
    expect(subjects.map((s) => s.subject)).toEqual(G9_CORE_FIRST);
  });

  test('the lesson counts still travel with the right subject', async () => {
    // The sort moved; the rows it carries must not. One row per subject above, two here.
    mockTable = [
      { grade: 8, subject: 'Biology', book_stem: 'b', chapter_key: 'c01', language: 'en', is_current: true, is_religious: false },
      { grade: 8, subject: 'Biology', book_stem: 'b', chapter_key: 'c02', language: 'en', is_current: true, is_religious: false },
      { grade: 8, subject: 'English', book_stem: 'e', chapter_key: 'c01', language: 'en', is_current: true, is_religious: false },
    ];
    const subjects = await Browse.listSubjects(8);
    expect(subjects).toEqual([
      { subject: 'English', lesson_count: 1 },
      { subject: 'Biology', lesson_count: 2 },
    ]);
  });
});
