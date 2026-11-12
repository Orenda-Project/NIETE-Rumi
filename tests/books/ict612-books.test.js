'use strict';
/**
 * bd-qchgya — `sync-sheet-lps --books` adds ICT's current Grade 6-10 books to GB's list. This reads them from
 * niete_lp612_segments: current ICT rows only, one entry per book stem, only the grades asked for.
 */
const { createMemorySupabase } = require('../fixtures/memory-supabase');
const { ict612Books } = require('../../bot/scripts/sheet-lps/ict612-books');

const seg = (grade, stem, extra = {}) => ({ segment_id: `${stem}.${Math.random()}`, curriculum: 'ict', is_current: true, grade, book_stem: stem, ...extra });

test("ICT's current 6-12 books, one per stem, only the grades asked for", async () => {
  const db = createMemorySupabase();
  db.reset({
    niete_lp612_segments: [
      seg(6, 'grade_6_english'), seg(6, 'grade_6_english'),
      seg(7, 'g7_physics'),
      seg(8, 'grade_8_old', { is_current: false }),
      seg(9, 'gb_g9_biology', { curriculum: 'nbf_snc' }),
      seg(10, 'grade_10_english'),
      seg(11, 'grade_11_physics'),
    ],
  });
  const books = await ict612Books(db, [6, 7, 8, 9, 10]);
  expect(books.map((b) => b.stem).sort()).toEqual(['g7_physics', 'grade_10_english', 'grade_6_english']);
  expect(books.find((b) => b.stem === 'g7_physics').grade).toBe(7);
});

test('no grades asked for: no query, no books', async () => {
  const db = { from: jest.fn() };
  expect(await ict612Books(db, [])).toEqual([]);
  expect(db.from).not.toHaveBeenCalled();
});

test('a read error stops the sync rather than writing a short list', async () => {
  const q = { select: () => q, eq: () => q, in: () => q, order: () => q, range: async () => ({ data: null, error: { message: 'boom' } }) };
  await expect(ict612Books({ from: () => q }, [6])).rejects.toThrow(/boom/);
});
