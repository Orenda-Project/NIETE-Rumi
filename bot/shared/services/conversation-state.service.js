'use strict';

/**
 * Conversation state — the ONE place "what is this teacher doing right now?" lives.
 *
 * Before this service there were four stores that disagreed, and the disagreement
 * was total: on production over 30 days the state was written 5,128 times and read
 * 11,359 times, and every branch that depended on a non-null state fired ZERO times.
 *
 * Three things were killing state, and each maps to a decision here:
 *
 *   scoped to a chat session   ->  keyed on user_id ONLY. chat_sessions rotate after
 *                                  30 minutes idle; a teacher who stepped away and came
 *                                  back found her own state gone. There is deliberately
 *                                  no sessionId parameter anywhere in this API.
 *
 *   held only in Redis          ->  stored in Postgres. The NIETE Redis runs with no
 *                                  persistent volume, so every restart dropped every
 *                                  in-flight conversation. Redis keeps dedup, rate
 *                                  limits, locks and caches — things nobody notices
 *                                  losing.
 *
 *   used as a GATE              ->  state is CONTEXT, never PERMISSION. Callers must be
 *                                  able to act on a self-describing event (a button id
 *                                  like `menu_lesson_plan`) with no state at all. This
 *                                  service will happily return null; it is the caller's
 *                                  job not to dead-end on that.
 *
 * Storage is users.conversation_state (JSONB) + users.conversation_state_expires_at.
 * See migrations/V1.1.1__conversation_state.sql for why two columns on `users` beat
 * a 77th table.
 *
 * KNOWN LIMITATION — no optimistic locking, deliberately deferred.
 * `version` below is a SHAPE version (for future migrations of the JSON), not a
 * lock. setState/pushState read the row to preserve `stack` and then write it back,
 * so two messages from the same teacher arriving close enough together can lose one
 * update to the other. The blast radius is bounded: the CURRENT flow always reflects
 * the later message (which is what the teacher is actually doing), and only a
 * resumable interruption can be dropped from the stack — no teacher content is at
 * risk. Fixing it properly needs a conditional update, which is scoped with the
 * resume work rather than smuggled in here.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');

/**
 * Same 24h ceiling the Redis helper enforces. State that can outlive a school day
 * is not state, it is a leak — one call site had reached past the Redis helper with
 * a 7-day raw setex, which is exactly what this refuses to allow.
 */
const MAX_TTL_SECONDS = 86400;

/** How deep the interruption stack may go before we stop remembering. */
const MAX_STACK_DEPTH = 3;

const SHAPE_VERSION = 1;

const nowMs = () => Date.now();
const isoIn = (seconds) => new Date(nowMs() + seconds * 1000).toISOString();

function assertTtl(ttlSeconds, key = 'ttlSeconds') {
  if (ttlSeconds == null || typeof ttlSeconds !== 'number' || Number.isNaN(ttlSeconds)) {
    throw new Error(`conversation-state: ${key} must be a positive number, got ${ttlSeconds}`);
  }
  if (ttlSeconds <= 0) {
    throw new Error(`conversation-state: ${key} must be positive, got ${ttlSeconds}`);
  }
  if (ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error(
      `conversation-state: ${key} ${ttlSeconds}s exceeds the 24h ceiling (${MAX_TTL_SECONDS}s). ` +
      'Either shorten the step or persist this in the feature\'s own table.'
    );
  }
}

/** Normalise whatever is in the JSONB column into the shape callers expect. */
function hydrate(raw) {
  if (!raw || typeof raw !== 'object' || !raw.flow) return null;
  return {
    flow: raw.flow,
    step: raw.step || null,
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
    stack: Array.isArray(raw.stack) ? raw.stack : [],
    version: raw.version || SHAPE_VERSION,
    updatedAt: raw.updated_at || null,
  };
}

/** Read the row without applying the deadline — internal, for read-modify-write. */
async function readRow(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('conversation_state, conversation_state_expires_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logToFile('⚠️ conversation-state: read failed (treating as no state)', { userId, error: error.message });
    return null;
  }
  return data || null;
}

async function writeRow(userId, state, expiresAtIso) {
  const { error } = await supabase
    .from('users')
    .update({
      conversation_state: state,
      conversation_state_expires_at: expiresAtIso,
    })
    .eq('id', userId);

  if (error) {
    // Deliberately loud. A failed state write means the next turn will not know
    // what this one was doing — the exact failure this service exists to end.
    logToFile('❌ conversation-state: write failed', { userId, error: error.message }, 'error');
    return false;
  }
  return true;
}

/**
 * What is this teacher doing right now, or null.
 *
 * The deadline is applied HERE, not only in the sweeper: a sweeper that has not run
 * yet must never be the reason a teacher is served stale state.
 *
 * @param {string} userId
 * @returns {Promise<{flow, step, payload, stack, version, updatedAt}|null>}
 */
async function getState(userId) {
  if (!userId) return null;

  const row = await readRow(userId);
  if (!row || !row.conversation_state) return null;

  const expiresAt = row.conversation_state_expires_at;
  if (expiresAt && Date.parse(expiresAt) <= nowMs()) return null;

  return hydrate(row.conversation_state);
}

/**
 * Record what the teacher is doing. Replaces whatever was there — use pushState when
 * the previous flow should be resumable.
 *
 * @param {string} userId
 * @param {{flow: string, step?: string, payload?: object, ttlSeconds: number}} next
 */
async function setState(userId, next = {}) {
  const { flow, step = null, payload = {}, ttlSeconds } = next;
  if (!userId) throw new Error('conversation-state: userId is required');
  if (!flow) throw new Error('conversation-state: flow is required');
  assertTtl(ttlSeconds);

  const existing = await readRow(userId);
  const stack = hydrate(existing && existing.conversation_state)?.stack || [];

  const state = {
    flow,
    step,
    payload,
    stack,
    version: SHAPE_VERSION,
    updated_at: new Date(nowMs()).toISOString(),
  };

  // Report what actually happened. Returning the state object regardless of the
  // write would be the same silent failure this service exists to remove: the
  // caller would believe the teacher's step was recorded when it was not. A null
  // is safe to ignore — a missing state means "no wait pending" and every gate is
  // intent-first — but a caller must never be TOLD it succeeded when it did not.
  // (For popState a null therefore means "nothing was resumed", which is the
  // correct thing to act on whether the stack was empty or the write failed.)
  const ok = await writeRow(userId, state, isoIn(ttlSeconds));
  return ok ? hydrate(state) : null;
}

/**
 * Finish a flow.
 *
 * Flow-scoped on purpose: clearing unconditionally is how one feature finishing wiped
 * another feature's state. Passing no flow clears whatever is there, which is only
 * correct for an explicit "cancel everything".
 *
 * @param {string} userId
 * @param {{flow?: string}} [opts]
 */
async function clearState(userId, opts = {}) {
  if (!userId) return false;
  const { flow } = opts;

  if (flow) {
    const current = await getState(userId);
    if (!current || current.flow !== flow) return false; // someone else's state — leave it
  }

  return writeRow(userId, null, null);
}

/**
 * Interrupt the current flow with a new one, keeping the old one resumable.
 *
 * A teacher who drifts out of coaching into a quiz has not abandoned coaching. The
 * old model overwrote, so the interrupted flow was simply gone.
 */
async function pushState(userId, next = {}) {
  const { flow, step = null, payload = {}, ttlSeconds } = next;
  if (!userId) throw new Error('conversation-state: userId is required');
  if (!flow) throw new Error('conversation-state: flow is required');
  assertTtl(ttlSeconds);

  const current = await getState(userId);

  const stack = current
    ? [
        { flow: current.flow, step: current.step, payload: current.payload },
        ...current.stack,
      ].slice(0, MAX_STACK_DEPTH)
    : [];

  const state = {
    flow,
    step,
    payload,
    stack,
    version: SHAPE_VERSION,
    updated_at: new Date(nowMs()).toISOString(),
  };

  // Report what actually happened. Returning the state object regardless of the
  // write would be the same silent failure this service exists to remove: the
  // caller would believe the teacher's step was recorded when it was not. A null
  // is safe to ignore — a missing state means "no wait pending" and every gate is
  // intent-first — but a caller must never be TOLD it succeeded when it did not.
  // (For popState a null therefore means "nothing was resumed", which is the
  // correct thing to act on whether the stack was empty or the write failed.)
  const ok = await writeRow(userId, state, isoIn(ttlSeconds));
  return ok ? hydrate(state) : null;
}

/**
 * Finish the current flow and resume the one it interrupted, if any.
 *
 * @returns {Promise<object|null>} the resumed state, or null when nothing was interrupted
 */
async function popState(userId, { ttlSeconds = 3600 } = {}) {
  if (!userId) return null;
  assertTtl(ttlSeconds);

  const current = await getState(userId);
  if (!current || current.stack.length === 0) {
    await writeRow(userId, null, null);
    return null;
  }

  const [resume, ...rest] = current.stack;
  const state = {
    flow: resume.flow,
    step: resume.step || null,
    payload: resume.payload || {},
    stack: rest,
    version: SHAPE_VERSION,
    updated_at: new Date(nowMs()).toISOString(),
  };

  // Report what actually happened. Returning the state object regardless of the
  // write would be the same silent failure this service exists to remove: the
  // caller would believe the teacher's step was recorded when it was not. A null
  // is safe to ignore — a missing state means "no wait pending" and every gate is
  // intent-first — but a caller must never be TOLD it succeeded when it did not.
  // (For popState a null therefore means "nothing was resumed", which is the
  // correct thing to act on whether the stack was empty or the write failed.)
  const ok = await writeRow(userId, state, isoIn(ttlSeconds));
  return ok ? hydrate(state) : null;
}

/**
 * Teachers whose current step has timed out.
 *
 * This is the input to "offer the thread back", not to a silent delete — the whole
 * point is that an abandoned flow becomes a question ("pick up, or start fresh?")
 * rather than something that quietly evaporates.
 */
async function sweepExpired({ limit = 100 } = {}) {
  const { data, error } = await supabase
    .from('users')
    .select('id, conversation_state, conversation_state_expires_at')
    .lt('conversation_state_expires_at', new Date(nowMs()).toISOString())
    .not('conversation_state', 'is', null)
    .limit(limit);

  if (error) {
    logToFile('⚠️ conversation-state: sweep failed', { error: error.message });
    return [];
  }

  return (data || [])
    .map((row) => {
      const state = hydrate(row.conversation_state);
      if (!state) return null;
      return {
        userId: row.id,
        flow: state.flow,
        step: state.step,
        payload: state.payload,
        expiredAt: row.conversation_state_expires_at,
      };
    })
    .filter(Boolean);
}

module.exports = {
  getState,
  setState,
  clearState,
  pushState,
  popState,
  sweepExpired,
  MAX_TTL_SECONDS,
  MAX_STACK_DEPTH,
};
