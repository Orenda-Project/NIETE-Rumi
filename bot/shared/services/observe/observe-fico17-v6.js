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

// `lessonIsPrimary` (bd-pni007): true when the coach named this lesson's class as grades 1-5 (obs612 switch on).
// That answer decides the grades 1-5 gate instead of the teacher's profile. Absent: the profile, exactly as before.
async function decideVisitFramework({ userId, region, teacherUserId = null, lessonIsPrimary } = {}) {
  if (process.env.OBSERVE_FRAMEWORK !== 'fico') return null;
  if (!isReady()) return null;
  try {
    const { coachRubric } = require('../coaching/fico-rubric-switch');
    if ((await coachRubric({ userId, region })) !== 'v6') return null;
    if (lessonIsPrimary === true) return V6;
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
function frameworkKeyForSession(session) {
  return session && session.observation_type === 'leader_observation' && session.framework === V6 ? V6 : null;
}

function isV6Analysis(analysis) { return !!analysis && analysis.framework === V6; }

// ── Options and Rumi's levels ───────────────────────────────────────────────

/**
 * The level options a coach is offered for one indicator, on every coach path (/observe, /observe2, portal), operator
 * 13 Nov: 1-4 only, each the level's name with the rubric sheet's text under it (v6.coachLevelOptions), in the coach's
 * language. No N/A and no Couldn't tell. `keep`: a value an OLD review saved ('NA' / 'IE'), added back at the end so
 * that review still shows its choice; nothing new offers it.
 */
function optionsFor(code, { keep = null, lang = 'en' } = {}) {
  const out = v6.coachLevelOptions(code, lang);
  if (keep === 'NA') {
    const na = (v6.isCombined(code) && v6.NA_OPTIONS[code]) || DC_NA_OPTION;
    out.push({ id: 'NA', title: na.title, description: v6.clip(na.description, 300) });
  } else if (keep === 'IE') {
    out.push({ id: 'IE', title: "Couldn't tell", description: v6.clip(`Use when ${v6.indicator(code).couldnt_tell}`, 300) });
  }
  return out;
}

const COACH_IDS = ['1', '2', '3', '4'];
// What the old 5-screen Flow (and an old portal review) could send: 1-4, N/A, Couldn't tell. Accepted, never offered.
const LEGACY_IDS = ['1', '2', '3', '4', 'NA', 'IE'];
const optionIds = () => COACH_IDS;

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

/** Rumi's level when it is a number 1-4; null for none, N/A or Couldn't tell (the coach then sets it). */
function rumiNumeric(analysis, code) {
  const r = rumiLevel(analysis, code);
  return typeof r === 'number' ? r : null;
}

/** The option a DC radio is pre-filled with: Rumi's 1-4, or blank when Rumi has none (or N/A / Couldn't tell). */
function prefillLevel(analysis, code) {
  const r = rumiNumeric(analysis, code);
  return r === null ? '' : String(r);
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
  if (code === 'D2') {
    const a = ce.student_turns_first_half;
    const b = ce.student_turns_second_half;
    return Number.isFinite(a) && Number.isFinite(b) ? fill(T.v6f_d2_turns, { a: num(a, lang), b: num(b, lang) }) : T.v6f_rec_nothing;
  }
  if (ce.result === 'IE') return T.v6f_rec_ie;
  if (ce.result === 'NA') return T.v6f_rec_na;
  const items = (Array.isArray(ce.items) ? ce.items : []).filter((i) => i && i.quote).slice(0, EVIDENCE_ITEMS);
  if (!items.length) return T.v6f_rec_nothing;
  return items.map((i) => `${i.time || '--:--'}  "${clipWords(i.quote, QUOTE_CAP)}"`).join('\n');
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
    return {
      heading: `${fill(T.v6f_section, { l: L })} · ${v6.sectionName(info.letter, lang)}`,
      count_line: fill(T.v6f_intro_count, { n: num(codes.length, lang) }),
      list: codes.map((c) => `${iso(c, lang)}  ${v6.indicatorText(c, lang).name}${v6.isCombined(c) ? `  ${T.v6f_room_tag}` : ''}`).join('\n'),
      note: note.join(' '),
      next_label: fill(T.v6f_start, { l: L }),
    };
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
    opts: optionsFor(code, { lang }),
    next_label: isLastScreen(screenId) ? T.v6f_submit : T.v6f_next,
  };
  const init = {};
  if (v6.isCombined(code)) {
    Object.assign(data, {
      lbl_level: T.v6f_level_room,
      from_rec: T.v6f_from_recording,
      evidence: recordingText(analysis, code, lang, T),
      coach_adds: `${T.v6f_coach_adds} ${text.coach_adds || ''}`.trim(),
      lbl_why: T.v6f_why,
      help_why: T.v6f_why_help,
    });
    if (COACH_IDS.includes(submitted)) init[`r_${code}`] = submitted;
    init[`why_${code}`] = typeof e[`why_${code}`] === 'string' ? e[`why_${code}`] : '';
  } else {
    const rumi = rumiNumeric(analysis, code);
    const row = v6Row(analysis, code) || {};
    Object.assign(data, {
      lbl_level: T.v6f_level,
      rumi_note: rumi === null ? T.v6f_rumi_none : fill(T.v6f_rumi_chose, { level: v6.levelName(rumi, lang) }),
      lbl_ev: T.v6f_evidence,
      help_ev: T.v6f_evidence_help,
      lbl_imp: T.v6f_improve,
      help_imp: T.v6f_improve_help,
      lbl_chg: T.v6f_change,
      help_chg: T.v6f_change_help,
    });
    const level = COACH_IDS.includes(submitted) ? submitted : prefillLevel(analysis, code);
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

/** D2's level from the two counts (spec §7.4). */
function d2Expected(children, quietLater) {
  if (children === 0) return 1;
  if (children <= 2) return 2;
  if (children <= 5) return 3;
  return quietLater >= 2 ? 4 : 3;
}

/**
 * The reasons a v6 screen submit is refused, as { field: message }; {} when it may go on. `screenId` is one indicator's
 * screen (IND_C_ONE …), or a whole section (DOMAIN_C: the old 5-screen Flow, and the portal, which sends every level).
 * Combined: a level and a reason ≥ 20 characters. DC: changing a level Rumi set (a number 1-4) needs a reason ≥ 20
 * characters, in chg_<code> on an indicator screen or chg_<letter> on a section. A level where Rumi had none (or N/A
 * or Couldn't tell) needs no change reason. D2's two counts are checked only when a form still sends them (the old Flow).
 */
function validateScreen(screenId, data = {}, analysis = {}, S = MSG_EN) {
  const info = screenInfo(screenId);
  const codes = codesFor(screenId);
  const perCode = info.kind === 'ind';
  const allowed = perCode ? COACH_IDS : LEGACY_IDS;
  const errors = {};
  let sectionChanged = false;
  for (const code of codes) {
    const level = data[`r_${code}`] === undefined || data[`r_${code}`] === null ? '' : String(data[`r_${code}`]);
    const name = v6.indicator(code).name;
    if (v6.isCombined(code)) {
      if (!allowed.includes(level)) errors[`r_${code}`] = `${name}: ${S.v6_choose_level}`;
      const why = data[`why_${code}`];
      if (!v6.isJustified(why)) errors[`why_${code}`] = `${name}: ${S.v6_write_why}`;
      if (code === 'D2' && data.d2_children !== undefined) {
        const n = wholeNumber(data.d2_children);
        const q = wholeNumber(data.d2_quiet_later);
        if (n === null || q === null || q > n) {
          errors.d2_children = `${name}: ${S.v6_check_numbers}`;
        } else if (/^[1-4]$/.test(level) && Number(level) !== d2Expected(n, q) && !/\d/.test(String(why || ''))) {
          errors.why_D2 = `${name}: ${S.v6_d2_mismatch}`;
        }
      }
    } else {
      if (perCode && !allowed.includes(level)) errors[`r_${code}`] = `${name}: ${S.v6_choose_level}`;
      const rumi = rumiNumeric(analysis, code);
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
  V6, FLOW_ID_ENV, MSG_EN, DC_NA_OPTION, LETTERS, SCREENS, LEGACY_SCREENS, COACH_IDS, LEGACY_IDS, FORM_VERSION,
  decideVisitFramework, visitFramework, frameworkKeyForSession, isV6Analysis,
  optionsFor, rumiLevel, rumiNumeric, prefillLevel, combinedBody, buildScreenPrefill, validateScreen, d2Expected,
  buildReview, applyReview, messages,
  screenOf, screenInfo, codesFor, nextScreenOf, isLastScreen, screenData,
};
