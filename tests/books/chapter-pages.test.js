/**
 * A K-5 book with more than 20 chapters pages its chapter list (bd-97daxo.5).
 *
 * GB's Urdu books carry 27-28 chapters once Amena's جائزہ review units sit between them; a WhatsApp
 * NavigationList holds 20 rows, so chapters 21+ (51 lessons on sandbox, 5 Nov) were unreachable. Page 1 shows 19
 * chapters and a "More chapters" row; the row's step opens SELECT_CHAPTER_MORE (the screen the published Flow
 * already has for Grades 6-12) with the rest. A book of 20 or fewer — every ICT book — is exactly as before.
 */
jest.mock('../../bot/shared/config/supabase', () => {
  const { createMemorySupabase } = require('../fixtures/memory-supabase');
  return createMemorySupabase({});
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocumentByLink: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ buildR2PublicUrl: (k) => k, getPresignedUrl: async (u) => u }));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({ gradeWord: () => null, isEligibleGrade: () => false }));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({}));

const CHAPTERS = Array.from({ length: 25 }, (_, i) => (i === 5 ? 101 : i + 1));
const ids = CHAPTERS.map((n) => `gb_g4_urdu_ch${n}_seg1`);
jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: async () => new Set(Array.from({ length: 25 }, (_, i) => `gb_g4_urdu_ch${i === 5 ? 101 : i + 1}_seg1`)),
  downloadedLessonIds: async () => new Set(),
}));

const db = require('../../bot/shared/config/supabase');
const Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const TeacherBooks = require('../../bot/shared/services/teacher-books.service');
const ep = require('../../bot/shared/routes/pakistan-lp-endpoint');

const book = {
  stem: 'gb_g4_urdu', book_key: 'gb_g4_urdu', grade: 4, subject: 'Urdu', subject_key: 'urdu', rtl: true, opt_in: true,
  chapters: CHAPTERS.map((n, i) => ({
    number: n, title: n === 101 ? 'جائزہ-۱' : `سبق ${n}`, pages_label: 'p.1-2', ...(n === 101 ? { review: true } : {}),
    lessons: [{ lesson_id: ids[i], segment_index: 1, lp_type: 'content', row: { title: 'T', description: 'D', metadata: 'M' } }],
  })),
};
const SHELF = ['gb_g4_urdu'];
const all = new Set(ids);

beforeAll(() => Catalog.__setCatalogForTests({ books: [book] }));
afterAll(() => Catalog.__setCatalogForTests(null));
beforeEach(() => {
  db.reset({
    users: [{ id: 'gb', region: 'Gilgit-Baltistan' }],
    region_features: [{ region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', book_keys: SHELF }],
  });
  TeacherBooks._clearCache();
});

test('page 1: 19 chapters and a More row that names the next page', () => {
  const p1 = Catalog.buildChapterItems(4, 'urdu', all, SHELF);
  expect(p1).toHaveLength(20);
  expect(p1.slice(0, 19).map((i) => i.id)).toEqual(CHAPTERS.slice(0, 19).map(String));
  const more = p1[19];
  expect(more.id).toBe(Catalog.MORE_ROW_ID);
  expect(more['on-click-action'].payload).toEqual({ step: 'chapter_page', grade: '4', subject: 'urdu', page: '2' });
  expect(more['main-content'].title.startsWith('‏')).toBe(true); // an Urdu book's row reads RTL
});

test('page 2: the rest, no More row', () => {
  const p2 = Catalog.buildChapterItems(4, 'urdu', all, SHELF, 2);
  expect(p2.map((i) => i.id)).toEqual(CHAPTERS.slice(19).map(String));
});

test("the Flow's chapter_page step opens SELECT_CHAPTER_MORE with page 2", async () => {
  const res = await ep.handlePakistanLpDataExchange('gb:pakistan-lp:1', 'SELECT_CHAPTER', { step: 'chapter_page', grade: '4', subject: 'urdu', page: '2' });
  expect(res.screen).toBe('SELECT_CHAPTER_MORE');
  expect(res.data.items.map((i) => i.id)).toEqual(CHAPTERS.slice(19).map(String));
  expect(res.data.subject_value).toBe('urdu');
});

test('a book of 20 chapters or fewer has no More row (every ICT book)', () => {
  const twenty = new Set(ids.slice(0, 20));
  const items = Catalog.buildChapterItems(4, 'urdu', twenty, SHELF);
  expect(items).toHaveLength(20);
  expect(items.some((i) => i.id === Catalog.MORE_ROW_ID)).toBe(false);
});
