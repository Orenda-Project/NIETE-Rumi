'use strict';
/**
 * Child test v3 (bd-s1oo0.50.3) — the two engines the per-kind scorers run on.
 *
 *   timedTask   Soniox words → the clock → one clip [begin − 5, begin + 62] → one or more audio-model
 *               calls with the exact item list → per-item rows → first-row stop → attempted, correct,
 *               time remaining, rate.
 *   untimedTask the whole note → one audio-model call with the items and answers → rows → 4-in-a-row stop
 *               → correct of N (and of those asked).
 */

const { chatJSON } = require('../llm');
const { modelFor } = require('../models');
const { cutClip, cleanup } = require('../media');
const C = require('./common');

const PRE_ROLL = 5;

async function audioCall({ model, prompt, schema, clip, job, calls }) {
  const r = await chatJSON({ model, prompt, schema, audio: { data: clip.base64, format: 'mp3' }, job, maxTokens: 12000 });
  calls.push({ job: job.replace('child_test.', ''), model, cost: r.cost, seconds: r.seconds, error: r.error, ...(r.detail ? { detail: r.detail } : {}) });
  if (!r.json) throw new C.TaskError(`${job.replace('child_test.', '')}_failed`, r.error || 'no_json');
  return r.json;
}

/**
 * @param ctx { task, kind, spec, media, lang, grade, calls }
 * @param p   { refs: string[], firstItems: string[], variants: [{ name, prompt, schema, parse(json) -> raw[] }],
 *              onClock?(clock, words) }
 *            pick?: 'max_correct'. Variant 0 is the score unless pick says otherwise; every variant's count
 *            is kept in second_opinion.
 */
async function timedTask(ctx, p) {
  const { task, kind, spec, media, calls } = ctx;
  const words = await C.wordsFor(media, ctx.lang, calls);
  const clock = C.findClock({ words, spec, firstItems: p.firstItems, beginAtS: media.beginAtS });
  if (p.onClock) p.onClock(clock, words);
  const model = modelFor('counts');
  let clip = null;
  try {
    // 5 s of pre-roll: practice is done before recording, so nothing scoreable sits there, and a cue matched
    // a little late must not cut off the child's first items (each would read as passed over = wrong).
    // `media.window` is for offline evaluation only: the study's own cut of a longer recording.
    const w = media.window || { start: Math.max(0, clock.begin_at_s - PRE_ROLL), end: clock.begin_at_s + C.SECONDS + 2 };
    clip = await cutClip(media.file, w.start, w.end, 'mp3');
    const replies = await Promise.all(p.variants.map((v) => audioCall({ model, prompt: v.prompt, schema: v.schema, clip, job: `child_test.${kind}${v.name ? `_${v.name}` : ''}`, calls })));
    const sets = replies.map((json, k) => ({ json, name: p.variants[k].name || 'grid', rows: C.timedRows(p.variants[k].parse(json), p.refs) }));
    const correctOf = (x) => x.rows.filter((r) => r.verdict === 'correct').length;
    // p.pick 'max_correct': the variant that heard the most right is the score (letters: the model's failures
    // are dropped rows and early stops, never invented letters; May re-measure). Otherwise variant 0.
    const primary = p.pick === 'max_correct' ? sets.reduce((a, b) => (correctOf(b) > correctOf(a) ? b : a)) : sets[0];
    const rows = primary.rows;
    const stopRule = spec.stop || {};
    let stopped = false;
    let unclear = false;
    if (stopRule.type === 'first_row') {
      const r = C.applyFirstRowStop(rows, Number(stopRule.n) || Number(spec.per_row) || 0);
      unclear = r === 'unclear'; stopped = r === true;
    }
    const timed = C.timedSummary({ rows, clock, words, durationSec: media.durationSec, stopped });
    const m = C.marks({ task, spec, timed, stopped, items: rows, modelVersions: { counts: model, ...(media.sttModel ? { stt: media.sttModel } : {}) } });
    if (unclear) { m.flags.push('first_row_unclear'); m.count_flag = { reason: 'first_row_unclear' }; }
    if (primary.json && primary.json.found === false) m.flags.push('task_not_found');
    if (clock.clock !== 'cue') m.flags.push(clock.clock === 'inferred' ? 'no_begin_line' : 'clock_given');
    if (sets.length > 1) m.second_opinion = sets.map((x) => ({ name: x.name, correct: correctOf(x), used: x === primary }));
    return m;
  } finally {
    if (clip) cleanup(clip.path);
  }
}

async function untimedTask(ctx, p) {
  const { task, kind, spec, media, calls } = ctx;
  const model = modelFor('counts');
  let clip = null;
  try {
    const end = Number.isFinite(media.durationSec) ? media.durationSec : 600;
    clip = await cutClip(media.file, 0, end, 'mp3');
    const json = await audioCall({ model, prompt: p.prompt, schema: p.schema, clip, job: `child_test.${kind}`, calls });
    const rows = C.untimedRows(C.byPosition(json.items, p.refs.length), p.refs);
    const stop = (spec.stop && spec.stop.type === 'consecutive_errors') ? C.applyConsecutiveStop(rows, Number(spec.stop.n) || 4) : { stopped: false };
    const m = C.marks({ task, spec, score: C.untimedScore(rows), stopped: stop.stopped, items: rows, modelVersions: { counts: model } });
    if (json.found === false) m.flags.push('task_not_found');
    return m;
  } finally {
    if (clip) cleanup(clip.path);
  }
}

module.exports = { timedTask, untimedTask, audioCall };
