'use strict';
/**
 * GB follows ICT 6-12 (queue #71, operator 9 Nov: "GB should follow the currently ict 6-12 one ... pre-gen if
 * available if not then gen it JIT").
 *
 * Prod, 9 Nov, as the operator's GB account: the app listed only the 838 GB lessons already written (of ~2,712),
 * Grade 3 was empty, GK/SST/Islamiat and Grades 6-12 were missing, and Digital Coaching could not start for G3 or
 * G6+. Here a GB teacher's shelf lists EVERY lesson of her GB books — a written one opens at once, an unwritten one
 * is written on her tap through the 6-12 request/status pair (GB's own gb_lp_author job, GB's own rows) — plus
 * ICT's books where GB has none: GK/SST/Islamiat in Grades 1-5 (ICT's K-5 catalogue) and all of Grades 6-12
 * (ICT's lp612 lane, #4091). ICT teachers are untouched.
 *
 * Real routes, real GB browse and serving; faked: Supabase (in memory), R2 signing, the queue, WhatsApp, the logs,
 * and the teacher's curriculum/book list (their own services, tested elsewhere).
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockQueueJob = jest.fn(async () => ({ messageId: 'm-1' }));
const mockSendMessage = jest.fn(async () => true);
jest.mock('../../bot/shared/config/supabase', () => mockDb);
// Which books have their page text in R2 (lp612/page-truth/<book_stem>/_book.json): only those can be written.
const mockPageTruth = new Set();
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://s3.example/bucket/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
  headObject: jest.fn(async (k) => ({ exists: mockPageTruth.has(k) })),
}));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: (...a) => mockQueueJob(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a), sendDocument: jest.fn(), sendDocumentByLink: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), getCurrentCorrelationId: () => undefined,
}));

const KEY = 'internal-test-key';
process.env.INTERNAL_API_KEY = KEY;

const BookCurriculum = require('../../bot/shared/services/book-curriculum.service');
const TeacherBooks = require('../../bot/shared/services/teacher-books.service');
const V8Browse = require('../../bot/shared/services/lp-v8-browse.service');
const router = require('../../bot/shared/routes/internal-api.routes');

const GB = 'gb-teacher';
const ICT = 'ict-teacher';
const TV = 'gb_k5_v10';
// Her region's list: GB's own NBF books plus ICT's English GK and Islamiat (the 27-key shape, cut down).
const GB_KEYS = ['gb_g2_english', 'gb_g2_urdu', 'gb_g3_maths', 'grade_2_general_knowledge_en', 'grade_2_islamiat'];
const ICT_FALLBACK = ['grade_2_general_knowledge_en', 'grade_2_islamiat'];

const seg = (grade, subject, ch, s, extra = {}) => ({
  segment_id: `nbf_snc_grade_${grade}_${subject}.c${String(ch).padStart(2, '0')}.s${String(s).padStart(3, '0')}`,
  curriculum: 'nbf_snc', is_current: true, grade, subject, chapter_number: ch, chapter_key: `c${ch}`,
  chapter_title: `Chapter ${ch}`, subtopic_title: `Topic ${s}`, menu_title: `Menu ${s}`, order_index: s,
  printed_page_start: 10 + s, printed_page_end: 10 + s, language: subject === 'urdu' ? 'ur' : 'en',
  is_religious: false, book_stem: `nbf_snc_grade_${grade}_${subject}`, ...extra,
});
const render = (segment, lang, extra = {}) => ({
  id: `r-${segment.segment_id}`, segment_id: segment.segment_id, lang, template_version: TV, status: 'ready',
  r2_key: `gb-lp/${TV}/${lang}/${segment.segment_id}.pdf`, waiters: [], ...extra,
});

const U1 = seg(2, 'urdu', 6, 1); // written
const U2 = seg(2, 'urdu', 6, 2); // not written yet
const E1 = seg(2, 'english', 1, 1); // not written yet
const M3 = seg(3, 'maths', 1, 1); // Grade 3: nothing written (prod, 9 Nov)

function findRoute(method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`route ${method.toUpperCase()} ${path} not found`);
}
async function call(path, body) {
  const stack = findRoute('post', path);
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const ENV_KEYS = ['LP_GB_K5_ENABLED', 'LP_GB_AUTHOR_ENABLED', 'LP_GB_TEMPLATE_VERSION', 'LP_LIFECYCLE_PATHS', 'LP_612_ENABLED'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.LP_GB_K5_ENABLED = 'true';
  process.env.LP_GB_AUTHOR_ENABLED = 'true';
  process.env.LP_GB_TEMPLATE_VERSION = TV;
  process.env.LP_612_ENABLED = 'true';
  delete process.env.LP_LIFECYCLE_PATHS;
  mockQueueJob.mockClear();
  mockSendMessage.mockClear();
  mockPageTruth.clear();
  ['nbf_snc_grade_2_urdu', 'nbf_snc_grade_2_english', 'nbf_snc_grade_3_maths']
    .forEach((b) => mockPageTruth.add(`lp612/page-truth/${b}/_book.json`));
  require('../../bot/shared/services/lp612-pagetruth.service').resetBookCache();
  jest.spyOn(BookCurriculum, 'curriculumForUser').mockImplementation(async (id) => (id === GB ? 'nbf_snc' : 'ict'));
  jest.spyOn(TeacherBooks, 'bookKeysForUser').mockImplementation(async (id) => (id === GB ? GB_KEYS : null));
  jest.spyOn(V8Browse, 'listGrades').mockResolvedValue([{ grade: 2, subject_count: 2 }]);
  jest.spyOn(V8Browse, 'listSubjects').mockResolvedValue([
    { subject_key: 'general_knowledge', subject: 'General Knowledge', rtl: false, lesson_count: 30 },
    { subject_key: 'islamiat', subject: 'Islamiat', rtl: true, lesson_count: 20 },
  ]);
  jest.spyOn(V8Browse, 'listChapters').mockResolvedValue([{ chapter_number: 1, chapter_title: 'GK 1', lesson_count: 3 }]);
  jest.spyOn(V8Browse, 'listLessons').mockResolvedValue([{ lesson_id: 'grade_2_general_knowledge_en_ch1_seg1' }]);
  mockDb.reset({
    niete_lp612_segments: [
      U1, U2, E1, M3,
      // ICT's Grade 6 English: what a GB Grade 6 teacher is handed (GB has no Grade 6 book).
      {
        segment_id: 'g6_english.c01.s001', curriculum: 'ict', is_current: true, grade: 6, subject: 'English',
        chapter_number: 1, chapter_key: 'c01', chapter_title: 'Unit 1', subtopic_title: 'Reading', menu_title: 'Reading',
        order_index: 1, language: 'en', is_religious: false,
      },
    ],
    niete_gb_lp_renders: [render(U1, 'ur')],
    niete_lp612_renders: [],
    users: [{ id: GB, region: 'Gilgit-Baltistan', phone_number: '920000000001' }, { id: ICT, region: 'Sihala' }],
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  jest.restoreAllMocks();
});

describe("a GB teacher's Grades 1-5 shelf lists every lesson of her books", () => {
  test('grades: a grade with nothing written yet (Grade 3) is on her shelf', async () => {
    const { payload } = await call('/lp/v8/grades', { userId: GB });
    expect(payload.grades.map((g) => g.grade)).toEqual([2, 3]);
  });

  test("subjects: her GB books count every lesson, and ICT's GK and Islamiat follow", async () => {
    const { payload } = await call('/lp/v8/subjects', { userId: GB, grade: 2 });
    expect(payload.subjects).toEqual([
      { subject_key: 'english', subject: 'English', rtl: false, lesson_count: 1 },
      { subject_key: 'urdu', subject: 'Urdu', rtl: true, lesson_count: 2 },
      { subject_key: 'general_knowledge', subject: 'General Knowledge', rtl: false, lesson_count: 30 },
      { subject_key: 'islamiat', subject: 'Islamiat', rtl: true, lesson_count: 20 },
    ]);
    // ICT's catalogue is asked with ICT's books only, never GB's own (no second English from the old v9 PDFs).
    expect(V8Browse.listSubjects).toHaveBeenCalledWith(2, ICT_FALLBACK);
  });

  test('lessons: written and unwritten, each saying which', async () => {
    const { payload } = await call('/lp/v8/lessons', { userId: GB, grade: 2, subjectKey: 'urdu', chapterNumber: 6 });
    expect(payload.lessons.map((l) => [l.lesson_id, l.ready])).toEqual([[U1.segment_id, true], [U2.segment_id, false]]);
    // Every GB lesson is served through the 6-12 request/status pair in the app, written or not.
    expect(payload.lessons.every((l) => l.on_request === true)).toBe(true);
  });

  test("an ICT book's chapters and lessons come from ICT's catalogue, with ICT's books only", async () => {
    const ch = await call('/lp/v8/chapters', { userId: GB, grade: 2, subjectKey: 'general_knowledge' });
    expect(ch.payload.chapters).toEqual([{ chapter_number: 1, chapter_title: 'GK 1', lesson_count: 3 }]);
    expect(V8Browse.listChapters).toHaveBeenCalledWith(2, 'general_knowledge', ICT_FALLBACK);
    const ls = await call('/lp/v8/lessons', { userId: GB, grade: 2, subjectKey: 'general_knowledge', chapterNumber: 1 });
    expect(ls.payload.lessons).toEqual([{ lesson_id: 'grade_2_general_knowledge_en_ch1_seg1' }]);
    expect(V8Browse.listLessons).toHaveBeenCalledWith(2, 'general_knowledge', 1, GB, ICT_FALLBACK);
  });

  test("a book whose page text is not loaded lists only its written lessons (an unwritten one could not be written)", async () => {
    mockPageTruth.delete('lp612/page-truth/nbf_snc_grade_2_urdu/_book.json');
    require('../../bot/shared/services/lp612-pagetruth.service').resetBookCache();
    const ls = await call('/lp/v8/lessons', { userId: GB, grade: 2, subjectKey: 'urdu', chapterNumber: 6 });
    expect(ls.payload.lessons.map((l) => [l.lesson_id, l.ready])).toEqual([[U1.segment_id, true]]);
    mockPageTruth.delete('lp612/page-truth/nbf_snc_grade_3_maths/_book.json');
    require('../../bot/shared/services/lp612-pagetruth.service').resetBookCache();
    const g = await call('/lp/v8/grades', { userId: GB });
    expect(g.payload.grades.map((x) => x.grade)).toEqual([2]);
  });

  test('writing switched off (LP_GB_AUTHOR_ENABLED): only written lessons are listed, as before', async () => {
    process.env.LP_GB_AUTHOR_ENABLED = 'false';
    const ls = await call('/lp/v8/lessons', { userId: GB, grade: 2, subjectKey: 'urdu', chapterNumber: 6 });
    expect(ls.payload.lessons.map((l) => l.lesson_id)).toEqual([U1.segment_id]);
    const g = await call('/lp/v8/grades', { userId: GB });
    expect(g.payload.grades.map((x) => x.grade)).toEqual([2]);
  });
});

describe('an unwritten GB lesson is written on her tap in the app, like an ICT 6-12 one', () => {
  test('request: 202 authoring with a render id; GB row claimed, gb_lp_author queued, nothing sent', async () => {
    const { statusCode, payload } = await call('/lp612/request', { segmentId: U2.segment_id, userId: GB });
    expect(statusCode).toBe(202);
    expect(payload).toMatchObject({ success: true, state: 'authoring' });
    expect(payload.renderId).toBeTruthy();
    const row = mockDb.tables.niete_gb_lp_renders.find((r) => r.segment_id === U2.segment_id);
    expect(row).toMatchObject({ id: payload.renderId, status: 'authoring', lang: 'ur', template_version: TV, requested_by: GB });
    expect(mockQueueJob).toHaveBeenCalledWith(U2.segment_id, 'gb_lp_author', expect.objectContaining({ renderId: payload.renderId }), expect.anything());
    expect(mockDb.tables.niete_lp612_renders).toEqual([]);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('request on a written lesson: 202 ready with its render id, nothing queued or sent', async () => {
    const { statusCode, payload } = await call('/lp612/request', { segmentId: U1.segment_id, userId: GB });
    expect(statusCode).toBe(202);
    expect(payload).toMatchObject({ success: true, state: 'ready', renderId: `r-${U1.segment_id}` });
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('status: a GB render is answered to a GB teacher (ready → presigned url), never to an ICT one', async () => {
    const ok = await call('/lp612/status', { renderId: `r-${U1.segment_id}`, userId: GB });
    expect(ok.payload).toMatchObject({
      success: true, state: 'ready', segmentId: U1.segment_id, lang: 'ur',
      url: `https://s3.example/bucket/gb-lp/${TV}/ur/${U1.segment_id}.pdf?sig=1`,
    });
    const no = await call('/lp612/status', { renderId: `r-${U1.segment_id}`, userId: ICT });
    expect(no.statusCode).toBe(404);
  });

  test('status while it is being written: authoring', async () => {
    const req = await call('/lp612/request', { segmentId: U2.segment_id, userId: GB });
    const { payload } = await call('/lp612/status', { renderId: req.payload.renderId, userId: GB });
    expect(payload).toMatchObject({ success: true, state: 'authoring', segmentId: U2.segment_id });
  });

  test('writing switched off: a tap on an unwritten lesson is "not available yet" (403), not a render-less 202', async () => {
    process.env.LP_GB_AUTHOR_ENABLED = 'false';
    const { statusCode } = await call('/lp612/request', { segmentId: U2.segment_id, userId: GB });
    expect(statusCode).toBe(403);
    expect(mockQueueJob).not.toHaveBeenCalled();
  });
});

describe("Grades 6-12: a GB teacher gets ICT's 6-12 shelf (GB has no 6-12 book)", () => {
  // bd-qchgya — her book list decides which 6-12 grades she sees, so this list names ICT's Grade 6 book.
  test('grades and subjects are ICT\'s, not empty', async () => {
    TeacherBooks.bookKeysForUser.mockImplementation(async (id) => (id === GB ? [...GB_KEYS, 'grade_6_english'] : null));
    const g = await call('/lp612/grades', { userId: GB });
    expect(g.payload.grades.map((x) => x.grade)).toContain(6);
    const s = await call('/lp612/subjects', { userId: GB, grade: 6 });
    expect(s.payload.subjects.map((x) => x.subject)).toEqual(['English']);
  });
});

describe('ICT teachers are untouched', () => {
  test("an ICT teacher's K-5 shelf is ICT's catalogue, called exactly as before", async () => {
    await call('/lp/v8/subjects', { userId: ICT, grade: 2 });
    expect(V8Browse.listSubjects).toHaveBeenCalledWith(2);
  });
});
