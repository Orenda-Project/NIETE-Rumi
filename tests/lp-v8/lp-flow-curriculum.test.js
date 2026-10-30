/**
 * The WhatsApp lesson-plan Flow asks the catalogue for the TEACHER's curriculum (bd-97daxo.5).
 *
 * The flow token names the teacher; her users.region, through the region registry, names her
 * curriculum. A GB teacher's Grade 3 English menu is GB's book (once one is in the catalogue with
 * lessons up); a sector teacher's — and a teacher with no region's — is ICT's, exactly as today.
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
    'grade_3_english_ch1_seg1', 'grade_3_math_ch1_seg1', 'nbf_snc_grade_3_english_ch1_seg1',
  ]),
  downloadedLessonIds: async () => new Set(),
}));

const db = require('../../bot/shared/config/supabase');
const Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const ep = require('../../bot/shared/routes/pakistan-lp-endpoint');

const lesson = (id) => ({
  lesson_id: id, segment_index: 1, lp_type: 'content', pages_label: 'p.1',
  row: { title: id.slice(0, 26), description: 'Day 1', metadata: 'T' },
});
const book = (stem, subjectKey, title, extra = {}) => ({
  stem, grade: 3, subject: subjectKey, subject_key: subjectKey, rtl: false, ...extra,
  chapters: [{ number: 1, title, pages_label: 'p.1-9', lessons: [lesson(`${stem}_ch1_seg1`)] }],
});

beforeAll(() => Catalog.__setCatalogForTests({
  books: [
    book('grade_3_english', 'english', 'ICT Eng One'),
    book('grade_3_math', 'math', 'ICT Maths One'),
    book('nbf_snc_grade_3_english', 'english', 'GB Eng One', { curriculum: 'nbf_snc' }),
  ],
}));
afterAll(() => Catalog.__setCatalogForTests(null));

beforeEach(() => {
  db.reset({
    users: [{ id: 'gb-teacher', region: 'Gilgit-Baltistan' }, { id: 'sector-teacher', region: 'Sihala' }, { id: 'no-region', region: null }],
    region_features: [
      { region: 'sihala', organization: 'niete', display_name: 'Sihala', sort_order: 2, is_active: true, curriculum_key: null },
      { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 1, is_active: true, curriculum_key: 'nbf_snc' },
      { region: 'niete', organization: null, display_name: null, sort_order: null, is_active: true, curriculum_key: 'punjab_snc_2020' },
    ],
  });
  require('../../bot/shared/services/region-registry')._clearCache();
});

const chapterTitles = async (user) => {
  const res = await ep.handlePakistanLpDataExchange(`${user}:pakistan-lp:1`, 'SELECT_SUBJECT', { step: 'subject', grade: '3', subject: 'english' });
  expect(res.screen).toBe('SELECT_CHAPTER');
  return res.data.items.map((r) => r['main-content'].title).join(' ');
};
const lessonIds = async (user) => {
  const res = await ep.handlePakistanLpDataExchange(`${user}:pakistan-lp:1`, 'SELECT_CHAPTER', { step: 'chapter', grade: '3', subject: 'english', chapter: '1' });
  return res.data.items.map((r) => r.id);
};

it('a sector teacher and a teacher with no region get ICT\'s English book', async () => {
  for (const user of ['sector-teacher', 'no-region']) {
    expect(await chapterTitles(user)).toContain('ICT Eng One');
    expect(await lessonIds(user)).toEqual(['V8-grade_3_english_ch1_seg1']);
  }
});

it("a GB teacher gets GB's English book, and ICT's Maths", async () => {
  expect(await chapterTitles('gb-teacher')).toContain('GB Eng One');
  expect(await chapterTitles('gb-teacher')).not.toContain('ICT');
  expect(await lessonIds('gb-teacher')).toEqual(['V8-nbf_snc_grade_3_english_ch1_seg1']);

  const maths = await ep.handlePakistanLpDataExchange('gb-teacher:pakistan-lp:1', 'SELECT_SUBJECT', { step: 'subject', grade: '3', subject: 'math' });
  expect(maths.data.items.map((r) => r['main-content'].title).join(' ')).toContain('ICT Maths One');
});
