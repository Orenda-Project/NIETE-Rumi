'use strict';
/**
 * The video picker's prompt (bd-gzfdu9, SPEC §3.4) and the transcript moments it may quote. Pure.
 * The text is the lead's, verbatim; only the {…} slots are filled here. Bump PROMPT_VERSION with any
 * change to it: every stored row carries the version it was picked with.
 */
const PROMPT_VERSION = 'vr-1';
const EXCERPT_LINES = 12;
const EXCERPT_MAX_CHARS = 220;

function mmss(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The first m:ss / mm:ss in a string → ms, or null. */
function stampMs(text) {
  const m = String(text || '').match(/(\d{1,2}):(\d{2})/);
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null;
}

function clip(line) {
  const cps = [...line];
  return cps.length <= EXCERPT_MAX_CHARS ? line : `${cps.slice(0, EXCERPT_MAX_CHARS - 1).join('')}…`;
}

/**
 * The 12 transcript lines around the target row's timestamp (else the uptake moment, else the start),
 * each "[mm:ss] Label: text" ≤ 220 code points. From diarization_data.segments; without it, from the
 * transcript_text lines that start with [mm:ss].
 */
function excerpts(session, { timestamp, uptakeMoment } = {}) {
  let lines = [];
  const segs = session && session.diarization_data && Array.isArray(session.diarization_data.segments)
    ? session.diarization_data.segments.filter((s) => s && String(s.text || '').trim()) : [];
  if (segs.length) {
    lines = segs.map((s) => ({ ms: Number(s.start_ms) || 0, text: `[${mmss(s.start_ms)}] ${s.label || s.speaker || 'Speaker'}: ${String(s.text).trim()}` }));
  } else if (session && session.transcript_text) {
    lines = String(session.transcript_text).split('\n').map((l) => l.trim())
      .filter((l) => /^\[\d{1,2}:\d{2}\]/.test(l)).map((l) => ({ ms: stampMs(l), text: l }));
  }
  if (!lines.length) return [];
  const anchor = stampMs(timestamp) ?? stampMs(uptakeMoment);
  let start = 0;
  if (anchor !== null) {
    let idx = 0;
    lines.forEach((l, i) => { if (l.ms <= anchor) idx = i; });
    start = Math.max(0, Math.min(idx - 4, lines.length - EXCERPT_LINES));
  }
  return lines.slice(start, start + EXCERPT_LINES).map((l) => clip(l.text));
}

function candidateLine(c, catalog) {
  const hit = catalog && catalog.segment(c.seg_id);
  if (!hit) return `${c.seg_id} · (unknown clip)`;
  const { module, segment } = hit;
  const len = Math.round(Number(segment.end_s) - Number(segment.start_s));
  const needs = (module.symptoms || []).join('; ');
  const fico = (segment.fico || []).map((f) => f.indicator).join(', ');
  return `${segment.seg_id} · ${segment.title_en || module.title} · ${len}s · ${module.language} · ${segment.summary_en || ''} · needs: ${needs} · ${fico}`;
}

/**
 * @param {object} a
 * @param {object} a.target      target.pick(...)
 * @param {string} [a.rationale] the report's rationale for the step
 * @param {string} [a.tryText]   "try this tomorrow" as the teacher reads it (the card's action)
 * @param {string} [a.subject]
 * @param {string[]} a.excerpts
 * @param {Array<{seg_id:string}>} a.candidates
 * @param {object} a.catalog
 * @param {number} [a.topRung]   2 on FICO v4, 3 on the 37-id scheme
 */
function build({ target, rationale, tryText, subject, excerpts: ex, candidates, catalog, topRung = 2 }) {
  const t = target || {};
  const row = t.row || {};
  const indicator = t.indicator || (t.phase ? `plan step: ${t.phase}` : '');
  const name = row.name || (t.moves || []).join(', ') || '';
  const rung = row.score !== undefined && row.score !== null ? row.score : '?';
  return `You are the Digital Coach's video picker for a government-school teacher in Pakistan. After a lesson, the coaching report tells the teacher ONE thing to try next class. Your job: choose the ONE short training-video clip (from the candidates below) that would most help THIS teacher do THAT thing, or say that none fits. Return JSON only.

THE TEACHER'S ONE NEXT STEP
Indicator: ${indicator} — ${name} (scored ${rung} of ${topRung} in this lesson)
Rationale from the report: ${rationale || ''}
Try this tomorrow: ${tryText || ''}
Evidence the scorer quoted: ${row.evidence_summary || row.evidence || ''} (around ${row.timestamp || 'unknown'})

TRANSCRIPT MOMENTS (each line: [mm:ss] Speaker: text) — the only source for a quote:
${(ex || []).join('\n')}

CANDIDATE CLIPS (seg_id · title · length · language · what the teacher sees · when a teacher needs it · indicators)
${(candidates || []).map((c) => candidateLine(c, catalog)).join('\n')}

RULES
1. Prefer a clip that SHOWS the exact move in "Try this tomorrow". Same indicator as the next step unless a candidate for another listed indicator matches a transcript moment far better — then say so in the reason and set "differs_from_step": true.
2. The reason must cite ONE real transcript moment: the [mm:ss] and a short quote copied from the TRANSCRIPT MOMENTS (never invented, never paraphrased), then what the clip shows a teacher doing instead. Two sentences, plain words a teacher uses, no jargon, no judgement of the teacher.
3. Gender-neutral: say "the teacher" / "they"; in Urdu use verbal nouns or impersonal forms, never gendered second-person verbs. Keep pedagogical terms in English letters inside Urdu (e.g. open-ended questions, wait time).
4. If no candidate would help this teacher with this step, return "seg_id": null and say why in "none_reason". That is a good answer, not a failure.
5. Never pick a clip whose "needs" clearly do not match this lesson, or one meant for a different subject than this lesson (${subject || 'unknown'}).
6. The quote must contain no person's name: write [a student] in its place.

Return exactly this JSON:
{"seg_id": "<one of the candidate ids, or null>", "differs_from_step": false, "moment": {"at": "mm:ss", "quote": "<copied from the transcript moments>"}, "reason_en": "<two sentences>", "reason_ur": "<the same, in natural Urdu (Nastaliq script)>", "confidence": <0.0-1.0>, "none_reason": "<only when seg_id is null>"}`;
}

module.exports = { build, excerpts, PROMPT_VERSION, stampMs };
