'use strict';
/**
 * Storage for the video recommendation (bd-gzfdu9, SPEC v1.2.1 §3.6): one video_recommendations row per coaching
 * session, the teacher's recommendation history, their place on the training ladder, their grade bands. Every
 * function returns; none throws. A DB error is one warn log and the safe answer (null / empty), so a missing table
 * on a tier without the migration can never touch a report.
 */
const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');

const TABLE = 'video_recommendations';
const LADDER_LEVELS = new Set([1, 2, 3, 4]); // training_levels 1–4 = the Taleemabad CPD ladder (vendor af3e929e…); other vendors' ids are not ours
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
 * What this engine already put in front of the teacher (any status, incl. shadow): every chapter of the last
 * 365 days (never again), and the modules with ≥ 2 chapters in the last 180 days. Completed training modules are
 * NOT history (r-corpus: 70% of coached teachers finished the whole ladder; re-seeing one chapter is the point).
 */
async function recentHistory(userId) {
  try {
    const since = new Date(Date.now() - 365 * DAY).toISOString();
    const { data, error } = await supabase.from(TABLE).select('seg_id, module_id, created_at')
      .eq('user_id', userId).gte('created_at', since).not('seg_id', 'is', null).limit(MAX_ROWS);
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

/** users.training_bands (V1.1.8, teacher-chosen PRIMARY/MIDDLE/HIGH): the grade chain's second link (H7). */
async function trainingBands(userId) {
  try {
    const { data, error } = await supabase.from('users').select('training_bands').eq('id', userId).maybeSingle();
    if (error) throw error;
    return Array.isArray(data && data.training_bands) ? data.training_bands : [];
  } catch (e) {
    warn('trainingBands', e, { userId });
    return [];
  }
}

async function write(row) {
  try {
    const { data, error } = await supabase.from(TABLE).upsert(row, { onConflict: 'coaching_session_id' }).select('*').single();
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

module.exports = { readForSession, recentHistory, ladderProgress, trainingBands, write, markSent };
