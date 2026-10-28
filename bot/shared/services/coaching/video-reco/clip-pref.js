'use strict';
/**
 * The teacher's own say over the clips — bd-9dbhh0.1 (VIDREC), COS rulings 20261028T151240 §1 and 151950 §1.3.
 *
 * On the clip page (/v, dashboard/routes/video-reco.routes.js) the teacher can say "not now" to this one clip, "stop clips"
 * altogether, and turn them back on. The choice lives in `users.preferences.video_clips` (JSONB that already exists and is
 * read-merge-written the same way by the settings Flow and /observe; red7 151721 option (b): no migration, no new status
 * or event name, both CHECKs untouched):
 *
 *   { stopped: bool, changed_at, stopped_at?, resumed_at?, stop_count, skip_count, skipped_at?, skip_rec?, rec? }
 *
 * Ids and times only. "Not now" changes nothing else (the next report is eligible as before); "stop" makes the engine store
 * the next reports' picks as status 'none', none_reason 'opted_out' with the arm kept (engine.js), so no strip, no caption
 * link and no app card follow, and the teacher stays in their assigned arm for the read. Every function returns; none throws.
 */
const KEY = 'video_clips';
const ACTIONS = new Set(['skip', 'stop', 'resume']);
const OPTED_OUT = 'opted_out';

/** The stored choice (pure). */
const isStopped = (prefs) => !!(prefs && typeof prefs === 'object' && prefs[KEY] && prefs[KEY].stopped === true);

/**
 * The new `video_clips` object for an action (pure); `changed` false when the action is a repeat (a second stop, a second
 * "not now" on the same clip, "back on" when already on): the caller then writes nothing.
 */
function next(current, action, { recommendationId = null, now = new Date().toISOString() } = {}) {
  const c = current && typeof current === 'object' ? current : {};
  const n = (k) => (Number.isFinite(c[k]) ? c[k] : 0);
  if (action === 'stop') {
    if (c.stopped === true) return { value: c, changed: false };
    return { value: { ...c, stopped: true, changed_at: now, stopped_at: now, stop_count: n('stop_count') + 1, rec: recommendationId }, changed: true };
  }
  if (action === 'resume') {
    if (c.stopped !== true) return { value: c, changed: false };
    return { value: { ...c, stopped: false, changed_at: now, resumed_at: now, rec: recommendationId }, changed: true };
  }
  if (action === 'skip') {
    if (recommendationId && c.skip_rec === recommendationId) return { value: c, changed: false };
    return { value: { ...c, stopped: c.stopped === true, skipped_at: now, skip_count: n('skip_count') + 1, skip_rec: recommendationId }, changed: true };
  }
  return { value: c, changed: false };
}

/** true when the teacher stopped the clips; false on no choice, no row, or a failed read (the safe answer: today). */
async function readStopped(supabase, userId) {
  if (!supabase || !userId) return false;
  try {
    const { data, error } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
    if (error) throw error;
    return isStopped(data && data.preferences);
  } catch (_) {
    return false;
  }
}

/**
 * Apply "skip" | "stop" | "resume" for this teacher: read-merge-write of users.preferences (only the video_clips key is
 * touched). { ok, stopped, changed }; ok false on an unknown action or a failed read/write (the page says so).
 */
async function apply(supabase, userId, action, { recommendationId = null, now } = {}) {
  if (!ACTIONS.has(action) || !supabase || !userId) return { ok: false, stopped: null, changed: false };
  try {
    const { data, error } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, stopped: null, changed: false };
    const prefs = data.preferences && typeof data.preferences === 'object' ? data.preferences : {};
    const r = next(prefs[KEY], action, { recommendationId, ...(now ? { now } : {}) });
    if (r.changed) {
      const { error: e2 } = await supabase.from('users').update({ preferences: { ...prefs, [KEY]: r.value } }).eq('id', userId);
      if (e2) throw e2;
    }
    return { ok: true, stopped: r.value.stopped === true, changed: r.changed };
  } catch (_) {
    return { ok: false, stopped: null, changed: false };
  }
}

module.exports = { KEY, ACTIONS, OPTED_OUT, isStopped, next, readStopped, apply };
