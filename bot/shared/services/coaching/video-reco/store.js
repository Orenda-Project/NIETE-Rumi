'use strict';
/**
 * Storage for the video recommendation (bd-gzfdu9, SPEC §3.6): one video_recommendations row per
 * coaching session, and the teacher's place on the training ladder. Every function returns; none
 * throws. A DB error is one warn log and the safe answer (null / [] / level 2), so a missing table on a
 * tier without the migration can never touch a report.
 */
const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');

const TABLE = 'video_recommendations';
const LADDER_LEVELS = new Set([1, 2, 3, 4]); // training_levels 1–4 = the Taleemabad CPD ladder (other vendors' ids are not ours)
const DEFAULT_LEVEL = 2;
const MAX_ROWS = 500;

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

async function recentModules(userId, days = 180) {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabase.from(TABLE).select('module_id')
      .eq('user_id', userId).gte('created_at', since).not('module_id', 'is', null).limit(MAX_ROWS);
    if (error) throw error;
    return [...new Set((data || []).map((r) => Number(r.module_id)).filter(Number.isFinite))];
  } catch (e) {
    warn('recentModules', e, { userId });
    return [];
  }
}

/** The highest ladder level with a completed module (null when none) and the completed ladder module ids. */
async function ladderProgress(userId) {
  try {
    const { data, error } = await supabase.from('teacher_training_progress')
      .select('module_id, training_modules!inner(training_courses!inner(level_id))')
      .eq('user_id', userId).not('completed_at', 'is', null).limit(MAX_ROWS);
    if (error) throw error;
    let level = null;
    const completed = [];
    for (const r of data || []) {
      const lv = Number(r && r.training_modules && r.training_modules.training_courses && r.training_modules.training_courses.level_id);
      if (!LADDER_LEVELS.has(lv)) continue;
      completed.push(Number(r.module_id));
      level = level === null ? lv : Math.max(level, lv);
    }
    return { level, completed };
  } catch (e) {
    warn('ladderProgress', e, { userId });
    return { level: null, completed: [] };
  }
}

async function levelOf(userId) {
  const { level } = await ladderProgress(userId);
  return level === null ? DEFAULT_LEVEL : level;
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

async function markSent(coachingSessionId, { sent_via, wamid } = {}) {
  try {
    const { error } = await supabase.from(TABLE)
      .update({ sent_via: sent_via || null, wamid: wamid || null, sent_at: new Date().toISOString() })
      .eq('coaching_session_id', coachingSessionId);
    if (error) throw error;
    return true;
  } catch (e) {
    warn('markSent', e, { coachingSessionId });
    return false;
  }
}

module.exports = { readForSession, recentModules, ladderProgress, levelOf, write, markSent, DEFAULT_LEVEL };
