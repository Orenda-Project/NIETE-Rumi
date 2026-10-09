/**
 * bd-6640j.1.8.8 — the portal's subject list (/curriculum/subjects) uses the same fixed order as the WhatsApp menu
 * (TDD, red first). bd-6640j.1.8.7 ordered the bot menu; the portal sorted the same books A-Z by name instead, so
 * "General Knowledge" came before "English" and the Urdu-script names landed last.
 */
// availableLessonIds is spied below; the client is never reached.
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));

const C = require('../../shared/services/lp-v8-catalog.service');
const D = require('../../shared/services/lp-v8-delivery.service');
const Browse = require('../../shared/services/lp-v8-browse.service');

const book = (grade, subject_key) => ({ grade, subject: subject_key, subject_key,
  chapters: [{ number: 1, title: 't', lessons: [{ lesson_id: `${grade}_${subject_key}_1` }] }] });
const KEYS = ['english', 'general_knowledge', 'general_knowledge_ur', 'general_science', 'islamiat', 'math',
  'social_studies_en', 'social_studies_ur', 'urdu', 'zz_new'];

describe('Browse.listSubjects — same order as the WhatsApp menu', () => {
  afterAll(() => { C.__setCatalogForTests(null); jest.restoreAllMocks(); });

  test('lists core first, then electives, unknown keys last', async () => {
    C.__setCatalogForTests({ books: KEYS.map((k) => book(4, k)) });
    jest.spyOn(D, 'availableLessonIds').mockResolvedValue(new Set(KEYS.map((k) => `4_${k}_1`)));
    expect((await Browse.listSubjects(4)).map((s) => s.subject_key)).toEqual(['english', 'urdu', 'math',
      'general_science', 'general_knowledge_ur', 'general_knowledge', 'social_studies_en', 'social_studies_ur',
      'islamiat', 'zz_new']);
  });
});
