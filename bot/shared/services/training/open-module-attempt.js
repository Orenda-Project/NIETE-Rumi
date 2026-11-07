'use strict';
/**
 * One open module check per teacher per module: the rule both surfaces start a
 * module quiz by (the portal's POST /training/module/:id/quiz-attempts/start and
 * WhatsApp's startTrainingQuiz).
 *
 * The database already holds that rule as a partial unique index,
 * ux_taa_one_active_per_module: one training_assessment_attempts row per
 * (user_id, training_module_id) with status 'in_progress' and quiz_kind
 * 'training_module'. A start that read only her NEWEST attempt, and inserted
 * when that one was closed, broke on the index in two ways, each a failed start:
 *
 *   - two starts for one module a few hundred ms apart (a double tap, a
 *     back-navigation): both read "nothing open", both insert, the second
 *     loses with 23505;
 *   - an OLD open attempt under a newer closed one (the all-at-once submit
 *     writes a closed row without closing the open one): her newest row is
 *     closed, so every start inserts, and every one fails, for good.
 *
 * So a start:
 *   1. looks for ANY open attempt on the module, not only her newest row;
 *   2. resumes it when it is her newest attempt. When a closed attempt is
 *      newer, the open one is stale (it can be months old, on a paper that has
 *      changed since): it is closed as 'abandoned', only while it is still
 *      open, and a fresh attempt opens;
 *   3. inserts, and reads a 23505 as "a parallel start won": the open attempt
 *      is read back and resumed. Any other insert error goes back to the
 *      caller, which reports it.
 *
 * Zero requires, on purpose: the portal and the bot are separate deploy units
 * that do not share a node_modules, so each hands in its own Supabase client
 * and its own event logger (`log(event, data)`).
 */

const KIND = 'training_module';
const UNIQUE_VIOLATION = '23505';

const noop = () => {};

function _safeLog(log, event, data) {
  try { (log || noop)(event, data); } catch (_) { /* telemetry never fails a start */ }
}

/** Her open attempt on this module, newest first, or null. Throws on a read error. */
async function _openAttempt(db, userId, moduleId) {
  const { data, error } = await db
    .from('training_assessment_attempts')
    .select('id, status, started_at')
    .eq('user_id', userId)
    .eq('training_module_id', moduleId)
    .eq('quiz_kind', KIND)
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data && data.status === 'in_progress' ? data : null;
}

/** Her newest attempt on this module, whatever its status, or null. Throws on a read error. */
async function _newestAttempt(db, userId, moduleId) {
  const { data, error } = await db
    .from('training_assessment_attempts')
    .select('id, status, started_at')
    .eq('user_id', userId)
    .eq('training_module_id', moduleId)
    .eq('quiz_kind', KIND)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * The open attempt a start should RESUME, after closing a stale one.
 *
 * @param {object} db       a Supabase client (the caller's own)
 * @param {object} args
 * @param {string} args.userId
 * @param {number} args.moduleId
 * @param {string} [args.surface]  'portal' | 'whatsapp', carried on the events
 * @param {Function} [args.log]    (event, data) => void
 * @returns {Promise<{ id: string|null, abandonedId?: string }>}
 *   id: the attempt to resume, or null when a new one should be opened.
 */
async function resumableModuleAttempt(db, { userId, moduleId, surface, log } = {}) {
  const open = await _openAttempt(db, userId, moduleId);
  if (!open) return { id: null };

  const newest = await _newestAttempt(db, userId, moduleId);
  if (!newest || newest.id === open.id || newest.status === 'in_progress') return { id: open.id };

  // A closed attempt is newer than her open one: the open one is stale.
  const now = new Date().toISOString();
  const { data: closed, error } = await db
    .from('training_assessment_attempts')
    .update({ status: 'abandoned', last_activity_at: now })
    .eq('id', open.id)
    .eq('status', 'in_progress')
    .select('id');
  if (error) {
    // Could not close it: resuming it is still better than a start that fails.
    _safeLog(log, 'training_quiz_attempt_abandon_failed', {
      user_uuid: userId, attempt_uuid: open.id, module_row_id: moduleId, surface,
      pg_code: error.code || null, error: String(error.message || error).slice(0, 300),
    });
    return { id: open.id };
  }
  if (closed && closed.length > 0) {
    _safeLog(log, 'training_quiz_attempt_abandoned', {
      user_uuid: userId, attempt_uuid: open.id, module_row_id: moduleId, surface,
      open_started_at: open.started_at || null,
      newer_attempt_uuid: newest.id, newer_status: newest.status,
    });
  }
  // Closed now (by this start, or by a parallel one): open a fresh attempt.
  return { id: null, abandonedId: open.id };
}

/**
 * Insert a new open attempt; a 23505 resumes the attempt the parallel start opened.
 *
 * @param {object} db
 * @param {object} row  the full attempts row, its `id` minted by the caller
 *                      (the served paper is seeded on it)
 * @param {object} [opts]
 * @param {string} [opts.surface]
 * @param {Function} [opts.log]
 * @returns {Promise<{ id: string, raced: boolean } | { id: null, error: object }>}
 *   raced: true when another start's attempt is returned instead of this row.
 */
async function insertModuleAttempt(db, row, { surface, log } = {}) {
  const { data, error } = await db
    .from('training_assessment_attempts')
    .insert(row)
    .select('id')
    .single();
  if (!error && data) return { id: data.id || row.id, raced: false };

  if (error && error.code === UNIQUE_VIOLATION) {
    let winner = null;
    try {
      winner = await _openAttempt(db, row.user_id, row.training_module_id);
    } catch (readErr) {
      return { id: null, error: readErr };
    }
    if (winner) {
      _safeLog(log, 'training_quiz_start_raced', {
        user_uuid: row.user_id, module_row_id: row.training_module_id, surface,
        attempt_uuid: winner.id, lost_attempt_uuid: row.id,
      });
      return { id: winner.id, raced: true };
    }
  }
  return { id: null, error: error || new Error('attempt insert returned nothing') };
}

module.exports = { resumableModuleAttempt, insertModuleAttempt, UNIQUE_VIOLATION };
