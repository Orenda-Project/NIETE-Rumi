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

const VERSION = 'ai-marks-v1';
const ITEM_VERDICTS = new Set(['correct', 'wrong', 'none']);
const WRITTEN_VERDICTS = new Set(['correct', 'wrong', 'blank', 'unreadable']);
const FLAG_VERDICTS = new Set(['wrong', 'skipped']);
const KNOWN_FLAGS = new Set(['no_cue_phrase', 'prompting_during_timed_minute', 'story_read_once', 'timer_problem']);

const BLOCK_SECTIONS = {
  urdu: ['story', 'questions', 'first_sounds', 'nonwords'],
  english: ['story', 'questions', 'nonwords'],
  maths: ['numbers', 'quick_sums', 'written', 'word_problem'],
};

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
function assembleMarks({ block, form, parts = {}, flags = [], modelVersions = {}, meta = {} }) {
  const spec = (form && form[block]) || {};
  const reading = block === 'urdu' || block === 'english';
  return {
    version: VERSION,
    block,
    story: reading ? story(parts.story) : null,
    fallback: reading && parts.fallback ? {
      letters: { correct: Math.round(Number(parts.fallback.letters && parts.fallback.letters.correct) || 0), of: (spec.fallback && spec.fallback.letters || []).length },
      words: { correct: Math.round(Number(parts.fallback.words && parts.fallback.words.correct) || 0), of: (spec.fallback && spec.fallback.words || []).length },
      confidence: conf(parts.fallback.confidence),
    } : null,
    questions: reading ? itemRows(spec.questions, parts.questions) : [],
    first_sounds: block === 'urdu' ? itemRows(spec.first_sounds, parts.first_sounds, { hintOnly: true }) : [],
    nonwords: reading ? itemRows(spec.nonwords, parts.nonwords) : [],
    maths: block === 'maths' ? maths(parts.maths, spec) : null,
    protocol_flags: [...new Set((flags || []).filter((f) => KNOWN_FLAGS.has(f)))],
    model_versions: { ...modelVersions },
    meta: { ...meta },
  };
}

/** ok-map of section → scored? → contract ai_status. */
function aiStatusFor(block, ok) {
  const sections = BLOCK_SECTIONS[block] || [];
  const n = sections.filter((s) => ok[s]).length;
  if (n === 0) return 'failed';
  return n === sections.length ? 'scored' : 'partial';
}

module.exports = { assembleMarks, aiStatusFor, BLOCK_SECTIONS, VERSION };
