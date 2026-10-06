'use strict';
/**
 * Child test v3 (bd-s1oo0.50.3, lane L37, CONTRACT §21.5) — one scorer per task kind.
 *
 *   scoreTask({ task, spec, media, lang, grade }) → ai-marks-v3
 *     task   a v3 task id (tasks.js TASKS_V3), dispatched on kindOf(task)
 *     spec   the bank's task spec (item-bank.v3, getTaskSpec)
 *     media  { file, durationSec, words?, beginAtS?, window?, skipped_by_coach? } — a local audio file;
 *            `words` (Soniox) when already transcribed; `beginAtS` / `window` (the clip) only for offline
 *            evaluation on study recordings, where the clock and cut are known
 *     lang   reading tasks: their own language; maths: the coach's language (word-problem text)
 *   A skipped task or a bank gap returns { skipped_by_coach: true } without a model call.
 *   Failures return { ok: false, reason } (never throws); `calls` (cost per call) rides on the marks' meta.
 */
const { kindOf, isTask } = require('../../tasks');
const C = require('./common');

const SCORERS = {
  listening: () => require('./listening'),
  letters: () => require('./letters'),
  nonwords: () => require('./wordlist'),
  words: () => require('./wordlist'),
  story: () => require('./story'),
  number_id: () => require('./fluency'),
  add1: () => require('./fluency'),
  sub1: () => require('./fluency'),
  discrimination: () => require('./oral'),
  missing: () => require('./oral'),
  add2: () => require('./oral'),
  sub2: () => require('./oral'),
  word_problems: () => require('./oral'),
};

const sum = (xs) => Math.round(xs.reduce((a, x) => a + (Number(x) || 0), 0) * 1e5) / 1e5;

async function scoreTask({ task, spec, media = {}, lang, grade } = {}) {
  if (!isTask(task) || !SCORERS[kindOf(task)]) return { ok: false, reason: 'bad_task' };
  if (media.skipped_by_coach || (spec && spec.gap)) return C.skipped({ task, spec });
  if (!spec || !(spec.items || spec.story || spec.questions)) return { ok: false, reason: 'form_not_found' };
  if (!media.file) return { ok: false, reason: 'no_media' };
  const prefix = task.split('.')[0];
  const kind = kindOf(task);
  const calls = [];
  const started = Date.now();
  try {
    const m = await SCORERS[kind]().score({
      task, kind, spec, media, grade: Number(grade) || 3, calls,
      lang: prefix === 'ma' ? 'ma' : prefix, coachLang: prefix === 'ma' ? lang : prefix,
    });
    m.meta = {
      seconds: Math.round((Date.now() - started) / 100) / 10,
      cost_usd: sum(calls.map((c) => c.cost)),
      calls: calls.map((c) => ({ job: c.job, model: c.model, cost: c.cost == null ? null : Math.round(c.cost * 1e5) / 1e5, seconds: Math.round((c.seconds || 0) * 10) / 10, error: c.error || null })),
    };
    if (m.review.length === 0 && m.quality === 'ai_review' && kind !== 'story' && kind !== 'letters' && kind !== 'words') {
      m.review = C.reviewItems(kind, m.quality, m.items);
    }
    if (m.quality !== 'ai_review') { m.review = []; if (m.quality === 'provisional') m.count_flag = null; }
    return m;
  } catch (e) {
    return { ok: false, reason: e instanceof C.TaskError ? e.reason : 'internal_error', detail: String(e.detail || e.message || '').slice(0, 200), calls };
  }
}

module.exports = { scoreTask, SCORERS };
