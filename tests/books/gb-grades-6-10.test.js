'use strict';
/**
 * bd-qchgya — GB gets Grades 6-10 lesson plans from ICT's 6-12 lane (operator, 11 Nov: "extend the existing 6-12
 * pipeline to GB, only in GB, we have till grades 10. Same books as ICT").
 *
 * No new flag: GB's book list (region_features.book_keys) is what says which grades she has. Once it names ICT's
 * Grade 6-10 books, the WhatsApp Flow and the portal offer those grades and hand her ICT's 6-12 catalogue. Grades
 * 11 and 12 are never on her list, so never offered. A GB list that stops at 5 behaves exactly as before.
 *
 * Real Flow endpoint, internal API routes and 6-12 catalogue/browse; faked: Supabase (in memory), WhatsApp, R2,
 * the logs, her curriculum + book list, and the Flow's 6-12 subject rows (all tested elsewhere; the in-memory
 * Supabase does not model the catalogue's `.or()` grade filter).
 */
const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocumentByLink: jest.fn(), sendDocument: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => k, getPresignedUrl: async (u) => u, headObject: async () => ({ exists: false }),
}));
jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: async () => new Set(), downloadedLessonIds: async () => new Set(),
}));

const KEY = 'internal-test-key';
process.env.INTERNAL_API_KEY = KEY;

const BookCurriculum = require('../../bot/shared/services/book-curriculum.service');
const TeacherBooks = require('../../bot/shared/services/teacher-books.service');
const Lp612Catalog = require('../../bot/shared/services/lp612-catalog.service');
const ep = require('../../bot/shared/routes/pakistan-lp-endpoint');
const router = require('../../bot/shared/routes/internal-api.routes');

// GB's Grades 1-5 list (cut down), and the same list once ICT's Grades 6-10 books are added to it.
const GB_K5 = ['gb_g1_english', 'gb_g2_urdu', 'grade_1_islamiat', 'grade_5_islamiat'];
const GB_610 = [...GB_K5, 'grade_6_english', 'g7_physics', 'grade_8_english', 'grade_9_biology', 'grade_10_english'];

const ictSeg = (grade, subject, stem) => ({
  segment_id: `${stem}.c01.s001`, curriculum: 'ict', is_current: true, grade, subject, chapter_number: 1,
  chapter_key: 'c01', chapter_title: 'Unit 1', subtopic_title: 'Reading', menu_title: 'Reading', order_index: 1,
  language: 'en', is_religious: false, book_stem: stem,
});

let keysFor;
const ENV_KEYS = ['LP_612_ENABLED', 'LP_GB_K5_ENABLED', 'LP_612_ROUTE_ALL', 'LP_612_ROUTE_K5'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.LP_612_ENABLED = 'true';
  process.env.LP_GB_K5_ENABLED = 'true';
  delete process.env.LP_612_ROUTE_ALL;
  delete process.env.LP_612_ROUTE_K5;
  keysFor = { gb: GB_610, ict: null };
  jest.spyOn(BookCurriculum, 'curriculumForUser').mockImplementation(async (id) => (id === 'gb' ? 'nbf_snc' : 'ict'));
  jest.spyOn(TeacherBooks, 'bookKeysForUser').mockImplementation(async (id) => keysFor[id] ?? null);
  jest.spyOn(Lp612Catalog, 'buildSubjectItems').mockImplementation(async (grade) => (Number(grade) === 7
    ? [{ id: 'Physics', 'main-content': { title: 'Physics' }, 'on-click-action': { payload: { step: 'lp612_subject' } } }]
    : []));
  mockDb.reset({
    users: [
      { id: 'gb', region: 'Gilgit-Baltistan', preferred_language: 'en' },
      { id: 'ict', region: 'Sihala', preferred_language: 'en' },
    ],
    niete_lp612_segments: [
      ictSeg(6, 'English', 'grade_6_english'),
      ictSeg(7, 'Physics', 'g7_physics'),
      ictSeg(9, 'Biology', 'grade_9_biology'),
      ictSeg(11, 'Physics', 'grade_11_physics'),
      ictSeg(12, 'Physics', 'grade_12_physics'),
    ],
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  jest.restoreAllMocks();
});

const init = (user) => ep.handlePakistanLpInit(`${user}:pakistan-lp:1`);
const pick = (user, grade) => ep.handlePakistanLpDataExchange(`${user}:pakistan-lp:1`, 'SELECT_GRADE', { step: 'grade', grade: String(grade) });
const gradesOf = (res) => res.data.items.map((i) => Number(i.id));

describe('the WhatsApp lesson-plan Flow, for a GB teacher', () => {
  test('her grade picker runs 1-10 once her list names Grades 6-10, never 11 or 12', async () => {
    expect(gradesOf(await init('gb'))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('a GB list that stops at 5 keeps the Grades 1-5 picker', async () => {
    keysFor.gb = GB_K5;
    expect(gradesOf(await init('gb'))).toEqual([1, 2, 3, 4, 5]);
  });

  test("Grade 7 opens ICT's 6-12 subjects, with no GB-only or not-available message", async () => {
    const res = await pick('gb', 7);
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.items.map((i) => i.id)).toEqual(['Physics']);
    // Her curriculum is passed on: the catalogue gives her GB's book where it has one, ICT's otherwise.
    expect(Lp612Catalog.buildSubjectItems).toHaveBeenCalledWith(7, { curriculum: 'nbf_snc' });
  });

  test('Grade 11 is refused: her list does not cover it', async () => {
    const res = await pick('gb', 11);
    expect(res.data.error.message).toBe(TeacherBooks.gradeNotCoveredMessage('lp', 11, 'en'));
  });

  test('a covered grade with no 6-12 lessons yet says so, and never falls back to the old Oxbridge picker', async () => {
    const res = await pick('gb', 8);
    expect(res.screen).toBeUndefined();
    expect(res.data.error.message).toMatch(/Grade 8/);
  });

  test('with the 6-12 lane switched off, Grades 6-10 stay closed to her', async () => {
    process.env.LP_612_ENABLED = 'false';
    expect(gradesOf(await init('gb'))).toEqual([1, 2, 3, 4, 5]);
    expect((await pick('gb', 7)).data.error).toBeTruthy();
  });

  test('an ICT teacher keeps the 1-10 picker plus the 6-12 extras, unchanged', async () => {
    expect(gradesOf(await init('ict'))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

function findRoute(method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`route ${method.toUpperCase()} ${path} not found`);
}
async function call(path, body) {
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path };
  let payload = null;
  const res = { status() { return this; }, json(b) { payload = b; return this; } };
  for (const handler of findRoute('post', path)) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return payload;
}

describe('the portal 6-12 grade list', () => {
  const grades = (p) => p.grades.map((g) => Number(g.grade ?? g));

  test('a GB teacher sees only the grades her list covers: never 11 or 12', async () => {
    expect(grades(await call('/lp612/grades', { userId: 'gb' }))).toEqual([6, 7, 9]);
  });

  test('an ICT teacher sees every grade with lessons, as before', async () => {
    expect(grades(await call('/lp612/grades', { userId: 'ict' }))).toEqual([6, 7, 9, 11, 12]);
  });
});
