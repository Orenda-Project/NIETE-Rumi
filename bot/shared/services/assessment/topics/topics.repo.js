'use strict';
/**
 * Reads assessment_topics (V1.6.18; curriculum V1.8.6). listChapterTopics -> one chapter's current topics, camelCase, in sort_order.
 * A chapter that was never loaded gives []; a database error is logged and thrown, never read as "no topics".
 */
const supabase = require('../../../config/supabase');
const { logError } = require('../../../utils/logger');
const { fromRow } = require('./reconcile');

/**
 * `curriculum` is the BOOK's curriculum (V1.8.6, bd-97daxo.4): chapter 3 of NBF's book is not chapter
 * 3 of ICT's, so a read without it would hand one curriculum's teacher the other's topics. Default
 * 'ict' — every row that existed before V1.8.6.
 */
async function listChapterTopics(grade, subject, chapterNumber, { curriculum = 'ict' } = {}) {
  const { data, error } = await supabase
    .from('assessment_topics')
    .select('*')
    .eq('curriculum', curriculum)
    .eq('grade', grade)
    .eq('subject', subject)
    .eq('chapter_number', chapterNumber)
    .eq('is_current', true)
    .order('sort_order', { ascending: true });
  if (error) {
    logError('❌ assessment_topics read failed', { grade, subject, chapterNumber, error: error.message });
    throw new Error(error.message);
  }
  return (data || []).map(fromRow);
}

module.exports = { listChapterTopics };
