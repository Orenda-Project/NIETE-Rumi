'use strict';
/**
 * COACHIP nightly job, the phonics detector (bd-sex15q.14; NIGHTLY_JOB §6, §4 stage 10; ANALYSES §2.2). The model
 * names stages with quotes; code keeps only quotes found in the transcript and computes F8 itself
 * (x-analysis scripts/phonics_code_score.py). The stored result has seconds, never a quote. The transcript is read in
 * memory as the detector's input and is never written or logged.
 */
const M = require('./model');
const { clockToSeconds } = require('./allowlist');

const PHONICS_PROMPT_VERSION = 'phonics_v2';
const STAGES = Object.freeze(['sound', 'blend', 'segment']);
const LETTER_NAME_KINDS = Object.freeze(['hijje', 'tor_jor', 'letter_spelling']);
const KAPPA_OK = 0.80;
const KAPPA_DRIFT = 0.70;
const BLIND_SET = 30;
const DRIFT_RUNS = 4;
const DRIFT_PER_NIGHT = 5;

const LINE_STAMP = /^\s*\[(\d{1,3}):([0-5]\d)\]/;
const DIACRITIC_RE = /[ً-ٰٟۖ-ۭـ]/g;
const FOLD = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ه': 'ہ', 'ھ': 'ہ', 'ة': 'ہ', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا' };

/** Whitespace, punctuation, symbols and Arabic/Urdu diacritics removed; letter variants folded; lower case. */
const norm = (s) => (typeof s === 'string' ? s : '')
  .normalize('NFC').replace(DIACRITIC_RE, '').replace(/[يىكهھةأإآ]/g, (c) => FOLD[c]).toLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, '');

function buildPhonicsInput({ transcriptText, meta }) {
  const m = meta || {};
  return {
    lesson_meta: {
      lesson_id: m.lessonId != null ? m.lessonId : (m.lesson_id != null ? m.lesson_id : null),
      subject: m.subject != null ? m.subject : null,
      grade: m.grade != null ? m.grade : null,
      goal: m.goal != null ? m.goal : null,
    },
    transcript: typeof transcriptText === 'string' ? transcriptText : '',
  };
}

/** The user message x-analysis evaluated the prompt with (run_proto.py user_msg). */
const phonicsUserMessage = (input) => `LESSON META:\n${JSON.stringify(input.lesson_meta)}\n\nTRANSCRIPT:\n${input.transcript}\n\nReturn the JSON.`;

/** The transcript as one normalised string with, for each stretch, the [MM:SS] of the line it came from. */
function indexTranscript(text) {
  const segs = [];
  let all = '';
  let at = null;
  for (const line of (text || '').split('\n')) {
    const m = LINE_STAMP.exec(line);
    if (m) at = Number(m[1]) * 60 + Number(m[2]);
    const body = norm(m ? line.slice(m[0].length) : line);
    if (!body) continue;
    segs.push({ start: all.length, at });
    all += body;
  }
  return { all, segs };
}

function locate(index, quote) {
  const q = norm(quote);
  if (!q) return undefined;
  const i = index.all.indexOf(q);
  if (i < 0) return undefined;
  let at = null;
  for (const s of index.segs) { if (s.start <= i) at = s.at; else break; }
  return at;
}

function grounded(items, keyName, allowed, index) {
  const best = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object' || !allowed.includes(it[keyName])) continue;
    const at = locate(index, it.quote);
    if (at === undefined) continue;
    const prev = best.get(it[keyName]);
    if (!best.has(it[keyName]) || (at != null && (prev == null || at < prev))) best.set(it[keyName], at);
  }
  return [...best.entries()]
    .map(([k, at]) => ({ [keyName]: k, at_s: at }))
    .sort((a, b) => (a.at_s == null) - (b.at_s == null) || (a.at_s || 0) - (b.at_s || 0));
}

/**
 * The model's answer → { applicable, score, stages_heard:[{stage, at_s}], routines_heard:[{kind, at_s}],
 * letter_name_routine_only, read_alone_s }, or null when the answer is not an object. No quote survives.
 */
function groundAndScore(modelOutput, transcriptText) {
  if (!modelOutput || typeof modelOutput !== 'object' || Array.isArray(modelOutput)) return null;
  if (modelOutput.applicable !== true) {
    return { applicable: false, score: null, stages_heard: [], routines_heard: [], letter_name_routine_only: false, read_alone_s: null };
  }
  const index = indexTranscript(transcriptText);
  const stages = grounded(modelOutput.stages_heard, 'stage', STAGES, index);
  const routines = grounded(modelOutput.letter_name_routines, 'kind', [...LETTER_NAME_KINDS, 'syllable_chant'], index);
  const heard = new Set(stages.map((s) => s.stage));
  let score;
  let routineOnly = false;
  if (heard.size === 0) {
    score = routines.some((r) => r.kind === 'syllable_chant') ? 1 : 0;
    routineOnly = routines.some((r) => LETTER_NAME_KINDS.includes(r.kind));
  } else {
    score = STAGES.every((s) => heard.has(s)) && modelOutput.score === 2 ? 2 : 1;
  }
  const ra = typeof modelOutput.read_alone_at === 'string' ? clockToSeconds(modelOutput.read_alone_at) : null;
  return { applicable: true, score, stages_heard: stages, routines_heard: routines, letter_name_routine_only: routineOnly, read_alone_s: ra == null ? null : ra };
}

/**
 * One detector call → { row, result }. deps: model.callModel's deps plus { sessionId }. `model` / `purpose` let the
 * drift audit re-run on the reference model (purpose = drift_audit, its own p90).
 */
async function detectPhonics({ transcriptText, meta, ledger, deps, model = M.MODELS.phonics, purpose = 'primary' }) {
  const d = { ...(deps || {}), ledger };
  const input = buildPhonicsInput({ transcriptText, meta });
  const key = { model, analysis: 'phonics', target: '-', purpose, sessionId: d.sessionId, promptVersion: PHONICS_PROMPT_VERSION, input, jobRunId: d.jobRunId };
  if (!input.transcript.trim()) return { row: M.rowFor(key, 'failed', 'input_missing'), result: null };

  const out = await M.callModel({ ...key, prompt: M.loadPrompt(PHONICS_PROMPT_VERSION), userMessage: phonicsUserMessage(input),
    costKey: purpose === 'drift_audit' ? 'phonics_drift' : 'phonics', deps: d });
  if (out.reused) return { row: out.row, result: out.row.output || null };
  if (out.row.status !== 'ok') return { row: out.row, result: null };
  const result = groundAndScore(out.output, input.transcript);
  if (!result) return { row: { ...out.row, status: 'failed', failure_class: 'unparseable', output: null }, result: null };
  return { row: { ...out.row, status: result.applicable ? 'ok' : 'not_applicable', output: result }, result };
}

/** coachip_phonics_state.state: testing until κ ≥ 0.80 on the blind 30 and a person signs off; a person may pause. */
function phonicsState({ current = 'testing', kappa = null, signedOffBy = null, pausedBy = null, readCount = BLIND_SET } = {}) {
  if (pausedBy) return 'paused';
  if (current === 'paused' && !signedOffBy) return 'paused';
  const passed = typeof kappa === 'number' && kappa >= KAPPA_OK && readCount === BLIND_SET;
  return passed && signedOffBy ? 'ok' : 'testing';
}

/** The monthly drift audit, spread over the first four runs of the month: 5 detector reads + 5 glosses a night. */
function driftAuditSlice(dayOfMonth, runIndexInMonth) {
  const on = Number.isInteger(runIndexInMonth) && runIndexInMonth >= 1 && runIndexInMonth <= DRIFT_RUNS;
  return { detector: on ? DRIFT_PER_NIGHT : 0, gloss: on ? DRIFT_PER_NIGHT : 0, isLast: on && runIndexInMonth === DRIFT_RUNS };
}

/** After the fourth night: κ < 0.70 on the 20 reads, or any name in a stored gloss, pauses (pause_reason enum value). */
function driftVerdict(kappaOn20, anyNameInStoredGloss) {
  if (anyNameInStoredGloss) return { pause: true, reason: 'gate' };
  if (typeof kappaOn20 === 'number' && kappaOn20 < KAPPA_DRIFT) return { pause: true, reason: 'upstream' };
  return { pause: false, reason: null };
}

/** Cohen's κ, as x-analysis computed it (3 decimals; null when chance agreement is 1). */
function cohenKappa(a, b) {
  const n = a.length;
  if (!n || n !== b.length) return null;
  const po = a.reduce((s, x, i) => s + (x === b[i] ? 1 : 0), 0) / n;
  const ca = new Map();
  const cb = new Map();
  a.forEach((x) => ca.set(x, (ca.get(x) || 0) + 1));
  b.forEach((x) => cb.set(x, (cb.get(x) || 0) + 1));
  let pe = 0;
  for (const k of new Set([...ca.keys(), ...cb.keys()])) pe += (ca.get(k) || 0) * (cb.get(k) || 0);
  pe /= n * n;
  return pe < 1 ? Math.round(((po - pe) / (1 - pe)) * 1000) / 1000 : null;
}

module.exports = {
  PHONICS_PROMPT_VERSION, buildPhonicsInput, phonicsUserMessage, groundAndScore, detectPhonics, phonicsState, driftAuditSlice,
  driftVerdict, cohenKappa,
};
