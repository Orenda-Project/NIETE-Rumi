'use strict';
/**
 * bd-qchgya — ICT's current 6-12 books for the grades a region borrows (GB: 6-10, operator 11 Nov), read from
 * niete_lp612_segments. `sync-sheet-lps --books` adds their stems to the region's book list. One entry per stem.
 */
const PAGE = 1000;

async function ict612Books(supabase, grades) {
  if (!grades || !grades.length) return [];
  const byStem = new Map();
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('niete_lp612_segments').select('book_stem, grade')
      .eq('curriculum', 'ict').eq('is_current', true).in('grade', grades)
      .order('segment_id').range(from, from + PAGE - 1);
    if (error) throw new Error(`reading ICT 6-12 books: ${error.message}`);
    for (const r of data || []) if (r.book_stem && !byStem.has(r.book_stem)) byStem.set(r.book_stem, { stem: r.book_stem, grade: Number(r.grade) });
    if (!data || data.length < PAGE) break;
  }
  return [...byStem.values()];
}

module.exports = { ict612Books };
