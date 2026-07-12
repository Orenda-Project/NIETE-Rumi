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

// Extract significant tokens from a chapter title — words of length ≥3,
// lowercased, alphanumeric only, excluding pure-numeric tokens (so "0-9"
// range markers don't demand a "0" or "9" in the teacher's topic).
//
// "Number Buddies 0-9"          → ["number", "buddies"]
// "Numbers upto 9 (Concrete)"   → ["numbers", "upto", "concrete"]
// "Extended Hour: Number Sense" → ["extended", "hour", "number", "sense"]
function chapterTokens(chapterTitle) {
  return String(chapterTitle || '')
    .toLowerCase()
    .replace(/[-]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

// True iff every token appears as a case-insensitive substring in the topic.
// Handles LP-request wrappers ("lesson plan for X", "give me X", "X please").
function topicHasAllTokens(normalizedTopic, tokens) {
  if (!tokens.length) return false;
  return tokens.every((tok) => normalizedTopic.includes(tok));
}

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

    // Fetch candidates at (grade, subject) scope. ~12 LPs per chapter ×
    // ~5 chapters per grade+subject ≈ 60 rows — trivial to filter in JS.
    // Stable order — chapter first, then lp_index — so the same topic
    // resolves to the same LP row (essential for R2 caching to hit).
    let q = supabase
      .from('curriculum_lp_ast')
      .select('*')
      .eq('is_enabled', true)
      .order('chapter_number', { ascending: true })
      .order('lp_index', { ascending: true });
    if (grade !== undefined && grade !== null) q = q.eq('grade', grade);
    if (subject) q = q.eq('subject', subject);
    if (curriculum_key) q = q.eq('curriculum_key', curriculum_key);

    const { data: candidates, error } = await q;
    if (error) {
      logToFile('CurriculumLpAstService.findByTopic error', { error: error.message });
      return null;
    }
    if (!candidates || candidates.length === 0) {
      logToFile('CurriculumLpAstService.findByTopic no candidates', { grade, subject, curriculum_key });
      return null;
    }

    // Significant-word intersection: chapter_title's meaningful tokens must
    // ALL appear (case-insensitive substring) in the topic. Handles
    // natural-language LP-request wrappers like "lesson plan for X",
    // "give me a lesson plan on X", "X lesson plan please".
    const isOrientation = (lp) => /^types of|introductory lp/i.test(lp.topic || '');
    const chapterMatches = new Map();
    for (const row of candidates) {
      const tokens = chapterTokens(row.chapter_title);
      if (!topicHasAllTokens(normalizedTopic, tokens)) continue;
      const existing = chapterMatches.get(row.chapter_number);
      if (!existing) { chapterMatches.set(row.chapter_number, row); continue; }
      // Prefer non-orientation LP within the same chapter
      if (isOrientation(existing) && !isOrientation(row)) chapterMatches.set(row.chapter_number, row);
    }

    if (chapterMatches.size === 0) {
      logToFile('CurriculumLpAstService.findByTopic no chapter match', {
        topic: normalizedTopic,
        grade, subject, curriculum_key,
        candidate_count: candidates.length,
      });
      return null;
    }

    // If multiple chapters matched, prefer lowest chapter_number (deterministic).
    const sortedChapters = [...chapterMatches.keys()].sort((a, b) => (a || 999) - (b || 999));
    const winner = chapterMatches.get(sortedChapters[0]);
    logToFile('CurriculumLpAstService.findByTopic matched', {
      chapter_number: winner.chapter_number,
      chapter_title: winner.chapter_title,
      lp_index: winner.lp_index,
      source_lp_uuid: winner.source_lp_uuid,
    });
    return winner;
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
