'use strict';
/**
 * Fidelity pre-flight (bd-b3pop.5, Eval 8): deterministic facts about the RECORDING that the grader must not be left
 * to infer — how many [MM:SS] stamps it carries, where the transcript ends against the audio, whether it collapsed into
 * one timestamped block — and which of the plan's content anchors occur in the transcript. Pure: no I/O, no LLM.
 * Persisted on every graded blob (additive) and handed to the v2 prompt as RECORDING FACTS / PLAN ANCHORS.
 *
 * What these facts are NOT: a truncation detector. On NIETE prod (2,795 graded sessions, 8–15 Sep 2026) the transcript
 * stops more than 90 s before the audio on 14.5% of sessions — quiet independent work as often as lost speech — and a
 * rule that turned late misses into "not recorded" on that signal fired on 11.0% of all sessions and 10.6% of the
 * sessions whose own grader note claimed truncation (bd-b3pop.19). It stays telemetry. Nothing here changes a verdict.
 *
 * Python mirror used by the gate harness: eval/out/eval7/run_eval7.py describe_recording / plan_anchor_hits.
 */
const STAMP_SOURCE = '\\[(\\d{2}):(\\d{2})\\]';
const TAIL_GRACE_S = 90;
const COLLAPSE_SHARE = 0.4;

function mmss(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * @param {string} transcript             the timestamped transcript
 * @param {number|null} audioDurationSeconds coaching_sessions.audio_duration_seconds
 * @param {{tailGraceS?: number, collapseShare?: number}} [opts]
 * @returns {{stamps:number, no_timestamps:boolean, last_stamp_s:number|null, ends_at:string|null, audio_s:number|null,
 *            transcript_short_of_audio:boolean, collapsed_block:boolean}}
 */
function describeRecording(transcript, audioDurationSeconds, opts = {}) {
  const t = String(transcript || '');
  const tailGraceS = opts.tailGraceS == null ? TAIL_GRACE_S : opts.tailGraceS;
  const collapseShare = opts.collapseShare == null ? COLLAPSE_SHARE : opts.collapseShare;
  const re = new RegExp(STAMP_SOURCE, 'g');
  const stamps = [];
  let m;
  while ((m = re.exec(t)) !== null) stamps.push({ s: Number(m[1]) * 60 + Number(m[2]), i: m.index });
  const lastStampS = stamps.length ? stamps[stamps.length - 1].s : null;
  const n = Number(audioDurationSeconds);
  const audioS = audioDurationSeconds != null && Number.isFinite(n) && n > 0 ? n : null;
  let biggest = 0;
  for (let k = 0; k < stamps.length; k += 1) {
    const end = k + 1 < stamps.length ? stamps[k + 1].i : t.length;
    biggest = Math.max(biggest, end - stamps[k].i);
  }
  return {
    stamps: stamps.length,
    no_timestamps: stamps.length === 0,
    last_stamp_s: lastStampS,
    ends_at: lastStampS == null ? null : mmss(lastStampS),
    audio_s: audioS,
    transcript_short_of_audio: lastStampS != null && audioS != null && audioS - lastStampS > tailGraceS,
    collapsed_block: stamps.length > 0 && t.length > 0 && biggest / t.length >= collapseShare,
  };
}

// Anchors = the plan's illustrative content: multi-digit numbers, double-quoted phrases, page references (English and
// Urdu). Advisory — the model makes the lesson-identity call; code only counts. Never a verdict. No \b in front of the
// Urdu alternatives: a JS \b is ASCII-only, so `\bصفحہ` could never match. Apostrophes are not quotation marks.
const ANCHOR_SOURCES = [
  ['(?<![0-9A-Za-z_])[0-9][0-9,]{1,}(?![0-9A-Za-z_])', 'g'],
  ['["\\u201c\\u00ab]([^"\\u201d\\u00bb]{3,60})["\\u201d\\u00bb]', 'g'],
  ['(?:\\bp\\.?|\\bpage|صفحہ|پیج)\\s*(?:نمبر\\s*)?([0-9]{1,3})(?![0-9])', 'gi'],
];

/**
 * @param {Array<{text?: string}>} moves
 * @param {string} transcript
 * @returns {{total:number, found:string[], missing:string[]}}
 */
function planAnchorHits(moves, transcript) {
  const t = String(transcript || '');
  const anchors = [];
  for (const mv of Array.isArray(moves) ? moves : []) {
    const text = String((mv && mv.text) || '');
    for (const [source, flags] of ANCHOR_SOURCES) {
      const re = new RegExp(source, flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        const anchor = String(m[1] !== undefined ? m[1] : m[0]).replace(/,/g, '').trim();
        if (anchor && !anchors.includes(anchor)) anchors.push(anchor);
      }
    }
  }
  return { total: anchors.length, found: anchors.filter((a) => t.includes(a)), missing: anchors.filter((a) => !t.includes(a)) };
}

module.exports = { describeRecording, planAnchorHits, TAIL_GRACE_S, COLLAPSE_SHARE };
