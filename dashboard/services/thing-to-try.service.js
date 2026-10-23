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
 *
 * PR3: the thing carries its step (Opening … Check) — the step of the move it was picked from, in that
 * session's lp_fidelity, through report-card stepOf (pure, no imports; the /cr page reads it the same way) —
 * so the app can open the plan at that step's heading. A move or phase that cannot be found is step null.
 *
 * bd-v0toag.100.8: the strip shows the live ask of this plan's subject and grade (the bot's pure
 * thing-to-try-scope), not the latest session's; an ask stored with its step keeps that step.
 */

const { isFlagEnabled } = require('../lib/feature-flags');
const { stepOf } = require('../../bot/shared/services/coaching/report-card');
const { scopeOf, activeThing } = require('../../bot/shared/services/coaching/thing-to-try-scope');

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

async function latestThing(supabase, userId, lessonId) {
  const scope = scopeOf(lessonId);
  if (!scope) return null;
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, prioritized_action, lp_fidelity:analysis_data->lp_fidelity')
    .eq('user_id', userId)
    .not('prioritized_action', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const found = activeThing(data, scope);
  if (!found) return null;
  const t = found.thing;
  return {
    text: t.text.trim(), tag: t.tag || null, moveId: t.move_id || null, setOnLessonId: t.lesson_id || null,
    step: 'step' in t ? t.step || null : stepOfMove(found.lpFidelity, t.move_id),
  };
}

/** { name, index } of the graded move's step, else null. Pure. */
function stepOfMove(lpFidelity, moveId) {
  const moves = lpFidelity && Array.isArray(lpFidelity.moves) ? lpFidelity.moves : [];
  const m = moveId ? moves.find((x) => x && x.move_id === moveId) : null;
  return m ? stepOf(m.phase) : null;
}

/** { group, thing } for a teacher in C or D with a live ask for this plan, else null. Never throws. */
async function thingFor(supabase, userId, lessonId) {
  if (!userId) return null;
  try {
    if (!(await isFlagEnabled(supabase, SWITCH_KEY))) return null;
    const group = await groupOf(supabase, userId);
    if (!NEW_REPORT.has(group)) return null;
    const thing = await latestThing(supabase, userId, lessonId);
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
