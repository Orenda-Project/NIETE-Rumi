'use strict';

/**
 * Queue #184 — FICO 6-12 (FICO-S v1.1, rubric 'fico_s_v1_1'), the Digital Coach's scorer for ICT HITL visits in grades
 * 6-12. Operator 19 Nov ~11:20: "yes, all HITL go to DC". Registered beside 'fico17_v6' (framework-registry.js).
 *
 * The prompt is the rubric registry (fico-s/fico_s_v1_1.rubric.json, from the operator's sheet): every indicator's own
 * words (what to look for, how it is seen), its four levels with the sheet's level names, and the sheet's examples.
 * STARRED indicators (E3, rubric field `starred`) are never sent to the DC: they are not in the prompt, the validator
 * refuses a reply that scores one, and the scorer drops any that arrives. The observer sets them (mandatory).
 *
 * It speaks the standard framework interface, so GPT5MiniService.analyzePedagogy runs it like v6 (same model, same
 * settings, same photo channel: images attached in COACHING_PHOTO_MODE image|both). Unlike v6's prompt it also reads
 * the classroom photos' description (text|both) and the lesson plan when the visit has them: FICO 6-12 asks about the
 * written objective (A1), resources (B5) and checking learning (E1, E2), which a transcript alone often cannot show.
 *
 * What the DC returns: levels.<code> = { result: 1-4 | 'NA' (C2, C3) | 'IE' ("couldn't tell"), because, evidence:
 * [{ time, quote }] } for every non-starred indicator. Nothing here is shown as a FICO-S score on its own: it is the
 * pre-fill the observer reviews (observe/obs612), and the observer's submitted level is the one that counts.
 *
 * FICO-S v1.2 (queue #218, dc-4): each indicator carries its own "Couldn't tell" line (fico-s/fico_s_v1_2.json dc_ie; it
 * was one generic rule), and N/A is allowed on C2 and C3 only, each with its own rule. IE stays the Digital Coach's only.
 * One scorer serves both ids (framework-registry): a v1.1 visit analysed now gets this prompt, and its form keeps only
 * what v1.1 offers (obs612/fico-s-dc rumiLevelOf drops a C3 N/A there).
 */

const crypto = require('crypto');
const fs = require('fs');
const S = require('./fico-s');

// The hash follows the rubric data: v1.1's text and what v1.2 adds to it.
const RUBRIC_SHA8 = crypto.createHash('sha256').update(fs.readFileSync(S.RUBRIC_FILE)).update(fs.readFileSync(S.V12_FILE)).digest('hex').slice(0, 8);
// Bump the number when the prompt's wording (not the rubric data) changes; the hash follows the rubric data.
// 2 (19 Nov ~14:15): the HITL-only indicators starred too (C3 C5 C7 D2 D3 E2 E3), so 16 are asked.
// 3 (19 Nov ~17:00): starred = E3 only, so the Digital Coach is asked 22 indicators (2 asked 16; 1 was the first cut).
// 4 (21 Nov, FICO-S v1.2): a "Couldn't tell" line per indicator (was one generic rule); N/A on C2 and C3, each its own rule.
const DC_PROMPT_VERSION = `fico-s-dc-4+${RUBRIC_SHA8}`;
const RESULTS = [1, 2, 3, 4, 'NA', 'IE'];
const TIME_RE = /^\d{1,3}:\d{2}$/;
const NEAR_SECONDS = 30;
// The pre-filled Evidence box (the form's textarea takes more; the observer edits it).
const PREFILL_CAP = 600;

const cp = (s) => Array.from(String(s || '')).length;
function clip(s, max) {
  const chars = Array.from(String(s || ''));
  if (chars.length <= max) return chars.join('');
  const head = chars.slice(0, max - 1).join('');
  const cut = head.lastIndexOf(' ');
  return `${(cut > max * 0.6 ? head.slice(0, cut) : head).trimEnd()}…`;
}

// ─── Prompt ───────────────────────────────────────────────────────────

function renderIndicator(code) {
  const ind = S.indicator(code);
  const lines = [`### Indicator: ${code} ${ind.name}`, `What to look for: ${ind.look_for}`];
  if (ind.how) lines.push(`How it is seen: ${ind.how}`);
  for (const l of ind.levels) {
    lines.push(`Level ${l.n} (${S.LEVEL_LABELS[l.n]}): ${l.text}`);
    const ex = (ind.examples || []).find((e) => e.n === l.n);
    if (ex) lines.push(`   Example (not from this lesson): ${ex.text}`);
  }
  const na = S.naDcRule(code);
  if (na) lines.push(`N/A when: ${na}`);
  const ie = S.ieLine(code);
  if (ie) lines.push(`Couldn't tell ("IE") when: ${ie}`);
  return lines.join('\n');
}

const SCHEMA = () => `{
  "rubric": "${S.RUBRIC_KEY}",
  "levels": {
${S.DC_CODES.map((c, i) => {
    if (i === 0) return `    "${c}": {"result": 3, "because": "one short line on why this level", "evidence": [{"time": "12:40", "quote": "exact words from the transcript"}]}`;
    if (S.NA_CODES.includes(c) && c === S.NA_CODES[0]) return `    "${c}": {"result": "NA", "because": "...", "evidence": []}`;
    if (i === 1) return `    "${c}": {"result": "IE", "because": "what the recording could not show", "evidence": []}`;
    return `    "${c}": {...}`;
  }).join(',\n')}
  }
}
- levels.<code>.result is one of 1, 2, 3, 4, "IE"${S.NA_CODES.length ? `, and "NA" only for ${S.NA_CODES.join(', ')}` : ''}.
- Every indicator above is in "levels"; no other code is.
- Every "time" is MM:SS from the transcript; every "quote" is copied exactly from the transcript line at that time.`;

let _cached = null; // { version, prompt }

function getSystemPrompt() {
  if (_cached && _cached.version === DC_PROMPT_VERSION) return _cached.prompt;
  const sections = S.SECTIONS.map((sec) => {
    const codes = sec.codes.filter((c) => !S.isStarred(c));
    if (!codes.length) return '';
    return `## ${sec.key}. ${sec.name}${sec.question ? ` (${sec.question})` : ''}\n\n${codes.map(renderIndicator).join('\n\n')}`;
  }).filter(Boolean).join('\n\n');
  const prompt = `You are an expert classroom observer scoring one secondary-school lesson (grades 6-12) with FICO 6-12, the ICT classroom observation rubric.

You are reading the transcript of the lesson. Each line is
\`[MM:SS] Speaker (LANG): text\`; speakers are labelled Teacher or Student.
Every child is labelled "Student": never count different children by that label.
The observer may also share a description of classroom photos (the board, a notebook, a teaching aid) and the
teacher's lesson plan. Use them only for what they show; the lesson as taught is in the transcript.

For each indicator below, choose the ONE level (1-4) whose description best fits the whole lesson.
Levels build on each other: level 4 means level 3 is met plus the extra step. Give the lower level if unsure.
Score only what the transcript, the photos or the plan show. Never infer that something "probably happened".
Each indicator has a "Couldn't tell" line: when it applies (the transcript, the photos and the plan cannot show what
the indicator looks for), return "IE" ("couldn't tell") and say why in "because". "IE" is not a low level.
Return "NA" only for an indicator with an "N/A when" line, and only when that line applies.
Give 1-3 evidence items, each a timestamp and the exact words from the transcript (none when the result is "IE").
Write "because" in English, in one short line, about what happened in this lesson.

${sections}

Return only JSON matching this schema:
${SCHEMA()}`;
  _cached = { version: DC_PROMPT_VERSION, prompt };
  return prompt;
}

const RETRY_NOTE = 'Your last reply was not valid JSON. Return only the JSON.';
const PHOTO_TEXT_MODES = ['text', 'both'];

/**
 * The per-lesson user prompt (everything that varies by lesson; the system prompt is one cached string per version).
 *   metadata.grade / subject / duration (seconds)
 *   metadata.photo { mode, text }   the classroom photos' description, used in mode text|both (images ride separately)
 *   metadata.transcriptQuality      a 'partial' gate result adds its TRANSCRIPT GAPS block
 *   metadata.retry                  the one retry after a reply that would not parse
 * @param {string} transcript
 * @param {object} [metadata]
 * @param {object|null} [lessonPlanStructured]  the extracted lesson plan, when the observer shared one
 */
function buildAnalysisPrompt(transcript, metadata = {}, lessonPlanStructured = null) {
  const { grade, subject, duration, transcriptQuality, retry, photo } = metadata || {};
  const ctx = [];
  if (grade) ctx.push(`Grade: ${grade}`);
  if (subject) ctx.push(`Subject: ${subject}`);
  if (duration) ctx.push(`Recording length: ${Math.round(Number(duration) / 60)} minutes`);
  const blocks = [];
  if (ctx.length) blocks.push(ctx.join('\n'));
  if (lessonPlanStructured) {
    const plan = require('../lesson-plan-narrative').formatLessonPlanNarrative(lessonPlanStructured);
    if (plan) blocks.push(`LESSON PLAN (shared by the observer):\n${plan}`);
  }
  if (photo && PHOTO_TEXT_MODES.includes(photo.mode) && photo.text) blocks.push(`CLASSROOM PHOTOS (described):\n${photo.text}`);
  blocks.push(`TRANSCRIPT:\n${transcript}`);
  const gaps = transcriptQuality ? require('../../observe/transcript-quality').promptGaps(transcriptQuality) : '';
  if (gaps) blocks.push(gaps);
  blocks.push('Score every indicator for this lesson. Return only the JSON.');
  const prompt = blocks.join('\n\n');
  return retry ? `${prompt}\n\n${RETRY_NOTE}` : prompt;
}

// ─── Transcript reading (as v6) ───────────────────────────────────────

function toSeconds(t) {
  const parts = String(t).split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const LINE_RE = /\[?(\d{1,2}:)?(\d{1,3}):(\d{2})\]?\s*(.*)$/;
function lines(transcript) {
  const out = [];
  for (const raw of String(transcript || '').split('\n')) {
    const m = raw.match(LINE_RE);
    if (!m || raw.indexOf(m[0]) > 4) continue;
    out.push({ t: (m[1] ? Number(m[1].slice(0, -1)) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]), text: m[4] });
  }
  return out;
}
const squash = (s) => String(s || '').toLowerCase().replace(/[\s"'“”‘’.,!?؟،۔…]+/g, ' ').trim();

// ─── Validator ────────────────────────────────────────────────────────

/**
 * Checks a reply in place: every non-starred indicator present with a valid result (NA only where the rubric allows
 * it), no starred indicator scored, and evidence whose quote is not in the transcript within ±30 s dropped (counted).
 * @returns {{ ok: boolean, errors: string[], dropped: number, warnings: string[] }}
 */
function validate(analysis, transcript) {
  const errors = [];
  const warnings = [];
  let dropped = 0;
  const ls = lines(transcript);
  const whole = squash(transcript);
  const quoted = (it) => {
    const q = squash(it && it.quote);
    if (!q) return false;
    if (!ls.length) return whole.includes(q);
    const at = toSeconds(it.time);
    return ls.some((l) => Math.abs(l.t - at) <= NEAR_SECONDS && squash(l.text).includes(q));
  };
  const levels = analysis && analysis.levels && typeof analysis.levels === 'object' ? analysis.levels : null;
  if (!levels) errors.push('levels missing');
  for (const code of S.STARRED_CODES) {
    if (levels && levels[code] !== undefined) errors.push(`${code}: a starred indicator is never scored by the Digital Coach`);
  }
  for (const code of S.DC_CODES) {
    const row = levels && levels[code];
    if (!row) { errors.push(`${code}: missing from levels`); continue; }
    if (!RESULTS.includes(row.result)) { errors.push(`${code}: invalid result ${JSON.stringify(row.result)}`); continue; }
    if (row.result === 'NA' && !S.NA_CODES.includes(code)) { errors.push(`${code}: N/A is not allowed for this indicator`); continue; }
    const items = Array.isArray(row.evidence) ? row.evidence : [];
    const timed = items.filter((it) => it && typeof it.time === 'string' && TIME_RE.test(it.time));
    const kept = timed.filter(quoted);
    dropped += items.length - kept.length;
    row.evidence = kept.slice(0, 3);
    if (!kept.length && (row.result === 3 || row.result === 4)) warnings.push(`${code}: level ${row.result} with no evidence left`);
  }
  return { ok: errors.length === 0, errors, dropped, warnings };
}

// ─── Scores and the pre-fill ──────────────────────────────────────────

/** One indicator's pre-filled Evidence box: the DC's "because", then its moments ("[MM:SS] "quote""), capped. */
function prefillEvidence(row) {
  if (!row) return '';
  const because = String(row.because || '').trim();
  const moments = (Array.isArray(row.evidence) ? row.evidence : [])
    .filter((e) => e && e.quote)
    .map((e) => `[${e.time}] "${String(e.quote).trim()}"`);
  if (row.result === 'IE' && !moments.length) return '';
  return clip([because, ...moments].filter(Boolean).join(' '), PREFILL_CAP);
}

/**
 * Tidies a reply and adds up the DC's own levels (FICO-S's sums: numeric levels only; N/A and IE leave both sides).
 * Keeps `levels` for the non-starred indicators only, stamps rubric + prompt_version. `dc_scores` is the DC's view of the
 * lesson, kept for calibration; it is never a visit's score (the observer's submitted levels are).
 */
function computeScores(analysis, _hasLp) {
  const a = analysis || {};
  a.rubric = S.RUBRIC_KEY;
  a.prompt_version = DC_PROMPT_VERSION;
  const levels = a.levels && typeof a.levels === 'object' ? a.levels : {};
  a.levels = {};
  for (const code of S.DC_CODES) {
    const row = levels[code];
    if (!row || typeof row !== 'object') continue;
    const result = row.result === 'NA' ? (S.NA_CODES.includes(code) ? 'NA' : null) : row.result === 'IE' ? 'IE' : S.normLevel(row.result, code);
    a.levels[code] = { result, because: String(row.because || ''), evidence: Array.isArray(row.evidence) ? row.evidence : [] };
  }
  const nums = Object.fromEntries(Object.entries(a.levels).filter(([, r]) => typeof r.result === 'number').map(([c, r]) => [c, r.result]));
  const sc = S.score(nums);
  a.dc_scores = { total: sc.total, max: sc.max, counted: sc.counted, pct: sc.pct, band: sc.band ? sc.band.label : null, rubric: S.RUBRIC_KEY };
  return a;
}

function getScoringConstants() {
  const domains = {};
  for (const s of S.SECTIONS) {
    domains[`fico_s_${s.key}`] = {
      key: s.key,
      displayName: s.name,
      indicatorCount: s.codes.length,
      indicators: s.codes.map((c) => ({ id: c, name: S.indicator(c).name, starred: S.isStarred(c) })),
    };
  }
  return { domains, maxMarks: S.CODES.length * 4, scaleMax: 4, totalIndicators: S.CODES.length, dcIndicators: S.DC_CODES.length };
}

module.exports = {
  name: S.RUBRIC_KEY,
  version: S.versionOf(S.RUBRIC_KEY),
  rubric: S.RUBRIC_KEY,
  promptVersion: DC_PROMPT_VERSION,
  displayName: 'FICO 6-12',
  maxMarks: S.CODES.length * 4,
  hasDebrief: false,
  hasLPBonus: false,
  getSystemPrompt,
  buildAnalysisPrompt,
  computeScores,
  getScoringConstants,
  validate,
  prefillEvidence,
  lines,
  RETRY_NOTE,
  PREFILL_CAP,
  RUBRIC_SHA8,
};
