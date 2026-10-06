'use strict';
/**
 * REASONS A CHILD CAN FOLLOW (quiz_author_gates_v2 only).
 *
 * The explanation and each option's feedback are read aloud to the child after
 * an answer. Authored for a grade 1-5 quiz they came out as adult prose — 15 to
 * 25 words, nested clauses ("The prediction that the Earth's core is extremely
 * hot is supported by the observation that lava, which originates…"). A child
 * of seven hears the first half and loses the point.
 *
 * The rule is a SOFT one, banded by grade: grades 1-2 one sentence of at most
 * 12 words, grades 3-5 at most two sentences and 18 words, everyday words, no
 * clause inside a clause. It never costs a question. Every reason over its cap
 * gets ONE small call that rewrites only those texts; code takes a rewrite back
 * only when it is shorter and keeps every number the original said, and writes
 * it into ONLY that field — the stem, the options and the key cannot move. What
 * the call could not shorten ships as it was, counted.
 *
 * Grade 6 and above, and a quiz with no grade, are untouched. Urdu is counted
 * with a looser cap (×1.25): its postpositions are separate words.
 */

const URDU_FACTOR = 1.25;

/** The cap for a grade band, or null when the rule does not apply. */
function reasonCap(gradeBand) {
  const g = String(gradeBand || '').toLowerCase();
  if (/\b(kg|prep|nursery|ecce|katchi)\b/.test(g)) return { words: 12, sentences: 1, band: '1-2' };
  const nums = (g.match(/\d+/g) || []).map(Number);
  if (!nums.length) return null;
  const top = Math.max(...nums);
  if (top <= 2) return { words: 12, sentences: 1, band: '1-2' };
  if (top <= 5) return { words: 18, sentences: 2, band: '3-5' };
  return null;
}

/** A sum in TeX ($19 - 7$) is one thing said, not five words. */
const plain = (t) => String(t || '').replace(/\$[^$]*\$/g, 'X');
const wordCount = (t) => plain(t).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const sentenceCount = (t) => plain(t).trim().split(/(?<=[.!?۔؟])\s+/).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
const numbersIn = (t) => (String(t || '').match(/\d+(?:[.,/]\d+)?/g) || []);

function capFor(cap, language) {
  return language === 'ur' ? Math.round(cap.words * URDU_FACTOR) : cap.words;
}

function tooLong(text, cap, language) {
  return wordCount(text) > capFor(cap, language) || sentenceCount(text) > cap.sentences;
}

/** Every reason text of a question, with the path that writes it back. */
function reasonFields(q) {
  const out = [];
  if (String((q && q.explanation) || '').trim()) out.push({ field: 'explanation', text: q.explanation });
  const fb = (q && q.option_feedback) || {};
  if (String(fb.correct || '').trim()) out.push({ field: 'correct', text: fb.correct });
  Object.entries(fb.wrong || {}).forEach(([k, t]) => {
    if (String(t || '').trim()) out.push({ field: `wrong.${k}`, text: t });
  });
  return out;
}

/** The reasons over their cap: [{ q, field, text, words }]. */
function longReasons(questions, { gradeBand, language } = {}) {
  const cap = reasonCap(gradeBand);
  if (!cap || !Array.isArray(questions)) return [];
  return questions.flatMap((q, i) => reasonFields(q)
    .filter((r) => tooLong(r.text, cap, language))
    .map((r) => ({ q: i, field: r.field, text: String(r.text), words: wordCount(r.text) })));
}

function buildPrompt(targets, { cap, language, questions }) {
  const lang = language === 'ur' ? 'Urdu (Urdu script; an English technical term may stay in English letters)' : 'English';
  const words = capFor(cap, language);
  const lines = targets.map((t, n) => {
    const q = questions[t.q] || {};
    const key = Array.isArray(q.options) ? q.options[Number(q.correct_index)] : '';
    const opt = t.field.startsWith('wrong.') && Array.isArray(q.options) ? q.options[Number(t.field.slice(6))] : null;
    return JSON.stringify({
      id: n, question: q.question, right_answer: key, ...(opt != null ? { feedback_for_wrong_option: opt } : {}), kind: t.field.split('.')[0], text: t.text,
    });
  }).join('\n');
  return [
    `You rewrite short texts that are READ ALOUD to a child in grade ${cap.band} after they answer a quiz question.`,
    `RULE: each text becomes ${cap.sentences === 1 ? 'ONE sentence' : 'at most TWO short sentences'} of at most ${words} words, in ${lang}. Everyday words a child of that age uses at home. No clause inside a clause, no "which"/"that is"/"whereas" chains, no passive voice. Speak to the child directly when you speak to them, with no gender ("you").`,
    'KEEP THE MEANING EXACTLY: the same reason, the same right answer, every number and name it gave. A text for a wrong option still says why that option is not right (never praise it). Do not add a new fact. Do not mention the teacher or "the lesson".',
    'Return JSON only: { "texts": [ { "id": 0, "text": "" } ] } — one entry per id below, in any order.',
    '',
    lines,
  ].join('\n');
}

/** A rewrite code accepts: shorter, non-empty, every number of the original still said. */
function acceptable(orig, next) {
  const t = String(next || '').trim();
  if (!t || wordCount(t) >= wordCount(orig)) return false;
  const have = new Set(numbersIn(t));
  return numbersIn(orig).every((n) => have.has(n));
}

function writeBack(q, field, text) {
  if (field === 'explanation') return { ...q, explanation: text };
  const fb = { ...(q.option_feedback || {}) };
  if (field === 'correct') fb.correct = text;
  else fb.wrong = { ...(fb.wrong || {}), [field.slice(6)]: text };
  return { ...q, option_feedback: fb };
}

const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/**
 * Shorten the reasons over their cap. Never throws, never drops a question.
 * @param {{questions:object[], gradeBand:string, language:string, complete:Function}} args
 *   `complete({prompt, maxTokens, label})` → { json, costUsd, latencyMs, model } (transcript-quiz-llm completeJson)
 * @returns {Promise<{questions:object[], changed:boolean, record:object|null}>}
 */
async function shortenReasons({
  questions, gradeBand, language, complete,
}) {
  const cap = reasonCap(gradeBand);
  const targets = longReasons(questions, { gradeBand, language });
  if (!cap || !targets.length) return { questions, changed: false, record: null };
  const record = {
    band: cap.band, cap_words: capFor(cap, language), targets: targets.length,
    words_before: mean(targets.map((t) => t.words)), rewritten: 0, still_long: targets.length, cost_usd: 0, status: 'unchanged',
  };
  let json;
  try {
    const out = await complete({ prompt: buildPrompt(targets, { cap, language, questions }), maxTokens: 4000, label: 'transcript_quiz.child_reasons' });
    json = out && out.json;
    record.cost_usd = Number(out && out.costUsd) || 0;
    record.latency_ms = (out && out.latencyMs) || null;
    record.model = (out && out.model) || null;
  } catch (err) {
    record.status = 'error';
    record.error = String((err && err.message) || err).slice(0, 160);
    return { questions, changed: false, record };
  }
  const byId = new Map(((json && json.texts) || []).filter((x) => x && Number.isInteger(Number(x.id))).map((x) => [Number(x.id), x.text]));
  let next = questions;
  const after = [];
  targets.forEach((t, n) => {
    const text = byId.get(n);
    if (acceptable(t.text, text)) {
      next = next.map((q, i) => (i === t.q ? writeBack(q, t.field, String(text).trim()) : q));
      record.rewritten += 1;
      after.push(wordCount(text));
    } else {
      after.push(t.words);
    }
  });
  record.words_after = mean(after);
  record.still_long = longReasons(next, { gradeBand, language }).length;
  record.status = record.rewritten ? 'shortened' : 'unchanged';
  return { questions: next, changed: record.rewritten > 0, record };
}

module.exports = {
  reasonCap, longReasons, shortenReasons, wordCount, sentenceCount, acceptable, buildPrompt,
};
