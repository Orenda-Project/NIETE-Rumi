/**
 * Curriculum LP AST Service
 *
 * Read-only accessor over the `curriculum_lp_ast` table (2,415 NBF + Taleemabad
 * lesson plans imported from taleemabad-core, migration 016). Each row is a
 * "pre-render" of one LP — structured JSON step arrays + metadata that Gamma
 * (or, later, a v7 renderer) consumes to produce a teacher-usable PDF.
 *
 * Serving flow:
 *   1. Handler calls findByChapter({curriculum_key, grade, subject, chapter_number})
 *      → returns the LPs available for that chapter
 *   2. If a specific lp_index is requested, we serve that; if not, we serve
 *      lp_index=1 (or the first is_enabled row) — chapter-picker UX can come
 *      later
 *   3. If the row has pdf_r2_key_{en|ur} populated, serve directly from cache
 *      (skip Gamma round-trip)
 *   4. Otherwise, hand the row to Gamma via ContentService and cache the
 *      resulting PDF back into the row
 *
 * Uses the same `supabase` client as everything else in the bot.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');

class CurriculumLpAstService {
  /**
   * Find LPs for a given chapter.
   *
   * @param {Object} input
   * @param {string} input.curriculum_key
   * @param {number} input.grade
   * @param {string} input.subject
   * @param {number} input.chapter_number
   * @param {number} [input.lp_index]  If given, filters to just that LP.
   * @returns {Promise<Array>} matching rows, ordered by lp_index
   */
  static async findByChapter({ curriculum_key, grade, subject, chapter_number, lp_index } = {}) {
    let q = supabase
      .from('curriculum_lp_ast')
      .select('*')
      .eq('curriculum_key', curriculum_key)
      .eq('grade', grade)
      .eq('subject', subject)
      .eq('chapter_number', chapter_number)
      .eq('is_enabled', true)
      .order('lp_index', { ascending: true });
    if (lp_index !== undefined && lp_index !== null) q = q.eq('lp_index', lp_index);
    const { data, error } = await q;
    if (error) {
      logToFile('CurriculumLpAstService.findByChapter error', { error: error.message });
      return [];
    }
    return data || [];
  }

  /**
   * Pick a default LP for a chapter — the lowest lp_index that isn't a
   * "teacher orientation" placeholder. If the chapter has an LP whose topic
   * starts with "Types of" (Taleemabad convention for the intro-to-teachers
   * LP), skip it and prefer lp_index=2.
   */
  static async pickDefaultLpForChapter({ curriculum_key, grade, subject, chapter_number }) {
    const lps = await this.findByChapter({ curriculum_key, grade, subject, chapter_number });
    if (lps.length === 0) return null;
    // Prefer first LP whose topic isn't the "Types of" orientation placeholder.
    const nonOrientation = lps.find(lp => !/^types of|introductory lp/i.test(lp.topic || ''));
    return nonOrientation || lps[0];
  }

  /**
   * Topic-match against curriculum_lp_ast — mirrors the two-step approach
   * from TopicMatchingService but against the AST table's chapter_title and
   * topic columns.
   *
   * Step 1: exact `chapter_title ILIKE %topic%` at the requested grade+subject
   * Step 2: bidirectional substring match in JS across ALL chapters at that
   *         grade+subject (topic contains chapter_title OR vice versa)
   *
   * Curriculum filter is OPTIONAL — for NIETE we're serving both NBF and
   * Taleemabad content, so a single region_features.curriculum_key doesn't
   * make sense; instead we let the topic guide us across the corpus.
   */
  static async findByTopic({ topic, grade, subject, curriculum_key } = {}) {
    if (!topic) return null;
    const normalizedTopic = String(topic).toLowerCase().trim();

    let baseQuery = supabase.from('curriculum_lp_ast').select('*').eq('is_enabled', true);
    if (grade !== undefined && grade !== null) baseQuery = baseQuery.eq('grade', grade);
    if (subject) baseQuery = baseQuery.eq('subject', subject);
    if (curriculum_key) baseQuery = baseQuery.eq('curriculum_key', curriculum_key);

    // Step 1: fast ILIKE hit on chapter_title. Stable order — chapter first,
    // then lp_index — so the same topic string always resolves to the same LP
    // row across calls (essential for R2 caching to hit).
    const { data: exactHits, error: exactError } = await baseQuery
      .ilike('chapter_title', `%${normalizedTopic}%`)
      .order('chapter_number', { ascending: true })
      .order('lp_index', { ascending: true })
      .limit(20);
    if (exactError) {
      logToFile('CurriculumLpAstService.findByTopic step1 error', { error: exactError.message });
      return null;
    }
    if (exactHits && exactHits.length > 0) {
      // Bucket by chapter, prefer non-orientation LP within each chapter, then
      // return the LP for the lowest chapter_number — deterministic.
      const byChapter = new Map();
      for (const row of exactHits) {
        const key = row.chapter_number;
        const existing = byChapter.get(key);
        if (!existing) { byChapter.set(key, row); continue; }
        const isOrientation = (lp) => /^types of|introductory lp/i.test(lp.topic || '');
        if (isOrientation(existing) && !isOrientation(row)) byChapter.set(key, row);
      }
      const sortedChapters = [...byChapter.keys()].sort((a, b) => (a || 999) - (b || 999));
      return byChapter.get(sortedChapters[0]);
    }

    // Step 2: fetch candidates + JS bidirectional match on chapter_title
    let candidatesQuery = supabase.from('curriculum_lp_ast').select('*').eq('is_enabled', true);
    if (grade !== undefined && grade !== null) candidatesQuery = candidatesQuery.eq('grade', grade);
    if (subject) candidatesQuery = candidatesQuery.eq('subject', subject);
    if (curriculum_key) candidatesQuery = candidatesQuery.eq('curriculum_key', curriculum_key);
    const { data: candidates, error: candError } = await candidatesQuery;
    if (candError) {
      logToFile('CurriculumLpAstService.findByTopic step2 error', { error: candError.message });
      return null;
    }

    // Deduplicate by (chapter_number) — pick the best LP per chapter
    const chapterMatches = new Map();
    for (const row of candidates || []) {
      const title = (row.chapter_title || '').toLowerCase().trim();
      if (!title) continue;
      if (!normalizedTopic.includes(title) && !title.includes(normalizedTopic)) continue;
      const existing = chapterMatches.get(row.chapter_number);
      if (!existing) { chapterMatches.set(row.chapter_number, row); continue; }
      // Prefer non-orientation LP over orientation LP within the same chapter
      const isOrientation = (lp) => /^types of|introductory lp/i.test(lp.topic || '');
      if (isOrientation(existing) && !isOrientation(row)) chapterMatches.set(row.chapter_number, row);
    }
    const results = [...chapterMatches.values()];
    if (results.length === 0) return null;
    // If topic-matched multiple chapters, prefer lowest chapter_number
    results.sort((a, b) => (a.chapter_number || 999) - (b.chapter_number || 999));
    return results[0];
  }

  static async findByUuid(source_lp_uuid) {
    const { data, error } = await supabase
      .from('curriculum_lp_ast')
      .select('*')
      .eq('source_lp_uuid', source_lp_uuid)
      .eq('is_enabled', true)
      .maybeSingle();
    if (error) {
      logToFile('CurriculumLpAstService.findByUuid error', { error: error.message });
      return null;
    }
    return data;
  }

  /**
   * Persist a rendered PDF's R2 key on the LP AST row so subsequent
   * requests skip Gamma and serve from cache.
   *
   * @param {string} source_lp_uuid
   * @param {string} r2Key
   * @param {'en'|'ur'} language
   */
  static async setRenderedPdfKey(source_lp_uuid, r2Key, language = 'en') {
    const col = language === 'ur' ? 'pdf_r2_key_ur' : 'pdf_r2_key_en';
    const { error } = await supabase
      .from('curriculum_lp_ast')
      .update({ [col]: r2Key, rendered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('source_lp_uuid', source_lp_uuid);
    if (error) {
      logToFile('CurriculumLpAstService.setRenderedPdfKey error', { error: error.message, source_lp_uuid, r2Key });
      return false;
    }
    return true;
  }
}

module.exports = CurriculumLpAstService;
