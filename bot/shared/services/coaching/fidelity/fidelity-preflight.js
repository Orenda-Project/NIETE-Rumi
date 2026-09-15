'use strict';
/**
 * Fidelity pre-flight (bd-b3pop.5, Eval 8): deterministic facts about the RECORDING — how many [MM:SS] stamps it carries,
 * where the transcript ends against the audio, whether it collapsed into one timestamped block. Pure: no I/O, no LLM.
 * Persisted on every graded blob as telemetry (lp_fidelity.recording).
 *
 * What these facts are NOT: a truncation detector. On NIETE prod (2,795 graded sessions, 8–15 Sep 2026) the transcript
 * stops more than 90 s before the audio on 14.5% of sessions — quiet independent work as often as lost speech — and a
 * rule that turned late misses into "not recorded" on that signal fired on 11.0% of all sessions and 10.6% of the
 * sessions whose own grader note claimed truncation (bd-b3pop.19). Nothing here changes a verdict.
 *
 * Python mirror used by the gate harness: eval/out/eval7/run_eval7.py describe_recording.
 */
const STAMP_SOURCE = '\\[(\\d{1,3}):(\\d{2})\\]';
const TAIL_GRACE_S = 90;
const COLLAPSE_SHARE = 0.4;

function mmss(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * @param {string} transcript             the timestamped transcript
 * @param {number|null} audioDurationSeconds coaching_sessions.audio_duration_seconds
 * @returns {{stamps:number, no_timestamps:boolean, last_stamp_s:number|null, ends_at:string|null, audio_s:number|null,
 *            transcript_short_of_audio:boolean, collapsed_block:boolean}}
 */
function describeRecording(transcript, audioDurationSeconds) {
  const t = String(transcript || '');
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
    transcript_short_of_audio: lastStampS != null && audioS != null && audioS - lastStampS > TAIL_GRACE_S,
    collapsed_block: stamps.length > 0 && t.length > 0 && biggest / t.length >= COLLAPSE_SHARE,
  };
}

module.exports = { describeRecording };
