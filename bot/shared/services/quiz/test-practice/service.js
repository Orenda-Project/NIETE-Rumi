'use strict';
/**
 * Practice rounds (A/B test ict-quiz-practice-door, arm B). Every call re-checks the switch, the session token, the
 * child's eligibility and arm (door.context), so a stale page can do nothing once the switch is off.
 *
 *   start({st})          → {topics, rounds_left}: the topics the child may pick from.
 *   start({st, topics})  → {round_id, questions, rounds_left}: 5 fresh questions, never with the answers;
 *                          {capped:true} past the day's cap; {short:true} when fewer than 5 fresh ones exist or the
 *                          freshness list could not be read (fail closed).
 *   finish({st, round_id, answers}) → {score, total, items}: graded here, with the lesson plan's worked answers;
 *                          a second finish returns the first result. Only the child whose round it is.
 * Not in arm B, switch off, or not their round → null (the route answers 404). Sends nothing to anyone.
 */
const { logToFile } = require('../../../utils/logger');
const Door = require('./door');
const Pool = require('./pool.repo');
const Round = require('./round');
const Cap = require('./cap');
const F = require('./freshness');

const MAX_PICKED = 3;
const warn = (m) => logToFile(`⚠️ practice_door ${m}`);

async function childOf(st) {
  const ctx = await Door.context(st);
  return ctx && ctx.arm === 'b' ? ctx : null;
}

async function poolFor(ctx) {
  const sid = ctx.s.student_id;
  const seenQuizzes = await Pool.seenQuizIds(sid);
  const quizzes = (await Pool.poolQuizzes(ctx.quiz.grade, ctx.quiz.id)).filter((z) => !seenQuizzes.has(z.id));
  const questions = await Pool.questionsOf([ctx.quiz.id, ...quizzes.map((z) => z.id)]);
  const own = questions.filter((q) => q.quiz_id === ctx.quiz.id);
  return { quizzes, own, pool: Round.poolOf(quizzes, questions) };
}

async function build(ctx, picked, rows, left) {
  const { quizzes, own, pool } = await poolFor(ctx);
  const shown = Round.topicsOf(pool);
  if (picked == null) return { topics: shown, rounds_left: left };
  const blocked = await Pool.blockedTexts(ctx.quiz.grade);
  if (!blocked) return { short: true };
  const chosen = (Array.isArray(picked) ? picked : []).filter((t) => shown.includes(t)).slice(0, MAX_PICKED);
  const items = Round.buildRound({
    pool,
    wrong: Round.wrongKeys(ctx.quiz, own, await Pool.answersOf(ctx.s.id)),
    picked: chosen.length ? chosen : shown,
    isFresh: F.blocker(blocked.concat(own.map((q) => q.question_text))).isFresh,
    seen: Pool.seenOfRounds(rows),
    seed: `${ctx.s.id}|${rows.length}`,
  });
  if (items.length < Round.ROUND_SIZE) { warn(`short n=${items.length}`); return { short: true }; }
  const metaOf = new Map(quizzes.map((z) => [z.id, z.meta]));
  const stored = items.map((i) => ({ qid: i.qid, text: i.text, correct: i.correct, key: i.key, quizId: i.quizId,
    sloId: i.sloId, worked: Round.workedOf(metaOf.get(i.quizId), i.sloId) }));
  const id = await Pool.insertRound({
    teacher_id: ctx.quiz.teacher_id, topic: ctx.quiz.topic, grade: ctx.quiz.grade, subject: ctx.quiz.subject,
    quiz_source: 'practice', status: 'skipped',
    meta: { kind: 'practice', student_id: ctx.s.student_id, source_quiz_id: ctx.quiz.id, source_session_id: ctx.s.id, round: { items: stored } },
  });
  if (!id) return { short: true };
  return { round_id: id, questions: items.map(Round.publicOf), rounds_left: left - 1 };
}

async function start({ st, topics } = {}, { now = new Date() } = {}) {
  try {
    const ctx = await childOf(st);
    if (!ctx) return null;
    const rows = await Pool.practiceRows(ctx.s.student_id);
    const left = Cap.ROUNDS_PER_DAY - Pool.roundsSince(rows, Cap.pktDayStart(now));
    if (left <= 0) return { capped: true };
    return await build(ctx, topics, rows, left);
  } catch (e) {
    warn(`start ${e.message}`);
    return { short: true };
  }
}

async function finish({ st, round_id: roundId, answers } = {}) {
  try {
    const ctx = await childOf(st);
    if (!ctx || !roundId) return null;
    const row = await Pool.quizOf(roundId);
    const meta = row && row.meta;
    if (!row || row.quiz_source !== 'practice' || !meta || meta.kind !== 'practice' || meta.student_id !== ctx.s.student_id) return null;
    if (meta.result) return meta.result;
    const result = Round.grade((meta.round && meta.round.items) || [], answers);
    await Pool.updateRound(roundId, { meta: { ...meta, result } });
    return result;
  } catch (e) {
    warn(`finish ${e.message}`);
    return null;
  }
}

module.exports = { MAX_PICKED, start, finish };
