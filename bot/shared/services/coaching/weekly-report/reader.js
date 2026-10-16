'use strict';
/**
 * bd-v0toag.32 — the reads behind the weekly usage report. Existing tables only; no new columns.
 *
 *   cohort      niete_coaching_ab_assignment (ab_group B) → users in those schools → confirmed B by the
 *               v10 group lookup (coaching/ab-v10-arms.groupsForUsers, which is null for everyone while
 *               ab_v10_enabled is off).
 *   one week    conversations (role user) · niete_lp_downloads (sent) · niete_lp_opens (k5) ·
 *               coaching_sessions (graded recordings) · coaching_quality_metrics.
 *
 * Every read is scoped to one teacher and one week and bounded (Class R). Any read error THROWS: a report that quietly
 * shows 0 for a count it could not read would tell a teacher something false.
 *
 * ab-v10-arms lives on the v10 stack (origin/staging, origin/main). It is required lazily, so this module
 * loads on a branch without it and only the cohort call needs it.
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { pagedRows } = require('../../../utils/postgrest-paged');

const CHUNK = 200;
const MAX = { messages: 1000, deliveries: 500, opens: 500, sessions: 100, ratings: 200 };

function check(what, { data, error }) {
  if (error) {
    logToFile(`❌ v10 weekly report: ${what} read failed`, { error: error.message, code: error.code }, 'error');
    throw new Error(`v10 weekly report: ${what} read failed — ${error.message}`);
  }
  return data || [];
}

/** The ids of group B teachers who can be messaged: live, not test accounts, with a phone. */
async function groupBTeachers() {
  const arms = require('../ab-v10-arms');
  const schools = check('assignment', await supabase
    .from(arms.TABLE).select('school_id').eq('ab_group', 'B').limit(5000))
    .map((r) => r.school_id).filter(Boolean);
  if (!schools.length) return [];

  const candidates = [];
  for (let i = 0; i < schools.length; i += CHUNK) {
    const part = schools.slice(i, i + CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const rows = await pagedRows('v10 weekly report: teachers', () => supabase
      .from('users')
      .select('id, phone_number, is_test_user')
      .in('school_id', part)
      .eq('role', 'teacher')
      .is('deleted_at', null));
    // is_test_user is null for most real teachers, so it is filtered here, not with .neq in SQL.
    for (const u of rows) if (u.is_test_user !== true && u.phone_number) candidates.push(u.id);
  }
  if (!candidates.length) return [];

  const groups = await arms.groupsForUsers(candidates);
  return candidates.filter((id) => (groups.get(id) || {}).group === 'B');
}

/** The teacher the report is addressed to, read at send time (language may have changed). */
async function teacher(userId) {
  const { data, error } = await supabase.from('users')
    .select('id, name, phone_number, preferred_language')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) check('teacher', { error });
  return data || null;
}

/** conversations.created_at is a naive UTC timestamp: compare it with a zone-less UTC wall clock. */
const naive = (iso) => iso.replace(/\.\d+Z$|Z$/, '');

/** One teacher's rows for one week ({fromIso, toIso}). */
async function readWeek(userId, { fromIso, toIso }) {
  const [messages, deliveries, opens, sessions] = await Promise.all([
    supabase.from('conversations').select('created_at')
      .eq('user_id', userId).eq('role', 'user')
      .gte('created_at', naive(fromIso)).lt('created_at', naive(toIso))
      .limit(MAX.messages)
      .then((r) => check('messages', r)),
    supabase.from('niete_lp_downloads').select('lesson_id, created_at')
      .eq('user_id', userId).eq('status', 'sent')
      .gte('created_at', fromIso).lt('created_at', toIso)
      .limit(MAX.deliveries)
      .then((r) => check('lesson plan deliveries', r)),
    supabase.from('niete_lp_opens').select('plan_ref, opened_at')
      .eq('user_id', userId).eq('plan_kind', 'k5')
      .gte('opened_at', fromIso).lt('opened_at', toIso)
      .limit(MAX.opens)
      .then((r) => check('lesson plan opens', r)),
    supabase.from('coaching_sessions').select('id, created_at')
      .eq('user_id', userId).is('observation_type', null).not('analysis_data->scores', 'is', null)
      .gte('created_at', fromIso).lt('created_at', toIso)
      .order('created_at', { ascending: true })
      .limit(MAX.sessions)
      .then((r) => check('recordings', r)),
  ]);

  const ids = sessions.map((s) => s.id);
  const ratings = ids.length
    ? check('ratings', await supabase.from('coaching_quality_metrics')
      .select('coaching_session_id, user_satisfaction_rating')
      .in('coaching_session_id', ids)
      .limit(MAX.ratings))
    : [];

  return { messages, deliveries, opens, sessions, ratings };
}

module.exports = { groupBTeachers, teacher, readWeek };
