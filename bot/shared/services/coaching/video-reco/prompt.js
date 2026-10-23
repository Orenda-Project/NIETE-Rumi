'use strict';
/**
 * The video picker's prompt (bd-gzfdu9, SPEC §3.4) and the transcript moments it may quote. Pure.
 * The text is the lead's, verbatim; only the {…} slots are filled here. Bump PROMPT_VERSION with any
 * change to it: every stored row carries the version it was picked with. Every transcript line passes the
 * name redactor first (H8): a quote can only carry what survived it.
 */
const { redactNames } = require('./redact-names');

const PROMPT_VERSION = 'vr-6'; // vr-6 (bd-8hhqhf r7, COS 081156): no clock time or speaker label in a reason
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
function excerpts(session, anchors = {}, people = {}) {
  return rawExcerpts(session, anchors).map((l) => clip(redact(l, people)));
}

/**
 * Every transcript line "[mm:ss] Label: text", unredacted, in order (bd-8hhqhf: the scorer-path quote check). A
 * transcript with no [mm:ss] lines gives its non-empty lines as they are (scale-run 081240), so it is still checked.
 */
function transcriptLines(session) {
  const stamped = allLines(session).map((l) => l.text);
  if (stamped.length) return stamped;
  return String((session && session.transcript_text) || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function allLines(session) {
  let lines = [];
  const segs = session && session.diarization_data && Array.isArray(session.diarization_data.segments)
    ? session.diarization_data.segments.filter((s) => s && String(s.text || '').trim()) : [];
  if (segs.length) {
    lines = segs.map((s) => ({ ms: Number(s.start_ms) || 0, text: `[${mmss(s.start_ms)}] ${s.label || s.speaker || 'Speaker'}: ${String(s.text).trim()}` }));
  } else if (session && session.transcript_text) {
    lines = String(session.transcript_text).split('\n').map((l) => l.trim())
      .filter((l) => /^\[\d{1,2}:\d{2}\]/.test(l)).map((l) => ({ ms: stampMs(l), text: l }));
  }
  return lines;
}

/** The same lines before redaction, index for index (bd-8hhqhf: what the validator checks a placeholder against). */
function rawExcerpts(session, { timestamp, uptakeMoment } = {}) {
  const lines = allLines(session);
  if (!lines.length) return [];
  const anchor = stampMs(timestamp) ?? stampMs(uptakeMoment);
  let start = 0;
  if (anchor !== null) {
    let idx = 0;
    lines.forEach((l, i) => { if (l.ms <= anchor) idx = i; });
    start = Math.max(0, Math.min(idx - 4, lines.length - EXCERPT_LINES));
  }
  return lines.slice(start, start + EXCERPT_LINES).map((l) => l.text);
}

/** Children's names → [a student]; the teacher's own name masked too (redact-names.js, r-corpus port). */
function redact(text, people = {}) {
  return redactNames(String(text || ''), { teacher: people.teacher || null, placeholders: { child: '[a student]' } });
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
 * @param {object} a.target        target.pick(...)
 * @param {string} [a.rationale]   the report's rationale for the step
 * @param {string} [a.tryText]     "try this tomorrow" as the teacher reads it (the card's action)
 * @param {string} [a.subject]
 * @param {string[]} a.excerpts    excerpts(...) — already redacted
 * @param {Array<{seg_id:string}>} a.candidates
 * @param {object} a.catalog
 * @param {string} [a.scorerQuote] the target row's own quote (redacted)
 * @param {string} [a.uptakeQuote] the card_text path's evidence line (redacted)
 * @param {number} [a.topRung]     the scheme's top score (2 on FICO v4, 4 on the 37-id scheme)
 * @param {string} [a.reportLanguage] 'en' | 'ur': the language the teacher reads the reason in
 * @param {string} [a.lessonLanguage] 'en' | 'ur' | null: the transcript's language
 */
function build({ target, rationale, tryText, subject, excerpts: ex, candidates, catalog, scorerQuote, uptakeQuote, topRung = 2, reportLanguage, lessonLanguage }) {
  const t = target || {};
  const row = t.row || {};
  let indicatorLine;
  let evidenceLine = '';
  if (t.source === 'card_text') {
    indicatorLine = 'Indicator: not named — the step is the sentence below';
    if (uptakeQuote) evidenceLine = `\nThe report's own moment: "${uptakeQuote}"`;
  } else {
    if (t.indicator) {
      const rung = row.score !== undefined && row.score !== null ? row.score : '?';
      indicatorLine = `Indicator: ${t.indicator} — ${row.name || t.indicator} (scored ${rung} of ${topRung} in this lesson)`;
    } else {
      indicatorLine = `Indicator: plan step: ${t.phase || ''} — ${(t.moves || []).join(', ')} (a step of the lesson plan, not scored)`;
    }
    if (scorerQuote) {
      evidenceLine = `\nThe report's own moment: "${scorerQuote}" (around ${row.timestamp || 'unknown'}). Cite it unless a transcript line below fits the clip better.`;
    }
  }
  const moments = (ex || []).length ? ex.join('\n') : "(no transcript lines for this lesson: cite the report's moment above)";
  return `You are the Digital Coach's video picker for a government-school teacher in Pakistan. After a lesson, the coaching report tells the teacher ONE thing to try next class. Your job: choose the ONE short training-video clip (from the candidates below) that would most help THIS teacher do THAT thing, or say that none fits. Return JSON only.

THE TEACHER'S ONE NEXT STEP
${indicatorLine}
Rationale from the report: ${rationale || ''}
Try this tomorrow: ${tryText || ''}${evidenceLine}

TRANSCRIPT MOMENTS (each line: [mm:ss] Speaker: text) — the only source for a quote:
${moments}

CANDIDATE CLIPS (seg_id · title · length · language · what the teacher sees · when a teacher needs it · indicators)
${(candidates || []).map((c) => candidateLine(c, catalog)).join('\n')}

RULES
1. Choose the clip that SHOWS the exact move in "Try this tomorrow". Every candidate is for that step: you choose among them and ground the moment; you never change the step.
2. The reason must cite ONE real moment: a short quote copied from the report's moment or the TRANSCRIPT MOMENTS (never invented, never paraphrased), introduced in words (what was happening in the lesson), then what the clip shows a teacher doing instead — and if the clip explains the move rather than shows it, one phrase the teacher could say tomorrow. The quote must contain no person's name: write [a student] in its place. Two sentences (under 300 characters), plain words a teacher uses, no jargon, no judgement of the teacher. Never write a clip id, number or code; never write a clock time (no [mm:ss], no "at 12:08") or a speaker label (no "Teacher:", "Student:") in reason_en or reason_ur: the moment's time goes only in moment.at; never mention the scorer, the report or the analysis; describe the lesson moment itself. Choose a moment with the teacher's or a child's own words; if the only candidate line is mostly [a student] placeholders, pick another line. If no real moment fits, return seg_id null — never write N/A, unknown or [around unknown].${crossLanguageRule(reportLanguage, lessonLanguage)}
3. Gender-neutral: say "the teacher" / "they"; in Urdu use verbal nouns or impersonal forms, never gendered second-person verbs. Keep pedagogical terms in English letters inside Urdu (e.g. open-ended questions, wait time). No Roman Urdu (Urdu in Latin letters); Urdu is written in Nastaliq script; only pedagogical terms stay in English letters (one or two words).
4. If no candidate would help this teacher with this step, return "seg_id": null and say why in "none_reason". That is a good answer, not a failure.
5. Never pick a clip whose "needs" clearly do not match this lesson, or one meant for a different subject than this lesson (${subject || 'unknown'}).

Return exactly this JSON:
{"seg_id": "<one of the candidate ids, or null>", "moment": {"at": "mm:ss", "quote": "<copied from the transcript moments>"}, "reason_en": "<two sentences>", "reason_ur": "<the same, in natural Urdu (Nastaliq script)>", "confidence": <0.0-1.0>, "none_reason": "<only when seg_id is null>"}`;
}

const LANGUAGE_NAMES = Object.freeze({ en: 'English', ur: 'Urdu' });

/**
 * vr-5 (SPEC §3.4 [v1.3c-3]): when the teacher reads the reason in a different language from the lesson's, the
 * reason paraphrases the moment and quotes at most 6 words; moment.quote stays verbatim. '' when the two are the
 * same or either is unknown, so those prompts stay byte-identical to vr-4.
 */
function crossLanguageRule(reportLanguage, lessonLanguage) {
  const report = LANGUAGE_NAMES[reportLanguage];
  const lesson = LANGUAGE_NAMES[lessonLanguage];
  if (!report || !lesson || report === lesson) return '';
  return ` This lesson is in ${lesson} and the teacher reads the reason in ${report}: in reason_${reportLanguage}, paraphrase the moment in ${report} and quote at most 6 words of the lesson word for word; "moment"."quote" stays the line copied word for word from the TRANSCRIPT MOMENTS or the report's moment.`;
}

// One sentence per validate() <why> (select.js), for the single retry's appendix (v1.3b). Never names a scorer.
const RETRY_RULES = Object.freeze({
  shape: 'The answer was not the JSON object asked for.',
  candidate: 'The seg_id was not one of the CANDIDATES.',
  quote: "The quote was not copied word for word from the report's moment or the TRANSCRIPT MOMENTS.",
  moment_at: 'The moment "at" was not a real mm:ss time from those lines.',
  placeholder: 'The quote was mostly [a student] placeholders; choose a line with the teacher\'s or a child\'s own words.',
  scorer: 'The reason talked about the report or the analysis instead of the lesson moment itself.',
  id: 'The reason contained a clip id, number or code.',
  name: "The quote or the reason contained a person's name; write [a student] in its place.",
  length: 'reason_en was not two sentences under 300 characters.',
  urdu: 'reason_ur was not written in Urdu script.',
  roman: 'reason_ur contained Roman Urdu or English words; write it in Urdu script.',
  step: "The clip does not show the step's teaching move; choose one that does.",
});

/** The two lines added to the same prompt for the one retry: which rule the first answer broke, then answer again. */
function retryAppendix(none) {
  const why = String(none || '').replace(/^validation:/, '');
  const rule = RETRY_RULES[why] || 'The answer broke one of the rules above.';
  return `\n\nYOUR FIRST ANSWER WAS REJECTED (validation:${why}): ${rule}\nAnswer again in the same JSON shape, keeping every rule above; if no clip fits, return seg_id null.`;
}

module.exports = { build, excerpts, rawExcerpts, transcriptLines, redact, retryAppendix, PROMPT_VERSION, stampMs };
