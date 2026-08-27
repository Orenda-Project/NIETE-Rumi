'use strict';
/**
 * bd-ri5o9.2 — who is who in a diarized recording.
 *
 * audio.service.js had this inline and hardcoded to the CLASSROOM: the speaker
 * with the most words became 'Teacher', everyone else 'Student'. Correct for a
 * lesson. A DEBRIEF is two ADULTS — the coach and the teacher — and it ran
 * through the identical labeller, so the coach was announced as "Teacher" and
 * the teacher as "Student".
 *
 * Worse than a fixed inversion: because the label follows word count, WHICH adult
 * gets WHICH label flips between sessions. Measured over 520 production debriefs
 * (2026-08-27), the first speaker — essentially always the coach, opening the
 * conversation — was labelled 'Teacher' in 417 (80%) and 'Student' in 102 (20%),
 * with nothing marking which convention a transcript used. Every downstream LLM
 * pass reads that transcript, which is why a report could quote the coach as the
 * teacher. Javeria Nayyab reported it as meaning being "sometimes interpreted
 * incorrectly" — and "sometimes" is exactly what a 80/20 flip produces.
 *
 * Two design choices worth keeping:
 *
 *  1. CLASSROOM is the DEFAULT and is byte-identical to the old behaviour, so the
 *     lesson pipeline cannot move. transcribeWithDiarization has exactly two
 *     callers repo-wide; only the debrief one passes roles.
 *
 *  2. Where the word-count evidence is WEAK we refuse to name a role. "Most words
 *     = the coach" is a heuristic and the 80/20 split is the measure of how often
 *     it is wrong. A neutral "Speaker 1" is honest; a confident wrong "Coach" is
 *     what produced this ticket. Classroom sets no threshold, so lessons never
 *     degrade.
 */

/** A lesson: the teacher leads, the rest are pupils. Unchanged behaviour. */
const CLASSROOM_ROLES = Object.freeze({
  primary: 'Teacher',
  secondary: 'Student',
  // no marginalThreshold, no neutral — a lesson is never relabelled
});

/**
 * A debrief: the coach gives feedback, the teacher receives it. No pupils.
 * marginalThreshold 0.55 — with two speakers, the leader must hold >55% of the
 * words before we are willing to name the roles at all.
 */
const DEBRIEF_ROLES = Object.freeze({
  primary: 'Coach',
  secondary: 'Teacher',
  marginalThreshold: 0.55,
  neutral: 'Speaker',
  // A debrief has two known participants. A third voice, or a recording that
  // diarized to one, is not something word count can resolve — stay neutral.
  neutralBeyondSecondary: true,
  neutralWhenSingle: true,
});

/**
 * Assign a display label to each diarized speaker.
 *
 * @param {Object<string,{wordCount:number}>} speakerStats keyed by speaker id
 * @param {object} [roles] CLASSROOM_ROLES (default) or DEBRIEF_ROLES
 * @returns {Object<string,string>} speaker id -> label
 */
function assignSpeakerLabels(speakerStats, roles = CLASSROOM_ROLES) {
  const r = roles || CLASSROOM_ROLES;
  const stats = speakerStats || {};
  const sorted = Object.entries(stats)
    .sort((a, b) => (b[1] && b[1].wordCount || 0) - (a[1] && a[1].wordCount || 0))
    .map(([id]) => id);
  if (sorted.length === 0) return {};

  const neutral = (i) => `${r.neutral || 'Speaker'} ${i + 1}`;
  const labels = {};

  // A recording that diarized to a single voice tells us nothing about role.
  if (sorted.length === 1) {
    labels[sorted[0]] = r.neutralWhenSingle ? neutral(0) : r.primary;
    return labels;
  }

  // Two speakers, near-even split -> the evidence does not support naming them.
  if (r.marginalThreshold && sorted.length >= 2) {
    const top = (stats[sorted[0]] && stats[sorted[0]].wordCount) || 0;
    const second = (stats[sorted[1]] && stats[sorted[1]].wordCount) || 0;
    const total = top + second;
    if (total > 0 && top / total < r.marginalThreshold) {
      sorted.forEach((id, i) => { labels[id] = neutral(i); });
      return labels;
    }
  }

  labels[sorted[0]] = r.primary;
  labels[sorted[1]] = r.secondary;
  for (let i = 2; i < sorted.length; i += 1) {
    // Classroom keeps its historical numbering ('Student 2', 'Student 3'); a
    // debrief has no name for a third voice, so it stays neutral.
    labels[sorted[i]] = r.neutralBeyondSecondary ? neutral(i) : `${r.secondary} ${i}`;
  }
  return labels;
}

module.exports = { assignSpeakerLabels, CLASSROOM_ROLES, DEBRIEF_ROLES };
