'use strict';
/**
 * Storage for the video recommendation (bd-gzfdu9, SPEC v1.2.1 §3.6): one video_recommendations row per coaching
 * session, the teacher's recommendation history, their place on the training ladder, their grade bands. Every
 * function returns; none throws. A DB error is one warn log and the safe answer (null / empty), so a missing table
 * on a tier without the migration can never touch a report.
 */
const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { teacherLevelOf } = require('../../../utils/teacher-level');

const TABLE = 'video_recommendations';
const LADDER_LEVELS = new Set([1, 2, 3, 4]); // training_levels 1–4 = the CPD ladder (vendor af3e929e…); other vendors' ids are not ours
const MAX_ROWS = 500;
const DAY = 86400000;

function warn(what, err, extra = {}) {
  logToFile(`[video-reco] store: ${what} failed (non-fatal)`, { ...extra, error: (err && err.message) || String(err) }, 'warn');
}

async function readForSession(coachingSessionId) {
  try {
    const { data, error } = await supabase.from(TABLE).select('*').eq('coaching_session_id', coachingSessionId).maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (e) {
    warn('readForSession', e, { coachingSessionId });
    return null;
  }
}

/**
 * What this engine already put in front of the teacher — status 'shown' only (SPEC v1.3 §3.6, lead-review 19:11Z:
 * shadow, none and error rows stay for the A/B and evals but never block a chapter the teacher never saw): every
 * chapter of the last 365 days (never again), and the modules with ≥ 2 chapters in the last 180 days. Completed training modules are
 * NOT history (r-corpus: 70% of coached teachers finished the whole ladder; re-seeing one chapter is the point).
 */
async function recentHistory(userId) {
  try {
    const since = new Date(Date.now() - 365 * DAY).toISOString();
    const { data, error } = await supabase.from(TABLE).select('seg_id, module_id, created_at')
      .eq('user_id', userId).eq('status', 'shown').gte('created_at', since).not('seg_id', 'is', null).limit(MAX_ROWS);
    if (error) throw error;
    const recent = Date.now() - 180 * DAY;
    const segments = [];
    const perModule = new Map();
    for (const r of data || []) {
      if (!segments.includes(r.seg_id)) segments.push(r.seg_id);
      if (new Date(r.created_at).getTime() >= recent) {
        const m = Number(r.module_id);
        perModule.set(m, (perModule.get(m) || new Set()).add(r.seg_id));
      }
    }
    return { segments, modules: [...perModule].filter(([, s]) => s.size >= 2).map(([m]) => m) };
  } catch (e) {
    warn('recentHistory', e, { userId });
    return { segments: [], modules: [] };
  }
}

/** The highest ladder level with a completed module (null when none — never a default) and those module ids. */
async function ladderProgress(userId) {
  try {
    const { data, error } = await supabase.from('teacher_training_progress')
      .select('module_id, training_modules!inner(training_courses!inner(level_id))')
      .eq('user_id', userId).not('completed_at', 'is', null).limit(MAX_ROWS);
    if (error) throw error;
    let level = null;
    const completedModules = [];
    for (const r of data || []) {
      const lv = Number(r && r.training_modules && r.training_modules.training_courses && r.training_modules.training_courses.level_id);
      if (!LADDER_LEVELS.has(lv)) continue;
      completedModules.push(Number(r.module_id));
      level = level === null ? lv : Math.max(level, lv);
    }
    return { level, completedModules };
  } catch (e) {
    warn('ladderProgress', e, { userId });
    return { level: null, completedModules: [] };
  }
}

/**
 * The teacher's bands (PRIMARY/MIDDLE/HIGH), the grade chain's second link (H7), read through the repo's single
 * source: users.teacher_level via utils/teacher-level.js. users.training_bands exists on the sandbox DB only; on
 * staging and prod the query failed and the link was always empty (bd-8hhqhf r7, promo 073156).
 */
async function trainingBands(userId) {
  try {
    const { data, error } = await supabase.from('users').select('teacher_level').eq('id', userId).maybeSingle();
    if (error) throw error;
    return teacherLevelOf(data);
  } catch (e) {
    warn('trainingBands', e, { userId });
    return [];
  }
}

/**
 * bd-8hhqhf R7d (⛔9, panel Q086): the name words on the teacher's own class roster — students and fathers, Latin and
 * Urdu — from the classes they teach (class_teachers → class_enrollments) and the lists they keep (student_lists). Held
 * in memory for this run only, never stored. [] on any error or when the teacher has no roster.
 */
async function rosterNames(userId) {
  try {
    const cols = 'student_name, student_name_urdu, father_name, father_name_urdu';
    const [classes, lists] = await Promise.all([
      supabase.from('class_teachers').select('class_id').eq('teacher_user_id', userId).eq('is_active', true).limit(MAX_ROWS),
      supabase.from('student_lists').select('id').eq('user_id', userId).limit(MAX_ROWS),
    ]);
    if (classes.error) throw classes.error;
    if (lists.error) throw lists.error;
    const classIds = (classes.data || []).map((r) => r.class_id).filter(Boolean);
    const listIds = (lists.data || []).map((r) => r.id).filter(Boolean);
    const reads = [];
    if (classIds.length) reads.push(supabase.from('class_enrollments').select(`students(${cols})`).in('class_id', classIds).limit(MAX_ROWS));
    if (listIds.length) reads.push(supabase.from('students').select(cols).in('list_id', listIds).limit(MAX_ROWS));
    const words = new Set();
    for (const { data, error } of await Promise.all(reads)) {
      if (error) throw error;
      for (const r of data || []) {
        const s = (r && r.students) || r || {};
        for (const v of [s.student_name, s.student_name_urdu, s.father_name, s.father_name_urdu]) {
          for (const w of String(v || '').split(/[^\p{L}\p{M}]+/u)) if ([...w].length >= 3) words.add(w);
        }
      }
    }
    return [...words];
  } catch (e) {
    warn('rosterNames', e, { userId });
    return [];
  }
}

const ATTEMPTS = new Set([1, 2]); // V1.7.2 CHECK
const ROUTES = new Set(['tag', 'step_text', 'card_text']); // V1.7.1 CHECK

/**
 * bd-8hhqhf R7n (promo 191116, red7 191357/191815, COS 191154 §1): the row as the table's CHECKs allow it. The engine
 * counts attempts 0 when no completeJson call was made (card mode, the fixed paths) and 3–4 when the second moment
 * runs, and stores route 'enacted' / 'closure' on the R7f fixed paths; each failed a CHECK and the whole row was lost.
 * Outside the allowed set → NULL. The real route stays on every entry of `candidates` (JSONB, no CHECK).
 */
function tableRow(row) {
  if (!row) return row;
  const out = { ...row };
  if (out.attempts != null && !ATTEMPTS.has(out.attempts)) out.attempts = null;
  if (out.route != null && !ROUTES.has(out.route)) out.route = null;
  return out;
}

async function write(row) {
  try {
    const { data, error } = await supabase.from(TABLE).upsert(tableRow(row), { onConflict: 'coaching_session_id' }).select('*').single();
    if (error) throw error;
    return data || null;
  } catch (e) {
    warn('write', e, { coachingSessionId: row && row.coaching_session_id, status: row && row.status });
    return null;
  }
}

async function markSent(coachingSessionId, { sent_via, wamid, image_strip } = {}) {
  try {
    const { error } = await supabase.from(TABLE)
      .update({ sent_via: sent_via || null, wamid: wamid || null, sent_at: new Date().toISOString(), image_strip: !!image_strip })
      .eq('coaching_session_id', coachingSessionId);
    if (error) throw error;
    return true;
  } catch (e) {
    warn('markSent', e, { coachingSessionId });
    return false;
  }
}

module.exports = { readForSession, recentHistory, ladderProgress, trainingBands, rosterNames, write, markSent, tableRow };
