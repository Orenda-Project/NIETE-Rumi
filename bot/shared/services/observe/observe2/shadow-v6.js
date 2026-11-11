'use strict';

/**
 * /observe2 shadow mode (bd-qix9oh.5, spec §4.2; CONTRACTS §8).
 *
 * fico_coach_rubric = shadow stamps a visit v5 and marks visit_context.shadow_v6 (rubric.js, field-form.store.js).
 * Everything the coach and the teacher see is v5. After the v5 moments are stored, the same transcript is read
 * once more the way a v6 visit reads it: the quality gate, the moments prompt v3 (with room evidence), the quote
 * and label checks, the v6 rules. The result goes to rumi_moments.shadow_v6 and nowhere else:
 *
 *   { prompt_version: 'observe2-moments-v3', moments, counts, room_evidence, rumi_levels, transcript_quality,
 *     at, status: 'ok' }
 *   { prompt_version, transcript_quality, moments: [], ..., status: 'broken' }   the gate said broken: no call
 *   { prompt_version, transcript_quality?, at, status: 'failed', error }        the call or a check failed
 *
 * runFor returns at once: the read runs in the background, never throws into the moments job and never holds up
 * the check. check-v6's analysis.js copies the blob to analysis_data.observe2.shadow_v6 at check end.
 */

const Store = require('./field-form.store');
const { isV6, isShadow } = require('./rubric');
const { logToFile } = require('../../../utils/logger');

const V6 = 'fico17_v6';
const MAX_TOKENS = 16000;
const ERROR_MAX = 200;

const pending = new Set();

async function defaultLlm(prompt, { maxTokens = MAX_TOKENS, label = 'observe2.moments.shadow', job } = {}) {
  const GPT5MiniService = require('../../gpt5-mini.service');
  return GPT5MiniService.completeJson(prompt, { maxTokens, label, job });
}

/** Every heard row IE, a combined row's transcript-only result IE (D2 has none): as moments.js does on v6. */
function brokenLevels(heardLevels, combined) {
  return Object.fromEntries(Object.entries(heardLevels([], {}, [], { rubric: V6 })).map(([code, row]) => {
    if (!combined.includes(code)) return [code, { level: 'IE', because: 'the recording could not be used', source: 'heard' }];
    return [code, 'dc_result' in row ? { ...row, dc_result: 'IE' } : row];
  }));
}

async function read(form, transcript, { llm, labelLlm, lang }) {
  const Moments = require('./moments');
  const Quality = require('../transcript-quality');
  const { heardLevels, COMBINED_CODES_V6 } = require('./rules');
  const { groupOfFor, ROOM_KINDS } = require('./moment-types');
  const { checkQuotes } = require('./quote-check');
  const { checkLabels } = require('./label-check');
  const { JOB, unwrap, cutOff } = require('./llm-reply');
  const base = { prompt_version: Moments.PROMPT_VERSION_V3 };

  const quality = Quality.assess({ transcript, periodMinutes: form.period_minutes });
  base.transcript_quality = Quality.stored(quality);
  if (quality.status === 'broken') {
    return {
      ...base,
      moments: [],
      counts: { closed_q: 0, praise_generic: 0 },
      room_evidence: Object.fromEntries(Object.keys(ROOM_KINDS).map((c) => [c, []])),
      rumi_levels: brokenLevels(heardLevels, COMBINED_CODES_V6),
      at: new Date().toISOString(),
      status: 'broken',
    };
  }

  try {
    const prompt = Moments.buildPrompt(transcript, form, { lang, rubric: V6, gaps: Quality.promptGaps(quality) });
    const reply = unwrap(await llm(prompt, { maxTokens: MAX_TOKENS, job: JOB }));
    if (cutOff(reply, MAX_TOKENS)) throw new Error('moments reply cut off at the output limit');
    const raw = reply.result;
    const groupOf = groupOfFor(V6);
    const known = (Array.isArray(raw && raw.moments) ? raw.moments : []).filter((m) => m && groupOf[m.type]);
    const checked = checkQuotes(known, transcript);
    const labelled = await checkLabels(checked.moments, { transcript, lang, llm: labelLlm || llm, rubric: V6 });
    const { moments, counts } = Moments.normalise({ ...(raw || {}), moments: labelled.moments }, { rubric: V6 });
    return {
      ...base,
      moments,
      counts,
      room_evidence: Moments.roomEvidence(raw, transcript),
      rumi_levels: heardLevels(moments, counts, [], { rubric: V6 }),
      at: new Date().toISOString(),
      status: 'ok',
    };
  } catch (err) {
    return { ...base, at: new Date().toISOString(), status: 'failed', error: String((err && err.message) || err).slice(0, ERROR_MAX) };
  }
}

async function work(form, transcript, deps) {
  try {
    const blob = await read(form, transcript, deps);
    const stored = await Store.setShadowV6(form.id, blob);
    logToFile('[observe2] shadow v6 read stored', {
      formId: form.id, status: blob.status, stored: stored.ok, quality: blob.transcript_quality && blob.transcript_quality.status,
      moments: (blob.moments || []).length, ...(blob.error ? { error: blob.error } : {}),
    }, blob.status === 'failed' || !stored.ok ? 'error' : 'info');
    return { ok: stored.ok, status: blob.status };
  } catch (err) {
    logToFile('[observe2] shadow v6 read threw', { formId: form && form.id, error: err.message }, 'error');
    return { ok: false, status: 'failed' };
  }
}

/**
 * Start the v6 read of a shadow visit's transcript, and return without waiting for it.
 * @param {object} form  the observation_field_forms row
 * @param {string} transcript  the timed transcript the v5 moments were read from
 * @param {{llm?: Function, labelLlm?: Function, lang?: string}} deps  the moments job's own model seams
 * @returns {Promise<{started: boolean, done?: Promise<{ok: boolean, status: string}>}>}  never rejects
 */
async function runFor(form, transcript, deps = {}) {
  if (!form || !isShadow(form) || isV6(form)) return { started: false };
  const done = work(form, transcript, { llm: deps.llm || defaultLlm, labelLlm: deps.labelLlm, lang: deps.lang });
  pending.add(done);
  done.finally(() => pending.delete(done));
  return { started: true, done };
}

/** Settles when every shadow read started so far has finished (for the tests). */
function idle() {
  return Promise.all([...pending]).then(() => undefined);
}

module.exports = { runFor, idle };
