'use strict';
/**
 * Child test (bd-s1oo0.5) — assemble one block's scorer outputs into the
 * contract's `ai_marks` (CONTRACT §5, version ai-marks-v1).
 *
 * Every item in the form gets a row, in item order, whether or not a scorer
 * returned it: a missing row is `none` with confidence 0, so L6 shows it empty
 * and the coach marks it. Verdicts outside the contract's enums become `none`.
 */

const { HINT_CONFIDENCE_CAP, clamp01 } = require('./thresholds');
const { batteryVersion, mathsMode: mathsModeOf } = require('../item-bank');

const VERSION = 'ai-marks-v1';
// v2 (bd-s1oo0.46.3, CONTRACT §19): battery v2 reading blocks (story, questions, fallback) and oral maths
// (maths.oral = { compare, sums, word_problems }); additive to v1, so v1 readers find every v1 key.
const VERSION_V2 = 'ai-marks-v2';
const ITEM_VERDICTS = new Set(['correct', 'wrong', 'none']);
const WRITTEN_VERDICTS = new Set(['correct', 'wrong', 'blank', 'unreadable']);
const FLAG_VERDICTS = new Set(['wrong', 'skipped']);
const KNOWN_FLAGS = new Set(['no_cue_phrase', 'prompting_during_timed_minute', 'story_read_once', 'timer_problem']);

const BLOCK_SECTIONS = {
  urdu: ['story', 'questions', 'first_sounds', 'nonwords'],
  english: ['story', 'questions', 'nonwords'],
  maths: ['numbers', 'quick_sums', 'written', 'word_problem'],
};
const V2_SECTIONS = { urdu: ['story', 'questions'], english: ['story', 'questions'] };
const ORAL_SECTIONS = ['compare', 'sums', 'word_problems'];

/** The sections a block is scored on under the switches (what aiStatusFor counts). */
function sectionsFor(block, { battery = batteryVersion(), mathsMode = mathsModeOf() } = {}) {
  if (block === 'maths') return mathsMode === 'oral' ? ORAL_SECTIONS : BLOCK_SECTIONS.maths;
  return battery === 'v2' ? V2_SECTIONS[block] || [] : BLOCK_SECTIONS[block] || [];
}

function conf(x) { return Math.round(clamp01(Number(x)) * 100) / 100; }

function itemRows(items, rows, { hintOnly = false } = {}) {
  const byId = new Map((rows || []).filter((r) => r && r.id).map((r) => [r.id, r]));
  return (items || []).map((it) => {
    const r = byId.get(it.id);
    const ok = r && ITEM_VERDICTS.has(r.verdict);
    const row = {
      id: it.id,
      verdict: ok ? r.verdict : 'none',
      heard: ok && r.heard != null ? String(r.heard) : '',
      confidence: ok ? conf(r.confidence) : 0,
    };
    if (hintOnly) { row.hint_only = true; row.confidence = Math.min(row.confidence, HINT_CONFIDENCE_CAP); }
    return row;
  });
}

function story(s) {
  if (!s) return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  return {
    words_correct: n(s.words_correct),
    words_attempted: n(s.words_attempted),
    seconds: Number.isFinite(Number(s.seconds)) ? Math.round(Number(s.seconds) * 10) / 10 : 60,
    finished_early: !!s.finished_early,
    flagged: (s.flagged || []).filter((f) => f && FLAG_VERDICTS.has(f.verdict) && Number.isInteger(f.idx))
      .map((f) => ({ idx: f.idx, word: String(f.word || ''), verdict: f.verdict, confidence: conf(f.confidence) })),
    confidence: conf(s.confidence),
  };
}

function oralMaths(m, spec) {
  const o = (spec && spec.oral) || {};
  const got = (m && m.oral) || {};
  return {
    oral: {
      compare: itemRows(o.compare, got.compare),
      sums: itemRows(o.sums, got.sums),
      word_problems: itemRows(o.word_problems, got.word_problems),
    },
    // the strip design's keys, empty: nothing of it is given in oral mode
    numbers: [], quick_sums: null, written: [], word_problem: null,
  };
}

function maths(m, spec) {
  if (!spec) return null;
  m = m || {};
  const written = new Map((m.written || []).filter((w) => w && w.id).map((w) => [w.id, w]));
  const qs = m.quick_sums || null;
  const wp = m.word_problem || null;
  return {
    numbers: itemRows(spec.numbers, m.numbers),
    quick_sums: qs ? {
      correct: Math.max(0, Math.round(Number(qs.correct) || 0)),
      attempted: Math.max(0, Math.round(Number(qs.attempted) || 0)),
      seconds: Number.isFinite(Number(qs.seconds)) ? Math.round(Number(qs.seconds) * 10) / 10 : 60,
      confidence: conf(qs.confidence),
    } : null,
    written: (spec.written || []).map((it) => {
      const w = written.get(it.id);
      const ok = w && WRITTEN_VERDICTS.has(w.verdict);
      return { id: it.id, read_answer: ok && w.read_answer != null ? String(w.read_answer) : '', verdict: ok ? w.verdict : 'unreadable', confidence: ok ? conf(w.confidence) : 0 };
    }),
    word_problem: wp && ITEM_VERDICTS.has(wp.verdict)
      ? { verdict: wp.verdict, read_answer: wp.read_answer != null ? String(wp.read_answer) : '', confidence: conf(wp.confidence) }
      : { verdict: 'none', read_answer: '', confidence: 0 },
  };
}

/**
 * @param {object} p
 * @param {'urdu'|'english'|'maths'} p.block
 * @param {object} p.form  FORM from the item bank
 * @param {object} p.parts scorer outputs keyed by section
 */
function assembleMarks({ block, form, parts = {}, flags = [], modelVersions = {}, meta = {}, battery = batteryVersion(), mathsMode = mathsModeOf() }) {
  const spec = (form && form[block]) || {};
  const reading = block === 'urdu' || block === 'english';
  const v2 = reading ? battery === 'v2' : mathsMode === 'oral';
  const phonics = reading && !v2;
  return {
    version: v2 ? VERSION_V2 : VERSION,
    block,
    ...(reading ? { battery } : { maths_mode: mathsMode }),
    story: reading ? story(parts.story) : null,
    fallback: reading && parts.fallback ? {
      letters: { correct: Math.round(Number(parts.fallback.letters && parts.fallback.letters.correct) || 0), of: (spec.fallback && spec.fallback.letters || []).length },
      words: { correct: Math.round(Number(parts.fallback.words && parts.fallback.words.correct) || 0), of: (spec.fallback && spec.fallback.words || []).length },
      confidence: conf(parts.fallback.confidence),
    } : null,
    questions: reading ? itemRows(spec.questions, parts.questions) : [],
    first_sounds: block === 'urdu' && phonics ? itemRows(spec.first_sounds, parts.first_sounds, { hintOnly: true }) : [],
    nonwords: phonics ? itemRows(spec.nonwords, parts.nonwords) : [],
    maths: block === 'maths' ? (v2 ? oralMaths(parts.maths, spec) : maths(parts.maths, spec)) : null,
    protocol_flags: [...new Set((flags || []).filter((f) => KNOWN_FLAGS.has(f)))],
    model_versions: { ...modelVersions },
    meta: { ...meta },
  };
}

/** ok-map of section → scored? → contract ai_status. */
function aiStatusFor(block, ok, switches) {
  const sections = sectionsFor(block, switches);
  const n = sections.filter((s) => ok[s]).length;
  if (n === 0) return 'failed';
  return n === sections.length ? 'scored' : 'partial';
}

module.exports = { assembleMarks, aiStatusFor, sectionsFor, BLOCK_SECTIONS, VERSION, VERSION_V2 };
