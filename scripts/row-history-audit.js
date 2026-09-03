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
  // conversation_state was REMOVED after measuring production: 43% of rows but
  // 93% of record_history's bytes, because each diff stores the whole nested
  // conversation twice. It is ephemeral session scratch — the same reason
  // chat_sessions is excluded. The status transitions are what people dispute.
  coaching_sessions: ['status', 'lesson_plan_extraction_status', 'debrief_status'],
  lesson_plan_requests: ['status', 'retry_count', 'error_message'],
  training_assessment_attempts: ['status', 'score', 'total_score', 'is_passed', 'level_id'],
  observation_schedules: ['status'],

  // Roster and config: low churn, high blast radius. Nobody notices a wrong
  // roster row on the day; they notice when a child is missing from a register.
  app_settings: ['value'],
  class_enrollments: ['is_active', 'class_id', 'student_id'],
  students: ['student_name', 'father_name', 'roll_number', 'is_active', 'status', 'school_id'],
  student_lists: ['is_active'],
  schools: ['name', 'emis', 'region', 'principal_user_id', 'is_active'],
  teacher_attendance_records: ['status', 'leave_type', 'school_id'],
  class_teachers: ['is_active', 'is_class_teacher'],
  teacher_training_assignments: ['is_active', 'assigned_by'],
  exam_check_sessions: ['status'],
};

/**
 * The primary key each audited table is addressed by. app_settings is the reason
 * this map exists: its PK is `key text`, not `id uuid`, and the original trigger
 * failed on it with `record "new" has no field "id"`.
 */
const KEY_COLUMN = {
  users: 'id', coaching_sessions: 'id', lesson_plan_requests: 'id',
  training_assessment_attempts: 'id', observation_schedules: 'id',
  app_settings: 'key',
  class_enrollments: 'id', students: 'id', student_lists: 'id', schools: 'id',
  teacher_attendance_records: 'id', class_teachers: 'id',
  teacher_training_assignments: 'id', exam_check_sessions: 'id',
};

/** The row key the trigger writes into record_history.row_id (always text). */
function rowKey(table, row) {
  const col = KEY_COLUMN[table];
  if (!col) throw new Error(`no key column for table ${table}`);
  const v = row ? row[col] : undefined;
  if (v === null || v === undefined) return null;
  return String(v);
}

/** Tables deliberately NOT audited, with the reason, so the omission is a decision. */
const EXCLUDED = {
  chat_sessions: 'ephemeral per-message conversation_state; ~22k updates/day of pure noise',
  training_certificates: '19 rows / 2,705 updates — a regeneration loop, not state worth keeping',
};

/**
 * Columns deliberately dropped from a table that IS audited, with the evidence.
 * Kept next to the allowlist so the omission reads as a decision, not an oversight.
 */
const DROPPED_COLUMNS = {
  'coaching_sessions.conversation_state':
    'measured in prod: 43% of record_history rows but 93% of its bytes (1,199 B/row vs 73). Ephemeral per-turn scratch.',
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
  WATCHED, EXCLUDED, DROPPED_COLUMNS, NIETE_PROJECT_REF, KEY_COLUMN,
  assertProjectRef, isDistinct, diffWatched, attributeActor, isAudited, rowKey,
};
