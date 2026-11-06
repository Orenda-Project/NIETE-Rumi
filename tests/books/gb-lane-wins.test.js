/**
 * bd-rj6w0n.14.17 — while LP_GB_K5_ENABLED is on, a GB teacher's grade tap goes to the GB K-5 lane (English, Urdu,
 * Maths, Science; Coming Soon where nothing is built), even though GB's region also carries a book list
 * (bd-97daxo.4). Before this, the book list won and sent her through ICT's K-5 corpus: GK, SST and Islamiat
 * showed, and GB subjects with no ICT lessons were missing (Amena's sandbox test, 6 Nov).
 */
const GB = ['gb_g3_english', 'gb_g3_urdu', 'gb_g3_maths', 'grade_3_general_knowledge_en', 'grade_3_islamiat'];

describe('the WhatsApp lesson-plan Flow, GB teacher with a region book list', () => {
  let ep;
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  function load(gbOn) {
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
      availableLessonIds: async () => new Set(), downloadedLessonIds: async () => new Set(),
    }));
    jest.doMock('../../bot/shared/services/lp612-catalog.service', () => ({
      ...jest.requireActual('../../bot/shared/services/lp612-catalog.service'),
      buildSubjectItems: async () => [],
    }));
    const db = require('../../bot/shared/config/supabase');
    db.reset({
      users: [{ id: 'gb-en', region: 'Gilgit-Baltistan', preferred_language: 'en' }],
      region_features: [{ region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan',
        curriculum_key: 'nbf_snc', is_active: true, book_keys: GB }],
    });
    ep = require('../../bot/shared/routes/pakistan-lp-endpoint');
  }

  const pick = (grade) => ep.handlePakistanLpDataExchange('gb-en:pakistan-lp:1', 'SELECT_GRADE', { step: 'grade', grade: String(grade) });

  test('flag on: Grade 3 lists the GB on-request books, and no GK or Islamiat', async () => {
    load(true);
    const res = await pick(3);
    expect(res.screen).toBe('SELECT_SUBJECT');
    const ids = res.data.items.map((i) => i.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^gb_soon_(english|urdu|maths|science)$/);
    expect(JSON.stringify(res)).not.toMatch(/islamiat|general_knowledge/i);
  });

  test('flag off: the region book list still decides, unchanged', async () => {
    load(false);
    const res = await pick(3);
    expect(JSON.stringify(res)).not.toContain('gb_soon_');
  });
});
