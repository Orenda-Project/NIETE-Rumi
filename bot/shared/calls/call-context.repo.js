'use strict';
/**
 * The live data sources behind the connect context (bd-1hae7.6).
 *
 * Kept apart from `call-context.service` on purpose: the service is pure
 * assembly and formatting (fully unit-tested against live-shaped fixtures),
 * this file is the thin Supabase layer. Column names here were verified against
 * the live staging schema on 2026-08-24 — not remembered, queried.
 *
 * Every function returns a plain object or null. None of them throws for
 * "nothing found"; the service treats a throw as a failed block and carries on,
 * so a genuine error still degrades to a call that simply knows less.
 */

const supabase = require('../config/supabase');

/** users: the caller's profile, by wa_id. */
async function fetchUser(waId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, name, school_name, grades_taught, subjects_taught, '
      + 'grade, subject, preferred_language, role, region, organization')
    .eq('phone_number', waId)
    .maybeSingle();
  if (error) throw new Error(`users lookup failed: ${error.message}`);
  return data || null;
}

/**
 * coaching_sessions: her most recent FINISHED session.
 *
 * A session is finished in TWO states, not one — and filtering on `completed`
 * alone hid 38 fully-analysed sessions on staging, including the caller's own on
 * the first real call. She then told him she could not see his report, which was
 * both wrong and alarming.
 *
 * Live counts (staging, 2026-08-24), sessions carrying analysis_data:
 *   completed 102 · observer_review_complete 38  ← both finished, both included
 *   awaiting_observer_review 14                  ← analysed but NOT yet reviewed,
 *                                                  so not final: excluded
 *   abandoned 6 · cancelled 2 · failed 1         ← excluded
 */
const FINISHED_COACHING_STATUSES = ['completed', 'observer_review_complete'];

async function fetchLatestCoaching(userId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, analysis_data, status, completed_at, created_at')
    .eq('user_id', userId)
    .in('status', FINISHED_COACHING_STATUSES)
    .not('analysis_data', 'is', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`coaching lookup failed: ${error.message}`);
  return (data && data[0]) || null;
}

/**
 * The SAME recent-lessons block the chat pipeline injects — content_hash-exact,
 * voicenote script and must-happen moves included. Reused, not reimplemented, so
 * a lesson she asks about on the phone is the lesson she was actually sent.
 */
async function fetchLpContext(userId) {
  const { buildLpContext } = require('../services/lp-context.service');
  const ctx = await buildLpContext(userId);
  return ctx && ctx.fullBlock ? ctx.fullBlock : null;
}

/** hcp_visit_schedules: her next scheduled observation. teacher_id is a uuid. */
async function fetchUpcomingVisit(userId) {
  const { data, error } = await supabase
    .from('hcp_visit_schedules')
    .select('scheduled_at, observation_tool, status')
    .eq('teacher_id', userId)
    .gte('scheduled_at', new Date().toISOString())
    .not('status', 'in', '("cancelled")')
    .order('scheduled_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`visit lookup failed: ${error.message}`);
  return (data && data[0]) || null;
}

/** teacher_training_progress + training_modules: where she is in the course. */
async function fetchTraining(userId) {
  const { data, error } = await supabase
    .from('teacher_training_progress')
    .select('module_id, completed_at')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false });
  if (error) throw new Error(`training lookup failed: ${error.message}`);
  if (!data || data.length === 0) return null;

  const { count, error: countError } = await supabase
    .from('training_modules')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);
  if (countError) throw new Error(`module count failed: ${countError.message}`);

  let latestTitle = null;
  if (data[0] && data[0].module_id) {
    const { data: mod } = await supabase
      .from('training_modules').select('title').eq('id', data[0].module_id).maybeSingle();
    latestTitle = (mod && mod.title) || null;
  }
  return { completed: data.length, total: count || data.length, latestTitle };
}

/**
 * call_memory: the bounded rolling summary of previous calls (bd-1hae7.10).
 * Returns null until that table exists — the block is simply absent.
 */
async function fetchMemory(waId) {
  const { data, error } = await supabase
    .from('call_memory')
    .select('summary, updated_at, call_count')
    .eq('caller_number', waId)
    .maybeSingle();
  if (error) throw new Error(`call_memory lookup failed: ${error.message}`);
  return data || null;
}

/**
 * call_memory (write side, bd-neeyat): upsert the caller's rolling summary after
 * a call. The read side (fetchMemory) already existed; nothing wrote it, so the
 * "PREVIOUS CALLS WITH HER" block never filled. Keyed by caller_number.
 */
async function upsertMemory(waId, { summary, callCount }) {
  const row = { caller_number: waId, summary, updated_at: new Date().toISOString() };
  if (Number.isFinite(callCount)) row.call_count = callCount;
  const { error } = await supabase
    .from('call_memory')
    .upsert(row, { onConflict: 'caller_number' });
  if (error) throw new Error(`call_memory upsert failed: ${error.message}`);
}

/**
 * Observations this caller CONDUCTED (`coaching_sessions.observer_user_id`).
 *
 * Not every caller is the subject of an observation. Coaches, AEOs and school
 * leaders ring up about the teachers THEY observed — on staging 64 sessions
 * across 17 distinct observers — and we held all of it while telling them we had
 * nothing. The caller's own role no longer decides what she can ask about.
 */
async function fetchObservedSessions(userId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, user_id, analysis_data, status, completed_at, created_at')
    .eq('observer_user_id', userId)
    .in('status', FINISHED_COACHING_STATUSES)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw new Error(`observed sessions lookup failed: ${error.message}`);
  if (!data || !data.length) return [];

  // Resolve the observed teachers' names in ONE round trip.
  const teacherIds = [...new Set(data.map((r) => r.user_id).filter(Boolean))];
  const names = new Map();
  if (teacherIds.length) {
    const { data: teachers } = await supabase
      .from('users').select('id, first_name, last_name, school_name').in('id', teacherIds);
    (teachers || []).forEach((t) => names.set(t.id, t));
  }

  return data.map((row) => {
    const t = names.get(row.user_id) || {};
    const focus = row.analysis_data && row.analysis_data.focus_area;
    return {
      teacherName: [t.first_name, t.last_name].filter(Boolean).join(' ') || null,
      schoolName: t.school_name || null,
      when: row.completed_at || row.created_at,
      focus: (typeof focus === 'string' ? focus : (focus && focus.title)) || null,
    };
  });
}

module.exports = {
  fetchUser,
  fetchLatestCoaching,
  fetchLpContext,
  fetchUpcomingVisit,
  fetchTraining,
  fetchMemory,
  upsertMemory,
  fetchObservedSessions,
  FINISHED_COACHING_STATUSES,
};
