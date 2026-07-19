/**
 * FEAT-053 bd-45 — the officer's teacher ROSTER.
 *
 * Attendance-parity teacher management for school leaders. The roster is the
 * EXPLICIT officer→teacher mapping, stored at `users.preferences.observe_teachers`
 * (zero new tables — Rule 15): [{ name, phone }], most-recently-used first.
 *
 * Lifecycle:
 *  - lazily backfilled ONCE from delivery history for officers who sent
 *    reports before the roster existed (then `[]` is persisted so the
 *    backfill never re-runs);
 *  - upserted on every send — same phone updates the name and moves to the
 *    front, which is also the RENAME path (re-add with the same number);
 *  - removable via the manage flow;
 *  - capped at ROSTER_CAP so it can never grow without bound.
 *
 * All writes are read-merge-write on the preferences JSON (the
 * seed-field-officers pattern) — other preference keys are never clobbered.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const ROSTER_CAP = 25;

function _clean(list) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && t.name && t.phone)
    .map((t) => ({ name: String(t.name), phone: String(t.phone) }));
}

async function _save(user, roster) {
  const preferences = { ...(user.preferences || {}), observe_teachers: roster };
  const { error } = await supabase
    .from('users')
    .update({ preferences })
    .eq('id', user.id);
  if (error) {
    // Non-fatal by design: the roster is a convenience layer — a failed save
    // must never block a send. The next successful write self-heals.
    logToFile('⚠️ observe roster save failed', { userId: user.id, error: error.message });
  } else {
    user.preferences = preferences;   // keep the in-hand user object coherent
  }
  return roster;
}

/** Delivery-history fallback — the pre-roster "memory" (bd-43), reused as backfill. */
async function _deriveFromHistory(observerUserId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('analysis_data, created_at')
    .eq('observer_user_id', observerUserId)
    .eq('observation_type', 'leader_observation')
    .not('analysis_data->teacher_delivery', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  const seen = new Set();
  const out = [];
  for (const row of data) {
    const td = (row.analysis_data || {}).teacher_delivery || {};
    if (!td.teacher_phone || !td.teacher_name || seen.has(td.teacher_phone)) continue;
    seen.add(td.teacher_phone);
    out.push({ name: td.teacher_name, phone: td.teacher_phone });
    if (out.length >= ROSTER_CAP) break;
  }
  return out;
}

/**
 * The officer's roster. Reads the explicit list when present; otherwise
 * backfills once from history and persists the result (even when empty, so
 * the history query never re-runs).
 */
async function getRoster(user) {
  const existing = user && user.preferences && user.preferences.observe_teachers;
  if (Array.isArray(existing)) return _clean(existing);
  const derived = await _deriveFromHistory(user.id);
  return _save(user, derived);
}

/** Add-or-refresh a teacher: same phone updates the name and moves to front. */
async function upsertTeacher(user, { name, phone }) {
  const roster = await getRoster(user);
  const rest = roster.filter((t) => t.phone !== String(phone));
  const next = [{ name: String(name), phone: String(phone) }, ...rest].slice(0, ROSTER_CAP);
  return _save(user, next);
}

/** Remove by phone. Unknown phones are a harmless no-op. */
async function removeTeacher(user, phone) {
  const roster = await getRoster(user);
  const next = roster.filter((t) => t.phone !== String(phone));
  if (next.length === roster.length) return roster;
  return _save(user, next);
}

module.exports = { getRoster, upsertTeacher, removeTeacher, ROSTER_CAP };
