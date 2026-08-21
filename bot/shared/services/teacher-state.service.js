'use strict';
// Cross-feature "is the teacher busy right now?" probe + the cancellable
// resource list that powers the /status flow.
//
// probeTeacherBusy is lazy: invoked when a scheduled quiz_report job is about
// to fire, so the report can be deferred a few minutes when the teacher is
// mid-coaching/LP/video/reading/quiz.
//
// Sources of state checked:
// - Coaching:   Postgres `coaching_sessions` rows, non-terminal, last hour
// - LP request: Postgres `lesson_plan_requests` rows in pending/processing/extracting
// - Reading:    Redis key `reading:user:{id}:current_assessment` — a LOCK ("an
//               assessment is processing"), not a step, which is why it stays here
// - Any flow mid-step: the conversation store, one row per teacher. This replaced a
//               four-key video probe and an attendance probe that had outlived its
//               feature — one question instead of a list of keys to remember.
//
// Defaults to "not busy" on any probe error so a Redis/DB blip never blocks
// reports forever.

const supabase = require('../config/supabase');
const redisService = require('./cache/railway-redis.service');
const ConversationState = require('./conversation-state.service');
const ConversationResume = require('./conversation-resume.service');
const { logToFile } = require('../utils/logger');

const ONE_HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const THIRTY_MIN_AGO = () => new Date(Date.now() - 30 * 60 * 1000).toISOString();

const COACHING_TERMINAL = ['completed', 'failed', 'cancelled', 'report_sent'];
const LP_IN_FLIGHT = ['pending', 'processing', 'extracting'];

/**
 * @returns {Promise<{busy: boolean, feature: string|null, etaSeconds: number|null}>}
 *   busy=false       → the scheduler delivers the report immediately
 *   busy=true,
 *     feature=string  → which feature is occupying her right now
 *     etaSeconds=N|null → hint for how long to defer; scheduler uses
 *                          a default (10 min) when null
 */
async function probeTeacherBusy(userId) {
  if (!userId) return { busy: false, feature: null, etaSeconds: null };

  // 1. Coaching session in flight
  try {
    const { data: coachingRows } = await supabase
      .from('coaching_sessions')
      .select('id, status, created_at')
      .eq('user_id', userId)
      .not('status', 'in', `(${COACHING_TERMINAL.join(',')})`)
      .gte('created_at', ONE_HOUR_AGO())
      .limit(1);
    if (coachingRows && coachingRows.length > 0) {
      return { busy: true, feature: 'coaching', etaSeconds: null };
    }
  } catch (err) {
    logToFile('⚠️ probeTeacherBusy: coaching probe failed (defaulting to not-busy)', { userId, error: err.message });
  }

  // 2. LP request currently being processed
  try {
    const { data: lpRows } = await supabase
      .from('lesson_plan_requests')
      .select('id, status, created_at')
      .eq('user_id', userId)
      .in('status', LP_IN_FLIGHT)
      .gte('created_at', THIRTY_MIN_AGO())
      .limit(1);
    if (lpRows && lpRows.length > 0) {
      // LPs typically finish within 30-60s; defer 5 min as a safety
      return { busy: true, feature: 'lesson_plan', etaSeconds: 300 };
    }
  } catch (err) {
    logToFile('⚠️ probeTeacherBusy: LP probe failed (defaulting to not-busy)', { userId, error: err.message });
  }

  // 4. Reading assessment in flight
  try {
    if (redisService.isAvailable && redisService.isAvailable()) {
      const readingState = await redisService.redis.get(`reading:user:${userId}:current_assessment`);
      if (readingState) {
        return { busy: true, feature: 'reading', etaSeconds: null };
      }
    }
  } catch (err) {
    logToFile('⚠️ probeTeacherBusy: reading probe failed (defaulting to not-busy)', { userId, error: err.message });
  }

  // 5. Any flow the conversation store knows she is mid-way through.
  //
  // This replaces both the per-key video probe above it and an attendance probe that
  // had outlived its feature: attendance was rebuilt as Flows and keeps no
  // conversational state, so that probe could never fire and `/status` could never
  // list it. One store means one question instead of a list of keys to remember.
  try {
    const active = await ConversationState.getState(userId);

    // `menu` is excluded deliberately, and it matters: the menu wait lasts an hour,
    // and this probe decides whether a scheduled quiz report is delivered or held
    // back. Counting a glance at the menu as "busy" would push a teacher's report
    // back by an hour every time she opened it — a silent delivery regression that
    // nothing would have reported as a bug.
    //
    // `offered_resume` is excluded for a different reason: she has been asked and has
    // not answered, so the wait is on us, not on her.
    const NOT_BUSY_FLOWS = new Set(['menu']);
    if (active && active.step !== ConversationResume.OFFERED && !NOT_BUSY_FLOWS.has(active.flow)) {
      return { busy: true, feature: active.flow, etaSeconds: null };
    }
  } catch (err) {
    logToFile('⚠️ probeTeacherBusy: state probe failed (defaulting to not-busy)', { userId, error: err.message });
  }

  return { busy: false, feature: null, etaSeconds: null };
}

/**
 * listActiveResources(userId)
 *   Returns an ordered array of cancellable items for the /status flow.
 *   Each item: { id, title, kind, refId }
 *     id     → the radio-row id: 'cancel_quiz_<uuid>' / 'cancel_lp_<uuid>' /
 *              'cancel_coaching_<uuid>' / 'resume_flow_<flow>' / 'cancel_flow_<flow>' /
 *              'cancel_reading'
 *     title  → human-friendly label shown to the teacher
 *     kind   → 'quiz' | 'lesson_plan' | 'coaching' | 'flow_resume' | 'flow_cancel' | 'reading'
 *     refId  → UUID for the DB-backed kinds, the flow id for the flow kinds, else null
 *
 *   Coverage:
 *     ✅ quiz         — QuizOrchestrator.cancelQuiz (orchestrator path)
 *     ✅ flow_resume  — leaves the state alone; she is already on that step
 *     ✅ flow_cancel  — clears the store, scoped to that flow
 *     ⚠ coaching     — DB status flip (teacher-only)
 *     ⚠ lesson_plan  — DB status='cancelled' (background job continues, result discarded)
 *     ⚠ reading      — cache lock delete only
 *
 *   `attendance` is gone: the feature was rebuilt as Flows and keeps no conversational
 *   state, so no row could ever carry that id.
 */
async function listActiveResources(userId) {
  if (!userId) return [];
  const items = [];

  // Quizzes — pull active ones for this teacher
  try {
    const { data: quizzes } = await supabase
      .from('quizzes')
      .select(`
        id, topic, list_id,
        student_lists ( class_name, section )
      `)
      .eq('teacher_id', userId)
      .in('status', ['sent', 'ready', 'completed'])
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5);
    for (const q of (quizzes || [])) {
      const cls = q.student_lists
        ? (q.student_lists.section ? `${q.student_lists.class_name}-${q.student_lists.section}` : q.student_lists.class_name)
        : '?';
      // Skip quizzes whose every session is already terminal
      const { data: peers } = await supabase
        .from('quiz_sessions').select('status').eq('quiz_id', q.id);
      const allDone = (peers || []).length > 0 && peers.every(s =>
        ['completed', 'incomplete', 'expired', 'cancelled'].includes(s.status)
      );
      if (allDone) continue;
      items.push({
        id: `cancel_quiz_${q.id}`,
        title: `Quiz · ${cls} · ${q.topic}`.slice(0, 70),
        kind: 'quiz',
        refId: q.id
      });
    }
  } catch (err) {
    logToFile('⚠️ listActiveResources: quiz probe failed', { error: err.message });
  }

  // Coaching sessions
  try {
    const { data: coachingRows } = await supabase
      .from('coaching_sessions')
      .select('id, created_at, status')
      .eq('user_id', userId)
      .not('status', 'in', `(${COACHING_TERMINAL.join(',')})`)
      .gte('created_at', ONE_HOUR_AGO())
      .limit(2);
    for (const c of (coachingRows || [])) {
      items.push({
        id: `cancel_coaching_${c.id}`,
        title: 'Coaching session in progress',
        kind: 'coaching',
        refId: c.id
      });
    }
  } catch (err) {
    logToFile('⚠️ listActiveResources: coaching probe failed', { error: err.message });
  }

  // LP requests
  try {
    const { data: lpRows } = await supabase
      .from('lesson_plan_requests')
      .select('id, topic, created_at, status')
      .eq('user_id', userId)
      .in('status', LP_IN_FLIGHT)
      .gte('created_at', THIRTY_MIN_AGO())
      .limit(2);
    for (const lp of (lpRows || [])) {
      items.push({
        id: `cancel_lp_${lp.id}`,
        title: `Lesson plan · ${lp.topic || 'in progress'}`.slice(0, 70),
        kind: 'lesson_plan',
        refId: lp.id
      });
    }
  } catch (err) {
    logToFile('⚠️ listActiveResources: LP probe failed', { error: err.message });
  }

  // Whatever the conversation store says she is mid-way through — and now she can
  // RESUME it rather than only cancel it, which is the point of listing it at all.
  // The attendance entry that used to sit here was dead: the feature was rebuilt as
  // Flows and keeps no conversational state, so it could never appear.
  try {
    const active = await ConversationState.getState(userId);
    if (active && active.step !== ConversationResume.OFFERED) {
      const label = ConversationResume.TASK_LABEL[active.flow];
      const title = label ? label.en : active.flow;
      // TWO selectable rows, ONE task. She must be able to pick resume
      // or stop, so the rows stay per-action — but /status counted and bulleted
      // this same array and therefore told a teacher with one coaching session
      // that she had "2 things running", listing the two verbs as if they were the
      // work. `taskKey` groups the pair; `taskTitle` is the task without the verb,
      // so a summary needs no string-surgery on "Continue: ".
      const taskKey = `flow:${active.flow}`;
      items.push({
        id: `resume_flow_${active.flow}`,
        title: `Continue: ${title}`.slice(0, 70),
        kind: 'flow_resume',
        refId: active.flow,
        taskKey,
        taskTitle: title,
      });
      items.push({
        id: `cancel_flow_${active.flow}`,
        title: `Stop: ${title}`.slice(0, 70),
        kind: 'flow_cancel',
        refId: active.flow,
        taskKey,
        taskTitle: title,
      });
    }
  } catch (err) {
    logToFile('⚠️ listActiveResources: state probe failed', { error: err.message });
  }

  // Reading's in-flight marker is a LOCK, not a step — it says "an assessment is
  // being processed", which is not something a teacher resumes. Kept on the cache.
  try {
    if (redisService.isAvailable && redisService.isAvailable()) {
      const readingState = await redisService.redis.get(`reading:user:${userId}:current_assessment`);
      if (readingState) {
        items.push({ id: 'cancel_reading', title: 'Reading assessment in progress', kind: 'reading', refId: null });
      }
    }
  } catch (err) {
    logToFile('⚠️ listActiveResources: reading probe failed', { error: err.message });
  }

  return items;
}

/**
 * cancelResource(item, userId)
 *   Routes cancel by kind. Quizzes go through the full orchestrator;
 *   the others do a state-delete with a polite acknowledgement.
 */
async function cancelResource(item, userId) {
  if (!item || !item.kind) return { ok: false, reason: 'invalid resource' };
  try {
    if (item.kind === 'quiz' && item.refId) {
      const QuizOrchestrator = require('./quiz/quiz-orchestrator.service');
      await QuizOrchestrator.cancelQuiz(item.refId, userId);
      return { ok: true, message: `🛑 Quiz cancelled. The scheduled report won't be generated for it.` };
    }
    if (item.kind === 'coaching' && item.refId) {
      await supabase
        .from('coaching_sessions')
        .update({ status: 'cancelled' })
        .eq('id', item.refId)
        .eq('user_id', userId);
      return { ok: true, message: `🛑 Coaching session stopped on our end.` };
    }
    if (item.kind === 'lesson_plan' && item.refId) {
      await supabase
        .from('lesson_plan_requests')
        .update({ status: 'cancelled' })
        .eq('id', item.refId)
        .eq('user_id', userId);
      return {
        ok: true,
        message: `🛑 Lesson plan cancelled on our end. The background generation may still finish but you won't be notified.`
      };
    }
    if (item.kind === 'video') {
      // Video moved onto the store, so stopping it is one clear rather than four
      // key deletes. Kept as its own branch because an older status list may still
      // be on a teacher's screen carrying the `cancel_video` row id.
      await ConversationState.clearState(userId, { flow: 'video' });
      return {
        ok: true,
        message: `🛑 Video flow stopped on our end. The background generation may still finish but you won't be notified.`
      };
    }
    if (item.kind === 'reading') {
      await redisService.redis.del(`reading:user:${userId}:current_assessment`);
      return { ok: true, message: `🛑 Reading assessment stopped. Tap /reading test to start a fresh one.` };
    }
    if (item.kind === 'flow_cancel') {
      await ConversationState.clearState(userId, { flow: item.refId });
      const label = ConversationResume.TASK_LABEL[item.refId];
      return { ok: true, message: `🛑 Stopped your ${label ? label.en : item.refId}. Send /menu when you want something else.` };
    }
    if (item.kind === 'flow_resume') {
      // Handing the teacher back into her own flow is the resume service's job, not
      // this one's — /status only decides WHICH flow, never how to re-enter it.
      return { ok: true, resume: item.refId };
    }
    return { ok: false, reason: 'unknown kind' };
  } catch (err) {
    logToFile('❌ cancelResource error', { kind: item.kind, refId: item.refId, error: err.message });
    return { ok: false, reason: err.message };
  }
}

/**
 * Parse a status-flow row id like 'cancel_quiz_<uuid>' / 'cancel_video' /
 * 'done' back into { kind, refId } or 'done'/'unknown'.
 */
function parseResourceId(rowId) {
  if (!rowId) return { kind: 'unknown' };
  if (rowId === 'done') return { kind: 'done' };

  // The two flow rows are matched FIRST and explicitly. They must be, twice over:
  // `cancel_flow_video` would otherwise fall to the pattern below, where `flow` is
  // not in the alternation, so it would parse as `unknown` and the tap would be
  // silently dropped — a list row that emits an id nothing can read.
  const flowResume = rowId.match(/^resume_flow_([a-z_]+)$/);
  if (flowResume) return { kind: 'flow_resume', refId: flowResume[1] };

  const flowCancel = rowId.match(/^cancel_flow_([a-z_]+)$/);
  if (flowCancel) return { kind: 'flow_cancel', refId: flowCancel[1] };

  // `attendance` is gone from here with its probe — the feature was rebuilt as Flows
  // and keeps no conversational state, so no row could ever carry that id.
  const m = rowId.match(/^cancel_(quiz|coaching|lp|video|reading)(?:_(.+))?$/);
  if (!m) return { kind: 'unknown' };
  const kindMap = { quiz: 'quiz', coaching: 'coaching', lp: 'lesson_plan', video: 'video', reading: 'reading' };
  return { kind: kindMap[m[1]], refId: m[2] || null };
}

module.exports = {
  probeTeacherBusy,
  listActiveResources,
  cancelResource,
  parseResourceId
};
