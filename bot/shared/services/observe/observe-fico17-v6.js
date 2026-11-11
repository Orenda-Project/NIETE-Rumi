'use strict';

/**
 * bd-ra8xu.38 — /observe on FICO17 v6: everything a v6 visit needs that a V3 visit never touches.
 *
 * Which rubric a visit uses is decided ONCE, when the observation row is created: the coach switch
 * (fico_coach_rubric, coaching/fico-rubric-switch.js, default 'current') is read for the coach, and a 'v6' answer
 * stamps coaching_sessions.framework = 'fico17_v6' on the insert. Everything after reads that stamp (or the
 * analysis's own `framework`), never the live switch, so flipping the switch mid-visit changes nothing in flight.
 * With the switch off nothing here runs and /observe is FICO V3 exactly as before.
 *
 * On a v6 visit (the review Flow, observe-fico17_v6-flow.json):
 * - C3 C5 C7 D2 D3 D4 (combined): the coach sets the level from the room, starting blank, with a written reason of
 *   at least 20 characters. D2 also takes two counts (children who spoke; quiet then spoke) and a level that does not
 *   match them needs a number in the reason. The DC's evidence for each is shown above the choice.
 * - The 11 DC indicators: Rumi's level is pre-filled from the v6 analysis of the recording; a coach who changes any
 *   level on a screen writes why in that screen's "Why you changed" box (operator Q2-B, 11 Nov).
 * - Lesson-plan fidelity (screen B) is the measured fidelity exactly as V3 edits it; it is not one of the 17.
 * Every stored level carries rubric + prompt_version + set_by ('coach' | 'rumi'). v6 totals never mix with V3.
 */

const v6 = require('../coaching/frameworks/fico17-v6');

const V6 = v6.RUBRIC_KEY; // 'fico17_v6'
const FLOW_ID_ENV = 'OBSERVE_FICO17_V6_FLOW_ID';
const QUOTE_CAP = 120;
const EVIDENCE_ITEMS = 5;
const PREFILL_TEXT_CAP = 600;

// The NA a DC indicator can carry (the DC returns "NA" when what it looks for did not come up, e.g. C2 with no
// wrong answer). Combined indicators use their own NA options (v6.NA_OPTIONS).
const DC_NA_OPTION = { id: 'NA', title: 'N/A · Did not come up', description: 'What this indicator looks for did not come up in the lesson.' };

// Validation messages. Urdu lives in observe-strings.js (v6_* keys, DRAFT for native review).
const MSG_EN = {
  v6_choose_level: 'Choose a level.',
  v6_write_why: 'Write why you chose this level (at least 20 characters).',
  v6_check_numbers: 'Check the two numbers.',
  v6_d2_mismatch: "Your level doesn't match the counts. Change one, or say why.",
  v6_change_why: 'You changed a level Rumi set. Write why (at least 20 characters).',
  v6_fix_heading: 'Please fix these before you go on:',
};

const LETTERS = ['C', 'D', 'F'];

// ── Which visits are v6 ─────────────────────────────────────────────────────

/**
 * The framework a NEW /observe visit is stamped with: 'fico17_v6' when this is a FICO deployment and the coach
 * switch says v6 for this coach, else null (no stamp: today's V3). Never throws.
 */
// /observe's v6 path is held behind its own readiness flag as well as the coach switch, because the coach switch
// also moves /observe2, and /observe on v6 still lacks (11 Nov): the teacher report and debrief for a v6 visit (the
// report dispatcher has no fico17_v6 transformer) and the exclusion of v6 rows from the FICO averages the portal and
// dashboards read (getOverall and its callers). Until those land, OBSERVE_FICO17_V6_READY stays unset and flipping
// fico_coach_rubric to v6 moves /observe2 only. Set it to 'true' (staging first) once they ship.
const READY_ENV = 'OBSERVE_FICO17_V6_READY';
const isReady = () => process.env[READY_ENV] === 'true';

async function decideVisitFramework({ userId, region } = {}) {
  if (process.env.OBSERVE_FRAMEWORK !== 'fico') return null;
  if (!isReady()) return null;
  try {
    const { coachRubric } = require('../coaching/fico-rubric-switch');
    return (await coachRubric({ userId, region })) === 'v6' ? V6 : null;
  } catch (_) {
    return null;
  }
}

/** 'fico17_v6' when a session row (or its analysis) carries the v6 stamp, else null. */
function visitFramework(session) {
  if (!session || typeof session !== 'object') return null;
  if (session.framework === V6) return V6;
  if (session.analysis_data && session.analysis_data.framework === V6) return V6;
  return null;
}

/**
 * For the analysis step: the framework key a leader observation must be analysed with because of its stamp, or null
 * to select as today. Only /observe visits; a self-recording never carries this stamp.
 */
function frameworkKeyForSession(session) {
  return session && session.observation_type === 'leader_observation' && session.framework === V6 ? V6 : null;
}

function isV6Analysis(analysis) { return !!analysis && analysis.framework === V6; }

// ── Options and Rumi's levels ───────────────────────────────────────────────

/** The level options a code offers on the v6 review Flow. */
function optionsFor(code) {
  if (v6.isCombined(code)) return v6.levelOptions(code);
  const opts = v6.levelOptions(code, { couldntTell: true });
  const ie = opts.pop(); // "Couldn't tell" stays last
  return [...opts, DC_NA_OPTION, ie];
}

const optionIds = (code) => optionsFor(code).map((o) => o.id);

function v6Row(analysis, code) {
  const dom = ((analysis || {}).domains || {})[v6.DOMAIN_OF[code]];
  return ((dom && dom.indicators) || []).find((i) => i && i.id === code) || null;
}

/** Rumi's level for a DC code: 1-4, 'NA', 'IE', or null when the analysis has none. */
function rumiLevel(analysis, code) {
  const lv = ((analysis || {}).levels || {})[code];
  if (lv && lv.result !== undefined) return v6.normLevel(lv.result);
  const row = v6Row(analysis, code);
  if (row) return v6.normLevel(row.result !== undefined ? row.result : row.score);
  return null;
}

/** The option a DC radio is pre-filled with: Rumi's level, or "Couldn't tell" when Rumi has none. */
function prefillLevel(analysis, code) {
  const r = rumiLevel(analysis, code);
  return r === null ? 'IE' : String(r);
}

function clipWords(s, n) {
  const chars = Array.from(String(s || ''));
  if (chars.length <= n) return chars.join('');
  const head = chars.slice(0, n - 1).join('');
  const sp = head.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? head.slice(0, sp) : head).trimEnd()}…`;
}

function rumiEvidenceText(analysis, code) {
  const lv = ((analysis || {}).levels || {})[code] || {};
  const row = v6Row(analysis, code) || {};
  const parts = [];
  const because = lv.because || row.evidence_summary || row.evidence || '';
  if (because) parts.push(String(because));
  const ev = Array.isArray(lv.evidence) ? lv.evidence[0] : null;
  if (ev && ev.quote) parts.push(`${ev.time ? `${ev.time} ` : ''}"${clipWords(ev.quote, QUOTE_CAP)}"`);
  return clipWords(parts.join(' · '), PREFILL_TEXT_CAP);
}

/** The text above a combined indicator's choice: definition, the DC's evidence, what the coach adds. */
function combinedBody(analysis, code) {
  const ind = v6.indicator(code);
  const ce = ((analysis || {}).combined_evidence || {})[code] || {};
  const lines = [ind.definition || ''];
  lines.push('');
  if (code === 'D2') {
    const a = ce.student_turns_first_half;
    const b = ce.student_turns_second_half;
    lines.push(Number.isFinite(a) && Number.isFinite(b)
      ? `The recording has ${a} student turns in the first half and ${b} in the second. It cannot tell how many different children spoke.`
      : 'The recording showed nothing for this.');
  } else if (ce.result === 'IE') {
    lines.push("The recording couldn't show this. Set the level from what you saw.");
  } else if (ce.result === 'NA') {
    lines.push('The recording found no child-to-child talk.');
  } else {
    const items = (Array.isArray(ce.items) ? ce.items : []).filter((i) => i && i.quote).slice(0, EVIDENCE_ITEMS);
    if (!items.length) lines.push('The recording showed nothing for this.');
    else items.forEach((i) => lines.push(`${i.time || '--:--'}  "${clipWords(i.quote, QUOTE_CAP)}"`));
  }
  lines.push('');
  lines.push(`Coach adds: ${ind.coach_adds || ''}`);
  return lines.join('\n');
}

// ── The screens ─────────────────────────────────────────────────────────────

const letterOf = (screenId) => String(screenId || '').slice(-1);
const codesOn = (letter) => ((v6.SECTIONS[letter] || {}).codes || []).slice();

/**
 * ${data.*} for one v6 C/D/F screen. `edits` (the coach's submitted values) and `errors` are passed when the same
 * screen is served again after a refused submit, so what the coach typed is kept and the reasons are listed.
 */
function buildScreenPrefill(analysis, letter, { edits = null, errors = null, S = MSG_EN } = {}) {
  const data = {};
  const e = edits || {};
  for (const code of codesOn(letter)) {
    if (v6.isCombined(code)) {
      data[`cb_${code}`] = combinedBody(analysis, code);
      data[`w_${code}`] = typeof e[`why_${code}`] === 'string' ? e[`why_${code}`] : '';
    } else {
      const submitted = e[`r_${code}`];
      data[`s_${code}`] = submitted && optionIds(code).includes(String(submitted)) ? String(submitted) : prefillLevel(analysis, code);
      data[`e_${code}`] = typeof e[`ev_${code}`] === 'string' ? e[`ev_${code}`] : rumiEvidenceText(analysis, code);
      const row = v6Row(analysis, code) || {};
      data[`i_${code}`] = typeof e[`imp_${code}`] === 'string' ? e[`imp_${code}`] : clipWords(row.improvement || '', PREFILL_TEXT_CAP);
    }
  }
  data[`wc_${letter}`] = typeof e[`chg_${letter}`] === 'string' ? e[`chg_${letter}`] : '';
  const list = errors ? Object.values(errors) : [];
  data.err_v = list.length > 0;
  data.err_note = list.length ? [S.v6_fix_heading || MSG_EN.v6_fix_heading, ...list.map((m) => `• ${m}`)].join('\n') : '';
  return data;
}

function wholeNumber(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** D2's level from the two counts (spec §7.4). */
function d2Expected(children, quietLater) {
  if (children === 0) return 1;
  if (children <= 2) return 2;
  if (children <= 5) return 3;
  return quietLater >= 2 ? 4 : 3;
}

/**
 * The reasons a v6 screen submit is refused, as { field: message }; {} when it may go on.
 * Combined: a level and a reason ≥ 20 characters (D2: valid counts; a level off the counts needs a number in the
 * reason). DC: changing a level Rumi set needs the screen's "Why you changed" (≥ 20 characters).
 */
function validateScreen(screenId, data = {}, analysis = {}, S = MSG_EN) {
  const letter = letterOf(screenId);
  const errors = {};
  let changed = false;
  for (const code of codesOn(letter)) {
    const level = data[`r_${code}`] === undefined || data[`r_${code}`] === null ? '' : String(data[`r_${code}`]);
    if (v6.isCombined(code)) {
      if (!optionIds(code).includes(level)) errors[`r_${code}`] = `${v6.indicator(code).name}: ${S.v6_choose_level}`;
      const why = data[`why_${code}`];
      if (!v6.isJustified(why)) errors[`why_${code}`] = `${v6.indicator(code).name}: ${S.v6_write_why}`;
      if (code === 'D2') {
        const n = wholeNumber(data.d2_children);
        const q = wholeNumber(data.d2_quiet_later);
        if (n === null || q === null || q > n) {
          errors.d2_children = `${v6.indicator('D2').name}: ${S.v6_check_numbers}`;
        } else if (/^[1-4]$/.test(level) && Number(level) !== d2Expected(n, q) && !/\d/.test(String(why || ''))) {
          errors.why_D2 = `${v6.indicator('D2').name}: ${S.v6_d2_mismatch}`;
        }
      }
    } else {
      const rumi = rumiLevel(analysis, code);
      if (rumi !== null && level !== '' && level !== String(rumi)) changed = true;
    }
  }
  if (changed && !v6.isJustified(data[`chg_${letter}`])) errors[`chg_${letter}`] = S.v6_change_why;
  return errors;
}

const trimOrNull = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);

/**
 * The coach's review of a v6 visit as stored: every one of the 17 levels with who set it, the reason, and the
 * rubric/prompt_version it was scored against; D2's counts; v6 totals (never mixed with V3).
 */
function buildReview(analysis = {}, edits = {}) {
  const dcVersion = (analysis && analysis.prompt_version) || v6.DC_PROMPT_VERSION;
  const levels = {};
  for (const code of v6.CODES) {
    const letter = code[0];
    const raw = edits[`r_${code}`];
    const submitted = raw === undefined || raw === null || raw === '' ? null : v6.normLevel(raw);
    if (v6.isCombined(code)) {
      const ce = ((analysis || {}).combined_evidence || {})[code] || {};
      levels[code] = {
        level: submitted,
        set_by: 'coach',
        because: trimOrNull(edits[`why_${code}`]),
        dc_result: ce.result === undefined ? null : ce.result,
        dc_evidence_count: Array.isArray(ce.items) ? ce.items.length : 0,
        rubric: V6,
        prompt_version: v6.COACH_PROMPT_VERSION,
      };
    } else {
      const rumi = rumiLevel(analysis, code);
      const level = submitted === null ? rumi : submitted;
      const byCoach = level !== rumi && level !== null;
      const lv = ((analysis || {}).levels || {})[code] || {};
      levels[code] = {
        level,
        set_by: byCoach ? 'coach' : 'rumi',
        because: byCoach ? trimOrNull(edits[`chg_${letter}`]) : (trimOrNull(lv.because) || null),
        rumi_level: rumi,
        rubric: V6,
        prompt_version: dcVersion,
      };
    }
  }
  const n = wholeNumber(edits.d2_children);
  const q = wholeNumber(edits.d2_quiet_later);
  const changeReasons = {};
  LETTERS.forEach((l) => { const t = trimOrNull(edits[`chg_${l}`]); if (t) changeReasons[l] = t; });
  return {
    rubric: V6,
    prompt_version: dcVersion,
    coach_prompt_version: v6.COACH_PROMPT_VERSION,
    levels,
    d2_counts: n === null || q === null ? null : { children: n, quiet_later: q },
    change_reasons: changeReasons,
    totals: v6.totals(levels),
  };
}

/**
 * Fold a review into the v2 analysis: the v6 domains' rows take the final levels (and the coach's evidence/improve
 * text), the review is kept whole under fico17_v6_review, and the scores are the v6 totals only.
 * Returns { rescored, textChanged }.
 */
function applyReview(v2, review, edits = {}, v1 = null) {
  let rescored = 0;
  let textChanged = 0;
  v2.rubric = V6;
  v2.framework = V6;
  v2.domains = v2.domains || {};
  for (const section of Object.values(v6.SECTIONS)) {
    const dom = v2.domains[section.domain] || (v2.domains[section.domain] = { indicators: [] });
    dom.indicators = dom.indicators || [];
    for (const code of section.codes) {
      let row = dom.indicators.find((i) => i && i.id === code);
      if (!row) { row = { id: code, name: v6.indicator(code).name }; dom.indicators.push(row); }
      const final = review.levels[code];
      const before = row.result !== undefined ? v6.normLevel(row.result) : v6.normLevel(row.score);
      if (final.level !== before) rescored += 1;
      row.result = final.level;
      row.score = typeof final.level === 'number' ? final.level : null;
      row.applicable = final.level !== 'NA';
      row.set_by = final.set_by;
      if (final.because) row.because = final.because;
      for (const [prefix, field] of [['ev_', 'evidence_sw'], ['imp_', 'improvement_sw']]) {
        const val = edits[`${prefix}${code}`];
        if (typeof val !== 'string') continue;
        const orig = String(((v1 && v6Row(v1, code)) || {})[field] || '');
        if (val !== orig) { row[field] = val; textChanged += 1; }
      }
    }
  }
  v2.fico17_v6_review = { ...review, reviewed_at: new Date().toISOString() };
  v2.scores = {
    ...(v2.scores || {}),
    overall_marks: review.totals.marks,
    overall_max_marks: review.totals.max,
    overall_percentage: review.totals.percentage,
    indicators_counted: review.totals.counted,
    rubric: V6,
  };
  return { rescored, textChanged };
}

/** Validation messages in the coach's language (Urdu from observe-strings, else English). */
function messages(lang) {
  try {
    const { observeStrings } = require('./observe-strings');
    const S = observeStrings(lang) || {};
    const out = {};
    Object.keys(MSG_EN).forEach((k) => { out[k] = S[k] || MSG_EN[k]; });
    return out;
  } catch (_) {
    return { ...MSG_EN };
  }
}

module.exports = {
  READY_ENV, isReady,
  V6, FLOW_ID_ENV, MSG_EN, DC_NA_OPTION, LETTERS,
  decideVisitFramework, visitFramework, frameworkKeyForSession, isV6Analysis,
  optionsFor, rumiLevel, prefillLevel, combinedBody, buildScreenPrefill, validateScreen, d2Expected,
  buildReview, applyReview, messages,
};
