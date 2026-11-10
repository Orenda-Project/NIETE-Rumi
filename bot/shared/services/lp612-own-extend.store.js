/**
 * bd-snkn32.14 — the two catalogue reads "Add the next lesson's pages" needs: her lesson's row, and the current rows of
 * its book and chapter in the book's order (lp612-own-extend.nextInChapter picks the adjacent one). Plain functions over
 * a passed client, so the schema guards can read the `.from()` calls.
 */

const COLUMNS = 'segment_id, book_stem, chapter_key, order_index, printed_page_start, printed_page_end, pages_covered, '
  + 'subtopic_title, menu_title, slo_codes, slo_descriptions, prev_segment_id, next_segment_id';

async function loadSegment(supabase, segmentId) {
  const { data, error } = await supabase
    .from('niete_lp612_segments')
    .select(COLUMNS)
    .eq('segment_id', segmentId)
    .maybeSingle();
  return error ? null : (data || null);
}

async function chapterSegments(supabase, seg) {
  if (!seg) return [];
  const { data, error } = await supabase
    .from('niete_lp612_segments')
    .select(COLUMNS)
    .eq('book_stem', seg.book_stem)
    .eq('chapter_key', seg.chapter_key)
    .eq('is_current', true)
    .order('order_index', { ascending: true });
  return error ? [] : (data || []);
}

module.exports = { loadSegment, chapterSegments, COLUMNS };
