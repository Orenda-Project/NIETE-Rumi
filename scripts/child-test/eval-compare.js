'use strict';
/**
 * Child test — how an AI (or coach) mark is compared with its key. L5's comparison functions, moved
 * here unchanged from eval-scoring.js so the offline eval and the simulation scorer (L14,
 * score-run-compare.js / sim/score_run.py) share one implementation.
 *
 *   storyRow    one block's story count + per-word tp/fp/fn on the words both sides reached
 *   itemRows    per-item verdict rows (none counts as wrong; an item the AI did not return is "missing")
 *   stats       count agreement: n, r, MAE, bias, exact, within ±1/3/5
 *   agreement   share of item rows that agree
 *   withinTolerance / verdictAgrees   "does this mark agree with the key?" for one field, at the bands
 *               L5's evaluation reports (EVAL.md): story ±5 (the band the story bars were set on), quick
 *               sums ±3, letters/words fallback ±3; item verdicts exactly, after none → wrong
 */

const TOLERANCE = Object.freeze({
  'story.words_correct': 5,
  'story.words_attempted': 5,
  'maths.quick_sums.correct': 3,
  'maths.quick_sums.attempted': 3,
  'fallback.letters': 3,
  'fallback.words': 3,
});

/** An item verdict as L5 compares it: `none` (nothing heard) is a wrong answer. */
const normVerdict = (v) => (v === 'none' ? 'wrong' : v);

function withinTolerance(field, ai, key) {
  const tol = TOLERANCE[field];
  if (tol == null) throw new Error(`no tolerance for ${field}`);
  const a = Number(ai); const k = Number(key);
  return Number.isFinite(a) && Number.isFinite(k) && Math.abs(a - k) <= tol;
}

/** Written sums keep all four verdicts (blank ≠ unreadable); every other item compares after none → wrong. */
function verdictAgrees(field, ai, key) {
  if (field === 'maths.written' || field === 'written') return ai === key;
  return normVerdict(ai) === normVerdict(key);
}

function aiItems(marks, field) {
  const m = marks.maths || {};
  if (field === 'numbers') return m.numbers;
  if (field === 'written') return m.written;
  if (field === 'word_problem') return m.word_problem ? [{ id: 'word_problem', ...m.word_problem }] : null;
  return marks[field];
}

function storyRow(rec, keyStory, kind) {
  const ai = rec.aiMarks && rec.aiMarks.story;
  if (!keyStory) return null;
  const row = { id: rec.id, block: rec.block, kind, key_quality: keyStory.key_quality || 'exact', key_correct: keyStory.words_correct, key_attempted: keyStory.words_attempted,
    ai_correct: ai ? ai.words_correct : null, ai_attempted: ai ? ai.words_attempted : null, ai_conf: ai ? ai.confidence : null,
    flags: rec.aiMarks ? rec.aiMarks.protocol_flags : [], status: rec.res && rec.res.aiStatus, reason: rec.res && rec.res.reason,
    align_correct: null };
  if (ai) {
    const keyWrong = new Set((keyStory.flagged || []).map((f) => f.idx));
    const reach = Math.min(ai.words_attempted, keyStory.words_attempted);
    const aiWrong = new Set(ai.flagged.map((f) => f.idx));
    let tp = 0; let fp = 0; let fn = 0; let tpChip = 0; let fpChip = 0;
    for (let i = 0; i < reach; i += 1) {
      const a = aiWrong.has(i); const k = keyWrong.has(i);
      if (a && k) tp += 1; else if (a && !k) fp += 1; else if (!a && k) fn += 1;
      const chip = ai.flagged.find((f) => f.idx === i);
      if (chip && chip.confidence >= 0.6) { if (k) tpChip += 1; else fpChip += 1; }
    }
    Object.assign(row, { tp, fp, fn, tpChip, fpChip });
  }
  return row;
}

function itemRows(rec, keyItems, field, kind) {
  const ai = rec.aiMarks ? aiItems(rec.aiMarks, field) : null;
  if (!keyItems || !keyItems.length || !ai) return [];
  const byId = new Map(ai.map((x) => [x.id, x]));
  return keyItems.filter((k) => k.verdict != null).map((k) => {
    const a = byId.get(k.id);
    return { id: rec.id, block: rec.block, field, kind, item: k.id, key: k.verdict === 'none' ? 'wrong' : k.verdict, ai: a ? (a.verdict === 'none' ? 'wrong' : a.verdict) : 'missing', conf: a ? a.confidence : null };
  });
}

function stats(pairs) {
  // pairs: [{ai, key}] numeric
  const d = pairs.filter((p) => Number.isFinite(p.ai) && Number.isFinite(p.key));
  if (!d.length) return { n: 0 };
  const diff = d.map((p) => p.ai - p.key);
  const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const ma = mean(d.map((p) => p.ai)); const mk = mean(d.map((p) => p.key));
  const cov = mean(d.map((p) => (p.ai - ma) * (p.key - mk)));
  const sa = Math.sqrt(mean(d.map((p) => (p.ai - ma) ** 2))); const sk = Math.sqrt(mean(d.map((p) => (p.key - mk) ** 2)));
  return {
    n: d.length, r: sa && sk ? Math.round((cov / (sa * sk)) * 100) / 100 : null,
    mae: Math.round(mean(diff.map(Math.abs)) * 10) / 10, bias: Math.round(mean(diff) * 10) / 10,
    exact: Math.round(100 * d.filter((p) => p.ai === p.key).length / d.length),
    within1: Math.round(100 * diff.filter((x) => Math.abs(x) <= 1).length / d.length),
    within3: Math.round(100 * diff.filter((x) => Math.abs(x) <= 3).length / d.length),
    within5: Math.round(100 * diff.filter((x) => Math.abs(x) <= 5).length / d.length),
  };
}

function agreement(rows) {
  const d = rows.filter((r) => r.ai !== 'missing');
  if (!d.length) return { n: 0, missing: rows.length };
  return { n: d.length, missing: rows.length - d.length, agree: Math.round(100 * d.filter((r) => r.ai === r.key).length / d.length) };
}

module.exports = { storyRow, itemRows, stats, agreement, withinTolerance, verdictAgrees, normVerdict, TOLERANCE };
