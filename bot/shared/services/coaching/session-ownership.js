/**
 * bd-wwcgf — who DRIVES a coaching session's conversation?
 *
 * A leader_observation row is owned by the observed TEACHER (user_id) but its
 * conversation is driven by the COACH (observer_user_id) — by design.
 * Every inbound-message matcher that resolves "the sender's active session" via
 * or(user_id.eq, observer_user_id.eq) therefore over-matches: the observed
 * teacher's own texts/photos hijack the coach's observation (3 Sep 2026 —
 * Saima's DC self-serve messages advanced Mubashar's observe session and the
 * editable observer form landed in her chat; Rifat's report, EMIS 221).
 *
 * Use with a query that selects user_id, observer_user_id, observation_type,
 * then keep only rows where the SENDER drives the conversation:
 *   - they are the observer on it, or
 *   - it is their own session and NOT a leader observation of them.
 */
function drivesSession(userId, session) {
  if (!session || !userId) return false;
  if (session.observer_user_id === userId) return true;
  return session.user_id === userId && session.observation_type !== 'leader_observation';
}

/** First row of `rows` (already recency-ordered) the sender actually drives. */
function firstDrivenSession(userId, rows) {
  return (rows || []).find((s) => drivesSession(userId, s)) || null;
}

module.exports = { drivesSession, firstDrivenSession };
