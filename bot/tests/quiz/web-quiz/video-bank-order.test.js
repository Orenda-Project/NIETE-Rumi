'use strict';
/**
 * The video bank's one order (grade, subject, chapter, title), shared by the WhatsApp
 * Student Videos Flow and the web library. These tests pin TODAY's order — the one the
 * Flow has always shown — so moving it into a shared module changes nothing.
 *
 * Documented quirks of today's order (kept on purpose, not "fixed"):
 *   - chapters and titles compare as lower-cased TEXT, so "Chapter 10" sorts before
 *     "Chapter 2" (the bank has no chapter number column to sort by);
 *   - subjects compare by code unit (Array#sort's default), so "General Knowledge"
 *     sorts before "Geography" ('n' < 'o') and upper case before lower case;
 *   - an unknown grade sorts after 6.
 */
const Order = require('../../../shared/services/quiz/video-bank-order');

// The Flow's comparator exactly as it stood inline in student-videos-endpoint.js
// before the extraction (the reference this module must match).
function oldVideoSort(a, b) {
  const ac = (a.clean_chapter || '').toLowerCase();
  const bc = (b.clean_chapter || '').toLowerCase();
  if (ac !== bc) return ac < bc ? -1 : 1;
  const at = (a.clean_title || '').toLowerCase();
  const bt = (b.clean_title || '').toLowerCase();
  return at < bt ? -1 : at > bt ? 1 : 0;
}

const ROWS = [
  { id: 'a', clean_chapter: 'Chapter 2', clean_title: 'Adding' },
  { id: 'b', clean_chapter: 'Chapter 10', clean_title: 'Zebra sums' },
  { id: 'c', clean_chapter: 'chapter 10', clean_title: 'apples' },
  { id: 'd', clean_chapter: null, clean_title: 'No chapter' },
  { id: 'e', clean_chapter: 'Fractions', clean_title: 'Halves' },
  { id: 'f', clean_chapter: 'Fractions', clean_title: 'halves' },
  { id: 'g', clean_chapter: 'Fractions', clean_title: null },
  { id: 'h', clean_chapter: 'Numbers', clean_title: 'Counting to 10' },
  { id: 'i', clean_chapter: 'Numbers', clean_title: 'Counting to 2' },
];

describe('video-bank-order', () => {
  test('grades: NURSERY, KG, 1…6, then anything else', () => {
    expect(Order.GRADE_ORDER).toEqual(['NURSERY', 'KG', '1', '2', '3', '4', '5', '6']);
    const gs = ['6', 'KG', '3', 'X', 'NURSERY', '1', 6, '10'];
    expect(gs.slice().sort((a, b) => Order.gradeRank(a) - Order.gradeRank(b)).map(String))
      .toEqual(['NURSERY', 'KG', '1', '3', '6', '6', 'X', '10']);
    expect(Order.gradeRank('7')).toBe(99);
    expect(Order.gradeRank(3)).toBe(4);
  });

  test('subjects: the Flow\'s Array#sort order (code units)', () => {
    const ss = ['Urdu', 'Science', 'General Knowledge', 'Geography', 'English', 'Maths', 'History', 'Islamic Studies', 'art'];
    expect(ss.slice().sort(Order.compareSubjects)).toEqual(ss.slice().sort());
    expect(ss.slice().sort(Order.compareSubjects)).toEqual(
      ['English', 'General Knowledge', 'Geography', 'History', 'Islamic Studies', 'Maths', 'Science', 'Urdu', 'art']);
  });

  test('videos: identical to the Flow\'s old inline comparator, "Chapter 10" before "Chapter 2"', () => {
    const want = ROWS.slice().sort(oldVideoSort).map((r) => r.id);
    const got = ROWS.slice().sort(Order.compareVideos).map((r) => r.id);
    expect(got).toEqual(want);
    expect(got.indexOf('b')).toBeLessThan(got.indexOf('a'));
    expect(got[0]).toBe('d');                      // no chapter first ('' sorts first)
    expect(got.indexOf('h')).toBeLessThan(got.indexOf('i')); // "counting to 10" < "counting to 2"
  });

  test('the Flow\'s SELECT_TOPIC list keeps today\'s order (endpoint uses the shared comparator)', async () => {
    jest.resetModules();
    const rows = ROWS.map((r) => ({ ...r, grade: '3', subject: 'Maths', r2_url: 'x' }));
    const q = { select: () => q, eq: () => q, is: () => q, then: (res) => res({ data: rows.map((r) => ({ ...r })), error: null }) };
    jest.doMock('../../../shared/config/supabase', () => ({ from: () => q }));
    const ep = require('../../../shared/routes/student-videos-endpoint');
    const out = await ep.handleStudentVideosDataExchange('u:student-videos:1', 'SELECT_SUBJECT', { grade: '3', subject: 'Maths' });
    expect(out.data.videos.map((v) => v.id)).toEqual(ROWS.slice().sort(oldVideoSort).map((r) => r.id));
  });
});
