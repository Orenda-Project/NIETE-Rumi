/**
 * row-history-audit — what the record_history trigger must and must not record.
 *
 * These tests exist because an audit trigger fails in two opposite directions and
 * both are silent. Record too much and the history table outgrows the 902 MB table
 * it observes, and the four status transitions that matter get buried in counter
 * churn. Record too little and the incident you built it for is the one it missed.
 *
 * The live-data case at the bottom is the reason this feature was commissioned:
 * 68 rows in training_assessment_attempts are status='passed' with is_passed=false,
 * and nothing in the database can say how they got that way.
 */
const {
  WATCHED, EXCLUDED, NIETE_PROJECT_REF,
  assertProjectRef, isDistinct, diffWatched, attributeActor, isAudited,
} = require('../../scripts/row-history-audit');

const eq = (a, b) => expect(a).toEqual(b);
const t = (name, fn) => it(name, fn);

describe('row history audit — the allowlist', () => {

// ── the cost story ───────────────────────────────────────────────────────────
// users takes ~600-1100 row-touches/day, almost all timestamp and counter
// movement. If those record, the feature is not affordable.

t('records NOTHING when only unwatched columns move', () => {
  const before = { id: 'u1', preferred_language: 'en', updated_at: '2026-09-01', last_message_at: '2026-09-01' };
  const after  = { id: 'u1', preferred_language: 'en', updated_at: '2026-09-02', last_message_at: '2026-09-02' };
  eq(diffWatched('users', before, after), null);
});

t('records NOTHING when conversation_state churns on users', () => {
  // 292 users carry conversation_state; it is rewritten per message.
  const before = { id: 'u1', role: 'teacher', conversation_state: { step: 1 } };
  const after  = { id: 'u1', role: 'teacher', conversation_state: { step: 2 } };
  eq(diffWatched('users', before, after), null);
});

t('DOES record when a watched column moves alongside noise', () => {
  const before = { id: 'u1', preferred_language: 'en', updated_at: '2026-09-01' };
  const after  = { id: 'u1', preferred_language: 'ur', updated_at: '2026-09-02' };
  const d = diffWatched('users', before, after);
  eq(d.changed_cols, ['preferred_language']);
  eq(d.old_vals.preferred_language, 'en');
  eq(d.new_vals.preferred_language, 'ur');
});

// ── the incident this is built for (rule 20) ─────────────────────────────────

t('captures a language flip with both sides of the value', () => {
  const d = diffWatched('users',
    { id: 'u1', preferred_language: 'ur', language_locked: true },
    { id: 'u1', preferred_language: 'en', language_locked: false });
  eq(d.changed_cols.sort(), ['language_locked', 'preferred_language']);
  eq(d.old_vals.language_locked, true);
  eq(d.new_vals.language_locked, false);
});

// ── null handling: SQL IS DISTINCT FROM, not === ─────────────────────────────

t('null -> value is a change', () => eq(isDistinct(null, 'en'), true));
t('value -> null is a change', () => eq(isDistinct('en', null), true));
t('null -> null is NOT a change', () => eq(isDistinct(null, null), false));
t('undefined and null are treated alike', () => eq(isDistinct(undefined, null), false));
t('false -> null is a change (falsy is not absent)', () => eq(isDistinct(false, null), true));
t('false -> false is NOT a change', () => eq(isDistinct(false, false), false));
t('0 -> null is a change', () => eq(isDistinct(0, null), true));

t('a jsonb column compares by value, not identity', () => {
  eq(isDistinct({ a: 1 }, { a: 1 }), false);
  eq(isDistinct({ a: 1 }, { a: 2 }), true);
});

t('an array column compares by value', () => {
  eq(diffWatched('users', { id: 'u', levels: ['L1'] }, { id: 'u', levels: ['L1'] }), null);
  eq(diffWatched('users', { id: 'u', levels: ['L1'] }, { id: 'u', levels: ['L1','L2'] })
     .changed_cols, ['levels']);
});

// ── coaching_sessions: four state machines, 63 columns, 902 MB ───────────────

t('watches exactly the four coaching status columns and nothing else', () => {
  eq(WATCHED.coaching_sessions.sort(),
     ['conversation_state','debrief_status','lesson_plan_extraction_status','status']);
});

t('ignores the other ~59 coaching_sessions columns', () => {
  eq(diffWatched('coaching_sessions',
     { id: 'c1', status: 'completed', transcript: 'a', audio_url: 'x' },
     { id: 'c1', status: 'completed', transcript: 'b', audio_url: 'y' }), null);
});

t('captures an abandoned coaching session', () => {
  const d = diffWatched('coaching_sessions',
    { id: 'c1', status: 'conducting_conversation' },
    { id: 'c1', status: 'abandoned' });
  eq(d.changed_cols, ['status']);
  eq(d.old_vals.status, 'conducting_conversation');
});

// ── the 68 contradictory rows ────────────────────────────────────────────────

t('captures the passed/is_passed=false contradiction as a single event', () => {
  const d = diffWatched('training_assessment_attempts',
    { id: 'a1', status: 'in_progress', is_passed: null, score: 40 },
    { id: 'a1', status: 'passed',      is_passed: false, score: 40 });
  eq(d.changed_cols.sort(), ['is_passed', 'status']);
  eq(d.new_vals.status, 'passed');
  eq(d.new_vals.is_passed, false);
});

t('captures a score being rewritten after the fact', () => {
  const d = diffWatched('training_assessment_attempts',
    { id: 'a1', status: 'failed', score: 40, total_score: 100, is_passed: false },
    { id: 'a1', status: 'passed', score: 80, total_score: 100, is_passed: true });
  eq(d.changed_cols.sort(), ['is_passed', 'score', 'status']);
  eq(d.old_vals.score, 40);
});

// ── lesson_plan_requests: no updated_at exists on this table at all ──────────

t('records the retry sequence that no timestamp column captures', () => {
  const d = diffWatched('lesson_plan_requests',
    { id: 'r1', status: 'pending', retry_count: 0, error_message: null },
    { id: 'r1', status: 'failed',  retry_count: 1, error_message: 'gamma timeout' });
  eq(d.changed_cols.sort(), ['error_message', 'retry_count', 'status']);
});

// ── INSERT / DELETE ──────────────────────────────────────────────────────────

t('an INSERT records the watched columns present on the new row', () => {
  const d = diffWatched('observation_schedules', null, { id: 'o1', status: 'upcoming' });
  eq(d.changed_cols, ['status']);
  eq(d.new_vals.status, 'upcoming');
});

t('a DELETE records the watched columns from the old row', () => {
  const d = diffWatched('observation_schedules', { id: 'o1', status: 'cancelled' }, null);
  eq(d.changed_cols, ['status']);
  eq(d.old_vals.status, 'cancelled');
});

// ── actor attribution is honest about what it knows ──────────────────────────

t('a portal write is attributed to the jwt subject', () => {
  eq(attributeActor({ jwtClaims: '{"sub":"user-123"}', sessionUser: 'authenticator' }),
     { actor: 'user-123', actor_source: 'postgrest' });
});

t('a bot/worker write is NOT dressed up as a person', () => {
  eq(attributeActor({ sessionUser: 'postgres' }),
     { actor: 'postgres', actor_source: 'sql' });
});

t('an app-set actor is recorded as service_role, not postgrest', () => {
  eq(attributeActor({ appActor: 'worker:sqs', sessionUser: 'postgres' }),
     { actor: 'worker:sqs', actor_source: 'service_role' });
});

t('malformed jwt claims degrade to session_user rather than throwing', () => {
  eq(attributeActor({ jwtClaims: 'not json', sessionUser: 'authenticator' }),
     { actor: 'authenticator', actor_source: 'postgrest' });
});

// ── the wrong-database guard (the bd-2533 footgun) ───────────────────────────

t('refuses to run against the MAIN BOT project', () => {
  expect(() => assertProjectRef('https://jlpenspfdcwxkopaidys.supabase.co'))
    .toThrow(/refusing to run/);
});

t('accepts the NIETE project', () => {
  eq(assertProjectRef(`https://${NIETE_PROJECT_REF}.supabase.co`), NIETE_PROJECT_REF);
});

t('refuses an empty or malformed url', () => {
  expect(() => assertProjectRef('')).toThrow(/refusing to run/);
  expect(() => assertProjectRef(undefined)).toThrow(/refusing to run/);
});

// ── exclusions are decisions, not oversights ─────────────────────────────────

t('chat_sessions is explicitly excluded with a reason', () => {
  eq(isAudited('chat_sessions'), false);
  expect(EXCLUDED.chat_sessions).toMatch(/noise/);
});

t('training_certificates is explicitly excluded with a reason', () => {
  eq(isAudited('training_certificates'), false);
  expect(EXCLUDED.training_certificates).toMatch(/regeneration loop/);
});

t('an unknown table is a programming error, not a silent no-op', () => {
  expect(() => diffWatched('some_new_table', {}, {})).toThrow(/no allowlist/);
});

});
