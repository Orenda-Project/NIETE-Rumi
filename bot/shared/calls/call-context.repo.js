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
 * coaching_sessions: her most recent COMPLETED session.
 * `status` values in production include completed / confirmed / abandoned /
 * failed / awaiting_observer_review / observer_review_complete — only a
 * completed one has a full analysis_data worth talking about.
 */
async function fetchLatestCoaching(userId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, analysis_data, completed_at, created_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .not('analysis_data', 'is', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
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

module.exports = {
  fetchUser,
  fetchLatestCoaching,
  fetchLpContext,
  fetchUpcomingVisit,
  fetchTraining,
  fetchMemory,
};
