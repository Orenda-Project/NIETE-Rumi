/**
 * bd-rj6w0n.14.17 — while LP_GB_K5_ENABLED is on, a GB teacher gets ONE subject menu: her region's book list
 * (bd-97daxo.4, Amena's GB sheet) says which books; the GB K-5 lane serves English, Urdu, Maths and Science
 * (Coming Soon until a book's lessons land); ICT's K-5 corpus serves the rest of the list (GK, SST, Islamiat).
 * Before this, the book list sent her through ICT's corpus alone, and GB books with no ICT lessons were missing
 * (Amena's sandbox test, 6 Nov: Grade 3 showed only Maths, GK and Islamiat).
 */
const G3 = ['gb_g3_english', 'gb_g3_urdu', 'gb_g3_maths', 'grade_3_general_knowledge_en', 'grade_3_islamiat'];
const G4 = ['gb_g4_english', 'gb_g4_urdu', 'gb_g4_maths', 'gb_g4_science', 'grade_4_social_studies_en', 'grade_4_islamiat'];

const lesson = (id) => ({ lesson_id: id, segment_index: 1, lp_type: 'content', pages_label: 'p.1',
  row: { title: id.slice(0, 26), description: 'Day 1', metadata: 'T' } });
const book = (stem, grade, subjectKey, subject, extra = {}) => ({ stem, book_key: stem, grade, subject,
  subject_key: subjectKey, rtl: false, ...extra,
  chapters: [{ number: 1, title: subject, pages_label: 'p.1-9', lessons: [lesson(`${stem}_ch1_seg1`)] }] });
const CATALOG = { books: [
  book('gb_g3_maths', 3, 'math', 'Math', { opt_in: true }),
  book('grade_3_general_knowledge_en', 3, 'general_knowledge', 'General Knowledge'),
  book('grade_3_islamiat', 3, 'islamiat', 'Islamiat', { rtl: true }),
  book('grade_4_social_studies_en', 4, 'social_studies_en', 'Social Studies'),
] };
const AVAILABLE = CATALOG.books.map((b) => `${b.stem}_ch1_seg1`);

const lp612Row = (grade, subject) => ({ id: subject, 'main-content': { title: subject },
  'on-click-action': { name: 'data_exchange', payload: { step: 'lp612_subject', grade: String(grade), subject } } });

describe('the WhatsApp lesson-plan Flow, GB teacher with a region book list', () => {
  let ep;
  let Catalog;
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; if (Catalog) Catalog.__setCatalogForTests(null); });

  function load(gbOn, bookKeys, built = []) {
    jest.resetModules();
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_GB_K5_ENABLED = gbOn ? 'true' : 'false';
    jest.doMock('../../bot/shared/config/supabase', () => {
      const { createMemorySupabase } = require('../fixtures/memory-supabase');
      return createMemorySupabase({});
    });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocumentByLink: jest.fn() }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ buildR2PublicUrl: (k) => k, getPresignedUrl: async (u) => u }));
    jest.doMock('../../bot/shared/services/oxbridge-lp.service', () => ({ gradeWord: () => null, isEligibleGrade: () => false }));
    jest.doMock('../../bot/shared/services/lp612-serving.service', () => ({}));
    jest.doMock('../../bot/shared/services/lp-v8-delivery.service', () => ({
      availableLessonIds: async () => new Set(AVAILABLE), downloadedLessonIds: async () => new Set(),
    }));
    // The GB lane's catalogue: the segmented GB books (`built`), as lp612_subject rows.
    jest.doMock('../../bot/shared/services/lp612-catalog.service', () => ({
      ...jest.requireActual('../../bot/shared/services/lp612-catalog.service'),
      buildSubjectItems: async (grade) => built.filter((b) => b.grade === grade).map((b) => lp612Row(grade, b.subject)),
    }));
    const db = require('../../bot/shared/config/supabase');
    db.reset({
      users: [{ id: 'gb-en', region: 'Gilgit-Baltistan', preferred_language: 'en' }],
      region_features: [{ region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan',
        curriculum_key: 'nbf_snc', is_active: true, book_keys: bookKeys }],
    });
    Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
    Catalog.__setCatalogForTests(CATALOG);
    ep = require('../../bot/shared/routes/pakistan-lp-endpoint');
  }

  const pick = (grade) => ep.handlePakistanLpDataExchange('gb-en:pakistan-lp:1', 'SELECT_GRADE', { step: 'grade', grade: String(grade) });
  const steps = (res) => res.data.items.map((i) => `${i.id}:${i['on-click-action'].payload.step}`);

  test('flag on, Grade 3: every GB book on her list, then GK and Islamiat from ICT', async () => {
    load(true, G3, [{ grade: 3, subject: 'Mathematics' }]);
    const res = await pick(3);
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(steps(res)).toEqual([
      'gb_soon_english:lp612_gb_soon', 'gb_soon_urdu:lp612_gb_soon', 'Mathematics:lp612_subject',
      'general_knowledge:subject', 'islamiat:subject',
    ]);
  });

  test('flag on, Grade 4: a newly segmented book (English, Science) shows as soon as its lessons land', async () => {
    load(true, G4);
    expect(steps(await pick(4))).toEqual([
      'gb_soon_english:lp612_gb_soon', 'gb_soon_urdu:lp612_gb_soon', 'gb_soon_maths:lp612_gb_soon',
      'gb_soon_science:lp612_gb_soon', 'social_studies_en:subject',
    ]);
    load(true, G4, [{ grade: 4, subject: 'English' }, { grade: 4, subject: 'Science' }]);
    expect(steps(await pick(4))).toEqual([
      'English:lp612_subject', 'gb_soon_urdu:lp612_gb_soon', 'gb_soon_maths:lp612_gb_soon',
      'Science:lp612_subject', 'social_studies_en:subject',
    ]);
  });

  test('flag on: a GB book her list does not name is not offered', async () => {
    load(true, ['gb_g3_maths', 'grade_3_islamiat']);
    expect(steps(await pick(3))).toEqual(['gb_soon_maths:lp612_gb_soon', 'islamiat:subject']);
  });

  test('flag off: the region book list still decides, unchanged', async () => {
    load(false, G3);
    const res = await pick(3);
    expect(JSON.stringify(res)).not.toContain('gb_soon_');
    expect(steps(res)).toEqual(['math:subject', 'general_knowledge:subject', 'islamiat:subject']);
  });
});
