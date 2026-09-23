'use strict';
/**
 * Transcript quiz — the one nudge. Six hours after the link went out, if fewer
 * than five children have started, the teacher is told how many have and asked
 * whether the link is worth forwarding again. Once per TEACHER per day, never
 * during quiet hours, never twice.
 *
 * The three rules and where they came from (operator, 2026-09-07 — "the
 * reminders that teachers get that no one has attempted their quiz are
 * annoying. Perhaps once after six hours is ok"):
 *
 *   SIX HOURS  the wait used to be three, which caught a class that simply had
 *              not got home yet.
 *   QUIET      21:00-07:00 PKT is deferred to 07:00, never dropped. Ten
 *              teachers were told at 9pm or later that nobody had opened their
 *              quiz. The report already had this guard; the nudge did not.
 *   ONE A DAY  a teacher who records four lessons was collecting four separate
 *              "nobody has started" messages. One message, naming the quiet
 *              lessons together; every one of them stamped, so none can nudge
 *              on its own later.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const { teacherLanguageFor } = require('./transcript-quiz-language');
const { excludeSelfTests } = require('./teacher-self-test');

const NUDGE_BELOW = 5;
const PKT_OFFSET_MIN = 5 * 60;
/** Nothing is sent to a teacher between these PKT hours. */
const QUIET_FROM_PKT = 21;
const QUIET_TO_PKT = 7;

/**
 * The quiet window, read per call from NUDGE_QUIET_HOURS_PKT. Unset — and in
 * production it is always unset — it is 21:00–07:00. `off` lifts it, for a test
 * environment that has to run a night's scenarios; `H-H` sets another window.
 * Anything unreadable keeps the default: a typo must never mean "no window".
 *
 * @returns {{from:number, to:number}|null} null = no quiet window
 */
function quietWindow() {
  // globalThis: this module defines its own `process` (the job handler below).
  const raw = String(globalThis.process.env.NUDGE_QUIET_HOURS_PKT || '').trim().toLowerCase();
  if (raw === 'off') return null;
  const m = raw.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (m) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (from <= 23 && to <= 23 && from !== to) return { from, to };
  }
  return { from: QUIET_FROM_PKT, to: QUIET_TO_PKT };
}

/**
 * When a nudge due at `when` may actually be sent: `when` itself during the
 * day, or the end of the quiet window (07:00 PKT) if it falls inside it.
 * DEFERRED, never dropped — the worker re-queues until this instant, so the
 * teacher still hears, in the morning, when the message is worth reading.
 */
function nudgeTargetUtc(when = new Date()) {
  const w = quietWindow();
  if (!w) return when;
  const pkt = new Date(when.getTime() + PKT_OFFSET_MIN * 60 * 1000);
  const h = pkt.getUTCHours();
  const overnight = w.from > w.to;
  const quiet = overnight ? (h >= w.from || h < w.to) : (h >= w.from && h < w.to);
  if (!quiet) return when;
  const bump = new Date(Date.UTC(
    pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate() + (overnight && h >= w.from ? 1 : 0),
    w.to, 0, 0,
  ));
  return new Date(bump.getTime() - PKT_OFFSET_MIN * 60 * 1000);
}

/**
 * The instant at which `ms` of WAKING time — time outside the quiet window — has
 * passed since `start`. A wait that should not run down while the teacher is
 * asleep: `ms` = 6 h from 19:00 is 21:00 (2 h) + 07:00–11:00 (4 h) = 11:00 the
 * next morning; from 10:00 it is simply 16:00. With no window (`off`) it is
 * `start + ms`. A start inside the window counts from the window's end.
 *
 * The same window as nudgeTargetUtc, read the same way, so the two can never
 * disagree about when the night is.
 *
 * @param {Date} start
 * @param {number} ms  waking milliseconds to count
 * @returns {Date}
 */
function quietAwareDeadlineUtc(start = new Date(), ms = 0) {
  const w = quietWindow();
  let t = start.getTime();
  let left = Math.max(0, Number(ms) || 0);
  if (!w) return new Date(t + left);
  const dayMs = 24 * 60 * 60 * 1000;
  // Each pass either leaves a quiet stretch or spends one waking stretch, and
  // every window has at least one waking hour a day, so this ends; the bound is
  // only a backstop against a bug turning into a hung worker.
  for (let pass = 0; pass < 64 && left > 0; pass++) {
    const allowed = nudgeTargetUtc(new Date(t)).getTime();
    if (allowed > t) { t = allowed; continue; }
    // Awake at t: the window next opens at the coming `from`:00 PKT.
    const pkt = new Date(t + PKT_OFFSET_MIN * 60 * 1000);
    let opens = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate(), w.from, 0, 0)
      - PKT_OFFSET_MIN * 60 * 1000;
    if (opens <= t) opens += dayMs;
    if (t + left <= opens) return new Date(t + left);
    left -= opens - t;
    t = opens;
  }
  return new Date(t + left);
}


/**
 * What the worker should do with a nudge job it has just picked up.
 *
 * The quiet-hours rule used to live only where the job is SCHEDULED, which left
 * every already-queued job on its old target. The night the rule shipped, six
 * nudges were still in flight under the old three-hour schedule, due between
 * 23:25 and 01:36 PKT — precisely the messages the rule exists to stop. So the
 * decision is made again on arrival, whenever the job was queued.
 *
 * @returns {{action:'process'}|{action:'requeue', targetAt:string, delaySeconds:number}}
 */
function nudgeDispatch({ targetAt = null, now = new Date() } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const due = targetAt ? new Date(targetAt) : null;
  const when = due && due > at ? due : at;
  const allowed = nudgeTargetUtc(when);
  if (allowed <= at) return { action: 'process' };
  // SQS caps DelaySeconds at 900, so a long hold is a chain of short hops.
  const wait = Math.min(900, Math.max(60, Math.floor((allowed - at) / 1000)));
  return { action: 'requeue', targetAt: allowed.toISOString(), delaySeconds: wait };
}

/** Midnight PKT of the day `now` falls in, as a UTC ISO string. */
function pktDayStartIso(now = new Date()) {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MIN * 60 * 1000);
  const start = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate());
  return new Date(start - PKT_OFFSET_MIN * 60 * 1000).toISOString();
}

/** How many REAL children have started this quiz (the teacher's own run never counts). */
async function startedFor(quizId, teacherId) {
  const { data: sessions } = await supabase.from('quiz_sessions')
    .select('id, user_id').eq('quiz_id', quizId).is('invited_by_student_id', null);
  return excludeSelfTests(sessions || [], teacherId).length;
}

async function process(quizId) {
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, teacher_id, topic, status, language, meta').eq('id', quizId).maybeSingle();
  if (!quiz) return { skipped: 'quiz_not_found' };
  if (quiz.status !== 'sent') return { skipped: `status_${quiz.status}` };
  if (quiz.meta?.nudged_at) return { skipped: 'already_nudged' };

  const dayStart = pktDayStartIso();
  const { data: sameDay } = await supabase.from('quizzes')
    .select('id, topic, status, meta').eq('teacher_id', quiz.teacher_id)
    .gte('created_at', dayStart);
  const others = (sameDay || []).filter((q) => q.id !== quiz.id);

  // ONE a day. A teacher already nudged today hears nothing more, whichever
  // quiz the job was queued for.
  if (others.some((q) => (q.meta || {}).nudged_at >= dayStart)) {
    return { skipped: 'teacher_nudged_today' };
  }

  // PLAN_R5 D8 — this count decides whether a teacher is told "only N children
  // have started"; their own test run of the class link must not read as
  // "started".
  const started = await startedFor(quiz.id, quiz.teacher_id);
  if (started >= NUDGE_BELOW) return { skipped: 'enough_started', started };

  // Gather the teacher's OTHER quiet lessons from today so they ride in the
  // same message rather than arriving as separate nags.
  const quiet = [{ id: quiz.id, topic: quiz.topic || '', started }];
  for (const q of others) {
    if (q.status !== 'sent' || (q.meta || {}).nudged_at) continue;
    const n = await startedFor(q.id, quiz.teacher_id);
    if (n < NUDGE_BELOW) quiet.push({ id: q.id, topic: q.topic || '', started: n, meta: q.meta });
  }

  const { data: teacher } = await supabase.from('users')
    .select('phone_number, preferred_language').eq('id', quiz.teacher_id).maybeSingle();
  if (!teacher?.phone_number) return { skipped: 'no_phone' };
  const lang = teacherLanguageFor({ preferredLanguage: teacher.preferred_language });

  const body = quiet.length === 1
    ? resolveUx('tqNudge', { language: lang, params: { started, topic: quiz.topic || '' } })
    : resolveUx('tqNudgeMany', {
      language: lang,
      params: { count: quiet.length, topics: quiet.map((q) => q.topic).filter(Boolean).join('، ') },
    });
  const ok = await WhatsAppService.sendMessage(teacher.phone_number, body);

  const at = new Date().toISOString();
  await supabase.from('quizzes')
    .update({ meta: { ...(quiz.meta || {}), nudged_at: at, nudge_started: started } })
    .eq('id', quiz.id);
  for (const q of quiet.slice(1)) {
    await supabase.from('quizzes')
      .update({ meta: { ...(q.meta || {}), nudged_at: at, nudge_started: q.started, nudged_with: quiz.id } })
      .eq('id', q.id);
  }

  logEvent('transcript_quiz.nudged', {
    quizId, started, sent: Boolean(ok), lessons: quiet.length, quizIds: quiet.map((q) => q.id),
  });
  if (!ok) logToFile('⚠️ transcript quiz: nudge not delivered', { quizId });
  return { ok: true, started, quizIds: quiet.map((q) => q.id) };
}

module.exports = {
  process, NUDGE_BELOW, nudgeTargetUtc, quietAwareDeadlineUtc, nudgeDispatch, pktDayStartIso,
  QUIET_FROM_PKT, QUIET_TO_PKT,
};
