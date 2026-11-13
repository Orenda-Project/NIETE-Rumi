'use strict';
/**
 * bd-la9f5e — GB Grades 6-10 offer only the ICT books on GB's list (operator, 11 Nov: "no tarjuma and no zarai
 * taleem needed in GB"). Before this, a covered grade offered every ICT subject in it, so dropping a book from
 * the list hid nothing. Now: the sync leaves Zarai Taleem off the list, and the WhatsApp subject menu, the portal
 * subject list and the paper menu each offer a Grade 6+ ICT book only when her list names it.
 * No list (ICT teachers): every subject, exactly as before.
 */

let mockTable = [];
function mockBuilder() {
  const api = {
    select: () => api, eq: (c, v) => { api.f.push([c, v]); return api; }, or: () => api, in: () => api,
    gte: () => api, lte: () => api, order: () => api, f: [],
    rows: () => mockTable.filter((r) => api.f.every(([c, v]) => c === 'curriculum' || r[c] === v)),
    limit: () => Promise.resolve({ data: api.rows(), error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    range: (a, b) => Promise.resolve({ data: api.rows().slice(a, b + 1), error: null }),
  };
  return api;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const TeacherBooks = require('../../bot/shared/services/teacher-books.service');
const Catalog = require('../../bot/shared/services/lp612-catalog.service');
const Browse = require('../../bot/shared/services/lp612-browse.service');
const Matrix = require('../../bot/scripts/sheet-lps/matrix');
const gb = require('../../bot/scripts/sheet-lps/gb.config');

const row = (subject, stem) => ({
  grade: 6, subject, book_stem: stem, chapter_key: 'c01', language: 'en', curriculum: 'ict',
  is_current: true, is_religious: false,
});
const G6 = [row('English', 'grade_6_english'), row('Zarai Taleem', 'grade_6_zari_taleem')];
const LIST = ['gb_g5_maths', 'grade_6_english'];

beforeEach(() => { mockTable = G6; });

test('the sync leaves Zarai Taleem off GB\'s list', () => {
  const m = { books: [] };
  const ict612 = [{ stem: 'grade_6_english', grade: 6 }, { stem: 'grade_6_zari_taleem', grade: 6 },
    { stem: 'grade_7_zari_taleem', grade: 7 }];
  expect(Matrix.bookKeys(m, gb, [], ict612)).toEqual(['grade_6_english']);
});

test('upperBookOffered: Grade 6+ ICT book only when listed; own-curriculum books, G1-5 and no list pass', () => {
  expect(TeacherBooks.upperBookOffered(6, 'grade_6_zari_taleem', LIST)).toBe(false);
  expect(TeacherBooks.upperBookOffered(6, 'grade_6_english', LIST)).toBe(true);
  expect(TeacherBooks.upperBookOffered(9, 'nbf_snc_grade_9_chemistry', LIST)).toBe(true);
  expect(TeacherBooks.upperBookOffered(4, 'grade_4_urdu', LIST)).toBe(true);
  expect(TeacherBooks.upperBookOffered(6, 'grade_6_zari_taleem', null)).toBe(true);
});

test('the paper menu drops a Grade 6 subject whose book is not on her list', () => {
  expect(TeacherBooks.assessmentOffered(6, 'zarai_taleem', LIST)).toBe(false);
  expect(TeacherBooks.assessmentOffered(6, 'english', LIST)).toBe(true);
  expect(TeacherBooks.assessmentOffered(6, 'zarai_taleem', null)).toBe(true);
});

test('the WhatsApp subject menu drops it', async () => {
  const ids = async (o) => (await Catalog.buildSubjectItems(6, o)).map((i) => i.id);
  expect(await ids({ curriculum: 'nbf_snc', bookKeys: LIST })).toEqual(['English']);
  expect((await ids()).sort()).toEqual(['English', 'Zarai Taleem']);
});

test('the portal subject list drops it', async () => {
  const subs = async (o) => (await Browse.listSubjects(6, o)).map((s) => s.subject);
  expect(await subs({ curriculum: 'nbf_snc', bookKeys: LIST })).toEqual(['English']);
  expect((await subs()).sort()).toEqual(['English', 'Zarai Taleem']);
});
