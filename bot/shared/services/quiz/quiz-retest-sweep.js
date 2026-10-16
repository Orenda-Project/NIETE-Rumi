'use strict';
/**
 * bd-v0toag.10 (b) — the day-3 retest. Scheduled hourly from workers/sqs-worker.js
 * (scheduleQuizRetest, main-queue replicas only). Each tick finds lesson quizzes the class
 * played 3–4 days ago and makes ONE new quiz per original on the same lesson and SLOs:
 * the digest and SLO codes are copied, the old questions go to the author as "do not reuse"
 * (meta.retest_avoid → quiz-avoid-block.js), and the existing quiz_generate job does the rest,
 * including the normal "quiz ready" hand-off to the teacher.
 *
 * Off unless app_settings quiz_slo_retest_enabled is on. Class P: logs a summary every tick,
 * a Redis lock per original so two replicas never make two retests, at most MAX_PER_TICK.
 * Linked both ways in meta (retest_of / retest_quiz_id) — no schema change.
 */
const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { v21On } = require('./quiz-v21-flag');
const { LESSON_SOURCES } = require('./quiz-sources');
const { MAX_AVOID, MAX_CHARS } = require('./quiz-avoid-block');

const DAY_MS = 864e5;
const MIN_DAYS = 3;
const MAX_DAYS = 4;
const MAX_PER_TICK = 10;
const SCAN_LIMIT = 200;
const LOCK_TTL_SECS = 2 * 86400;
const PKT_OFFSET_H = 5; // Pakistan has no DST
const OPEN_H = 9; // design-pending: school calendar; an engineering default
const CLOSE_H = 17;
const ELIGIBLE_STATUSES = ['sent', 'report_sent', 'ready'];
const KEEP_META = ['lessons', 'lesson_date', 'digest', 'slo_codes', 'slo_code_status', 'content_language', 'grade_source', 'class'];
const QUIZ_COLS = 'id, teacher_id, coaching_session_id, quiz_source, topic, subject, grade, language, status, meta, created_at';

const lockKey = (quizId) => `quiz:retest:${quizId}`;
const pktHour = (now) => (now.getUTCHours() + PKT_OFFSET_H) % 24;
const inSchoolHours = (now) => pktHour(now) >= OPEN_H && pktHour(now) < CLOSE_H;

function retestMeta(original, avoid) {
  const meta = {};
  KEEP_META.forEach((k) => { if (original.meta && original.meta[k] !== undefined) meta[k] = original.meta[k]; });
  return { ...meta, step: 'author', remakes: 1, source: 'retest', retest_of: original.id, retest_avoid: avoid };
}

async function candidates(now) {
  const { data, error } = await supabase.from('quizzes').select(QUIZ_COLS)
    .in('quiz_source', LESSON_SOURCES).in('status', ELIGIBLE_STATUSES)
    .gte('created_at', new Date(now.getTime() - MAX_DAYS * DAY_MS).toISOString())
    .lt('created_at', new Date(now.getTime() - MIN_DAYS * DAY_MS).toISOString())
    .order('created_at', { ascending: true }).limit(SCAN_LIMIT);
  if (error) throw new Error(error.message);
  return (data || []).filter((q) => !(q.meta && (q.meta.retest_of || q.meta.retest_quiz_id)));
}

async function played(quizId) {
  const { count, error } = await supabase.from('quiz_sessions').select('id', { count: 'exact', head: true })
    .eq('quiz_id', quizId).eq('status', 'completed');
  if (error) throw new Error(error.message);
  return (count || 0) > 0;
}

async function oldQuestions(quizId) {
  const { data } = await supabase.from('quiz_questions').select('question_text')
    .eq('quiz_id', quizId).order('sort_order', { ascending: true });
  return (data || []).map((r) => String(r.question_text || '').slice(0, MAX_CHARS)).filter(Boolean).slice(0, MAX_AVOID);
}

async function phoneOf(teacherId) {
  const { data } = await supabase.from('users').select('phone_number').eq('id', teacherId).maybeSingle();
  return (data && data.phone_number) || null;
}

/** One original → one retest. Returns the new quiz id, or null with the reason logged. */
async function makeRetest(original) {
  const phone = await phoneOf(original.teacher_id);
  if (!phone) { logEvent('quiz.retest_skipped', { quizId: original.id, reason: 'no_phone' }); return null; }
  const avoid = await oldQuestions(original.id);
  const { data: made, error } = await supabase.from('quizzes').insert({
    teacher_id: original.teacher_id, coaching_session_id: original.coaching_session_id, quiz_source: original.quiz_source,
    topic: original.topic, subject: original.subject, grade: original.grade, language: original.language,
    status: 'generating', meta: retestMeta(original, avoid),
  }).select('id').single();
  if (error || !made) throw new Error((error && error.message) || 'insert returned no row');
  await supabase.from('quizzes').update({ meta: { ...(original.meta || {}), retest_quiz_id: made.id } }).eq('id', original.id);
  try {
    await require('../queue').queueJob(made.id, 'quiz_generate',
      { quizId: made.id, phone, language: original.language, source: 'retest' }, { delaySeconds: 0 });
  } catch (e) {
    await supabase.from('quizzes').update({ status: 'failed', meta: { ...retestMeta(original, avoid), previous_error: 'retest_queue' } }).eq('id', made.id);
    logEvent('quiz.retest_failed', { quizId: made.id, retestOf: original.id, error: e.message });
    return null;
  }
  logEvent('quiz.retest_made', { quizId: made.id, retestOf: original.id, userId: original.teacher_id, avoid: avoid.length });
  return made.id;
}

async function sweep({ now = new Date() } = {}) {
  if (!(await v21On())) { logToFile('quiz retest sweep: switch off'); return { skipped: 'off' }; }
  if (!inSchoolHours(now)) { logToFile('quiz retest sweep: outside school hours', { pktHour: pktHour(now) }); return { skipped: 'hours' }; }
  const out = { considered: 0, made: 0, locked: 0, unplayed: 0, errors: 0 };
  try {
    const list = await candidates(now);
    out.considered = list.length;
    for (const q of list) {
      if (out.made >= MAX_PER_TICK) break;
      try {
        if (!(await played(q.id))) { out.unplayed += 1; continue; }
        if (!(await redisService.setNX(lockKey(q.id), { at: Date.now() }, LOCK_TTL_SECS))) { out.locked += 1; continue; }
        if (await makeRetest(q)) out.made += 1;
      } catch (e) {
        out.errors += 1;
        logToFile('⚠️ quiz retest sweep: one quiz failed', { quizId: q.id, error: e.message });
      }
    }
  } catch (e) {
    out.errors += 1;
    logToFile('⚠️ quiz retest sweep: scan failed', { error: e.message });
  }
  logEvent('quiz.retest_sweep', out);
  return out;
}

module.exports = { sweep, MAX_PER_TICK, inSchoolHours, retestMeta };
