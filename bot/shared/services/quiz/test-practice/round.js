'use strict';
/**
 * Practice door round builder. Pure. A round is ROUND_SIZE questions drawn from other lesson-plan quizzes of the same
 * grade and subject: first on the skills the child got wrong in the quiz just finished, then on the topics the child
 * picked. A skill is the curriculum SLO code when the quiz has one, else the quiz topic. Every question must pass the
 * freshness check (freshness.js) and not be one the child has seen. Worked answers are the lesson plan's own words (the
 * digest's evidence_quote for that SLO), never the model-written explanation.
 */
const crypto = require('crypto');
const SloCode = require('../quiz-slo-code');
const { norm } = require('./freshness');

const ROUND_SIZE = 5;
const TOPICS_SHOWN = 6;
const OPTIONS = ['A', 'B', 'C'];

function keyOf(quiz, question) {
  const code = SloCode.codeOf(quiz && quiz.meta, question.external_id);
  if (code) return `code:${code}`;
  return `topic:${String((quiz && quiz.topic) || '').trim().toLowerCase()}`;
}

function wrongKeys(quiz, questions, answers) {
  const wrongIds = new Set((answers || []).filter((a) => a && a.is_correct === false).map((a) => a.question_id));
  const keys = [];
  (questions || []).forEach((q) => {
    if (!wrongIds.has(q.id)) return;
    const k = keyOf(quiz, q);
    if (!keys.includes(k)) keys.push(k);
  });
  return keys;
}

function poolOf(quizzes, questions) {
  const byId = new Map((quizzes || []).map((z) => [z.id, z]));
  return (questions || []).filter((q) => byId.has(q.quiz_id)).map((q) => {
    const z = byId.get(q.quiz_id);
    return {
      qid: q.id, text: q.question_text, options: { A: q.option_a, B: q.option_b, C: q.option_c },
      correct: q.correct_option, key: keyOf(z, q), topic: z.topic, quizId: z.id, sloId: SloCode.sloIdOf(q.external_id),
    };
  });
}

function topicsOf(pool, limit = TOPICS_SHOWN) {
  const out = [];
  (pool || []).forEach((i) => { if (i.topic && !out.includes(i.topic) && out.length < limit) out.push(i.topic); });
  return out;
}

const rank = (seed, qid) => crypto.createHash('sha256').update(`${seed}|${qid}`).digest('hex');

// Take from each group in turn so one skill or topic does not fill the round.
function roundRobin(groups, take, accept) {
  const out = [];
  const queues = groups.map((g) => g.slice());
  let moved = true;
  while (out.length < take && moved) {
    moved = false;
    for (const q of queues) {
      while (q.length) {
        const i = q.shift();
        if (accept(i)) { out.push(i); moved = true; break; }
      }
      if (out.length >= take) break;
    }
  }
  return out;
}

function buildRound({ pool, wrong, picked, isFresh, seen, seed, size = ROUND_SIZE }) {
  const order = (pool || []).slice().sort((x, y) => (rank(seed, x.qid) < rank(seed, y.qid) ? -1 : 1));
  const usedText = new Set();
  const usedId = new Set();
  const accept = (i) => {
    const t = norm(i.text);
    if (!t || usedText.has(t) || usedId.has(i.qid) || (seen && seen.has(i.qid)) || !isFresh(i.text)) return false;
    if (!OPTIONS.includes(i.correct)) return false;
    usedText.add(t); usedId.add(i.qid);
    return true;
  };
  const byWrong = (wrong || []).map((k) => order.filter((i) => i.key === k));
  const first = roundRobin(byWrong, size, accept);
  const byTopic = (picked || []).map((t) => order.filter((i) => i.topic === t));
  return first.concat(roundRobin(byTopic, size - first.length, accept));
}

const publicOf = (i) => ({ qid: i.qid, text: i.text, options: { ...i.options } });

function workedOf(meta, sloId) {
  const slos = (meta && meta.digest && Array.isArray(meta.digest.slos)) ? meta.digest.slos : [];
  const s = slos.find((x) => x && x.id === sloId);
  const quote = s && typeof s.evidence_quote === 'string' ? s.evidence_quote.trim() : '';
  return quote || null;
}

function grade(items, answers) {
  const a = answers && typeof answers === 'object' ? answers : {};
  const out = (items || []).map((i) => {
    const chosen = OPTIONS.includes(a[i.qid]) ? a[i.qid] : null;
    return { qid: i.qid, chosen, correct: i.correct, right: chosen === i.correct, worked: i.worked || null };
  });
  return { score: out.filter((x) => x.right).length, total: out.length, items: out };
}

module.exports = { ROUND_SIZE, TOPICS_SHOWN, keyOf, wrongKeys, poolOf, topicsOf, buildRound, publicOf, workedOf, grade };
