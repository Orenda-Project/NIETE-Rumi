/**
 * bd-2531 — the write path. THIS is what makes the flow session-free.
 *
 * Every answer is persisted the moment it arrives, so the ROWS carry her
 * position. There is no conversation state in memory, nothing to expire, and
 * nothing lost if the process dies between indicator 3 and 4.
 *
 * Two deliberate shapes:
 *   * the header row is created LAZILY on her first answer for a teacher — the
 *     score rows need something to hang off, and creating it at submit would
 *     mean holding four answers somewhere else in the meantime (i.e. a session);
 *   * saveScore UPSERTS on (remark_id, indicator_ordinal), so "change my answer
 *     to question 2" is the same operation as answering it the first time.
 *
 * Validation happens here as well as in the DB CHECK constraints. The DB is the
 * guarantee; this layer exists so the handler gets a clean error it can
 * re-prompt on, rather than a constraint violation it would have to parse.
 */

const { getIndicator, MAX_LEVEL } = require('./remark-rubric');

// config/supabase calls process.exit(78) without env vars — lazy so tests can
// import the pure validation without killing the runner.
function defaultClient() {
  return require('../../config/supabase');
}

/**
 * Find or create the remark header for (teacher, cycle).
 *
 * NOT submitted on creation: a header with submitted_at IS NULL is a partial —
 * real work in progress. That distinction is what the retry sweep and the
 * S_pct view both rely on.
 *
 * @returns {Promise<string>} remark id
 */
async function ensureRemark({ cycleId, teacherId, principalUserId, schoolId }, deps = {}) {
  const client = deps.client || defaultClient();

  const existing = await client
    .from('supervisor_remarks')
    .select('id')
    .eq('cycle_id', cycleId)
    .eq('teacher_id', teacherId)
    .maybeSingle();
  if (existing && existing.error) {
    throw new Error(`remark-write: ensureRemark lookup failed — ${existing.error.message}`);
  }
  if (existing && existing.data && existing.data.id) return existing.data.id;

  const row = {
    cycle_id: cycleId,
    teacher_id: teacherId,
    principal_user_id: principalUserId,
  };
  if (schoolId) row.school_id = schoolId;

  const created = await client
    .from('supervisor_remarks')
    .insert(row)
    .select('id')
    .single();
  if (created && created.error) {
    throw new Error(`remark-write: ensureRemark insert failed — ${created.error.message}`);
  }
  return created && created.data ? created.data.id : null;
}

/**
 * Persist ONE indicator answer. Upserts, so re-answering replaces.
 */
async function saveScore(remarkId, ordinal, score, deps = {}) {
  getIndicator(ordinal);  // throws on an unknown ordinal
  if (!Number.isInteger(score) || score < 1 || score > MAX_LEVEL) {
    throw new Error(`remark-write: score ${score} out of range 1..${MAX_LEVEL}`);
  }
  const client = deps.client || defaultClient();
  const res = await client
    .from('supervisor_remark_scores')
    .upsert(
      { remark_id: remarkId, indicator_ordinal: ordinal, score, updated_at: new Date().toISOString() },
      // Without this target a re-answer violates the UNIQUE constraint instead
      // of replacing the previous score.
      { onConflict: 'remark_id,indicator_ordinal' },
    );
  if (res && res.error) throw new Error(`remark-write: saveScore failed — ${res.error.message}`);
  return true;
}

/**
 * Store the closing comment — typed, transcribed from voice, or skipped.
 *
 * A SKIP writes an empty string rather than leaving NULL: "skipped" must be
 * distinguishable from "not asked yet", or the flow re-prompts forever.
 */
async function saveComment(remarkId, { text, audioId, language, skipped } = {}, deps = {}) {
  const client = deps.client || defaultClient();
  const patch = { updated_at: new Date().toISOString() };
  if (skipped) {
    patch.comment_text = '';
  } else {
    patch.comment_text = typeof text === 'string' ? text : '';
    if (audioId) patch.comment_audio_id = audioId;
    if (language) patch.comment_language = language;
  }
  const res = await client.from('supervisor_remarks').update(patch).eq('id', remarkId);
  if (res && res.error) throw new Error(`remark-write: saveComment failed — ${res.error.message}`);
  return true;
}

/**
 * THE COMMIT. Stamping submitted_at is what fires the teacher's narrative —
 * deliberately separate from "has 5 scores", so answering the fifth indicator
 * does not message a teacher before the principal is ready.
 */
async function markSubmitted(remarkId, deps = {}) {
  const client = deps.client || defaultClient();
  const now = new Date().toISOString();
  const res = await client
    .from('supervisor_remarks')
    .update({ submitted_at: now, updated_at: now })
    .eq('id', remarkId);
  if (res && res.error) throw new Error(`remark-write: markSubmitted failed — ${res.error.message}`);
  return now;
}

module.exports = { ensureRemark, saveScore, saveComment, markSubmitted };
