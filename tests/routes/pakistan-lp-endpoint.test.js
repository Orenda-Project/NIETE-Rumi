/**
 * Pakistan LP Flow endpoint (FEAT-059 + FEAT-109 iter 3) —
 * asserts the data_exchange handlers return the right dropdown rows.
 *
 * v2 iter 3 screens: SELECT_GRADE → SELECT_SUBJECT → SELECT_CHAPTER → SELECT_TOPIC → SUCCESS
 * - SPEC removed
 * - Grade dropdown is STATIC 1..10 (not filtered by DB coverage)
 * - Grades 1–5 use pre_generated_lps (curriculum='pakistan')
 * - Grades 6–10 route to lesson_plan_catalog (source='oxbridge')
 * - Topic IDs are prefixed PK-/OX- so SELECT_TOPIC routes delivery correctly
 */

function makeSupabase(datasets) {
  const store = JSON.parse(JSON.stringify(datasets));
  function builder(table) {
    let rows = (store[table] || []).slice();
    const api = {
      select() { return api; },
      eq(k, v) { rows = rows.filter(r => String(r[k]) === String(v)); return api; },
      in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } }); },
      insert(payload) {
        const row = { id: `gen-${(store[table] || []).length + 1}`, ...payload };
        store[table] = store[table] || [];
        store[table].push(row);
        return { then: (res) => res({ data: row, error: null }) };
      },
      update() { return { eq() { return Promise.resolve({ data: null, error: null }); } }; },
      then(resolve) { return resolve({ data: rows, error: null }); },
    };
    return api;
  }
  return { from: jest.fn((t) => builder(t)) };
}

const LP_ROWS = [
  { id: 'r-g1-en-ch1', curriculum: 'pakistan', grade: 1, subject: 'English', chapter_number: 1, chapter_title: 'Hello World', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/Rumi_TA_G1_English_Hello_World.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  { id: 'r-g1-en-ch2', curriculum: 'pakistan', grade: 1, subject: 'English', chapter_number: 2, chapter_title: 'Five Senses Funland!', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/Rumi_TA_G1_English_Ch2_Five_Senses_Funland.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  { id: 'r-g1-math', curriculum: 'pakistan', grade: 1, subject: 'Math', chapter_number: 1, chapter_title: 'Number Buddies (0–9)', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/Rumi_TA_G1_Math_Number_Buddies_0-9.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  { id: 'r-g3-en', curriculum: 'pakistan', grade: 3, subject: 'English', chapter_number: 1, chapter_title: 'English — Chapter 1', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/PK_G3_ENG_CH1.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  { id: 'r-g6-m1', curriculum: 'pakistan_methods', grade: 6, subject: 'English', chapter_number: 601, chapter_title: 'Chapter 1 — Explicit Instruction', pdf_r2_key_en: 'x.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  { id: 'r-incomplete', curriculum: 'pakistan', grade: 1, subject: 'Urdu', chapter_number: 99, chapter_title: 'X', pdf_r2_key_en: 'x.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'pending' },
];

const OXBRIDGE_ROWS = [
  { id: 1, source: 'oxbridge', is_active: true, grade: 'Grade Six', subject: 'Computer Science', chapter_title: 'Digital skills', description: '<p><strong>Topic: </strong>Digital Skills</p>', content_html: '<h1>G6 CS Digital skills</h1><p>Body</p>' },
  { id: 2, source: 'oxbridge', is_active: true, grade: 'Grade Six', subject: 'Computer Science', chapter_title: 'ICT Fundamentals', description: '<p><strong>Topic: </strong>ICT Fundamentals</p>', content_html: '<h1>G6 CS ICT</h1>' },
  { id: 3, source: 'oxbridge', is_active: true, grade: 'Grade Ten', subject: 'Physics', chapter_title: 'Waves and Energy', description: '<p><strong>Topic: </strong>Dispersion Of Light</p>', content_html: '<h1>G10 Physics Waves</h1>' },
];

describe('pakistan-lp-endpoint (v2 iter 3 — FEAT-109)', () => {
  let ep, sendMsgSpy, sendDocByLinkSpy, deliverOxSpy;

  function load(pkRows = LP_ROWS, oxRows = OXBRIDGE_ROWS) {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const supa = makeSupabase({
      pre_generated_lps: pkRows,
      lesson_plan_catalog: oxRows,
      users: [{ id: 'u1', phone_number: '15551230000', preferred_language: 'en' }],
    });
    jest.doMock('../../bot/shared/config/supabase', () => supa);
    sendMsgSpy = jest.fn().mockResolvedValue(true);
    sendDocByLinkSpy = jest.fn().mockResolvedValue(true);
    deliverOxSpy = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: sendMsgSpy,
      sendDocumentByLink: sendDocByLinkSpy,
      sendVoicenoteFromR2Key: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({
      buildR2PublicUrl: (k) => `https://r2.example/${k}`,
      getPresignedUrl: async (u) => `${u}?sig=stub`,
    }));
    jest.doMock('../../bot/shared/services/oxbridge-lp.service', () => ({
      gradeWord: (n) => ({ 6: 'Grade Six', 7: 'Grade Seven', 8: 'Grade Eight', 9: 'Grade Nine', 10: 'Grade Ten' })[n] || null,
      isEligibleGrade: (n) => n >= 6 && n <= 12,
      extractTopicFromDescription: (d) => {
        if (!d) return null;
        const m = d.match(/Topic:\s*<\/strong>\s*([^<]+)/i);
        return m ? m[1].trim() : null;
      },
      getById: async (id) => oxRows.find(r => r.id === id) || null,
      deliverOxbridgeLp: deliverOxSpy,
    }));
    ep = require('../../bot/shared/routes/pakistan-lp-endpoint');
  }

  it('INIT returns static 1..10 grades (never filtered by DB coverage)', async () => {
    load();
    const res = await ep.handlePakistanLpInit('u1:pakistan-lp:1');
    expect(res.screen).toBe('SELECT_GRADE');
    expect(res.data.grades.map(g => g.id)).toEqual(['1','2','3','4','5','6','7','8','9','10']);
    expect(res.data.grades.map(g => g.title)).toEqual([
      'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10',
    ]);
  });

  it('SELECT_GRADE=1 → subjects from pre_generated_lps (English + Math)', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_GRADE', { grade: '1' });
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.subjects.map(s => s.id).sort()).toEqual(['English', 'Math']);
  });

  it('SELECT_GRADE=6 → subjects from Oxbridge (Computer Science)', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_GRADE', { grade: '6' });
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.subjects.map(s => s.id)).toEqual(['Computer Science']);
  });

  it('SELECT_GRADE=10 → subjects from Oxbridge (Physics)', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_GRADE', { grade: '10' });
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.subjects.map(s => s.id)).toEqual(['Physics']);
  });

  it('SELECT_GRADE=4 (empty) returns friendly no-LPs error', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_GRADE', { grade: '4' });
    expect(res.data.error).toBeDefined();
    expect(res.data.error.message).toMatch(/no lesson plans/i);
  });

  it('SELECT_SUBJECT=English G1 → SELECT_CHAPTER lists Pakistan chapters ordered', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_SUBJECT', { grade: '1', subject: 'English' });
    expect(res.screen).toBe('SELECT_CHAPTER');
    expect(res.data.chapters).toHaveLength(2);
    expect(res.data.chapters[0].id).toBe('1');
    expect(res.data.chapters[1].id).toBe('2');
  });

  it('SELECT_SUBJECT=Computer Science G6 → SELECT_CHAPTER lists Oxbridge chapters', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_SUBJECT', { grade: '6', subject: 'Computer Science' });
    expect(res.screen).toBe('SELECT_CHAPTER');
    expect(res.data.chapters.map(c => c.id).sort()).toEqual(['Digital skills', 'ICT Fundamentals']);
  });

  it('SELECT_CHAPTER (Pakistan) → topic IDs are PK-prefixed', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_CHAPTER', { grade: '1', subject: 'English', chapter: '1' });
    // FEAT-059 v3: the topic screen is now SELECT_LESSON — the v3 routing
    // model has no SELECT_TOPIC. Item ids keep their PK-/OX- prefixes, so the
    // delivery pipelines below are unchanged.
    expect(res.screen).toBe('SELECT_LESSON');
    expect(res.data.topics).toHaveLength(1);
    expect(res.data.topics[0].id).toBe('PK-r-g1-en-ch1');
    expect(res.data.topics[0].title).toBe('Full Chapter Lesson Plan');
  });

  it('SELECT_CHAPTER (Oxbridge) → topic IDs are OX-prefixed with extracted topic titles', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_CHAPTER', { grade: '6', subject: 'Computer Science', chapter: 'Digital skills' });
    // FEAT-059 v3: the topic screen is now SELECT_LESSON — the v3 routing
    // model has no SELECT_TOPIC. Item ids keep their PK-/OX- prefixes, so the
    // delivery pipelines below are unchanged.
    expect(res.screen).toBe('SELECT_LESSON');
    expect(res.data.topics).toHaveLength(1);
    expect(res.data.topics[0].id).toBe('OX-1');
    expect(res.data.topics[0].title).toBe('Digital Skills'); // extracted from description
  });

  it('SELECT_TOPIC with PK- prefix routes to Pakistan delivery (sendDocumentByLink)', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange(
      'u1:pakistan-lp:1', 'SELECT_TOPIC', { grade: '1', subject: 'English', chapter: '1', topic: 'PK-r-g1-en-ch1' }
    );
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.message).toMatch(/on its way/);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 30));
    expect(sendDocByLinkSpy).toHaveBeenCalled();
    expect(deliverOxSpy).not.toHaveBeenCalled();
  });

  it('SELECT_TOPIC with OX- prefix routes to OxbridgeLpService.deliverOxbridgeLp', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange(
      'u1:pakistan-lp:1', 'SELECT_TOPIC', { grade: '6', subject: 'Computer Science', chapter: 'Digital skills', topic: 'OX-1' }
    );
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.message).toMatch(/Oxbridge/);
    expect(res.data.message).toMatch(/on its way/);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 30));
    expect(deliverOxSpy).toHaveBeenCalled();
    expect(sendDocByLinkSpy).not.toHaveBeenCalled();
  });

  it('SELECT_TOPIC with unprefixed id defaults to Pakistan (back-compat)', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange(
      'u1:pakistan-lp:1', 'SELECT_TOPIC', { grade: '1', subject: 'English', chapter: '1', topic: 'r-g1-en-ch1' }
    );
    expect(res.screen).toBe('SUCCESS');
  });

  it('SELECT_TOPIC rejects an unknown Pakistan row id', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange(
      'u1', 'SELECT_TOPIC', { grade: '1', subject: 'English', chapter: '1', topic: 'PK-nope' }
    );
    expect(res.data.error).toBeDefined();
  });

  it('SELECT_TOPIC rejects missing topic id', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange(
      'u1', 'SELECT_TOPIC', { grade: '1', subject: 'English', chapter: '1' }
    );
    expect(res.data.error).toBeDefined();
  });

  it('CURRICULUM_TAG is "pakistan" — never leaks methods corpus', async () => {
    load();
    expect(ep.CURRICULUM_TAG).toBe('pakistan');
    expect(ep.isOxbridgeGrade(5)).toBe(false);
    expect(ep.isOxbridgeGrade(6)).toBe(true);
    expect(ep.isOxbridgeGrade(10)).toBe(true);
  });
});
