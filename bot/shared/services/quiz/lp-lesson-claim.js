'use strict';
/**
 * ONE quiz per planned lesson — whichever door asks for it.
 *
 * Two doors write an lp_v8 quiz for a lesson a teacher took: the 15:00 offer
 * (lp-quiz-offer, a class's lessons) and /quiz (a tap on one lesson, list
 * message or Flow). Either can be tapped twice, and the bot runs on several
 * replicas, so "is there a quiz for this lesson yet?" followed by an INSERT is
 * a race that makes two quizzes for one lesson (Class P: never check-then-act).
 * There is no unique index to lean on — a lesson lives inside `quizzes.meta`
 * (`meta.lessons[].lesson_id`) — and one is not added for this (Rule 15; the
 * read below is a teacher's own handful of rows).
 *
 * The claim, per (teacher, lesson):
 *   1. a Redis `SET NX` lock per lesson, held only for the claim itself — the
 *      strict guard while Redis is up;
 *   2. under it: read the teacher's lp_v8 quizzes → any covering the lesson?
 *      then the lesson is taken;
 *   3. INSERT the quiz (the caller's row);
 *   4. re-read: if more than one quiz now covers a lesson, the OLDEST
 *      (created_at, then id) wins and every other writer deletes its own row.
 *      This is what keeps it single when Redis fails OPEN (railway-redis
 *      setNX returns "claimed" when Redis is down rather than drop work).
 *
 * The loser is told who won (`existing`), so the caller can answer with that
 * quiz's state instead of a second "making it now".
 */

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { LP_V8 } = require('./quiz-sources');

/** Long enough for insert + re-read; short enough that a crashed holder frees the lesson. */
const LOCK_TTL_SECS = 30;
const LOCK_KEY = (teacherId, lessonId) => `quiz:lesson-claim:${teacherId}:${lessonId}`;

/**
 * The only slice of `quizzes.meta` a coverage read takes. meta carries the
 * digest and the share message (8 KB median, 56 KB largest on production,
 * 24 Sep 2026); the lessons are a few hundred bytes (Class R).
 */
const COVERAGE_SELECT = 'id, status, created_at, lessons:meta->lessons';

/** The catalog lesson ids a coverage row (COVERAGE_SELECT) covers. */
function lessonIdsOf(row) {
  return (Array.isArray(row && row.lessons) ? row.lessons : []).map((l) => l && l.lesson_id).filter(Boolean);
}

/** Does this quiz row cover any of `lessonIds`? */
function covers(row, lessonIds) {
  return lessonIdsOf(row).some((id) => lessonIds.includes(id));
}

const oldestFirst = (a, b) => {
  const t = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (t) return t;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
};

/**
 * The teacher's lp_v8 quizzes written since `since` that cover any of
 * `lessonIds`, oldest first. Throws on a read error: "could not read" is never
 * "no quiz yet" — that collapse is exactly how a second quiz gets made.
 *
 * @param {string} teacherId
 * @param {string[]} lessonIds catalog lesson ids
 * @param {{since: string}} opts ISO lower bound (a quiz for a lesson is always
 *   written after the lesson was delivered)
 * @returns {Promise<object[]>}
 */
async function coveringQuizzes(teacherId, lessonIds, { since } = {}) {
  let q = supabase.from('quizzes')
    .select(COVERAGE_SELECT)
    .eq('teacher_id', teacherId)
    .eq('quiz_source', LP_V8);
  if (since) q = q.gte('created_at', since);
  const { data, error } = await q;
  if (error) throw new Error(`lesson claim: quizzes read failed — ${error.message || error}`);
  return (data || []).filter((row) => covers(row, lessonIds)).sort(oldestFirst);
}

async function lock(key) {
  try {
    return await redisService.setNX(key, { at: Date.now() }, LOCK_TTL_SECS);
  } catch (err) {
    // The re-read below still keeps the claim single; the lock is the strict half.
    logToFile('⚠️ lesson claim: lock unavailable — relying on the re-read', { error: err.message }, 'warn');
    return true;
  }
}

async function unlock(key) {
  try { await redisService.delete(key); } catch (err) {
    logToFile('⚠️ lesson claim: unlock failed (the lock expires on its own)', { error: err.message }, 'warn');
  }
}

/**
 * Claim `lessonIds` for one new quiz.
 *
 * @param {object} args
 * @param {string} args.teacherId
 * @param {string[]} args.lessonIds catalog lesson ids the new quiz will cover
 * @param {string} [args.since] ISO lower bound for the coverage read
 * @param {function(): Promise<string>} args.insert writes the quiz row, returns its id
 * @param {string} [args.via] who asked ('list' | 'flow' | 'lp_offer') — log only
 * @returns {Promise<{won: true, quizId: string} | {won: false, reason: 'locked'|'covered'|'raced', existing: object|null}>}
 */
async function claimLessons({ teacherId, lessonIds, since = null, insert, via = null }) {
  const ids = [...new Set((lessonIds || []).filter(Boolean))].sort();
  if (!teacherId || !ids.length) throw new Error('lesson claim: a teacher and at least one lesson are required');
  const held = [];
  try {
    for (const id of ids) {
      const key = LOCK_KEY(teacherId, id);
      // eslint-disable-next-line no-await-in-loop
      if (!(await lock(key))) {
        // eslint-disable-next-line no-await-in-loop
        const existing = (await coveringQuizzes(teacherId, ids, { since }))[0] || null;
        logEvent('quiz_menu.lesson_claimed', { userId: teacherId, won: false, reason: 'locked', via, quizId: existing ? existing.id : null });
        return { won: false, reason: 'locked', existing };
      }
      held.push(key);
    }

    const before = await coveringQuizzes(teacherId, ids, { since });
    if (before.length) {
      logEvent('quiz_menu.lesson_claimed', { userId: teacherId, won: false, reason: 'covered', via, quizId: before[0].id });
      return { won: false, reason: 'covered', existing: before[0] };
    }

    const quizId = await insert();
    const after = await coveringQuizzes(teacherId, ids, { since });
    const winner = after[0];
    if (winner && winner.id !== quizId) {
      const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
      if (error) {
        logToFile('❌ lesson claim: could not remove the losing quiz row', { quizId, error: error.message }, 'error');
      }
      logEvent('quiz_menu.lesson_claimed', { userId: teacherId, won: false, reason: 'raced', via, quizId: winner.id, lostQuizId: quizId });
      return { won: false, reason: 'raced', existing: winner };
    }
    logEvent('quiz_menu.lesson_claimed', { userId: teacherId, won: true, via, quizId, lessons: ids.length });
    return { won: true, quizId };
  } finally {
    for (const key of held) {
      // eslint-disable-next-line no-await-in-loop
      await unlock(key);
    }
  }
}

module.exports = { claimLessons, coveringQuizzes, lessonIdsOf, COVERAGE_SELECT };
