'use strict';
/**
 * A GB teacher in the portal/app reads the GB K-5 lane, not the old v9 catalogue.
 *
 * Staging, 6 Nov: a GB teacher opened G2 Urdu ch6 in the app and was served v9 from lp-cache/v8 — the
 * portal routes only ever read lp-v8-browse. With LP_GB_K5_ENABLED on, /api/internal/lp/v8/* answer a GB
 * teacher from niete_lp612_segments (nbf_snc) ∩ ready niete_gb_lp_renders at the current GB template
 * version, in the same shapes. Flag off, or an ICT teacher: today's catalogue, untouched.
 *
 * Driven through the REAL routes and the REAL GB browse service; faked: Supabase (in memory), R2 signing,
 * the log sinks, and the teacher's curriculum/book list (their own services, tested elsewhere).
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://s3.example/bucket/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
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

const seg = (subject, ch, s, extra = {}) => ({
  segment_id: `nbf_snc_grade_2_${subject}.c${String(ch).padStart(2, '0')}.s${String(s).padStart(3, '0')}`,
  curriculum: 'nbf_snc', is_current: true, grade: 2, subject, chapter_number: ch, chapter_key: `c${ch}`,
  chapter_title: `Chapter ${ch}`, subtopic_title: `Topic ${s}`, menu_title: `Menu ${s}`, order_index: s,
  printed_page_start: 10 + s, printed_page_end: 10 + s, language: subject === 'english' ? 'en' : 'ur', ...extra,
});
const render = (segment, lang, extra = {}) => ({
  id: `r-${segment.segment_id}`, segment_id: segment.segment_id, lang, template_version: TV, status: 'ready',
  r2_key: `gb-lp/${TV}/${lang}/${segment.segment_id}.pdf`, ...extra,
});

const U1 = seg('urdu', 6, 1);
const U2 = seg('urdu', 6, 2);
const U3 = seg('urdu', 6, 3); // not built yet
const E1 = seg('english', 1, 1);
const GK = seg('gk', 1, 1); // not an on-request book: never listed

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

const ENV_KEYS = ['LP_GB_K5_ENABLED', 'LP_GB_TEMPLATE_VERSION', 'LP_LIFECYCLE_PATHS'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.LP_GB_K5_ENABLED = 'true';
  process.env.LP_GB_TEMPLATE_VERSION = TV;
  delete process.env.LP_LIFECYCLE_PATHS;
  jest.spyOn(BookCurriculum, 'curriculumForUser').mockImplementation(async (id) => (id === GB ? 'nbf_snc' : 'ict'));
  jest.spyOn(TeacherBooks, 'bookKeysForUser').mockResolvedValue(null);
  mockDb.reset({
    niete_lp612_segments: [U1, U2, U3, E1, GK, { ...seg('urdu', 6, 9), is_current: false }],
    niete_gb_lp_renders: [
      render(U1, 'ur'), render(U2, 'ur'), render(E1, 'en'), render(GK, 'ur'),
      render(U3, 'ur', { status: 'authoring', r2_key: null }),
      render(U2, 'ur', { id: 'old', template_version: 'gb_k5_v9', r2_key: `gb-lp/gb_k5_v9/ur/${U2.segment_id}.pdf` }),
    ],
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  jest.restoreAllMocks();
});

describe('a GB teacher, flag on', () => {
  test('grades: only grades with a ready plan', async () => {
    const { payload } = await call('/lp/v8/grades', { userId: GB });
    expect(payload).toEqual({ success: true, grades: [{ grade: 2, subject_count: 2 }] });
  });

  test('subjects: on-request books with a ready plan, in menu order', async () => {
    const { payload } = await call('/lp/v8/subjects', { userId: GB, grade: 2 });
    expect(payload.subjects).toEqual([
      { subject_key: 'english', subject: 'English', rtl: false, lesson_count: 1 },
      { subject_key: 'urdu', subject: 'Urdu', rtl: true, lesson_count: 2 },
    ]);
  });

  test('subjects honour the region book list', async () => {
    TeacherBooks.bookKeysForUser.mockResolvedValue(['gb_g2_urdu']);
    const { payload } = await call('/lp/v8/subjects', { userId: GB, grade: 2 });
    expect(payload.subjects.map((s) => s.subject_key)).toEqual(['urdu']);
  });

  test('chapters and lessons: ready v10 renders only', async () => {
    const ch = await call('/lp/v8/chapters', { userId: GB, grade: 2, subjectKey: 'urdu' });
    expect(ch.payload.chapters).toEqual([
      { chapter_number: 6, chapter_title: 'Chapter 6', pages_label: 'p.11-12', lesson_count: 2 },
    ]);
    const ls = await call('/lp/v8/lessons', { userId: GB, grade: 2, subjectKey: 'urdu', chapterNumber: 6 });
    expect(ls.payload.lessons.map((l) => l.lesson_id)).toEqual([U1.segment_id, U2.segment_id]);
    expect(ls.payload.lessons[0]).toMatchObject({ segment_index: 1, topic: 'Menu 1', pages_label: 'p.11', downloaded: false });
  });

  test('pdf: the v10 render, presigned', async () => {
    const { payload } = await call('/lp/v8/pdf', { userId: GB, lessonId: U2.segment_id });
    expect(payload).toEqual({
      success: true, available: true, asset_kind: 'lesson', version_stamp: TV,
      url: `https://s3.example/bucket/gb-lp/${TV}/ur/${U2.segment_id}.pdf?sig=1`,
    });
  });

  test('pdf: an unbuilt lesson or an answer key is not available', async () => {
    expect((await call('/lp/v8/pdf', { userId: GB, lessonId: U3.segment_id })).payload).toEqual({ success: true, available: false });
    expect((await call('/lp/v8/pdf', { userId: GB, lessonId: U1.segment_id, assetKind: 'answer_key' })).payload)
      .toEqual({ success: true, available: false });
  });
});

describe('everyone else is untouched', () => {
  test('an ICT teacher gets the v8 catalogue', async () => {
    const spy = jest.spyOn(V8Browse, 'listSubjects').mockResolvedValue(['v8']);
    const { payload } = await call('/lp/v8/subjects', { userId: ICT, grade: 2 });
    expect(payload.subjects).toEqual(['v8']);
    expect(spy).toHaveBeenCalled();
  });

  test('flag off: a GB teacher gets the v8 catalogue, and no curriculum lookup', async () => {
    process.env.LP_GB_K5_ENABLED = 'false';
    jest.spyOn(V8Browse, 'listSubjects').mockResolvedValue(['v8']);
    const { payload } = await call('/lp/v8/subjects', { userId: GB, grade: 2 });
    expect(payload.subjects).toEqual(['v8']);
    expect(BookCurriculum.curriculumForUser).not.toHaveBeenCalled();
  });

  test('an old v8 lesson id still goes to the v8 catalogue', async () => {
    const spy = jest.spyOn(V8Browse, 'lessonPdfUrl').mockResolvedValue(null);
    await call('/lp/v8/pdf', { userId: GB, lessonId: 'grade_2_urdu_ch6_seg3' });
    expect(spy).toHaveBeenCalledWith('grade_2_urdu_ch6_seg3', 'lesson', GB, { reader: null });
  });
});
