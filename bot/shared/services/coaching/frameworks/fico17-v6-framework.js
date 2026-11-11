'use strict';

/**
 * bd-ra8xu.38 — FICO17 v6, the Digital Coach's scorer (deploy spec §5). Registered as 'fico17_v6' beside V3 'fico'.
 *
 * The rubric text is data (fico17-v6/fico17_v6.rubric.json, from spec Appendix A); this module renders it into the
 * prompt, checks what the model returns, and adds it up. It speaks the standard framework interface, so
 * GPT5MiniService.analyzePedagogy can run it like any other framework (same model, same settings as V3).
 *
 * What the DC returns:
 *   levels            the 11 DC indicators (C1 C2 C4 C6 C8 D1 D5 F1 F2 F3 F4): 1-4, 'NA' or 'IE' ("couldn't tell").
 *   combined_evidence the 5 combined ones the transcript can show something of (C3 C5 C7 D3 D4): evidence only,
 *                     result null | 'NA' | 'IE', NEVER a number (spec §12 Q1: evidence only). D2 is counted in code
 *                     (countD2), never asked of the model. The coach sets all six levels.
 *
 * Totals count numeric DC levels only. NA and IE leave both sides of the ratio. The six combined indicators never
 * enter a DC total. Domains live under v6-only keys (v6_teacher / v6_children / v6_subject), never a V3 key, so a
 * reader written for V3 cannot sum a v6 row (V3 C5 and v6 C5 are different indicators).
 *
 * Self-recordings: V3 still scores every recording and drives the teacher's report (the v10 coaching A/B test reads
 * it). This scorer runs only when the fico_dc_rubric switch says 'shadow' (or 'v6', which today behaves as shadow),
 * and its output is stored under analysis_data.shadow.fico17_v6, never sent (fico17-v6/shadow.js).
 */

const v6 = require('./fico17-v6');

const DC_MAX = v6.DC_CODES.length * 4; // 44
const EVIDENCE_CODES = ['C3', 'C5', 'C7', 'D3', 'D4'];

// Spec §5.6.
const KINDS = {
  C3: [['name_called', 'the teacher names a child before the question'], ['pair_talk', '"tell your partner"'], ['everyone_write', '"everyone write your answer"'], ['random_pick', 'names picked at random']],
  C5: [['signal', 'the teacher\'s signal to change activity; add "starts": "MM:SS" when the next activity is heard starting']],
  C7: [['pairs_or_groups', 'children put in pairs or groups'], ['shared_task', 'a task the group can only finish together'], ['product', 'what the group must make'], ['roles', 'roles or turns inside the group'], ['report_back', 'the group reports back']],
  D3: [['child_agrees_or_adds', 'a Student line that answers, agrees with or adds to the previous Student line'], ['second_child_named_to_agree', 'the teacher names a second child to agree']],
  D4: [['unsure_answer', '"Maybe...", "Should I say...?", or an answer that changes halfway'], ['second_try', 'a second try after a wrong answer'], ['unasked_answer', 'an answer given without being asked']],
};

const LEVEL_RESULTS = [1, 2, 3, 4, 'NA', 'IE'];
const COMBINED_RESULTS = [null, 'NA', 'IE'];
const TIME_RE = /^\d{1,3}:\d{2}$/;
const NEAR_SECONDS = 30;

// ─── Prompt (spec §5.3) ───────────────────────────────────────────────

function renderLevelBlock(ind) {
  const lines = [`### Indicator: ${ind.code} ${ind.name}`, `Definition: ${ind.definition}`];
  for (const l of ind.levels) {
    lines.push(`Level ${l.n} (${v6.LEVEL_LABELS[l.n]}): ${l.text}`);
    if (l.example) lines.push(`   Example (not from this lesson): ${l.example}`);
  }
  lines.push(`Couldn't tell: ${ind.couldnt_tell}`);
  return lines.join('\n');
}

// "Combined indicator." text without the clause that asks for a transcript-only level (spec Appendix A conflict note).
function reportLine(text) {
  return String(text || '')
    .replace(/,?\s*(with|and) the level the transcript alone supports/i, '')
    .replace(/\s+\./g, '.')
    .trim();
}

function renderEvidenceBlock(ind) {
  const lines = [
    `### Evidence: ${ind.code} ${ind.name}`,
    `Definition: ${ind.definition}`,
    `Report: ${reportLine(ind.combined_evidence)}`,
    `Kinds: ${KINDS[ind.code].map(([k, d]) => `${k} (${d})`).join('; ')}`,
    `Couldn't tell: ${ind.couldnt_tell}`,
  ];
  if (ind.na_rule) lines.push(`N/A rule: ${ind.na_rule}`);
  return lines.join('\n');
}

const SCHEMA = `{
  "rubric": "fico17_v6",
  "levels": {
    "C1": {"result": 3, "because": "one short line on why this level", "evidence": [{"time": "12:40", "quote": "exact words from the transcript"}]},
    "C2": {"result": "NA", "because": "...", "evidence": []},
    "C4": {...}, "C6": {...}, "C8": {...}, "D1": {...}, "D5": {...},
    "F1": {"result": "IE", "because": "...", "evidence": [...]},
    "F2": {...}, "F3": {...}, "F4": {...}
  },
  "combined_evidence": {
    "C3": {"result": null, "items": [{"time": "05:10", "quote": "exact words", "kind": "name_called"}]},
    "C5": {"result": null, "items": [{"time": "14:02", "quote": "exact words", "kind": "signal", "starts": "14:40"}]},
    "C7": {"result": null, "items": []},
    "D3": {"result": "NA", "items": []},
    "D4": {"result": "IE", "items": []}
  }
}
- levels.<code>.result is one of 1, 2, 3, 4, "NA", "IE".
- combined_evidence.<code>.result is null, "NA" or "IE" — NEVER a number.
- Every "time" is MM:SS from the transcript; every "quote" is copied exactly from the transcript line at that time.`;

let _cached = null; // { version, prompt }

function getSystemPrompt() {
  if (_cached && _cached.version === v6.DC_PROMPT_VERSION) return _cached.prompt;
  const part1 = v6.DC_CODES.map((c) => renderLevelBlock(v6.indicator(c))).join('\n\n');
  const part2 = EVIDENCE_CODES.map((c) => renderEvidenceBlock(v6.indicator(c))).join('\n\n');
  const prompt = `You are an expert classroom observer scoring one primary-school lesson with FICO17 v6 (the ICT classroom observation rubric).

You are reading the transcript of one primary-school lesson. Each line is
\`[MM:SS] Speaker (LANG): text\`; speakers are labelled Teacher or Student.
Every child is labelled "Student": never count different children by that label.
Score only what the transcript shows. Never infer that something "probably happened".
A number in a level counts things you can find in the transcript (answers, questions, times the teacher does
something), never different children.

PART 1 – LEVELS. For each indicator in Part 1, choose the ONE level (1-4) whose
description best fits the whole lesson, using only what is in the transcript.
If the indicator's "Couldn't tell" condition applies, return "IE" instead of a level.
If the indicator's N/A condition applies, return "NA".
Give 1-3 evidence items, each a timestamp and the exact words from the transcript.

${part1}

PART 2 – EVIDENCE ONLY. For each indicator in Part 2, do NOT give a level.
List up to 5 moments from the transcript that match what is asked, each with a
timestamp, the exact words, and a kind. If none, return an empty list.
If the indicator's "Couldn't tell" condition applies, set "result": "IE".
If its N/A rule applies, set "result": "NA".
(How many children spoke is counted separately; do not report it.)

${part2}

Return only JSON matching this schema:
${SCHEMA}`;
  _cached = { version: v6.DC_PROMPT_VERSION, prompt };
  return prompt;
}

function buildAnalysisPrompt(transcript, metadata = {}) {
  const { grade, subject, duration } = metadata || {};
  const ctx = [];
  if (grade) ctx.push(`Grade: ${grade}`);
  if (subject) ctx.push(`Subject: ${subject}`);
  if (duration) ctx.push(`Recording length: ${Math.round(Number(duration) / 60)} minutes`);
  return `${ctx.length ? `${ctx.join('\n')}\n\n` : ''}TRANSCRIPT:
${transcript}

Score Part 1 and report Part 2 for this lesson. Return only the JSON.`;
}

// ─── Transcript reading ───────────────────────────────────────────────

function toSeconds(t) {
  const parts = String(t).split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const LINE_RE = /\[?(\d{1,2}:)?(\d{1,3}):(\d{2})\]?\s*(.*)$/;

/** The transcript as [{ t (seconds), speaker, text, raw }]; lines with no timestamp are skipped. */
function lines(transcript) {
  const out = [];
  for (const raw of String(transcript || '').split('\n')) {
    const m = raw.match(LINE_RE);
    if (!m || raw.indexOf(m[0]) > 4) continue;
    const t = (m[1] ? Number(m[1].slice(0, -1)) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
    const rest = m[4];
    const sp = rest.match(/^([A-Za-z]+)/);
    out.push({ t, speaker: sp ? sp[1] : '', text: rest, raw });
  }
  return out;
}

const squash = (s) => String(s || '').toLowerCase().replace(/[\s"'“”‘’.,!?؟،۔…]+/g, ' ').trim();

/** Spec §5.6: Student lines, split at the midpoint between the first and last timestamp. Null with no timestamps. */
function countD2(transcript) {
  const ls = lines(transcript);
  if (!ls.length) return null;
  const mid = (ls[0].t + ls[ls.length - 1].t) / 2;
  let first = 0;
  let second = 0;
  for (const l of ls) {
    if (!/^Student/i.test(l.speaker)) continue;
    if (l.t <= mid) first += 1; else second += 1;
  }
  return { student_turns_first_half: first, student_turns_second_half: second };
}

// ─── Validator (spec §5.5) ────────────────────────────────────────────

/**
 * Checks a reply in place. Drops evidence whose quote is not in the transcript within ±30 s of its time (counted in
 * `dropped`). Returns { ok, errors, dropped, warnings }. Never fills a default level.
 */
function validate(analysis, transcript) {
  const errors = [];
  const warnings = [];
  let dropped = 0;
  const a = analysis || {};
  const ls = lines(transcript);
  const tMin = ls.length ? ls[0].t : null;
  const tMax = ls.length ? ls[ls.length - 1].t : null;
  const whole = squash(transcript);

  const quoted = (item) => {
    const q = squash(item.quote);
    if (!q) return false;
    if (!ls.length) return whole.includes(q);
    const at = toSeconds(item.time);
    return ls.some((l) => Math.abs(l.t - at) <= NEAR_SECONDS && squash(l.text).includes(q));
  };

  const checkItems = (code, items, where) => {
    if (!Array.isArray(items)) { errors.push(`${code}: ${where} is not a list`); return []; }
    for (const it of items) {
      if (!it || typeof it.time !== 'string' || !TIME_RE.test(it.time)) { errors.push(`${code}: bad time ${JSON.stringify(it && it.time)}`); continue; }
      const s = toSeconds(it.time);
      if (tMin !== null && (s < tMin - NEAR_SECONDS || s > tMax + NEAR_SECONDS)) errors.push(`${code}: time ${it.time} outside the lesson`);
    }
    if (errors.length) return items;
    const kept = items.filter(quoted);
    dropped += items.length - kept.length;
    return kept;
  };

  const levels = a.levels && typeof a.levels === 'object' ? a.levels : null;
  if (!levels) errors.push('levels missing');
  for (const code of v6.DC_CODES) {
    const row = levels && levels[code];
    if (!row) { errors.push(`${code}: missing from levels`); continue; }
    if (!LEVEL_RESULTS.includes(row.result)) { errors.push(`${code}: invalid result ${JSON.stringify(row.result)}`); continue; }
    const before = errors.length;
    const kept = checkItems(code, row.evidence || [], 'evidence');
    if (errors.length === before) {
      row.evidence = kept;
      if (!kept.length && (row.result === 3 || row.result === 4)) warnings.push(`${code}: level ${row.result} with no evidence left`);
    }
  }

  const ce = a.combined_evidence && typeof a.combined_evidence === 'object' ? a.combined_evidence : null;
  if (!ce) errors.push('combined_evidence missing');
  for (const code of EVIDENCE_CODES) {
    const row = ce && ce[code];
    if (!row) { errors.push(`${code}: missing from combined_evidence`); continue; }
    const result = row.result === undefined ? null : row.result;
    if (!COMBINED_RESULTS.includes(result)) { errors.push(`${code}: combined result must be null, NA or IE, got ${JSON.stringify(row.result)}`); continue; }
    const before = errors.length;
    const kept = checkItems(code, row.items || [], 'items');
    if (errors.length === before) row.items = kept.slice(0, 5);
  }

  return { ok: errors.length === 0, errors, dropped, warnings };
}

// ─── Scores ───────────────────────────────────────────────────────────

function summaryOf(row) {
  const ev = (row && Array.isArray(row.evidence) && row.evidence[0]) || null;
  const because = (row && row.because) || '';
  const quote = ev ? ` [${ev.time}] "${ev.quote}"` : '';
  return v6.clip(`${because}${quote}`.trim(), 500);
}

/**
 * Adds up a v6 reply. Keeps levels / combined_evidence as returned, stamps rubric + prompt_version, builds
 * analysis.domains under the v6 keys, and analysis.scores over numeric DC levels only.
 * @param {object} analysis    the model's reply (spec §5.4)
 * @param {boolean} [_hasLp]   unused (lesson-plan fidelity is computed separately)
 * @param {string} [transcript] when given, D2's turn counts are added (spec §5.6)
 */
function computeScores(analysis, _hasLp, transcript) {
  const a = analysis || {};
  Object.assign(a, v6.stamp('dc'));
  a.levels = a.levels || {};
  a.combined_evidence = a.combined_evidence || {};
  if (transcript && !a.combined_evidence.D2) {
    const d2 = countD2(transcript);
    if (d2) a.combined_evidence.D2 = d2;
  }

  const domains = {};
  for (const section of Object.values(v6.SECTIONS)) {
    const indicators = section.codes.map((code) => {
      const ind = v6.indicator(code);
      if (v6.isCombined(code)) {
        const ce = a.combined_evidence[code] || {};
        return {
          id: code, name: ind.name, kind: 'combined', set_by: 'coach', score: null, result: null, applicable: false,
          dc_result: ce.result === undefined ? null : (ce.result || null),
          evidence: (ce.items || []).map((i) => `[${i.time}] "${i.quote}"`).join(' '),
          evidence_items: ce.items || [],
          evidence_summary: '',
        };
      }
      const row = a.levels[code] || {};
      const result = v6.normLevel(row.result);
      const numeric = typeof result === 'number';
      return {
        id: code, name: ind.name, kind: 'dc', set_by: 'dc', result, score: numeric ? result : null, applicable: numeric,
        evidence: (row.evidence || []).map((i) => `[${i.time}] "${i.quote}"`).join(' ') || (row.because || ''),
        evidence_items: row.evidence || [],
        evidence_summary: summaryOf(row),
        because: row.because || '',
      };
    });
    const counted = indicators.filter((i) => typeof i.score === 'number');
    domains[section.domain] = {
      key: section.key,
      name: section.name,
      indicators,
      domain_score: counted.reduce((s, i) => s + i.score, 0),
      domain_max: counted.length * 4,
      indicators_applicable: counted.length,
    };
  }
  a.domains = domains;

  const dcLevels = Object.fromEntries(v6.DC_CODES.map((c) => [c, a.levels[c]]));
  const t = v6.totals(dcLevels);
  a.scores = { overall_marks: t.marks, overall_max_marks: t.max, overall_percentage: t.percentage, counted: t.counted };
  return a;
}

function getPerformanceBand(percentage) {
  if (percentage >= 85) return 'excellent';
  if (percentage >= 70) return 'proficient';
  if (percentage >= 50) return 'developing';
  return 'emerging';
}

function getScoringConstants() {
  const domains = {};
  for (const s of Object.values(v6.SECTIONS)) {
    domains[s.domain] = {
      key: s.key,
      displayName: s.name,
      indicatorCount: s.codes.length,
      indicators: s.codes.map((c) => ({ id: c, name: v6.indicator(c).name, kind: v6.indicator(c).kind, levels: Object.fromEntries(v6.indicator(c).levels.map((l) => [l.n, l.text])) })),
    };
  }
  return { domains, maxMarks: DC_MAX, scaleMax: 4, totalIndicators: v6.CODES.length, dcIndicators: v6.DC_CODES.length };
}

module.exports = {
  name: 'fico17_v6',
  version: '6.0',
  rubric: v6.RUBRIC_KEY,
  promptVersion: v6.DC_PROMPT_VERSION,
  displayName: 'FICO17 v6',
  maxMarks: DC_MAX,
  hasDebrief: false,
  hasLPBonus: false,

  getSystemPrompt,
  buildAnalysisPrompt,
  computeScores,
  getPerformanceBand,
  getScoringConstants,
  validate,
  countD2,
  lines,
  EVIDENCE_CODES,
  KINDS,
};
