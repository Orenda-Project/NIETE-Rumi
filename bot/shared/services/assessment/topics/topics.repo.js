'use strict';
/**
 * Reads assessment_topics (V1.6.18). listChapterTopics -> one chapter's current topics, camelCase, in sort_order.
 * A chapter that was never loaded gives []; a database error is logged and thrown, never read as "no topics".
 */
const supabase = require('../../../config/supabase');
const { logError } = require('../../../utils/logger');
const { fromRow } = require('./reconcile');

async function listChapterTopics(grade, subject, chapterNumber) {
  const { data, error } = await supabase
    .from('assessment_topics')
    .select('*')
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
