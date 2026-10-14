'use strict';
/**
 * v10 coaching test (bd-v0toag.8, PR2): the one thing to try, for the teacher app's lesson plan.
 *
 * The portal's copy of the bot's coaching/thing-to-try + ab-v10-arms reads (the bot's modules need
 * pino, which the portal service does not install — see services/telemetry.service.js). Same rules:
 * only while app_settings.ab_v10_enabled is on, only for schools drawn into C or D in
 * niete_coaching_ab_assignment (never the ch3-8 LP test's niete_lp_ab_assignment), and the thing
 * to try is the latest session's prioritized_action.thing_to_try (written by bd-v0toag.20).
 * Anything that cannot be resolved is null: the plan opens as today, without the strip.
 */

const { isFlagEnabled } = require('../lib/feature-flags');

const SWITCH_KEY = 'ab_v10_enabled';
const NEW_REPORT = new Set(['C', 'D']);
const LESSON_ID = /^[a-z0-9_]{1,80}$/;
const MAX_STEP = 30;

async function groupOf(supabase, userId) {
  const { data: user, error: uErr } = await supabase
    .from('users').select('id, school_id').eq('id', userId).maybeSingle();
  if (uErr) throw new Error(uErr.message);
  if (!user || !user.school_id) return null;
  const { data: row, error } = await supabase
    .from('niete_coaching_ab_assignment').select('school_id, ab_group').eq('school_id', user.school_id).maybeSingle();
  if (error) throw new Error(error.message);
  return row ? row.ab_group : null;
}

async function latestThing(supabase, userId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('prioritized_action')
    .eq('user_id', userId)
    .not('prioritized_action', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const t = data && data[0] && data[0].prioritized_action && data[0].prioritized_action.thing_to_try;
  if (!t || typeof t.text !== 'string' || !t.text.trim()) return null;
  return { text: t.text.trim(), tag: t.tag || null, moveId: t.move_id || null, setOnLessonId: t.lesson_id || null };
}

/** { group, thing } for a teacher in C or D with a stored thing to try, else null. Never throws. */
async function thingFor(supabase, userId) {
  if (!userId) return null;
  try {
    if (!(await isFlagEnabled(supabase, SWITCH_KEY))) return null;
    const group = await groupOf(supabase, userId);
    if (!NEW_REPORT.has(group)) return null;
    const thing = await latestThing(supabase, userId);
    return thing ? { group, thing } : null;
  } catch (error) {
    console.error('v10 test: thing to try read failed (the plan opens without it)', { error: error && error.message });
    return null;
  }
}

/** A tap's body, cleaned: the lesson id when it has a lesson id's shape, a whole step 1-30. Pure. */
function cleanTap(body) {
  const b = body && typeof body === 'object' ? body : {};
  const lessonId = typeof b.lessonId === 'string' && LESSON_ID.test(b.lessonId) ? b.lessonId : null;
  const step = Number.isInteger(b.step) && b.step >= 1 && b.step <= MAX_STEP ? b.step : null;
  return { lessonId, step };
}

module.exports = { SWITCH_KEY, thingFor, cleanTap };
