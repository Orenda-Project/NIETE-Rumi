'use strict';
/**
 * Child test (bd-s1oo0.5, lane L5) — Rumi marks one block.
 *
 *   await scoreBlock({ sessionId, block: 'urdu'|'english'|'maths', grade, form })
 *   // → { ok, aiStatus: 'scored'|'partial'|'failed'|'pending', reason? }
 *
 * Never throws into the conversation (CONTRACT §5). Reads the block's media keys
 * through L3's store, writes `ai_marks` once (store.saveAiMarks), and records a
 * failure with its reason (store.setAiStatus) so the coach is told, not left
 * waiting.
 *
 * Pipeline (PLAN §6, the May 2026 study stack):
 *   Soniox (language forced) → cue-phrase windows (labeller fallback) →
 *   story counts + chips (Gemini 3.8 Flash on the clip, Soniox alignment and
 *   SpeechAce as cross-checks) · comprehension (Gemini 3 Flash text grader) ·
 *   first sounds (hint only) + made-up words · maths: number grammar on the
 *   transcript, word problem by text grader, strip photo by Gemini 3.1 Pro.
 *
 * Maths is written once, after BOTH the voice note and the strip photo are in
 * (`pending` until then). `force: true` scores whatever is there, for a photo
 * that never came.
 *
 * v2 switches (bd-s1oo0.46.3, CONTRACT §19), read per call, v2 by default:
 *   CHILD_TEST_BATTERY=v2   Urdu/English are scored for story, questions and the
 *                           non-reader fallback only; first sounds and made-up words
 *                           are neither looked for nor scored (v1: as above). The
 *                           fallback is scored only when the coach's switch line is
 *                           heard (meta.fallback_switch); v1 infers it from line 1.
 *   CHILD_TEST_MATHS_MODE=oral  maths is scored from its voice note alone (May set:
 *                           compare, sums, two word problems; maths-oral.js), no photo
 *                           is awaited (strip: as above).
 *
 * Battery v3 (bd-s1oo0.50.3, lane L37, CONTRACT §21.5): a `block` that is a v3 task id (tasks.js TASKS_V3,
 * e.g. 'ur.letters', 'ma.add1') is one task's row. The same job runner (conversation/recovery.js
 * runScoring → scoreBlock) scores it through scoreTask (scoring/tasks/), which writes `ai-marks-v3`.
 * `form` is the term set letter (item-bank.v3 getTaskSpec({ grade, set, task })). A row the coach skipped,
 * or a bank gap, gets { skipped_by_coach: true } with no model call.
 */

const { logToFile, logError } = require('../../../utils/logger');
const { logEvent } = require('../../../utils/structured-logger');
const media = require('./media');
const stt = require('./stt');
const { findCueWindows, findSwitchLine, reconcileWindows, defaultTimedWindow } = require('./windows');
const { labelMissing } = require('./labeller');
const { scoreStory, scoreFallback, needsFallback } = require('./story');
const { scoreQuestions } = require('./comprehension');
const { scorePhonics } = require('./phonics');
const { scoreSpoken, scoreSpokenWordProblem } = require('./maths');
const { scoreStrip } = require('./maths-photo');
const { assembleMarks, aiStatusFor, sectionsFor } = require('./assemble');
const { findOralWindows, scoreOralCard, scoreOralWordProblems } = require('./maths-oral');
const { batteryVersion, mathsMode: mathsModeOf } = require('../item-bank');
const { modelFor } = require('./models');
const { scoreTask } = require('./tasks');
const { isTask } = require('../tasks');

const BLOCKS = new Set(['urdu', 'english', 'maths']);
const STT_LANGUAGE = { urdu: 'ur', english: 'en', maths: 'ur' };

class Fatal extends Error {
  constructor(reason, detail) { super(reason); this.reason = reason; this.detail = detail; }
}

const sum = (xs) => Math.round(xs.reduce((a, x) => a + (Number(x) || 0), 0) * 1e5) / 1e5;

async function transcribeBlock(file, block, durationSec, calls) {
  let res;
  try {
    res = await stt.transcribe(file, STT_LANGUAGE[block], durationSec);
  } catch (e) {
    throw new Fatal('stt_failed', String(e && e.message || e).slice(0, 200));
  }
  calls.push({ job: 'stt', model: res.model, cost: res.cost, seconds: res.seconds, error: null });
  // No word timestamps means no windows: the backup Soniox model and the Whisper fallback both
  // come back without them. Say so, distinctly, rather than marking from a guessed clock.
  if (!res.words.length) throw new Fatal('stt_no_timestamps');
  return res;
}

async function cutWindows({ block, spec, cue, words, durationSec, calls, modelVersions, sections }) {
  const cut = findCueWindows({ words, block, form: { [block]: spec }, cue, durationSec, sections });
  if (cut.missing.length) {
    const lab = await labelMissing({ block, spec, words, cut, durationSec, calls });
    modelVersions.labeller = lab.modelVersion;
    reconcileWindows(block, cut.windows, durationSec);
  }
  if (block !== 'maths' && !cut.windows.story) {
    const d = defaultTimedWindow(words, durationSec);
    if (d) {
      cut.windows.story = d;
      if (!cut.flags.includes('no_cue_phrase')) cut.flags.push('no_cue_phrase');
      reconcileWindows(block, cut.windows, durationSec);
    }
  }
  return cut;
}

function compactTranscript(res) {
  return { language: res.language, model: res.model, words: res.words.map((w) => [w.raw, w.start, w.end, w.speaker]) };
}

async function runReading({ block, spec, cue, file, durationSec, calls, errors, modelVersions, battery }) {
  const res = await transcribeBlock(file, block, durationSec, calls);
  modelVersions.stt = res.model;
  const words = res.words;
  const withPhonics = battery !== 'v2';
  const cut = await cutWindows({ block, spec, cue, words, durationSec, calls, modelVersions, sections: sectionsFor(block, { battery }) });
  const w = cut.windows;
  const parts = {}; const ok = {};

  // v2: the switch to letters + words is the coach's, said aloud (L32). Heard: the story is what the child
  // read before it. v1 infers the switch from line 1 (needsFallback), unchanged.
  const coachSwitches = battery === 'v2';
  const switchLine = coachSwitches && spec.fallback
    ? findSwitchLine(words, spec.script && spec.script.fallback, { after: w.story ? w.story.start : -1 })
    : null;
  if (switchLine && w.story && switchLine.start < w.story.end) w.story.end = Math.max(w.story.start, switchLine.start);

  const [story, questions, phonics] = await Promise.all([
    w.story ? scoreStory({ lang: block, spec: spec.story || {}, file, window: w.story, words, coachSpeaker: cut.coachSpeaker, flags: cut.flags, calls }) : { ok: false, error: 'no_window' },
    w.questions ? scoreQuestions({ lang: block, spec, words, window: w.questions, calls }) : { ok: false, error: 'no_window' },
    !withPhonics ? null
      : (w.first_sounds || w.nonwords) ? scorePhonics({ lang: block, spec, file, windows: w, words, calls }) : { ok: false, error: 'no_window' },
  ]);

  if (story.ok) { parts.story = story.part; modelVersions.counts = story.modelVersion; }
  else errors.push({ job: 'story', error: story.error, ...(story.detail ? { detail: story.detail } : {}) });
  ok.story = !!story.ok;

  // the child could not read the first line, so the coach switched to letters + words (PLAN §3):
  // v2 when the coach's switch line is heard, v1 when line 1's count says so
  const inferred = !!(story.ok && spec.fallback && needsFallback(story.part, spec.story));
  let fbWindow = null;
  if (coachSwitches && switchLine) {
    const end = (w.story && w.story.sectionEnd) || durationSec;
    fbWindow = { start: switchLine.start, end: end > switchLine.end ? end : durationSec };
  } else if (!coachSwitches && inferred) {
    fbWindow = { start: w.story.start, end: w.story.sectionEnd || w.story.end };
  }
  if (fbWindow) {
    const fb = await scoreFallback({ lang: block, spec, file, window: fbWindow, calls });
    if (fb.ok) parts.fallback = fb.part; else errors.push({ job: 'fallback', error: fb.error });
  }
  const fallbackSwitch = !coachSwitches || !spec.fallback ? null
    : switchLine ? { heard: true, start: switchLine.start, end: switchLine.end, phrase: switchLine.phrase, inferred }
      : { heard: false, inferred };

  if (questions.ok) { parts.questions = questions.part; modelVersions.comprehension = questions.modelVersion || modelFor('comprehension'); }
  else errors.push({ job: 'comprehension', error: questions.error });
  ok.questions = !!questions.ok;

  if (phonics && phonics.ok) {
    parts.first_sounds = phonics.part.first_sounds; parts.nonwords = phonics.part.nonwords;
    modelVersions.phonics = phonics.modelVersion;
  } else if (phonics) errors.push({ job: 'phonics', error: phonics.error });
  if (phonics) { ok.first_sounds = !!phonics.ok; ok.nonwords = !!phonics.ok; }

  return { parts, ok, flags: cut.flags, transcript: compactTranscript(res), windows: cut.windows, fallbackSwitch };
}

async function runMaths({ spec, cue, grade, form, row, audioFile, durationSec, calls, errors, modelVersions, fetchMedia }) {
  const parts = { maths: {} }; const ok = {};
  let flags = []; let transcript = null; let windows = null;

  const spoken = (async () => {
    if (!audioFile) return;
    const res = await transcribeBlock(audioFile, 'maths', durationSec, calls);
    modelVersions.stt = res.model;
    const cut = await cutWindows({ block: 'maths', spec, cue, words: res.words, durationSec, calls, modelVersions });
    flags = cut.flags; transcript = compactTranscript(res); windows = cut.windows;
    const s = scoreSpoken({ spec, words: res.words, cut });
    if (s.numbers) { parts.maths.numbers = s.numbers; ok.numbers = true; }
    if (s.quick_sums) { parts.maths.quick_sums = s.quick_sums; ok.quick_sums = true; }
    const wp = await scoreSpokenWordProblem({ spec, words: res.words, window: cut.windows.word_problem, coachSpeaker: cut.coachSpeaker, calls });
    if (wp) { parts.maths.spoken_word_problem = wp; modelVersions.word_problem = modelFor('word_problem'); }
  })();

  const written = (async () => {
    if (!row.photo_r2_key) return null;
    let photoFile = null;
    try {
      photoFile = await fetchMedia(row.photo_r2_key, 'jpg');
      const image = require('fs').readFileSync(photoFile);
      const r = await scoreStrip({ spec, grade, form, image, calls });
      if (!r.ok) { errors.push({ job: 'vision', error: r.error }); return null; }
      modelVersions.vision = r.modelVersion;
      return r;
    } catch (e) {
      errors.push({ job: 'vision', error: String(e && e.message || e).slice(0, 200) });
      return null;
    } finally { media.cleanup(photoFile); }
  })();

  const [, strip] = await Promise.all([spoken, written]);
  if (strip) {
    parts.maths.written = strip.part.written; ok.written = true;
    parts.photo = { form_code: strip.formCode, form_code_ok: strip.formCodeOk, expected_code: strip.expectedCode, child_no: strip.childNo, child_no_confidence: strip.childNoConfidence };
  }
  // The word problem is answered on the strip; the spoken answer is the fallback.
  const photoWp = strip && strip.part.word_problem;
  const spokenWp = parts.maths.spoken_word_problem;
  if (photoWp && (photoWp.photo_verdict === 'correct' || photoWp.photo_verdict === 'wrong')) {
    parts.maths.word_problem = { verdict: photoWp.verdict, read_answer: photoWp.read_answer, confidence: photoWp.confidence };
  } else if (spokenWp) parts.maths.word_problem = spokenWp;
  ok.word_problem = !!parts.maths.word_problem;
  delete parts.maths.spoken_word_problem;

  return { parts, ok, flags, transcript, windows };
}

/** v2 oral maths: the voice note alone (maths-oral.js). */
async function runMathsOral({ spec, cue, audioFile, durationSec, calls, modelVersions }) {
  if (!spec.oral) throw new Fatal('form_not_found', 'item bank has no maths.oral');
  const res = await transcribeBlock(audioFile, 'maths', durationSec, calls);
  modelVersions.stt = res.model;
  const cut = findOralWindows({ words: res.words, cue, oral: spec.oral, durationSec });
  const card = scoreOralCard({ words: res.words, cut, oral: spec.oral });
  const wp = await scoreOralWordProblems({ words: res.words, cut, oral: spec.oral, calls });
  if (wp.modelVersion) modelVersions.word_problem = wp.modelVersion;
  return {
    parts: { maths: { oral: { compare: card.compare, sums: card.sums, word_problems: wp.rows } } },
    ok: { compare: true, sums: true, word_problems: true },
    flags: cut.flags,
    transcript: compactTranscript(res),
    windows: { ...cut.windows, ...(cut.missing.length ? { missing: cut.missing } : {}) },
  };
}

async function persistFailure(store, { sessionId, block }, reason) {
  try {
    if (store && typeof store.setAiStatus === 'function') await store.setAiStatus({ sessionId, block, aiStatus: 'failed', reason });
  } catch (e) {
    logError('[child-test] scoring: could not record the failure', { sessionId, block, reason, error: e.message });
  }
}

async function scoreBlock(args, deps = {}) {
  const started = Date.now();
  const { sessionId, block, grade, form, force = false } = args || {};
  const ids = { sessionId, block };
  let store = null;
  const tmp = [];
  try {
    if (isTask(block)) return await scoreTaskRow(args, deps);
    if (!BLOCKS.has(block)) return { ok: false, aiStatus: 'failed', reason: 'bad_block' };
    store = deps.store || require('../store');
    // R2 by default; the offline evaluation passes a local-file reader instead.
    const fetchMedia = deps.fetchMedia || media.downloadToTemp;
    const itemBank = deps.itemBank || require('../item-bank');

    let got;
    try { got = await store.getBlock(sessionId, block); } catch (e) { got = { ok: false, error: e.message }; }
    if (!got || !got.ok) {
      logError('[child-test] scoring: block read failed', { ...ids, error: got && got.error });
      return { ok: false, aiStatus: 'failed', reason: 'block_read_failed' };
    }
    const row = got.block;
    if (!row) return { ok: false, aiStatus: 'failed', reason: 'block_not_found' };
    if (row.ai_marks) return { ok: true, aiStatus: row.ai_status || 'scored', reason: 'already_scored' };

    const formSpec = itemBank.getForm(Number(grade), form);
    const spec = formSpec && formSpec[block];
    if (!spec) { await persistFailure(store, ids, 'form_not_found'); return { ok: false, aiStatus: 'failed', reason: 'form_not_found' }; }
    const cueAll = itemBank.cue || (typeof itemBank.getCue === 'function' ? itemBank.getCue() : null) || {};
    const cue = cueAll[block] || {};
    const battery = batteryVersion();
    const mathsMode = mathsModeOf();
    const oral = block === 'maths' && mathsMode === 'oral';

    if (oral && !row.audio_r2_key) {
      await persistFailure(store, ids, 'no_media');
      return { ok: false, aiStatus: 'failed', reason: 'no_media' };
    }
    if (block === 'maths' && !oral && !force && !(row.audio_r2_key && row.photo_r2_key)) {
      return { ok: true, aiStatus: 'pending', reason: row.audio_r2_key ? 'awaiting_photo' : 'awaiting_audio' };
    }
    if (!row.audio_r2_key && !(block === 'maths' && row.photo_r2_key)) {
      await persistFailure(store, ids, 'no_media');
      return { ok: false, aiStatus: 'failed', reason: 'no_media' };
    }

    if (typeof store.setAiStatus === 'function') {
      try { await store.setAiStatus({ sessionId, block, aiStatus: 'scoring' }); } catch (_) { /* advisory */ }
    }

    const calls = []; const errors = []; const modelVersions = {};
    let audioFile = null; let durationSec = null;
    if (row.audio_r2_key) {
      try { audioFile = await fetchMedia(row.audio_r2_key, 'ogg'); tmp.push(audioFile); } catch (e) { throw new Fatal('audio_download_failed', e.message); }
      durationSec = await media.probeDuration(audioFile);
    }

    let result;
    if (oral) result = await runMathsOral({ spec, cue, audioFile, durationSec, calls, modelVersions });
    else if (block === 'maths') result = await runMaths({ spec, cue, grade, form, row, audioFile, durationSec, calls, errors, modelVersions, fetchMedia });
    else result = await runReading({ block, spec, cue, file: audioFile, durationSec, calls, errors, modelVersions, battery });

    const aiStatus = aiStatusFor(block, result.ok, { battery, mathsMode });
    const meta = {
      item_bank_version: itemBank.version || null,
      duration_sec: durationSec,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      cost_usd: sum(calls.map((c) => c.cost)),
      calls: calls.map((c) => ({ job: c.job, model: c.model, cost: c.cost == null ? null : Math.round(c.cost * 1e5) / 1e5, seconds: Math.round((c.seconds || 0) * 10) / 10, error: c.error || null, ...(c.detail ? { detail: c.detail } : {}) })),
      errors,
      windows: result.windows,
      ...(result.parts.photo ? { photo: result.parts.photo } : {}),
      ...(result.fallbackSwitch ? { fallback_switch: result.fallbackSwitch } : {}),
    };
    if (aiStatus === 'failed') {
      const reason = errors[0] ? `${errors[0].job}_failed` : 'nothing_scored';
      logError('[child-test] scoring: nothing could be scored', { ...ids, reason, errors });
      await persistFailure(store, ids, reason);
      return { ok: false, aiStatus: 'failed', reason };
    }

    const aiMarks = assembleMarks({ block, form: { [block]: spec }, parts: result.parts, flags: result.flags, modelVersions, meta, battery, mathsMode });
    const saved = await store.saveAiMarks({ sessionId, block, aiMarks, aiStatus, modelVersions, transcript: result.transcript });
    if (!saved || !saved.ok) {
      if (saved && saved.alreadyScored) return { ok: true, aiStatus: (saved.block && saved.block.ai_status) || 'scored', reason: 'already_scored' };
      logError('[child-test] scoring: saveAiMarks failed', { ...ids, error: saved && saved.error });
      await persistFailure(store, ids, 'save_failed');
      return { ok: false, aiStatus: 'failed', reason: 'save_failed' };
    }
    logEvent('child_test.block.scored', { ...ids, aiStatus, seconds: meta.seconds, costUsd: meta.cost_usd, flags: aiMarks.protocol_flags, errors: errors.map((e) => e.job) });
    return { ok: true, aiStatus };
  } catch (e) {
    const reason = e instanceof Fatal ? e.reason : 'internal_error';
    logError('[child-test] scoring failed', { ...ids, reason, error: (e.detail || e.message || '').slice(0, 200) });
    await persistFailure(store, ids, reason);
    return { ok: false, aiStatus: 'failed', reason };
  } finally {
    media.cleanup(tmp);
    logToFile('[child-test] scoreBlock done', { ...ids, ms: Date.now() - started });
  }
}

// ------------------------------------------------------------------ battery v3: one task row

/** The coach typed skip (L36 stores it on the row: ai_reason, or a marker in coach_marks / transcript). */
function skippedRow(row) {
  return row.skipped_by_coach === true || row.ai_reason === 'skipped_by_coach'
    || !!(row.coach_marks && row.coach_marks.skipped_by_coach) || !!(row.transcript && row.transcript.skipped_by_coach);
}

function taskSpecFrom(itemBank, { grade, form, task }) {
  if (typeof itemBank.getTaskSpec !== 'function') return null;
  try { return itemBank.getTaskSpec({ grade: Number(grade), set: form || 'A', task }); } catch (_) { return null; }
}

async function scoreTaskRow(args, deps) {
  const started = Date.now();
  const { sessionId, block: task, grade, form, lang } = args;
  const ids = { sessionId, block: task };
  const store = deps.store || require('../store');
  const fetchMedia = deps.fetchMedia || media.downloadToTemp;
  const itemBank = deps.itemBank || require('../item-bank');
  let audioFile = null;
  try {
    let got;
    try { got = await store.getBlock(sessionId, task); } catch (e) { got = { ok: false, error: e.message }; }
    if (!got || !got.ok) {
      logError('[child-test] scoring: block read failed', { ...ids, error: got && got.error });
      return { ok: false, aiStatus: 'failed', reason: 'block_read_failed' };
    }
    const row = got.block;
    if (!row) return { ok: false, aiStatus: 'failed', reason: 'block_not_found' };
    if (row.ai_marks) return { ok: true, aiStatus: row.ai_status || 'scored', reason: 'already_scored' };

    const spec = taskSpecFrom(itemBank, { grade, form, task });
    const skip = skippedRow(row) || !!(spec && spec.gap);
    if (!spec && !skip) { await persistFailure(store, ids, 'form_not_found'); return { ok: false, aiStatus: 'failed', reason: 'form_not_found' }; }
    if (!skip && !row.audio_r2_key) { await persistFailure(store, ids, 'no_media'); return { ok: false, aiStatus: 'failed', reason: 'no_media' }; }

    let mediaIn = { skipped_by_coach: true };
    if (!skip) {
      if (typeof store.setAiStatus === 'function') {
        try { await store.setAiStatus({ sessionId, block: task, aiStatus: 'scoring' }); } catch (_) { /* advisory */ }
      }
      try { audioFile = await fetchMedia(row.audio_r2_key, 'ogg'); } catch (e) { throw new Fatal('audio_download_failed', e.message); }
      mediaIn = { file: audioFile, durationSec: await media.probeDuration(audioFile) };
    }
    const aiMarks = await scoreTask({ task, spec: spec || {}, media: mediaIn, lang, grade });
    if (aiMarks.ok === false) {
      logError('[child-test] scoring: task not scored', { ...ids, reason: aiMarks.reason, detail: aiMarks.detail });
      await persistFailure(store, ids, aiMarks.reason);
      return { ok: false, aiStatus: 'failed', reason: aiMarks.reason };
    }
    aiMarks.meta = { ...(aiMarks.meta || {}), item_bank_version: itemBank.version || null, duration_sec: mediaIn.durationSec ?? null };
    const aiStatus = (aiMarks.flags || []).includes('task_not_found') ? 'partial' : 'scored';
    const transcript = Array.isArray(mediaIn.words) ? { language: task.split('.')[0], model: mediaIn.sttModel || null, words: mediaIn.words.map((w) => [w.raw, w.start, w.end, w.speaker]) } : null;
    const saved = await store.saveAiMarks({ sessionId, block: task, aiMarks, aiStatus, modelVersions: aiMarks.model_versions, transcript, reason: skip ? 'skipped_by_coach' : null });
    if (!saved || !saved.ok) {
      if (saved && saved.alreadyScored) return { ok: true, aiStatus: (saved.block && saved.block.ai_status) || 'scored', reason: 'already_scored' };
      logError('[child-test] scoring: saveAiMarks failed', { ...ids, error: saved && saved.error });
      await persistFailure(store, ids, 'save_failed');
      return { ok: false, aiStatus: 'failed', reason: 'save_failed' };
    }
    logEvent('child_test.task.scored', { ...ids, aiStatus, skipped: skip, seconds: (aiMarks.meta && aiMarks.meta.seconds) || 0, costUsd: (aiMarks.meta && aiMarks.meta.cost_usd) || 0, flags: aiMarks.flags, review: (aiMarks.review || []).length });
    return { ok: true, aiStatus };
  } catch (e) {
    const reason = e instanceof Fatal ? e.reason : 'internal_error';
    logError('[child-test] task scoring failed', { ...ids, reason, error: (e.detail || e.message || '').slice(0, 200) });
    await persistFailure(store, ids, reason);
    return { ok: false, aiStatus: 'failed', reason };
  } finally {
    media.cleanup(audioFile);
    logToFile('[child-test] scoreTaskRow done', { ...ids, ms: Date.now() - started });
  }
}

module.exports = { scoreBlock, scoreTask };
