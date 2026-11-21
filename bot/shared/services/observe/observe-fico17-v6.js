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
 *   at least 20 characters. D2's levels are in words, not counts (bd-ra8xu.61): an old form that still sends D2's two
 *   counts has them checked for sense and stored, and never checked against the level. The DC's evidence for each is
 *   shown above the choice.
 * - The 11 DC indicators: Rumi's level is pre-filled from the v6 analysis of the recording; a coach who changes any
 *   level on a screen writes why in that screen's "Why you changed" box (operator Q2-B, 11 Nov).
 * - N/A (approved 19 Nov): offered only on C2 C3 C5 D4, each with its own words (fico17_v6.na.json).
 *   C2 arrives on N/A when Rumi heard no wrong answer (Rumi's choice: changing it needs the reason); C3 and D4 arrive
 *   on N/A when the coach set C1 to 1 (her choice decides, never the DC's). An N/A needs no 20-character reason.
 * - Lesson-plan fidelity (screen B) is the measured fidelity exactly as V3 edits it; it is not one of the 17.
 * Every stored level carries rubric + prompt_version + set_by ('coach' | 'rumi'). v6 totals never mix with V3.
 */

const v6 = require('../coaching/frameworks/fico17-v6');

const V6 = v6.RUBRIC_KEY; // 'fico17_v6'
const FLOW_ID_ENV = 'OBSERVE_FICO17_V6_FLOW_ID';
const QUOTE_CAP = 120;
const EVIDENCE_ITEMS = 5;
const PREFILL_TEXT_CAP = 600;

// Validation messages. Urdu lives in observe-strings.js (v6_* keys, DRAFT for native review).
const MSG_EN = {
  v6_choose_level: 'Choose a level.',
  v6_write_why: 'Write why you chose this level (at least 20 characters).',
  v6_check_numbers: 'Check the two numbers.',
  v6_change_why: 'You changed the level from the recording. Write why (at least 20 characters).',
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

// `lessonIsPrimary` (bd-pni007): true when the coach named this lesson's class as grades 1-5 (obs612 switch on).
// That answer decides the grades 1-5 gate instead of the teacher's profile. Absent: the profile, exactly as before.
// `schoolExtId` (bd-hk2jm3): the school the coach picked, for the visit's region (below).
async function decideVisitFramework({ userId, region, teacherUserId = null, lessonIsPrimary, schoolExtId = null } = {}) {
  if (process.env.OBSERVE_FRAMEWORK !== 'fico') return null;
  if (!isReady()) return null;
  try {
    const { coachRubric } = require('../coaching/fico-rubric-switch');
    if ((await coachRubric({ userId, region })) !== 'v6') return null;
    if (lessonIsPrimary === true) return V6;
    // bd-hk2jm3 (operator 17 Nov ~15:15: "for Gilgit Baltistan, it's gonna be the same Fico one ... for HITL, it's
    // supposed to be V6"): FDE's grades 6-8 are ICT's only, so a GB visit has no FDE grades and v6 reaches every grade,
    // a teacher of unknown level and an unbound capture included. Only a positive GB answer widens it.
    const { isGbVisit } = require('../coaching/fde-region');
    if (await isGbVisit({ observer: { id: userId, ...(region !== undefined ? { region } : {}) }, teacherUserId, schoolExtId })) return V6;
    // bd-ra8xu.42: grades 1-5 only (operator 11 Nov ~18:05). A grades 6-12 teacher, an unknown level or an unbound
    // capture stays V3 until FDE's 6-12 rubric lands (#94).
    const { isPrimaryVisit } = require('../coaching/fico-visit-grade');
    return (await isPrimaryVisit(teacherUserId)) ? V6 : null;
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
/**
 * Queue #184 — the v6 scorer for a stamped v6 visit: the starred variant (the six never sent to the DC) when
 * app_settings.fico_v6_starred is on for the observer, else today's. Never throws: today's on any failure.
 */
async function v6FrameworkFor(session) {
  const fw = require('../coaching/frameworks/fico17-v6-framework');
  try {
    const userId = (session && (session.observer_user_id || session.user_id)) || null;
    const sw = require('../coaching/fico-rubric-switch');
    if (userId && typeof sw.v6Starred === 'function' && (await sw.v6Starred({ userId }))) return fw.starredVariant();
  } catch (_) { /* today's */ }
  return fw;
}

function frameworkKeyForSession(session) {
  return session && session.observation_type === 'leader_observation' && session.framework === V6 ? V6 : null;
}

function isV6Analysis(analysis) { return !!analysis && analysis.framework === V6; }

// ── Options and Rumi's levels ───────────────────────────────────────────────

/**
 * The level options a coach is offered for one indicator, on every coach path (/observe, /observe2, portal), operator
 * 13 Nov: each level's name with the rubric sheet's text under it (v6.coachLevelOptions), in the coach's language, and
 * N/A with the indicator's own words where the approved table allows it (19 Nov: C2 C3 C5 D4). No Couldn't tell.
 * `keep`: a value an OLD review saved ('NA' / 'IE') on an indicator that no longer offers it, added back at the end
 * so that review still shows its choice; nothing new offers it.
 */
function optionsFor(code, { keep = null, lang = 'en' } = {}) {
  const out = v6.coachLevelOptions(code, lang);
  if (keep === 'NA') {
    if (!out.some((o) => o.id === 'NA')) out.push(v6.legacyNaOption(lang));
  } else if (keep === 'IE') {
    out.push({ id: 'IE', title: "Couldn't tell", description: v6.clip(`Use when ${v6.indicator(code).couldnt_tell}`, 300) });
  }
  return out;
}

const COACH_IDS = ['1', '2', '3', '4'];
// What the old 5-screen Flow (and an old portal review) could send: 1-4, N/A, Couldn't tell. Accepted, never offered.
const LEGACY_IDS = ['1', '2', '3', '4', 'NA', 'IE'];

function v6Row(analysis, code) {
  const dom = ((analysis || {}).domains || {})[v6.DOMAIN_OF[code]];
  return ((dom && dom.indicators) || []).find((i) => i && i.id === code) || null;
}

/** Rumi's level for a DC code: 1-4, 'NA', 'IE', or null when the analysis has none. */
function rumiLevel(analysis, code) {
  // Design rule (bd-ra8xu.44): Rumi never has a level for the six combined indicators, whatever an analysis carries.
  if (v6.isCombined(code)) return null;
  const lv = ((analysis || {}).levels || {})[code];
  if (lv && lv.result !== undefined) return v6.normLevel(lv.result);
  const row = v6Row(analysis, code);
  if (row) return v6.normLevel(row.result !== undefined ? row.result : row.score);
  return null;
}

/** Rumi's level when it is a number 1-4; null for none, N/A or Couldn't tell. */
function rumiNumeric(analysis, code) {
  const r = rumiLevel(analysis, code);
  return typeof r === 'number' ? r : null;
}

/**
 * Rumi's CHOICE on one of the 11, as the coach is shown it: 1-4, or 'NA' where the indicator offers N/A (C2, queue
 * #128); null for none or Couldn't tell, and for an N/A on an indicator that no longer offers one (the coach then sets
 * it). Changing Rumi's choice needs a reason; setting one where Rumi had none does not.
 */
function rumiChoice(analysis, code) {
  const r = rumiLevel(analysis, code);
  if (typeof r === 'number') return r;
  return r === 'NA' && v6.naAllowed(code) ? 'NA' : null;
}

/** The option a DC radio is pre-filled with: Rumi's choice (1-4, or N/A on C2), or blank when Rumi has none. */
function prefillLevel(analysis, code) {
  const r = rumiChoice(analysis, code);
  return r === null ? '' : String(r);
}

/**
 * The N/A a coach-set indicator arrives on because of another indicator: C3 and D4 when C1 is level 1 ("no question
 * for the children to answer"). C1 is the coach's own answer when she has given one, else Rumi's pre-fill (what her
 * C1 screen showed). Never the DC's say on C3/D4 themselves: those six are the coach's (bd-ra8xu.44).
 */
function followsNa(analysis, code, edits = {}) {
  const f = v6.naFollows(code);
  if (!f) return false;
  const mine = edits[`r_${f.code}`];
  const level = mine !== undefined && mine !== null && String(mine) !== '' ? v6.normLevel(mine) : rumiChoice(analysis, f.code);
  return level === f.level;
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
  // bd-ra8xu.46: once reviewed, row.evidence is the coach's text and Rumi's own sits in row.rumi_evidence.
  const rowRumi = row.rumi_evidence !== undefined ? row.rumi_evidence : (row.evidence_summary || row.evidence);
  const because = lv.because || rowRumi || '';
  if (because) parts.push(String(because));
  const ev = Array.isArray(lv.evidence) ? lv.evidence[0] : null;
  if (ev && ev.quote) parts.push(`${ev.time ? `${ev.time} ` : ''}"${clipWords(ev.quote, QUOTE_CAP)}"`);
  return clipWords(parts.join(' · '), PREFILL_TEXT_CAP);
}

// ── Evidence option B (bd-o15qnr.32, #204; locked by #188 21 Nov ~10:05) ───
// The v7 form shows Rumi's evidence for each of the 11 as a summary line and its {time, quote} rows; the coach keeps,
// edits or removes each row, adds her own lines and edits the summary. What she did is saved per indicator as
// row.evidence_review, beside the row; ev_<code> is still the text the report, the debrief guide and WhatsApp read.

const EVIDENCE_REVIEW_LIMITS = Object.freeze({ text: 1000, items: 30, scan: 200 });
const EVIDENCE_STATUSES = ['kept', 'removed', 'edited'];
const EVIDENCE_TIME_RX = /^\d{1,3}:\d{2}(:\d{2})?$/;
const isPlainObject = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const nonBlank = (s) => typeof s === 'string' && s.trim() !== '';

/**
 * Rumi's structured evidence for one of the 11, as the v7 form shows it: { because, items: [{ time, quote }] }, every
 * quote in full and in order; null when Rumi gave nothing. levels[code] first; else the row: its evidence_items
 * (rumi_evidence_items once a review has moved them there) and its because, unless the coach's review has put her
 * change reason in that field (set_by 'coach').
 */
function rumiEvidenceOf(analysis, code) {
  if (!v6.isDc(code)) return null;
  const lv = ((analysis || {}).levels || {})[code];
  const lvOk = isPlainObject(lv);
  const row = v6Row(analysis, code) || {};
  let because = lvOk && nonBlank(lv.because) ? lv.because.trim() : null;
  if (!because && row.set_by !== 'coach' && nonBlank(row.because)) because = row.because.trim();
  let list = lvOk && Array.isArray(lv.evidence) && lv.evidence.length ? lv.evidence : null;
  if (!list) list = Array.isArray(row.rumi_evidence_items) ? row.rumi_evidence_items : (Array.isArray(row.evidence_items) ? row.evidence_items : []);
  const items = list
    .filter((i) => isPlainObject(i) && nonBlank(i.quote))
    .map((i) => ({ time: nonBlank(i.time) ? i.time.trim() : null, quote: i.quote.trim() }));
  return because || items.length ? { because, items } : null;
}

const capText = (s) => s.trim().slice(0, EVIDENCE_REVIEW_LIMITS.text);
// An optional time: kept when it reads as a lesson time (mm:ss, or h:mm:ss), else dropped to null.
const reviewTime = (t) => (typeof t === 'string' && EVIDENCE_TIME_RX.test(t.trim()) ? t.trim() : null);

/** One row of a review, as stored; null for a row that is not one (it is dropped). */
function reviewItem(it) {
  if (!isPlainObject(it)) return null;
  if (it.source === 'rumi') {
    if (!nonBlank(it.quote) || !EVIDENCE_STATUSES.includes(it.status)) return null;
    const out = { source: 'rumi', time: reviewTime(it.time), quote: capText(it.quote), status: it.status };
    if (it.status === 'edited') {
      if (!nonBlank(it.coach_text)) return null;
      out.coach_text = capText(it.coach_text);
    }
    return out;
  }
  if (it.source === 'coach') {
    if (!nonBlank(it.text)) return null;
    return { source: 'coach', time: reviewTime(it.time), text: capText(it.text) };
  }
  return null;
}

/** One indicator's review, as stored: { summary: { rumi, coach }, items }; null when nothing in it is usable. */
function reviewEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const s = isPlainObject(entry.summary) ? entry.summary : {};
  const summary = {
    rumi: typeof s.rumi === 'string' ? capText(s.rumi) : '',
    coach: typeof s.coach === 'string' ? capText(s.coach) : '',
  };
  const items = [];
  const raw = Array.isArray(entry.items) ? entry.items.slice(0, EVIDENCE_REVIEW_LIMITS.scan) : [];
  for (const it of raw) {
    if (items.length >= EVIDENCE_REVIEW_LIMITS.items) break;
    const one = reviewItem(it);
    if (one) items.push(one);
  }
  return summary.rumi || summary.coach || items.length ? { summary, items } : null;
}

/**
 * The portal's evidence_review ({ [code]: EvidenceReview }) checked strictly: the 11 DC codes only, strings only,
 * texts capped, at most 30 rows an indicator, the status enum; anything else is dropped. null when nothing is left,
 * and on any surprise: a bad shape never stops the save of the edits beside it. Pure; never throws.
 */
function sanitizeEvidenceReview(input) {
  try {
    if (!isPlainObject(input)) return null;
    const out = {};
    for (const code of Object.keys(input)) {
      if (!v6.isDc(code)) continue;
      const entry = reviewEntry(input[code]);
      if (entry) out[code] = entry;
    }
    return Object.keys(out).length ? out : null;
  } catch (_) {
    return null;
  }
}

/** The coach's saved review of one indicator's evidence (row.evidence_review), checked again on the way out; or null. */
function savedEvidenceReview(analysis, code) {
  if (!v6.isDc(code)) return null;
  try {
    return reviewEntry((v6Row(analysis, code) || {}).evidence_review);
  } catch (_) {
    return null;
  }
}

/** The text above a combined indicator's choice: definition, the DC's evidence, what the coach adds. */
// Queue #184: an analysis made in starred mode names the indicators it never asked (analysis.starred).
const starredIn = (analysis, code) => Array.isArray((analysis || {}).starred) && analysis.starred.includes(code);

function combinedBody(analysis, code) {
  const ind = v6.indicator(code);
  const ce = ((analysis || {}).combined_evidence || {})[code] || {};
  const lines = [ind.definition || ''];
  lines.push('');
  if (starredIn(analysis, code)) {
    lines.push('★ Starred: yours alone. The NIETE Teaching Assistant does not listen for this one; set the level from what you saw.');
  } else if (code === 'D2') {
    const a = ce.student_turns_first_half;
    const b = ce.student_turns_second_half;
    lines.push(Number.isFinite(a) && Number.isFinite(b)
      ? `The recording has ${a} student turns in the first half and ${b} in the second. It cannot tell how many different children spoke.`
      : 'The recording showed nothing for this.');
  } else if (ce.result === 'IE') {
    lines.push("The recording couldn't show this. Set the level from what you saw.");
  } else if (ce.result === 'NA') {
    lines.push(v6.naAllowed(code) ? v6.naSentence(code, 'en', { by: 'dc' }) : 'The recording did not find this in the lesson.');
  } else {
    const items = (Array.isArray(ce.items) ? ce.items : []).filter((i) => i && i.quote).slice(0, EVIDENCE_ITEMS);
    if (!items.length) lines.push('The recording showed nothing for this.');
    else items.forEach((i) => lines.push(`${i.time || '--:--'}  "${clipWords(i.quote, QUOTE_CAP)}"`));
  }
  lines.push('');
  lines.push(`Coach adds: ${ind.coach_adds || ''}`);
  return lines.join('\n');
}

// The rubric's closing sentence on each of the six's "coach adds" (EN and UR): the portal drops it (bd-o15qnr.36).
const JUSTIFICATION_SENTENCE = /\s*(?:The coach sets the final level with a written justification\.?|کوچ تحریری وجہ کے ساتھ آخری لیول طے کرتا ہے۔?)\s*/g;

/**
 * bd-o15qnr.36 (#204, the operator 21 Nov ~14:20) — one of the six's "From the recording" as parts, for the portal's
 * v7 form (additive beside `body`, which older portals and the WhatsApp Flow keep reading). In the person's language:
 *   lookFor  the indicator's definition
 *   state    'found' | 'none' | 'ie' | 'na' | 'starred' | 'd2'
 *   found    every snippet the recording did find, [{ time, quote }] (as many and as clipped as the body's)
 *   naText   the indicator's own N/A words (state 'na'), else null
 *   turns    D2's { first, second } student turns (state 'd2'), else null
 *   youAdd   what the person adds, without the rubric's "The coach sets the final level with a written justification."
 */
function combinedParts(analysis, code, lang = 'en') {
  const text = v6.indicatorText(code, lang) || {};
  const ce = ((analysis || {}).combined_evidence || {})[code] || {};
  const out = {
    lookFor: text.definition || '',
    state: 'none',
    found: [],
    naText: null,
    turns: null,
    youAdd: String(text.coach_adds || '').replace(JUSTIFICATION_SENTENCE, ' ').replace(/\s+/g, ' ').trim(),
  };
  if (starredIn(analysis, code)) return { ...out, state: 'starred' };
  if (code === 'D2') {
    const a = ce.student_turns_first_half;
    const b = ce.student_turns_second_half;
    return Number.isFinite(a) && Number.isFinite(b) ? { ...out, state: 'd2', turns: { first: a, second: b } } : out;
  }
  if (ce.result === 'IE') return { ...out, state: 'ie' };
  if (ce.result === 'NA') return { ...out, state: 'na', naText: v6.naAllowed(code) ? v6.naSentence(code, lang, { by: 'dc' }) : null };
  const found = (Array.isArray(ce.items) ? ce.items : []).filter((i) => i && i.quote).slice(0, EVIDENCE_ITEMS)
    .map((i) => ({ time: i.time || null, quote: clipWords(i.quote, QUOTE_CAP) }));
  return found.length ? { ...out, state: 'found', found } : out;
}

// ── The screens ─────────────────────────────────────────────────────────────

const letterOf = (screenId) => String(screenId || '').slice(-1);
const codesOn = (letter) => ((v6.SECTIONS[letter] || {}).codes || []).slice();

// ── The coach form, one indicator per screen (operator 13 Nov) ───────────────
// DOMAIN_B (lesson-plan fidelity, unchanged) → INTRO_C (no input) → IND_C_ONE … IND_C_EIGHT → INTRO_D → IND_D_ONE …
// → INTRO_F → … IND_F_FOUR (Submit) → SUCCESS: 21 form screens + SUCCESS = 22. Screen ids are letters and underscores
// only (Meta). Every word on an intro or indicator screen is screen data in the coach's language, so one Flow serves
// English and Urdu. The old 5-screen Flow's DOMAIN_C/D/F stay accepted (LEGACY_SCREENS) for a form opened before the
// republish.
const NUMBER_WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
const screenOf = (code) => {
  const letter = String(code || '')[0];
  const i = codesOn(letter).indexOf(code);
  return i < 0 ? null : `IND_${letter}_${NUMBER_WORDS[i]}`;
};
const SCREENS = ['DOMAIN_B', ...LETTERS.flatMap((l) => [`INTRO_${l}`, ...codesOn(l).map(screenOf)])];
// Posted by this Flow's Section B (v6f): a Section B without it is the old 5-screen Flow, which goes on to DOMAIN_C.
const FORM_VERSION = '2';
// bd-ra8xu.60: posted (as v6n) by the Section B of a review Flow whose section intros declare the Observation Notes
// fields (notes_v, notes_heading, notes). The endpoint keeps it with the coach's buffered answers.
const NOTES_FORM = '1';
const LEGACY_SCREENS = ['DOMAIN_B', ...LETTERS.map((l) => `DOMAIN_${l}`)];

/** What a v6 screen id is: { kind: 'b' | 'intro' | 'ind' | 'legacy' | null, letter?, code? }. */
function screenInfo(screenId) {
  const id = String(screenId || '');
  if (id === 'DOMAIN_B') return { kind: 'b' };
  let m = /^INTRO_([CDF])$/.exec(id);
  if (m) return { kind: 'intro', letter: m[1] };
  m = /^IND_([CDF])_([A-Z]+)$/.exec(id);
  if (m) {
    const code = codesOn(m[1])[NUMBER_WORDS.indexOf(m[2])];
    return code ? { kind: 'ind', letter: m[1], code } : { kind: null };
  }
  m = /^DOMAIN_([CDF])$/.exec(id);
  if (m) return { kind: 'legacy', letter: m[1] };
  return { kind: null };
}

/** The indicators a screen posts: one on an indicator screen, a section's on DOMAIN_C/D/F, none otherwise. */
function codesFor(screenId) {
  const info = screenInfo(screenId);
  if (info.kind === 'ind') return [info.code];
  if (info.kind === 'legacy') return codesOn(info.letter);
  return [];
}

/**
 * The screen after this one: the new path, or the old Flow's own next for its DOMAIN_C/D/F; 'SUCCESS' at the end.
 * `posted` is what the screen sent: Section B of the old Flow carries no v6f, and goes on to DOMAIN_C.
 */
function nextScreenOf(screenId, posted = null) {
  const info = screenInfo(screenId);
  const oldFlow = info.kind === 'legacy' || (info.kind === 'b' && posted && String(posted.v6f || '') !== FORM_VERSION);
  const list = oldFlow ? LEGACY_SCREENS : SCREENS;
  const i = list.indexOf(screenId);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : 'SUCCESS';
}

const isLastScreen = (screenId) => nextScreenOf(screenId) === 'SUCCESS';

// Urdu prose takes Urdu digits; a code or letter inside it is isolated so the RTL line cannot reorder it.
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const num = (n, lang) => (v6.langOf(lang) === 'ur' ? String(n).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]) : String(n));
const iso = (atom, lang) => (v6.langOf(lang) === 'ur' ? `⁦${atom}⁩` : String(atom));
const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));

function formStrings(lang) {
  try {
    const { observeStrings } = require('./observe-strings');
    return observeStrings(v6.langOf(lang));
  } catch (_) {
    return {};
  }
}

/** What the recording showed for a combined indicator, in the coach's language (D2: the student turns). */
function recordingText(analysis, code, lang, T) {
  const ce = ((analysis || {}).combined_evidence || {})[code] || {};
  if (starredIn(analysis, code)) return T.v6f_rec_starred || '★';
  if (code === 'D2') {
    const a = ce.student_turns_first_half;
    const b = ce.student_turns_second_half;
    return Number.isFinite(a) && Number.isFinite(b) ? fill(T.v6f_d2_turns, { a: num(a, lang), b: num(b, lang) }) : T.v6f_rec_nothing;
  }
  if (ce.result === 'IE') return T.v6f_rec_ie;
  // Per-indicator N/A (19 Nov): the DC's N/A in its own words for that indicator (C5: "No change of activity in this transcript.").
  if (ce.result === 'NA') return v6.naAllowed(code) ? v6.naSentence(code, lang, { by: 'dc' }) : T.v6f_rec_na;
  const items = (Array.isArray(ce.items) ? ce.items : []).filter((i) => i && i.quote).slice(0, EVIDENCE_ITEMS);
  if (!items.length) return T.v6f_rec_nothing;
  return items.map((i) => `${i.time || '--:--'}  "${clipWords(i.quote, QUOTE_CAP)}"`).join('\n');
}

/**
 * bd-ra8xu.58 — Section B's prefill (fr_k verdict, fe_k note) with the coach's own fid_r_k / fid_e_k laid over it, so
 * a reopened v6 form keeps what she set. Only keys the screen already carries are touched. Pure.
 */
function withSectionBAnswers(data, edits) {
  if (!data || !edits) return data;
  const out = { ...data };
  for (const [k, v] of Object.entries(edits)) {
    const m = /^fid_([re])_(\w+)$/.exec(k);
    if (!m || typeof v !== 'string') continue;
    const key = `f${m[1]}_${m[2]}`;
    if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = v;
  }
  return out;
}

/**
 * bd-ra8xu.58 — a refusal as the Form shows it under each field: { field: message }. The list at the top names the
 * indicator ("D2 · How many children spoke: Write why …"); under the field the indicator is plain, so the name goes.
 */
function fieldMessages(errors) {
  const out = {};
  for (const [field, msg] of Object.entries(errors || {})) out[field] = String(msg).replace(/^[^:\n]*:\s+/, '');
  return out;
}

/**
 * ${data.*} for an intro or indicator screen of the 22-screen form, in the coach's language. `edits` (what the coach
 * has submitted so far) and `errors` are passed when a refused screen is served again, so her answers are kept and
 * the reasons listed. Returns null for a screen this does not build (DOMAIN_B, an old DOMAIN_C/D/F).
 */
function screenData(analysis, screenId, { lang = 'en', edits = null, errors = null } = {}) {
  const info = screenInfo(screenId);
  const T = formStrings(lang);
  const e = edits || {};
  if (info.kind === 'intro') {
    const codes = codesOn(info.letter);
    const room = codes.filter((c) => v6.isCombined(c));
    const L = iso(info.letter, lang);
    const note = [];
    if (codes.length > room.length) note.push(fill(T.v6f_intro_rumi, { k: num(codes.length - room.length, lang) }));
    if (room.length) note.push(fill(T.v6f_intro_room, { m: num(room.length, lang) }));
    const intro = {
      heading: `${fill(T.v6f_section, { l: L })} · ${v6.sectionName(info.letter, lang)}`,
      count_line: fill(T.v6f_intro_count, { n: num(codes.length, lang) }),
      list: codes.map((c) => `${iso(c, lang)}  ${v6.indicatorText(c, lang).name}${v6.isCombined(c) ? `  ${T.v6f_room_tag}` : ''}`).join('\n'),
      note: note.join(' '),
      next_label: fill(T.v6f_start, { l: L }),
    };
    // bd-ra8xu.60: the coach's Observation Notes, word for word, at the top of every section intro. Only for a Flow
    // whose Section B said it declares them (v6n): Meta refuses data keys a published screen does not declare, so a
    // form on the Flow published before this change gets exactly the keys above.
    if (String(e.v6n || '') === NOTES_FORM) {
      const text = require('./observation-notes').introText(analysis, v6.langOf(lang));
      Object.assign(intro, { notes_v: !!text, notes_heading: T.v6f_notes_heading || '', notes: text });
    }
    return intro;
  }
  if (info.kind !== 'ind') return null;
  const { code, letter } = info;
  const codes = codesOn(letter);
  const text = v6.indicatorText(code, lang);
  const list = errors ? Object.values(errors) : [];
  const S = messages(lang);
  const submitted = e[`r_${code}`] !== undefined && e[`r_${code}`] !== null ? String(e[`r_${code}`]) : '';
  const data = {
    progress: fill(T.v6f_progress, { l: iso(letter, lang), i: num(codes.indexOf(code) + 1, lang), n: num(codes.length, lang) }),
    heading: `${iso(code, lang)} · ${text.name}`,
    definition: text.definition,
    err_v: list.length > 0,
    err_note: list.length ? [S.v6_fix_heading, ...list.map((m) => `• ${m}`)].join('\n') : '',
    // bd-ra8xu.58: the same refusals under their own fields (the Form's error-messages); {} when nothing is refused.
    error_messages: fieldMessages(errors),
    opts: optionsFor(code, { lang }),
    next_label: isLastScreen(screenId) ? T.v6f_submit : T.v6f_next,
  };
  const init = {};
  const ids = v6.coachIds(code);
  if (v6.isCombined(code)) {
    Object.assign(data, {
      lbl_level: T.v6f_level_room,
      from_rec: T.v6f_from_recording,
      evidence: recordingText(analysis, code, lang, T),
      coach_adds: `${T.v6f_coach_adds} ${text.coach_adds || ''}`.trim(),
      lbl_why: T.v6f_why,
      // The published Flow marks this box required, so an N/A still needs a word or two; a level needs 20+ characters.
      help_why: v6.naAllowed(code) ? (T.v6f_why_help_na || T.v6f_why_help) : T.v6f_why_help,
    });
    if (ids.includes(submitted)) init[`r_${code}`] = submitted;
    else if (followsNa(analysis, code, e)) {
      // C3 / D4 after C1 = 1: N/A arrives chosen, and the screen says why (under the definition: the Flow has no slot
      // of its own for it, and adding one would mean republishing the Flow).
      init[`r_${code}`] = 'NA';
      const note = v6.naFollowNote(code, lang);
      if (note) data.definition = `${data.definition}\n\n${String(note).replace(/\b([CDF]\d)\b/g, (m) => iso(m, lang))}`;
    }
    init[`why_${code}`] = typeof e[`why_${code}`] === 'string' ? e[`why_${code}`] : '';
  } else {
    const rumi = rumiChoice(analysis, code);
    const row = v6Row(analysis, code) || {};
    let rumiNote = T.v6f_rumi_none;
    if (rumi === 'NA') rumiNote = v6.naRumiNote(code, lang) || fill(T.v6f_rumi_chose, { level: v6.naOption(code, lang).title });
    else if (rumi !== null) rumiNote = fill(T.v6f_rumi_chose, { level: v6.levelName(rumi, lang) });
    Object.assign(data, {
      lbl_level: T.v6f_level,
      rumi_note: rumiNote,
      lbl_ev: T.v6f_evidence,
      help_ev: T.v6f_evidence_help,
      lbl_imp: T.v6f_improve,
      help_imp: T.v6f_improve_help,
      lbl_chg: T.v6f_change,
      help_chg: T.v6f_change_help,
    });
    const level = ids.includes(submitted) ? submitted : prefillLevel(analysis, code);
    if (level) init[`r_${code}`] = level;
    init[`ev_${code}`] = typeof e[`ev_${code}`] === 'string' ? e[`ev_${code}`] : rumiEvidenceText(analysis, code);
    init[`imp_${code}`] = typeof e[`imp_${code}`] === 'string' ? e[`imp_${code}`] : clipWords(row.improvement || '', PREFILL_TEXT_CAP);
    init[`chg_${code}`] = typeof e[`chg_${code}`] === 'string' ? e[`chg_${code}`] : '';
  }
  data.init = init;
  return data;
}

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
      data[`s_${code}`] = submitted && LEGACY_IDS.includes(String(submitted)) ? String(submitted) : prefillLevel(analysis, code);
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

/**
 * The reasons a v6 screen submit is refused, as { field: message }; {} when it may go on. `screenId` is one indicator's
 * screen (IND_C_ONE …), or a whole section (DOMAIN_C: the old 5-screen Flow, and the portal, which sends every level).
 * Combined: a level and a reason ≥ 20 characters; N/A (where the table offers it) needs no reason. DC: changing Rumi's
 * choice (1-4, or N/A on C2) needs a reason ≥ 20 characters, in chg_<code> on an indicator screen or chg_<letter> on a
 * section. A level where Rumi had none (or Couldn't tell) needs no change reason. An indicator screen accepts N/A only
 * where the table offers it (per-indicator N/A, 19 Nov). D2's two counts are checked for sense only when a form still
 * sends them (the old Flow); since bd-ra8xu.61 D2's levels are in words, so the level is never checked against them.
 */
function validateScreen(screenId, data = {}, analysis = {}, S = MSG_EN) {
  const info = screenInfo(screenId);
  const codes = codesFor(screenId);
  const perCode = info.kind === 'ind';
  const errors = {};
  let sectionChanged = false;
  for (const code of codes) {
    const allowed = perCode ? v6.coachIds(code) : LEGACY_IDS;
    const level = data[`r_${code}`] === undefined || data[`r_${code}`] === null ? '' : String(data[`r_${code}`]);
    const name = v6.indicator(code).name;
    if (v6.isCombined(code)) {
      if (!allowed.includes(level)) errors[`r_${code}`] = `${name}: ${S.v6_choose_level}`;
      const why = data[`why_${code}`];
      if (level !== 'NA' && !v6.isJustified(why)) errors[`why_${code}`] = `${name}: ${S.v6_write_why}`;
      if (code === 'D2' && data.d2_children !== undefined) {
        const n = wholeNumber(data.d2_children);
        const q = wholeNumber(data.d2_quiet_later);
        if (n === null || q === null || q > n) errors.d2_children = `${name}: ${S.v6_check_numbers}`;
      }
    } else {
      if (perCode && !allowed.includes(level)) errors[`r_${code}`] = `${name}: ${S.v6_choose_level}`;
      const rumi = rumiChoice(analysis, code);
      const changed = rumi !== null && level !== '' && level !== String(rumi);
      if (changed && perCode && !v6.isJustified(data[`chg_${code}`])) errors[`chg_${code}`] = S.v6_change_why;
      if (changed && !perCode) sectionChanged = true;
    }
  }
  if (sectionChanged && !v6.isJustified(data[`chg_${info.letter}`])) errors[`chg_${info.letter}`] = S.v6_change_why;
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
      // One indicator per screen (13 Nov): the reason is the indicator's own; a section's (old Flow, portal) otherwise.
      const reason = trimOrNull(edits[`chg_${code}`]) || trimOrNull(edits[`chg_${letter}`]);
      levels[code] = {
        level,
        set_by: byCoach ? 'coach' : 'rumi',
        because: byCoach ? reason : (trimOrNull(lv.because) || null),
        rumi_level: rumi,
        rubric: V6,
        prompt_version: dcVersion,
      };
    }
  }
  const n = wholeNumber(edits.d2_children);
  const q = wholeNumber(edits.d2_quiet_later);
  const changeReasons = {};
  [...LETTERS, ...v6.DC_CODES].forEach((k) => { const t = trimOrNull(edits[`chg_${k}`]); if (t) changeReasons[k] = t; });
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
  // bd-o15qnr.32: the portal's evidence review rides in `edits` (portal-observe saveDraft puts it there, checked; it is
  // checked again here). Absent or unusable: nothing below touches evidence_review, so the save is today's.
  const evidenceReviews = sanitizeEvidenceReview(edits && edits.evidence_review);
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
      // bd-ra8xu.46 (operator 11 Nov ~21:20 and ~21:30): the HITL report shows the evidence AS THE COACH SUBMITTED
      // IT, with the coach's level. A combined indicator's evidence is the coach's written justification (Rumi's
      // shows above the choice, read-only, as on /observe2). One of the 11 carries the text in its Evidence box as
      // submitted: Rumi's pre-filled text the coach kept, or the coach's edit. Rumi's own moves to rumi_evidence,
      // kept for calibration beside analysis_data.combined_evidence; nothing Rumi wrote that the coach did not see
      // (evidence_items) stays on the shown row.
      const ev = edits[`ev_${code}`];
      const coachText = v6.isCombined(code) ? (final.because || '') : (typeof ev === 'string' ? ev.trim() : null);
      if (coachText !== null) {
        const rumiText = rumiEvidenceText(v1 || v2, code);
        if (row.rumi_evidence === undefined) row.rumi_evidence = row.evidence || '';
        if (row.evidence_items !== undefined && row.rumi_evidence_items === undefined) row.rumi_evidence_items = row.evidence_items;
        delete row.evidence_items;
        row.evidence = coachText;
        row.evidence_summary = coachText;
        if (!v6.isCombined(code)) {
          row.evidence_sw = coachText; // the narrative reads evidence_sw first
          if (coachText !== rumiText.trim()) textChanged += 1;
        }
      }
      // bd-o15qnr.32: what the coach did with Rumi's evidence, beside the row (Rumi's list stays in rumi_evidence_items).
      if (evidenceReviews && evidenceReviews[code] && !v6.isCombined(code)) row.evidence_review = evidenceReviews[code];
      const imp = edits[`imp_${code}`];
      if (typeof imp === 'string') {
        const orig = String(((v1 && v6Row(v1, code)) || {}).improvement_sw || '');
        if (imp !== orig) { row.improvement_sw = imp; textChanged += 1; }
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
  V6, FLOW_ID_ENV, MSG_EN, LETTERS, SCREENS, LEGACY_SCREENS, COACH_IDS, LEGACY_IDS, FORM_VERSION, NOTES_FORM,
  decideVisitFramework, visitFramework, frameworkKeyForSession, isV6Analysis,
  optionsFor, rumiLevel, rumiNumeric, rumiChoice, followsNa, prefillLevel, combinedBody, combinedParts, recordingText, v6FrameworkFor, buildScreenPrefill, validateScreen,
  buildReview, applyReview, messages,
  screenOf, screenInfo, codesFor, nextScreenOf, isLastScreen, screenData,
  fieldMessages, withSectionBAnswers,
  EVIDENCE_REVIEW_LIMITS, rumiEvidenceOf, sanitizeEvidenceReview, savedEvidenceReview,
};
