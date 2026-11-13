/**
 * sync-sheet-lps — a re-runnable loader from Amena's GB Curriculum Matrix (bd-97daxo.14).
 *
 * The workbook here is built in the test, in the sheet's real shape: title rows above a header row,
 * GRADE bands and "Ch N — title" bands between day rows, and the LP PDF as a hyperlink on a label.
 *   - tabs and columns are found BY HEADER; a missing tab or header stops the run and names it
 *   - the key is the Segment ID: gb_g1_english.c01.s001 → gb_g1_english_ch1_seg1 (cR1 → chR1, c101 → ch101)
 *   - subject tabs join All Segments on grade + Day #, and the PDF filename must agree with the id
 *   - a second run plans 0 new and 0 changed; a re-rendered PDF is 1 changed; an id gone from the sheet is
 *     reported and stays live (only --retire stops a lesson)
 *   - executed against an in-memory DB and R2: the old version stays in R2 and on record after a change
 */
const crypto = require('crypto');
const path = require('path');

const Workbook = require('../../bot/scripts/sheet-lps/workbook');
const Matrix = require('../../bot/scripts/sheet-lps/matrix');
const Sync = require('../../bot/scripts/sync-sheet-lps');
const GB = require('../../bot/scripts/sheet-lps/gb.config');
const { createMemorySupabase } = require('../fixtures/memory-supabase');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const pdf = (name) => Buffer.from(`%PDF-1.4 ${name}`);
const R2HOST = 'https://pub-test.r2.dev/gb-k5';
const urlFor = (file, bytes) => `${R2HOST}/renders/${sha1(bytes).slice(0, 8)}/${file}`;

/** Files on "Amena's R2": url → bytes. */
let files;
function link(file, bytes = pdf(file)) {
  const url = urlFor(file, bytes);
  files.set(url, bytes);
  return { text: 'v9 built · open PDF', hyperlink: url };
}

/** A tiny stand-in for exceljs's surface, producing what workbook.read produces: { tabs: { name: rows of {v, link} } }. */
function fakeBook() {
  const tabs = {};
  const cell = (x) => (x && typeof x === 'object' ? { v: x.text, link: x.hyperlink } : { v: x === undefined ? null : x });
  return {
    tabs,
    addWorksheet(name) { tabs[name] = []; return { addRow: (cells) => tabs[name].push(cells.map(cell)) }; },
  };
}

async function buildWorkbook({ english, extraSegment = null } = {}) {
  const wb = fakeBook();
  const segs = wb.addWorksheet('All Segments + SLOs');
  segs.addRow(['All Segments + SLOs']);
  segs.addRow(['Every segment with every field.']);
  segs.addRow(['Segment ID', 'Subject', 'Grade', 'Chapter', 'Day #', 'Topic', 'Skill Type', 'CPA Phase', 'Pages']);
  const rows = [
    ['gb_g1_english.c01.s001', 'English', 1, 1, 1, 'Unit opener: look and say names', 'pre_reading', '', '1-2'],
    ['gb_g1_english.c01.s002', 'English', 1, 1, 2, 'Read the alphabet Aa to Mm', 'phonics', '', '3'],
    ['gb_g1_english.c01.s995', 'English', 1, 1, 3, 'Unit assessment', 'assessment', '', '1-3'],
    ['gb_g1_english.cR1.s900', 'English', 1, 'R1', 4, 'Review: initial sounds', 'revision', '', '29'],
    ['gb_g2_urdu.c101.s901', 'Urdu', 2, 101, 1, 'Jaiza review', 'duhrai', '', '30'],
  ];
  if (extraSegment) rows.push(extraSegment);
  rows.forEach((r) => segs.addRow(r));

  const en = wb.addWorksheet('English G1-G5');
  en.addRow(['English G1-G5']);
  en.addRow(['Slice 1 · English']);
  en.addRow(['Day #', 'Topic', 'Skill Type', 'CPA Phase', 'Pages', 'LP PDF', 'Coach card (v10)', 'Answer key']);
  en.addRow(['GRADE 1']);
  en.addRow(['Ch 1 — Time to Recall']);
  for (const r of english) en.addRow(r);
  en.addRow(['Ch R1 — Review 1']);
  en.addRow([4, 'Review: initial sounds', 'revision', '', '29', 'v9 design pending']);

  const ur = wb.addWorksheet('Urdu G1-G5');
  ur.addRow(['Urdu G1-G5']);
  ur.addRow(['Slice 1 · Urdu']);
  ur.addRow(['Day #', 'Topic', 'Skill Type', 'CPA Phase', 'Pages', 'LP PDF']);
  ur.addRow(['GRADE 2']);
  ur.addRow(['Ch 101 — جائزہ-۱']);
  ur.addRow([1, 'Jaiza review', 'duhrai', '', '30', link('g2_ch101_Urdu_seg901_v9_gbfix_5Nov.pdf')]);

  for (const t of ['Maths G1-G5', 'Science G4-G5']) {
    const ws = wb.addWorksheet(t);
    ws.addRow([t]); ws.addRow(['-']); ws.addRow(['Day #', 'Topic', 'Skill Type', 'CPA Phase', 'Pages', 'LP PDF']);
  }

  const skills = wb.addWorksheet('Skill Taxonomy');
  skills.addRow(['Skill Taxonomy']); skills.addRow(['-']);
  skills.addRow(['Subject', 'Code', 'Skill type', 'Definition']);
  skills.addRow(['English', 'phonics', 'Phonics', '']);
  skills.addRow(['English', 'pre_reading', 'Pre-reading', '']);
  skills.addRow(['English', 'assessment', 'Assessment', '']);
  skills.addRow(['English', 'revision', 'Revision', '']);
  skills.addRow(['Urdu', 'duhrai', 'دہرائی (Revision)', '']);

  const books = wb.addWorksheet('Books');
  books.addRow(['Books']); books.addRow(['-']);
  books.addRow(['Slice', 'Subject', 'Grade', 'Book', 'Cover', 'Language']);
  books.addRow([1, 'English', 1, 'eng grade 1.pdf', '', 'en']);
  books.addRow([1, 'Urdu', 2, 'Urdu 2 Complete.pdf', '', 'ur']);
  books.addRow([1, 'Science', 4, 'genral science 4 nbf.pdf', '', 'verify at G0']);
  books.addRow([2, 'General Knowledge', 1, 'general know 1.pdf', '', 'en']);
  books.addRow([2, 'Islamiat', 1, 'Islamiyat grade 1.pdf', '', 'ur']);
  books.addRow([2, 'Social Studies', 4, 'social studies 4 (1).pdf', '', 'en']);
  return { tabs: wb.tabs };
}

const englishRows = () => [
  [1, 'Unit opener: look and say names', 'pre_reading', '', '1-2', link('g1_ch1_English_seg1_v9_gbfix_5Nov.pdf')],
  [2, 'Read the alphabet Aa to Mm', 'phonics', '', '3', link('g1_ch1_English_seg2_v9_gbsvg_3Nov.pdf')],
  [3, 'Unit assessment', 'assessment', '', '1-3', link('g1_ch1_English_seg995.worksheet.pdf'), '',
    { text: 'Open key', hyperlink: urlFor('g1_ch1_English_seg995.answer_key.pdf', pdf('key')) }],
];

beforeEach(() => {
  files = new Map();
});

async function readMatrix(opts) {
  const wb = await buildWorkbook(opts);
  // the answer key's bytes are registered under its URL
  files.set(urlFor('g1_ch1_English_seg995.answer_key.pdf', pdf('key')), pdf('key'));
  return Matrix.read(wb, GB);
}

// The jest config maps `exceljs` to a recording stub (bot-only dependency). Where the real one is installed,
// prove workbook.read keeps a cell's hyperlink, which is the whole reason the sheet is read as XLSX.
const RealExcel = (() => {
  try { return jest.requireActual(path.join(__dirname, '..', '..', 'bot', 'node_modules', 'exceljs')); } catch (_) { return null; }
})();
(RealExcel ? test : test.skip)('workbook.read keeps the text and the hyperlink of a cell (real exceljs)', async () => {
  const wb = new RealExcel.Workbook();
  const ws = wb.addWorksheet('English G1-G5');
  ws.addRow(['Day #', 'LP PDF']);
  ws.addRow([1, { text: 'v9 built · open PDF', hyperlink: 'https://x.r2.dev/gb-k5/renders/49b5e94c/g1_ch1/f.pdf' }]);
  const out = await Workbook.read(Buffer.from(await wb.xlsx.writeBuffer()), { ExcelJS: RealExcel });
  expect(out.tabs['English G1-G5'][1].slice(0, 2)).toEqual([
    { v: 1 }, { v: 'v9 built · open PDF', link: 'https://x.r2.dev/gb-k5/renders/49b5e94c/g1_ch1/f.pdf' }]);
});

describe('reading the matrix', () => {
  test('ids map to lesson ids, review chapters included', () => {
    expect(Matrix.lessonIdFor('gb_g1_english.c01.s001')).toBe('gb_g1_english_ch1_seg1');
    expect(Matrix.lessonIdFor('gb_g1_english.c12.s995')).toBe('gb_g1_english_ch12_seg995');
    expect(Matrix.lessonIdFor('gb_g1_english.cR1.s900')).toBe('gb_g1_english_chR1_seg900');
    expect(Matrix.lessonIdFor('gb_g2_urdu.c101.s901')).toBe('gb_g2_urdu_ch101_seg901');
    expect(() => Matrix.lessonIdFor('nonsense')).toThrow(/nonsense/);
  });

  test('every linked PDF joins its segment; answer keys come along; a pending cell is not a PDF', async () => {
    const m = await readMatrix({ english: englishRows() });
    expect(m.segments.size).toBe(5);
    const byId = Object.fromEntries(m.items.map((i) => [`${i.lesson_id}:${i.asset_kind}`, i]));
    expect(Object.keys(byId).sort()).toEqual([
      'gb_g1_english_ch1_seg1:lesson', 'gb_g1_english_ch1_seg2:lesson',
      'gb_g1_english_ch1_seg995:answer_key', 'gb_g1_english_ch1_seg995:lesson',
      'gb_g2_urdu_ch101_seg901:lesson',
    ]);
    expect(byId['gb_g1_english_ch1_seg1:lesson'].version_stamp).toBe('gb_v9_gbfix_5Nov');
    expect(byId['gb_g1_english_ch1_seg1:lesson'].url_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(m.pending.map((p) => p.segment_id)).toEqual(['gb_g1_english.cR1.s900']);
    expect(m.blockers).toEqual([]);
  });

  test('a PDF whose filename disagrees with its row is a blocker, never uploaded', async () => {
    const rows = englishRows();
    rows[1][5] = link('g1_ch1_English_seg7_v9.pdf');
    const m = await readMatrix({ english: rows });
    expect(m.items.map((i) => i.lesson_id)).not.toContain('gb_g1_english_ch1_seg2');
    expect(m.blockers).toEqual([expect.objectContaining({ segment_id: 'gb_g1_english.c01.s002', reason: expect.stringMatching(/filename/) })]);
  });

  test('a day row with no segment is a blocker naming the tab, grade and day', async () => {
    const rows = englishRows();
    rows.push([9, 'Stray day', 'phonics', '', '9', link('g1_ch1_English_seg9.pdf')]);
    const m = await readMatrix({ english: rows });
    expect(m.blockers).toEqual([expect.objectContaining({ tab: 'English G1-G5', grade: 1, day: 9, reason: expect.stringMatching(/no segment/i) })]);
  });

  test('a renamed tab or header stops the run and names it', async () => {
    const wb = await buildWorkbook({ english: englishRows() });
    const renamed = { ...wb, tabs: { ...wb.tabs } };
    renamed.tabs['English (G1-5)'] = renamed.tabs['English G1-G5'];
    delete renamed.tabs['English G1-G5'];
    expect(() => Matrix.read(renamed, GB)).toThrow(/English G1-G5/);

    const noHeader = { ...wb, tabs: { ...wb.tabs } };
    noHeader.tabs['All Segments + SLOs'] = wb.tabs['All Segments + SLOs'].map((r) => r.map((c) => (c.v === 'Segment ID' ? { v: 'Seg' } : c)));
    expect(() => Matrix.read(noHeader, GB)).toThrow(/Segment ID/);
  });

  test("the GB books for the catalog: book-first fields, review chapters in the sheet's order, skill labels as row titles", async () => {
    const m = await readMatrix({ english: englishRows() });
    const books = Matrix.catalogBooks(m, GB);
    const eng = books.find((b) => b.stem === 'gb_g1_english');
    expect(eng).toEqual(expect.objectContaining({
      book_key: 'gb_g1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
      publisher: 'NBF', language: 'en', opt_in: true,
    }));
    expect(eng.chapters.map((c) => [c.number, c.title, Boolean(c.review)])).toEqual([[1, 'Time to Recall', false], ['R1', 'Review 1', true]]);
    const l = eng.chapters[0].lessons;
    expect(l.map((x) => [x.lesson_id, x.lp_type])).toEqual([
      ['gb_g1_english_ch1_seg1', 'content'], ['gb_g1_english_ch1_seg2', 'content'], ['gb_g1_english_ch1_seg995', 'assessment']]);
    expect(l[1].row.title).toBe('Phonics');
    expect(l[1].row.metadata).toContain('Read the alphabet Aa to Mm');
    expect(eng.chapters[1].lessons[0].lp_type).toBe('revision');

    const urdu = books.find((b) => b.stem === 'gb_g2_urdu');
    expect(urdu.rtl).toBe(true);
    expect(urdu.chapters[0]).toEqual(expect.objectContaining({ number: 101, title: 'جائزہ-۱', review: true }));
    expect(urdu.chapters[0].lessons[0].row.title.startsWith('‏')).toBe(true);
    // deterministic: same sheet, same JSON
    expect(JSON.stringify(Matrix.catalogBooks(m, GB))).toBe(JSON.stringify(books));
  });

  test("the region's book list: slice 1 is GB's own books, slice 2 is ICT's English-medium book", async () => {
    const m = await readMatrix({ english: englishRows() });
    const ict = [
      { stem: 'grade_1_general_knowledge_en', grade: 1, subject_key: 'general_knowledge' },
      { stem: 'grade_1_general_knowledge', grade: 1, subject_key: 'general_knowledge_ur' },
      { stem: 'grade_1_islamiat', grade: 1, subject_key: 'islamiat' },
      { stem: 'grade_4_social_studies_en', grade: 4, subject_key: 'social_studies_en' },
      { stem: 'grade_4_social_studies', grade: 4, subject_key: 'social_studies_ur' },
    ];
    expect(Matrix.bookKeys(m, GB, ict)).toEqual([
      'gb_g1_english', 'gb_g2_urdu', 'gb_g4_science',
      'grade_1_general_knowledge_en', 'grade_1_islamiat', 'grade_4_social_studies_en',
    ]);
  });

  // bd-qchgya (operator, 11 Nov): GB teaches ICT's Grade 6-10 books, all of them, and has no Grades 11-12.
  test("GB's list adds every ICT 6-12 book of Grades 6-10, and none of 11-12", async () => {
    expect(GB.ictGrades).toEqual([6, 7, 8, 9, 10]);
    const m = await readMatrix({ english: englishRows() });
    const ict612 = [
      { stem: 'grade_6_english', grade: 6 }, { stem: 'g7_physics', grade: 7 }, { stem: 'grade_10_english', grade: 10 },
      { stem: 'grade_11_physics', grade: 11 }, { stem: 'grade_12_physics', grade: 12 },
    ];
    expect(Matrix.bookKeys(m, GB, [], ict612)).toEqual([
      'gb_g1_english', 'gb_g2_urdu', 'gb_g4_science', 'grade_6_english', 'g7_physics', 'grade_10_english',
    ]);
    // A region config without ictGrades takes none of them.
    expect(Matrix.bookKeys(m, { ...GB, ictGrades: undefined }, [], ict612)).toEqual(['gb_g1_english', 'gb_g2_urdu', 'gb_g4_science']);
  });
});

describe('planning against what is on record', () => {
  test('first run: all new; second run: nothing; a re-rendered PDF: one changed; a gone id: reported, kept', async () => {
    const m1 = await readMatrix({ english: englishRows() });
    const p1 = Sync.plan(m1.items, []);
    expect(p1.counts).toEqual({ new: 5, changed: 0, unchanged: 0, removed: 0 });

    const onRecord = m1.items.map((i, n) => ({
      id: `row-${n}`, lesson_id: i.lesson_id, asset_kind: i.asset_kind, is_current: true,
      source_sha1: sha1(files.get(i.url)), content_hash: 'x', version_stamp: i.version_stamp,
    }));
    expect(Sync.plan(m1.items, onRecord).counts).toEqual({ new: 0, changed: 0, unchanged: 5, removed: 0 });

    const rows = englishRows();
    rows[0][5] = link('g1_ch1_English_seg1_v9_gbfix_6Nov.pdf', pdf('re-rendered'));
    const m2 = await readMatrix({ english: rows });
    const p2 = Sync.plan(m2.items, onRecord);
    expect(p2.counts).toEqual({ new: 0, changed: 1, unchanged: 4, removed: 0 });
    expect(p2.changed[0].lesson_id).toBe('gb_g1_english_ch1_seg1');

    const gone = [...onRecord, { id: 'old', lesson_id: 'gb_g1_english_ch9_seg1', asset_kind: 'lesson', is_current: true, source_sha1: 'abc' }];
    const p3 = Sync.plan(m1.items, gone);
    expect(p3.counts.removed).toBe(1);
    expect(p3.removed).toEqual([expect.objectContaining({ lesson_id: 'gb_g1_english_ch9_seg1' })]);
  });
});

describe('running it (in-memory DB and R2)', () => {
  const fakeFetch = async (url) => {
    if (!files.has(url)) return { ok: false, status: 404 };
    const b = files.get(url);
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  };
  const r2Store = new Map();
  const r2 = { uploadBuffer: async (buf, key) => { r2Store.set(key, buf); return key; } };

  test('commit writes R2 + niete_lp_assets; a re-run writes nothing; a change keeps the old version', async () => {
    const supabase = createMemorySupabase({ niete_lp_assets: [] });
    const deps = { supabase, r2, fetch: fakeFetch, log: () => {} };

    const m1 = await readMatrix({ english: englishRows() });
    const run1 = await Sync.execute(m1, { commit: true, deps });
    expect(run1.counts).toEqual(expect.objectContaining({ new: 5, changed: 0, written: 5, failed: 0 }));
    const rows1 = supabase._tables ? supabase._tables.niete_lp_assets : (await supabase.from('niete_lp_assets').select('*')).data;
    expect(rows1.filter((r) => r.is_current)).toHaveLength(5);
    expect(rows1.every((r) => r.catalog_version === 'v8' && r.r2_key.startsWith('lp-cache/v8/gb_'))).toBe(true);

    const run2 = await Sync.execute(m1, { commit: true, deps });
    expect(run2.counts).toEqual(expect.objectContaining({ new: 0, changed: 0, written: 0 }));

    const rows = englishRows();
    rows[0][5] = link('g1_ch1_English_seg1_v9_gbfix_6Nov.pdf', pdf('re-rendered'));
    const m2 = await readMatrix({ english: rows });
    const run3 = await Sync.execute(m2, { commit: true, deps });
    expect(run3.counts).toEqual(expect.objectContaining({ new: 0, changed: 1, written: 1 }));

    const all = (await supabase.from('niete_lp_assets').select('*').eq('lesson_id', 'gb_g1_english_ch1_seg1')).data;
    expect(all).toHaveLength(2);
    const old = all.find((r) => !r.is_current);
    expect(old.superseded_at).toBeTruthy();
    expect(r2Store.has(old.r2_key)).toBe(true);          // the old version is still downloadable
    expect(all.find((r) => r.is_current).version_stamp).toBe('gb_v9_gbfix_6Nov');
  });

  test('dry run (the default) downloads nothing and writes nothing', async () => {
    const supabase = createMemorySupabase({ niete_lp_assets: [] });
    const fetch = jest.fn(fakeFetch);
    const m = await readMatrix({ english: englishRows() });
    const run = await Sync.execute(m, { commit: false, deps: { supabase, r2, fetch, log: () => {} } });
    expect(run.counts.new).toBe(5);
    expect(fetch).not.toHaveBeenCalled();
    expect((await supabase.from('niete_lp_assets').select('*')).data).toHaveLength(0);
  });

  test("bytes that do not match the URL's hash are refused", async () => {
    const supabase = createMemorySupabase({ niete_lp_assets: [] });
    const m = await readMatrix({ english: englishRows() });
    const url = m.items[0].url;
    files.set(url, pdf('tampered'));
    const run = await Sync.execute(m, { commit: true, deps: { supabase, r2, fetch: fakeFetch, log: () => {} } });
    expect(run.counts.failed).toBe(1);
    expect(run.failed[0]).toEqual(expect.objectContaining({ lesson_id: m.items[0].lesson_id, error: expect.stringMatching(/hash/) }));
  });

  test('retire stops serving one lesson and nothing else', async () => {
    const supabase = createMemorySupabase({ niete_lp_assets: [] });
    const m = await readMatrix({ english: englishRows() });
    await Sync.execute(m, { commit: true, deps: { supabase, r2, fetch: fakeFetch, log: () => {} } });
    const r = await Sync.retire('gb_g1_english_ch1_seg995', { commit: true, deps: { supabase } });
    expect(r.retired).toBe(2); // the worksheet and its answer key
    const current = (await supabase.from('niete_lp_assets').select('*').eq('is_current', true)).data.map((x) => x.lesson_id);
    expect(current).not.toContain('gb_g1_english_ch1_seg995');
    expect(current).toHaveLength(3);
    await expect(Sync.retire('grade_1_english_ch1_seg1', { commit: true, deps: { supabase } })).rejects.toThrow(/gb_/);
  });
});

describe('the environment guard', () => {
  test('prod needs --prod-go with the operator\'s words; sandbox and staging do not', () => {
    expect(() => Sync.checkEnv({ env: 'prod', commit: true })).toThrow(/prod-go/);
    expect(() => Sync.checkEnv({ env: 'prod', commit: true, prodGo: '' })).toThrow(/prod-go/);
    expect(() => Sync.checkEnv({ env: 'prod', commit: true, prodGo: 'go, load GB on prod' })).not.toThrow();
    expect(() => Sync.checkEnv({ env: 'sandbox', commit: true })).not.toThrow();
    expect(() => Sync.checkEnv({ env: 'staging', commit: true })).not.toThrow();
    expect(() => Sync.checkEnv({ env: 'local', commit: true })).toThrow(/env/);
  });

  test('an env file pointing at another project is refused', () => {
    expect(() => Sync.assertProject('staging', 'https://olvritwoqujtjvwfulbh.supabase.co')).toThrow(/staging/);
    expect(() => Sync.assertProject('sandbox', 'https://olvritwoqujtjvwfulbh.supabase.co')).not.toThrow();
  });
});
