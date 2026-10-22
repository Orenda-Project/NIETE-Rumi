'use strict';

/**
 * The one reader and writer of child_test_sa_item_reviews (migration V1.7.4): per item of a self-administered session,
 * the scoring agents' marks (written by the agents' import, never here) and a reviewer's own mark.
 * Every Supabase error is logged at 'error' with ids only and returned, never read as "no row". Never a note in a log.
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');

const REVIEWS = 'child_test_sa_item_reviews';

function fail(where, error, extra) {
  logToFile(`[child-test] ${where} failed`, { ...extra, error: error && (error.message || String(error)) }, 'error');
  return { ok: false, error: error && (error.message || String(error)) };
}

async function listItemReviews(sessionId) {
  const { data, error } = await supabase.from(REVIEWS)
    .select('session_id, task_id, item_key, agents, agents_run_at, mark, note, reviewed_by, reviewed_at')
    .eq('session_id', sessionId);
  if (error) return fail('listItemReviews', error, { sessionId });
  return { ok: true, reviews: data || [] };
}

/** The reviewer's mark and note on one item; the agents' columns are left as they are. */
async function saveItemReview({ sessionId, taskId, itemKey, mark, note, reviewedBy, reviewedAt }) {
  const { error } = await supabase.from(REVIEWS).upsert({
    session_id: sessionId,
    task_id: taskId,
    item_key: itemKey,
    mark,
    note,
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt,
    updated_at: reviewedAt,
  }, { onConflict: 'session_id,task_id,item_key' });
  if (error) return fail('saveItemReview', error, { sessionId, taskId, itemKey });
  return { ok: true };
}

module.exports = { listItemReviews, saveItemReview };
