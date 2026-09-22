'use strict';
/**
 * The teacher-nudge core — every read and write of `teacher_nudges`.
 *
 * One table, one module. Nothing else in the bot touches `teacher_nudges`
 * directly, so the two guards that make scheduled messaging safe live in one
 * place and cannot be half-applied by a caller in a hurry:
 *
 *   G1 · SCHEDULING IS IDEMPOTENT. `schedule` INSERTs and reads 23505 as
 *        "somebody already scheduled this", returning the row that won. The
 *        UNIQUE (user_id, nudge_date, kind) is doing the work — five worker
 *        replicas building the 15:00 cohort produce one row and four no-ops.
 *        Checking for an existing row first and then inserting would be a race,
 *        not a guard.
 *
 *   G2 · SENDING IS CLAIMED. supabase-js cannot express `UPDATE … LIMIT n`, so
 *        `claimDue` selects candidate ids and then flips them pending → sending
 *        with `.eq('status','pending')` STILL ON THE UPDATE, and treats only the
 *        rows the update returned as claimed. Two sweepers that selected the same
 *        ids each get exactly the rows their own UPDATE won; the loser gets an
 *        empty array and sends nothing. Drop that one `.eq` and this becomes a
 *        check-then-act that double-sends under two replicas.
 *
 * Every chain checks `error` (pre-merge Class D) and every failure is logged at
 * error level (Class N). A read that fails returns the empty answer rather than
 * throwing — a sweeper tick that cannot reach the database must skip, not crash
 * the worker — while `schedule` throws, because a caller building a cohort needs
 * to know its insert did not happen.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const TABLE = 'teacher_nudges';

/** The two kinds the V1.5.3 CHECK constraint allows. A third one is a migration. */
const KINDS = Object.freeze({
  COACHING_AFTER_LP: 'coaching_after_lp',
  LP_QUIZ_OFFER: 'lp_quiz_offer',
});

/** The six states the V1.5.3 CHECK constraint allows. */
const STATUS = Object.freeze({
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  EXPIRED: 'expired',
});

/**
 * Why a teacher was deliberately NOT asked. Closed on purpose and validated in
 * `markSkipped`: this token is the only record of which rule fired, so a typo'd
 * reason is a hole in the funnel that nobody notices until somebody asks why the
 * numbers do not add up. A skip is the product working; a failure is a defect.
 * They are different words and different counts.
 */
const SKIP_REASONS = Object.freeze([
  'coached_today',
  'offered_today',
  'sent_today',
  'coaching_yes_today',
  'window_closed',
  'weekly_cap',
  'declined_streak',
  'consecutive_day',
  'quiet_hours',
  'assessment_day',
  'no_lesson',
  'disabled',
  'sector_not_piloted',
  'not_school_day',
  'in_progress_coaching',
]);

/** What a teacher can have answered. `class:<key>` is the list-row pick. */
const CHOICE_RE = /^(yes|no|ignored|class:[A-Za-z0-9_]+)$/;

/** How long a row may sit in `sending` before it is called a failure. */
const STUCK_MINUTES = 10;

/** The most rows a single sweeper tick will claim (Class P, per-tick cap). */
const DEFAULT_CLAIM_LIMIT = 200;

const iso = (v) => (v instanceof Date ? v.toISOString() : String(v));
const nowIso = () => new Date().toISOString();

function logDbError(what, error, extra = {}) {
  logToFile(`❌ teacher_nudges: ${what}`, {
    error: error && error.message ? error.message : String(error),
    code: error && error.code,
    ...extra,
  }, 'error');
}

/**
 * Read a row's current `context`, merge `patch` into it and write the row back.
 *
 * The read is deliberate: `context` is a jsonb sidecar several writers add to
 * (the cohort builder puts the lessons in it, the sender puts the message ids
 * in it, the sweeper puts a skip reason or an error in it). A bare
 * `.update({ context: { error } })` REPLACES the object and silently throws away
 * which lessons the ask was about — the record of what the teacher was asked
 * disappears at exactly the moment somebody is investigating why.
 */
async function patchRow(id, patch, contextPatch = null, guard = null) {
  let context;
  if (contextPatch) {
    const { data, error } = await supabase.from(TABLE).select('context').eq('id', id).maybeSingle();
    if (error) {
      logDbError('could not read context before update', error, { id });
      return false;
    }
    context = { ...((data && data.context) || {}), ...contextPatch };
  }

  let q = supabase.from(TABLE).update({
    ...patch,
    ...(context ? { context } : {}),
    updated_at: nowIso(),
  }).eq('id', id);
  if (guard) q = q.eq(guard[0], guard[1]);

  const { data: updated, error } = await q.select();
  if (error) {
    logDbError('update failed', error, { id, patch: Object.keys(patch) });
    return false;
  }
  return (updated || []).length > 0;
}

/**
 * Schedule one ask. Idempotent by the UNIQUE (G1).
 *
 * @returns {Promise<{row:Object|null, created:boolean}>} `created:false` means
 *   the row was already there and `row` is THAT row — the caller's own context
 *   was not written, which is correct: the first writer's view of the day wins.
 */
async function schedule({ userId, kind, nudgeDate, scheduledAt, context = {} }) {
  const row = {
    user_id: userId,
    kind,
    nudge_date: nudgeDate,
    scheduled_at: iso(scheduledAt),
    context,
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  if (!error) return { row: data, created: true };

  if (error.code === '23505') {
    // Somebody scheduled this teacher-day-kind first. Read back what they wrote
    // so the caller has a real row to log, cap against, or answer with.
    const existing = await todayRow(userId, kind, nudgeDate);
    return { row: existing, created: false };
  }

  logDbError('schedule insert failed', error, { kind, nudgeDate });
  throw new Error(`teacher_nudges: could not schedule ${kind} — ${error.message}`);
}

/**
 * Claim the due, pending rows of one kind (G2).
 *
 * @returns {Promise<Array<Object>>} ONLY the rows this call won. An empty array
 *   is a normal outcome — nothing due, or another replica got there first.
 */
async function claimDue({ kind, limit = DEFAULT_CLAIM_LIMIT, now = new Date() } = {}) {
  const due = iso(now);

  const { data: candidates, error: selectError } = await supabase.from(TABLE)
    .select('id')
    .eq('kind', kind)
    .eq('status', STATUS.PENDING)
    .lte('scheduled_at', due)
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  if (selectError) {
    logDbError('claim select failed', selectError, { kind });
    return [];
  }

  const ids = (candidates || []).map((r) => r.id);
  if (!ids.length) return [];

  const { data: claimed, error: updateError } = await supabase.from(TABLE)
    .update({ status: STATUS.SENDING, updated_at: nowIso() })
    .in('id', ids)
    .eq('status', STATUS.PENDING)   // ← the claim. Never remove this.
    .select();

  if (updateError) {
    logDbError('claim update failed', updateError, { kind, candidates: ids.length });
    return [];
  }

  return claimed || [];
}

/** The teacher has it. `messageIds` is kept so a delivery question has an answer. */
async function markSent(id, { messageIds = [], context = {} } = {}) {
  return patchRow(id, { status: STATUS.SENT, sent_at: nowIso() }, {
    ...context,
    message_ids: messageIds,
  });
}

/**
 * Deliberately not sent. Throws on a reason outside `SKIP_REASONS`, BEFORE any
 * database call — an unknown reason is a bug in the caller, and writing it would
 * put an unqueryable value in the one column that explains the funnel.
 */
async function markSkipped(id, reason, extra = {}) {
  if (!SKIP_REASONS.includes(reason)) {
    throw new Error(
      `teacher_nudges: unknown skip reason ${JSON.stringify(reason)} — `
      + `add it to SKIP_REASONS or use one of: ${SKIP_REASONS.join(', ')}`,
    );
  }
  return patchRow(id, { status: STATUS.SKIPPED }, { ...extra, skip_reason: reason });
}

/** The send threw. The MESSAGE is stored, not the object — jsonb cannot hold a stack. */
async function markFailed(id, error) {
  const message = error && error.message ? error.message : String(error || 'unknown');
  return patchRow(id, { status: STATUS.FAILED }, { error: message });
}

/**
 * Rows claimed by a tick that then died mid-send sit in `sending` for ever,
 * invisible to the next claim (it only takes `pending`). After the ceiling they
 * are called what they are — failures — so the counts stay honest and a row
 * cannot silently disappear from every report.
 *
 * Selected first and then written per row, rather than in one bulk UPDATE,
 * because `context` must be merged rather than replaced (see patchRow). Each
 * write keeps `status = 'sending'` as a guard so a row that finished between the
 * select and the update is not clobbered.
 *
 * @returns {Promise<number>} how many rows were actually flipped.
 */
async function expireStuck({ olderThanMinutes = STUCK_MINUTES, now = new Date(), limit = DEFAULT_CLAIM_LIMIT } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const cutoff = new Date(at.getTime() - olderThanMinutes * 60 * 1000).toISOString();

  const { data: stuck, error } = await supabase.from(TABLE)
    .select('id')
    .eq('status', STATUS.SENDING)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) {
    logDbError('expireStuck select failed', error, { olderThanMinutes });
    return 0;
  }

  let expired = 0;
  for (const row of stuck || []) {
    const ok = await patchRow(
      row.id,
      { status: STATUS.FAILED },
      { error: 'stuck_sending' },
      ['status', STATUS.SENDING],
    );
    if (ok) expired += 1;
  }
  return expired;
}

/** What the teacher tapped, and the quiz it produced (if any). */
async function recordAnswer(id, { choice, quizId = null } = {}) {
  if (!CHOICE_RE.test(String(choice))) {
    throw new Error(
      `teacher_nudges: unknown choice ${JSON.stringify(choice)} — `
      + 'expected yes | no | ignored | class:<key>. Store the token, never the button title.',
    );
  }
  const patch = { choice, answered_at: nowIso() };
  if (quizId) patch.quiz_id = quizId;
  return patchRow(id, patch);
}

/** A teacher's nudges, newest day first. Serves the weekly cap and the declined streak. */
async function rowsFor(userId, { kind = null, fromDate = null, toDate = null } = {}) {
  let q = supabase.from(TABLE).select('*').eq('user_id', userId);
  if (kind) q = q.eq('kind', kind);
  if (fromDate) q = q.gte('nudge_date', fromDate);
  if (toDate) q = q.lte('nudge_date', toDate);

  const { data, error } = await q.order('nudge_date', { ascending: false });
  if (error) {
    logDbError('rowsFor failed', error, { kind });
    return [];
  }
  return data || [];
}

/** The one row for (teacher, kind, PKT day) — or null. Never undefined. */
async function todayRow(userId, kind, nudgeDate) {
  const { data, error } = await supabase.from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('nudge_date', nudgeDate)
    .maybeSingle();

  if (error) {
    logDbError('todayRow failed', error, { kind, nudgeDate });
    return null;
  }
  return data || null;
}

module.exports = {
  TABLE,
  KINDS,
  STATUS,
  SKIP_REASONS,
  STUCK_MINUTES,
  DEFAULT_CLAIM_LIMIT,
  schedule,
  claimDue,
  markSent,
  markSkipped,
  markFailed,
  expireStuck,
  recordAnswer,
  rowsFor,
  todayRow,
};
