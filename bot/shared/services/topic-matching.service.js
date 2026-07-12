/**
 * Topic Matching Service
 *
 * Matches a teacher's topic request to a textbook chapter using:
 *  1. Postgres `contains` against textbook_toc.topic_keywords (exact keyword)
 *  2. Bidirectional substring match against chapter_title, computed in JS
 *     over the candidates that share (curriculum, grade, subject). Bidirectional
 *     because either side may be the substring — a short user query ("recall")
 *     is contained in the chapter title, and a natural sentence ("send me the
 *     lesson plan for time to recall") contains the chapter title.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');

function applyScope(query, { curriculum, grade, subject }) {
  let q = query.eq('curriculum', curriculum);
  if (grade !== undefined && grade !== null) q = q.eq('grade', grade);
  if (subject) q = q.eq('subject', subject);
  return q;
}

class TopicMatchingService {
  /**
   * Find a chapter by topic keyword match
   * @param {Object} input
   * @param {string} input.topic - Teacher's topic (e.g. 'fractions', 'kasoor')
   * @param {number} [input.grade]
   * @param {string} [input.subject]
   * @param {string} input.curriculum
   * @returns {Promise<Object|null>} Matched chapter or null
   */
  static async findChapterByTopic({ topic, grade, subject, curriculum }) {
    try {
      const normalizedTopic = topic.toLowerCase().trim();

      // Step 1: Exact keyword match via Postgres contains
      const keywordQuery = applyScope(
        supabase.from('textbook_toc').select('*'),
        { curriculum, grade, subject },
      ).contains('topic_keywords', [normalizedTopic]).limit(1);

      const { data, error } = await keywordQuery;
      if (error) {
        logToFile('Topic matching query error', { error: error.message, topic, curriculum });
        return null;
      }
      if (data && data.length > 0) {
        logToFile('Topic matched via keyword', { topic, chapter: data[0].chapter_title });
        return data[0];
      }

      // Step 2: Bidirectional substring fallback — fetch scoped candidates, filter in JS.
      // (The prior ILIKE-in-DB filter only matched one direction and never handled natural
      //  sentences that were longer than the chapter title.)
      const candidatesQuery = applyScope(
        supabase.from('textbook_toc').select('*'),
        { curriculum, grade, subject },
      );
      const { data: candidates, error: candErr } = await candidatesQuery;
      if (candErr) {
        logToFile('Topic candidate fetch error', { error: candErr.message, topic });
        return null;
      }

      const match = (candidates || []).find((row) => {
        const title = (row.chapter_title || '').toLowerCase().trim();
        if (!title) return false;
        return normalizedTopic.includes(title) || title.includes(normalizedTopic);
      });

      if (match) {
        logToFile('Topic matched via bidirectional substring', {
          topic, chapter: match.chapter_title,
        });
        return match;
      }

      logToFile('No topic match found', { topic, grade, subject, curriculum });
      return null;
    } catch (error) {
      logToFile('Topic matching error', { error: error.message, topic });
      return null;
    }
  }
}

module.exports = TopicMatchingService;
