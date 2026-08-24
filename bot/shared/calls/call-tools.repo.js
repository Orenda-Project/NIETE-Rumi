'use strict';
/**
 * Data access for the call tools (bd-1hae7.9). Design: PLAN.md Appendix C.
 *
 * Split from `call-tools.service` so the formatting and the caps are unit-tested
 * against fixtures while this file stays a thin, auditable set of queries.
 *
 * TWO RULES ENFORCED HERE:
 *
 * 1. **Every query is caller-scoped, and an unscoped call THROWS.** The guard is
 *    in one place so "I forgot the filter" is impossible to write, not merely
 *    discouraged.
 * 2. **Only the named columns are selected.** The SELECT list is part of the
 *    design: `transcript_text`, `reflective_corpus` and the per-domain
 *    narratives would each blow the prompt budget alone, and `teacher_phone`
 *    must never reach a call.
 *
 * Latency: every query below runs on an EXISTING index (verified on staging
 * 2026-08-24 — no migration needed):
 *   conversations      idx_conversations_user_created (user_id, created_at DESC)   19 ms
 *   coaching_sessions  idx_coaching_sessions_user_status / _observer_pending      0.2 ms
 *   leader_teachers    idx_leader_teachers_leader_school (leader_user_id, …)     0.04 ms
 */

const supabase = require('../config/supabase');
const { FINISHED_COACHING_STATUSES } = require('./call-context.repo');

/** The one place an unscoped query is caught. */
function requireCaller(userId, what) {
  if (!userId) throw new Error(`UNSCOPED QUERY refused (${what}) — no caller id`);
  return userId;
}

/**
 * Her observations — as SUBJECT and as OBSERVER. Two queries rather than an
 * `.or()` so each rides its own index.
 */
async function findCoaching({ userId, about }) {
  requireCaller(userId, 'findCoaching');
  const COLS = 'id, user_id, observer_user_id, analysis_data, status, completed_at, created_at';

  const [mine, observed] = await Promise.all([
    supabase.from('coaching_sessions').select(COLS)
      .eq('user_id', userId).in('status', FINISHED_COACHING_STATUSES)
      .not('analysis_data', 'is', null)
      .order('completed_at', { ascending: false, nullsFirst: false }).limit(5),
    supabase.from('coaching_sessions').select(COLS)
      .eq('observer_user_id', userId).in('status', FINISHED_COACHING_STATUSES)
      .not('analysis_data', 'is', null)
      .order('completed_at', { ascending: false, nullsFirst: false }).limit(5),
  ]);
  if (mine.error) throw new Error(mine.error.message);
  if (observed.error) throw new Error(observed.error.message);

  let rows = [...(mine.data || []), ...(observed.data || [])];

  // "How did Fatima do?" — only ever within what SHE observed.
  if (about) {
    const names = await teacherNames((observed.data || []).map((r) => r.user_id));
    const needle = String(about).toLowerCase();
    const matching = (observed.data || []).filter((r) => {
      const n = names.get(r.user_id);
      return n && n.toLowerCase().includes(needle);
    });
    rows = matching.length ? matching : (observed.data || []);
  }

  return rows.sort((a, b) => {
    const x = a.completed_at || a.created_at;
    const y = b.completed_at || b.created_at;
    return x < y ? 1 : -1;
  });
}

/** Her past WhatsApp conversation with Rumi. */
async function searchChats({ userId, query, onDate }) {
  requireCaller(userId, 'searchChats');
  let q = supabase.from('conversations')
    .select('role, content, created_at')
    .eq('user_id', userId);

  if (onDate) {
    q = q.gte('created_at', `${onDate}T00:00:00Z`).lte('created_at', `${onDate}T23:59:59Z`);
  }
  if (query && String(query).trim()) {
    // Escape the PostgREST pattern metacharacters; the caller-scope filter above
    // is what actually contains this, but a clean pattern avoids surprises.
    const safe = String(query).replace(/[%_,()]/g, ' ').trim();
    if (safe) q = q.ilike('content', `%${safe}%`);
  }

  const { data, error } = await q.order('created_at', { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Lessons actually delivered to her.
 *
 * Deliberately the SAME resolution the chat pipeline uses (`lp-context`):
 * `niete_lp_downloads` → v8 catalog for the human heading → `niete_lp_assets`
 * for the `r2_key` of the exact version she was sent, keyed by `content_hash`
 * so a re-rendered lesson can never swap her script out from under her.
 * Version-exact, no name-matching, no search.
 */
async function findLessons({ userId }) {
  requireCaller(userId, 'findLessons');
  const { data, error } = await supabase
    .from('niete_lp_downloads')
    .select('lesson_id, content_hash, version_stamp, grade, subject, chapter_number, created_at')
    .eq('user_id', userId)
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);

  const V8Catalog = require('../services/lp-v8-catalog.service');
  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    if (seen.has(row.lesson_id)) continue;
    seen.add(row.lesson_id);

    const hit = V8Catalog.lessonById(row.lesson_id);
    if (!hit) continue;
    const { lesson, chapter, book } = hit;

    out.push({
      lesson_id: row.lesson_id,
      content_hash: row.content_hash,
      version_stamp: row.version_stamp,
      grade: row.grade != null ? row.grade : book.grade,
      subject: row.subject || book.subject_key,
      subject_label: book.subject,
      chapter_number: row.chapter_number != null ? row.chapter_number : chapter.number,
      chapter_title: chapter.title,
      topic: lesson.topic_short || lesson.topic,
      created_at: row.created_at,
    });
  }
  return out;
}

/**
 * The voice-note script + must-happen moves for ONE lesson, version-exact.
 * Signatures here are the real ones: `getVoicenoteScript` takes an entry
 * carrying `r2_key`, and `resolveMoveList` takes `{lesson_id, content_hash}`.
 */
async function readLessonScript({ lessonId, contentHash }) {
  const { getVoicenoteScript } = require('../services/lp-voicenote-script.service');
  const { resolveMoveList } = require('../services/coaching/fidelity/lp-fidelity-store');

  // The r2_key of the exact version she received.
  let r2Key = null;
  if (contentHash) {
    const { data: asset } = await supabase
      .from('niete_lp_assets')
      .select('r2_key')
      .eq('lesson_id', lessonId)
      .eq('asset_kind', 'lesson')
      .eq('content_hash', contentHash)
      .maybeSingle();
    r2Key = (asset && asset.r2_key) || null;
  }

  const [script, resolved] = await Promise.all([
    Promise.resolve().then(() => (r2Key ? getVoicenoteScript({ r2_key: r2Key }) : null)).catch(() => null),
    Promise.resolve().then(() => resolveMoveList({ lesson_id: lessonId, content_hash: contentHash })).catch(() => null),
  ]);

  return {
    script: script ? String(script).replace(/\s+/g, ' ').slice(0, 900) : null,
    moves: ((resolved && resolved.moves) || [])
      .filter((m) => m && m.bucket === 'must_happen' && m.adjudicable !== false && m.text)
      .map((m) => m.text)
      .slice(0, 8),
  };
}

/** Teachers assigned to a coach/AEO/leader. teacher_phone is NEVER selected. */
async function findRoster({ userId, school }) {
  requireCaller(userId, 'findRoster');
  let q = supabase.from('leader_teachers')
    .select('teacher_name, level, school_ext_id')
    .eq('leader_user_id', userId);
  if (school) q = q.ilike('school_ext_id', `%${String(school).replace(/[%_]/g, ' ')}%`);

  const { data, error } = await q.limit(200);
  if (error) throw new Error(error.message);

  const schools = await schoolNames(userId);
  return (data || []).map((r) => ({
    teacher_name: r.teacher_name,
    level: r.level,
    school_name: schools.get(r.school_ext_id) || null,
  }));
}

/** Her upcoming observation visits, as the leader conducting them. */
async function findSchedules({ userId }) {
  requireCaller(userId, 'findSchedules');
  const { data, error } = await supabase
    .from('observation_schedules')
    .select('teacher_name, school_name, scheduled_for, status')
    .eq('leader_user_id', userId)
    .gte('scheduled_for', new Date().toISOString().slice(0, 10))
    .not('status', 'in', '("cancelled")')
    .order('scheduled_for', { ascending: true })
    .limit(10);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Resolve one observed teacher's display name. */
async function resolveTeacherName(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from('users').select('first_name, last_name').eq('id', userId).maybeSingle();
  if (!data) return null;
  return [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
}

// ---------------------------------------------------------------- internals

async function teacherNames(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  const { data } = await supabase.from('users').select('id, first_name, last_name').in('id', unique);
  (data || []).forEach((u) => {
    map.set(u.id, [u.first_name, u.last_name].filter(Boolean).join(' '));
  });
  return map;
}

async function schoolNames(leaderUserId) {
  const map = new Map();
  const { data } = await supabase
    .from('leader_schools').select('school_ext_id, school_name').eq('leader_user_id', leaderUserId);
  (data || []).forEach((s) => map.set(s.school_ext_id, s.school_name));
  return map;
}

module.exports = {
  findCoaching,
  searchChats,
  findLessons,
  readLessonScript,
  findRoster,
  findSchedules,
  resolveTeacherName,
};
