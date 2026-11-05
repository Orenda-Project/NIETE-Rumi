/**
 * The WhatsApp lesson-plan Flow shows a teacher her region's books (bd-97daxo.4/.5).
 *
 * The flow token names the teacher; her users.region names her region; region_features.book_keys
 * names its books. GB: her own NBF English, and ICT's English GK — never ICT's English or the
 * Urdu-medium GK. A sector teacher, or one with no region, gets exactly today's ICT menu.
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
jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: async () => new Set([
    'grade_3_english_ch1_seg1', 'grade_3_general_knowledge_en_ch1_seg1', 'grade_3_general_knowledge_ch1_seg1',
    'gb_g3_english_ch1_seg1', 'gb_g3_english_chR1_seg900',
  ]),
  downloadedLessonIds: async () => new Set(),
}));

const db = require('../../bot/shared/config/supabase');
const Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const TeacherBooks = require('../../bot/shared/services/teacher-books.service');
const ep = require('../../bot/shared/routes/pakistan-lp-endpoint');

const lesson = (id) => ({
  lesson_id: id, segment_index: 1, lp_type: 'content', pages_label: 'p.1',
  row: { title: id.slice(0, 26), description: 'Day 1', metadata: 'T' },
});
const book = (stem, subjectKey, subject, chapters, extra = {}) => ({
  stem, book_key: stem, grade: 3, subject, subject_key: subjectKey, rtl: false, ...extra, chapters,
});
const ch = (number, title, ids, extra = {}) => ({ number, title, pages_label: 'p.1-9', ...extra, lessons: ids.map(lesson) });

beforeAll(() => Catalog.__setCatalogForTests({
  books: [
    book('grade_3_english', 'english', 'English', [ch(1, 'ICT Eng One', ['grade_3_english_ch1_seg1'])]),
    book('grade_3_general_knowledge_en', 'general_knowledge', 'General Knowledge', [ch(1, 'GK EN', ['grade_3_general_knowledge_en_ch1_seg1'])]),
    book('grade_3_general_knowledge', 'general_knowledge_ur', 'واقفیتِ عامہ', [ch(1, 'GK UR', ['grade_3_general_knowledge_ch1_seg1'])], { rtl: true }),
    book('gb_g3_english', 'english', 'English', [
      ch(1, 'GB Eng One', ['gb_g3_english_ch1_seg1']),
      ch('R1', 'Review 1', ['gb_g3_english_chR1_seg900'], { review: true }),
    ], { opt_in: true }),
  ],
}));
afterAll(() => Catalog.__setCatalogForTests(null));

beforeEach(() => {
  db.reset({
    users: [{ id: 'gb-teacher', region: 'Gilgit-Baltistan' }, { id: 'sector-teacher', region: 'Sihala' }, { id: 'no-region', region: null }],
    region_features: [
      { region: 'sihala', organization: 'niete', display_name: 'Sihala', book_keys: null },
      { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', book_keys: ['gb_g3_english', 'grade_3_general_knowledge_en'] },
      { region: 'niete', organization: null, display_name: null, book_keys: null },
    ],
  });
  TeacherBooks._clearCache();
});

const step = (user, d) => ep.handlePakistanLpDataExchange(`${user}:pakistan-lp:1`, 'SELECT_GRADE', d);
const rowTitles = (res) => res.data.items.map((r) => r['main-content'].title);

it("Grade 3 subjects: GB's list for a GB teacher, today's list for everyone else", async () => {
  const gb = await step('gb-teacher', { step: 'grade', grade: '3' });
  expect(gb.screen).toBe('SELECT_SUBJECT');
  expect(gb.data.items.map((r) => r.id)).toEqual(['english', 'general_knowledge']);

  for (const user of ['sector-teacher', 'no-region']) {
    const res = await step(user, { step: 'grade', grade: '3' });
    expect(res.data.items.map((r) => r.id)).toEqual(['english', 'general_knowledge_ur', 'general_knowledge']);
  }
});

it("English: a GB teacher gets GB's chapters, review included; a sector teacher gets ICT's", async () => {
  const gb = await step('gb-teacher', { step: 'subject', grade: '3', subject: 'english' });
  expect(gb.screen).toBe('SELECT_CHAPTER');
  expect(rowTitles(gb)).toEqual(['Ch 1 — GB Eng One', 'Review 1']);

  const ict = await step('sector-teacher', { step: 'subject', grade: '3', subject: 'english' });
  expect(rowTitles(ict)).toEqual(['Ch 1 — ICT Eng One']);
});

it("lessons come from her book: chapter 1 and the review chapter", async () => {
  const one = await step('gb-teacher', { step: 'chapter', grade: '3', subject: 'english', chapter: '1' });
  expect(one.data.items.map((r) => r.id)).toEqual(['V8-gb_g3_english_ch1_seg1']);
  const review = await step('gb-teacher', { step: 'chapter', grade: '3', subject: 'english', chapter: 'R1' });
  expect(review.data.items.map((r) => r.id)).toEqual(['V8-gb_g3_english_chR1_seg900']);
  expect(review.data.header_text).toContain('Review 1');

  const ict = await step('no-region', { step: 'chapter', grade: '3', subject: 'english', chapter: '1' });
  expect(ict.data.items.map((r) => r.id)).toEqual(['V8-grade_3_english_ch1_seg1']);
});

it('the Urdu-medium GK is not on GB\'s menu, even when asked for by key', async () => {
  const res = await step('gb-teacher', { step: 'subject', grade: '3', subject: 'general_knowledge_ur' });
  expect(res.screen).not.toBe('SELECT_CHAPTER');
});
