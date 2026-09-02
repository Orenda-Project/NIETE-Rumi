/**
 * row-history-audit — the decision logic behind the record_history trigger,
 * extracted so it can be tested without a live database.
 *
 * The SQL in bot/database/migrations/row_history_audit.sql is the thing that
 * actually runs. These functions mirror its semantics exactly so the rules can
 * be pinned by tests: which columns are watched, when a write records nothing,
 * and how the actor is attributed. If you change one, change the other.
 */

const WATCHED = {
  users: [
    'phone_number', 'first_name', 'last_name', 'name', 'preferred_language',
    'language_locked', 'registration_state', 'registration_completed', 'role',
    'region', 'country', 'organization', 'school_id', 'school_name', 'teacher_uuid',
    'grade', 'subject', 'grades_taught', 'subjects_taught', 'levels', 'training_bands',
    'is_test_user', 'portal_activated',
  ],
  coaching_sessions: [
    'status', 'conversation_state', 'lesson_plan_extraction_status', 'debrief_status',
  ],
  lesson_plan_requests: ['status', 'retry_count', 'error_message'],
  training_assessment_attempts: ['status', 'score', 'total_score', 'is_passed', 'level_id'],
  observation_schedules: ['status'],
};

/** Tables deliberately NOT audited, with the reason, so the omission is a decision. */
const EXCLUDED = {
  chat_sessions: 'ephemeral per-message conversation_state; ~22k updates/day of pure noise',
  training_certificates: '19 rows / 2,705 updates — a regeneration loop, not state worth keeping',
};

const NIETE_PROJECT_REF = 'ihzciabopbttygxxgrkm';

/**
 * Refuse to run against any database that is not NIETE. The worktree tooling
 * seeds .env from the MAIN BOT, which points at a different production project —
 * this is the guard that turns that footgun into an abort.
 */
function assertProjectRef(supabaseUrl) {
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(supabaseUrl || '');
  const ref = m && m[1];
  if (ref !== NIETE_PROJECT_REF) {
    throw new Error(
      `refusing to run: expected NIETE project ${NIETE_PROJECT_REF}, got ${ref || 'none'}`
    );
  }
  return ref;
}

/** SQL `IS DISTINCT FROM` — null-safe, unlike ===. */
function isDistinct(a, b) {
  if (a === null || a === undefined) return !(b === null || b === undefined);
  if (b === null || b === undefined) return true;
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  return a !== b;
}

/**
 * The diff the trigger computes. Returns null when nothing watched moved —
 * that null is the reason this feature is affordable.
 */
function diffWatched(table, oldRow, newRow) {
  const watched = WATCHED[table];
  if (!watched) throw new Error(`no allowlist for table ${table}`);
  const changed = [];
  const old_vals = {};
  const new_vals = {};
  for (const col of watched) {
    if (isDistinct(oldRow ? oldRow[col] : undefined, newRow ? newRow[col] : undefined)) {
      changed.push(col);
      old_vals[col] = oldRow ? oldRow[col] : undefined;
      new_vals[col] = newRow ? newRow[col] : undefined;
    }
  }
  if (changed.length === 0) return null;
  return { changed_cols: changed, old_vals, new_vals };
}

/**
 * Actor attribution, best-effort and explicit about which case it hit.
 * PostgREST sets request.jwt.claims; the bot/workers do not.
 */
function attributeActor({ jwtClaims, appActor, sessionUser }) {
  if (jwtClaims) {
    let sub = null;
    try {
      sub = JSON.parse(jwtClaims).sub || null;
    } catch (_) {
      sub = null;
    }
    return { actor: sub || sessionUser || null, actor_source: 'postgrest' };
  }
  if (appActor) return { actor: appActor, actor_source: 'service_role' };
  return { actor: sessionUser || null, actor_source: 'sql' };
}

function isAudited(table) {
  return Object.prototype.hasOwnProperty.call(WATCHED, table);
}

module.exports = {
  WATCHED, EXCLUDED, NIETE_PROJECT_REF,
  assertProjectRef, isDistinct, diffWatched, attributeActor, isAudited,
};
