'use strict';

/**
 * bd-31ziu8 — FICO-S v1.1 ("FICO for Secondary"), the ICT HITL rubric for grades 6-12, branched off FICO17 v6.
 *
 * Operator, 18 Nov ~14:30: "for ICT we get 2 rubrics only. For 1 to 5, remains the same FICO v6. For 6 onwards all the
 * way to 12, it is going to be FICO-S v1.1 ... FICO-S v1.1 is branched off of FICO v6." It replaces FDE's Annex G tools
 * (obs612-gen/msci/enur) for ICT grades 6-8 and FICO17 v6 for ICT grades 9-12. GB is not touched (v6 at every grade).
 *
 * The text is data: fico_s_v1_1.rubric.json, generated from the operator's sheet (snapshot fico_s_v1_1.source.json) by
 * bot/scripts/build-fico-s-rubric.js. Never hand-edit the JSON. Urdu: fico_s_v1_1.ur.json, a DRAFT for native review;
 * English is the fallback for any missing key.
 *
 * Who scores: the observer, every indicator, from the room (the sheet's How to use: "Score every indicator 1-4 and
 * write what you saw and heard as evidence. Give the lower level if unsure."). No model sets a FICO-S level: the
 * recording is kept, and a Digital Coach pre-fill would need its own FICO-S prompt checked against observers' levels
 * first (v6's levels are worded differently, so a v6 level is never shown as a FICO-S level).
 *
 * Scoring (sheet, How to use 'Overall'): a section's score is the average of its indicators; overall % = total ÷
 * (4 × indicators scored) × 100; bands 85-100 Exemplary · 65-84 Proficient · 45-64 Developing · below 45 Below
 * standard. N/A leaves both sides of the ratio. A FICO-S number is never a FICO V3 or v6 number: it is stamped with its
 * id ('fico_s_v1_1', 'fico_s_v1_2') and frameworks/own-rubric.js keeps it out of every FICO total and average.
 *
 * Versions (queue #218, the operator's go 21 Nov after approving #216's lists). v1.1 is frozen. v1.2 has the same 23
 * indicators, names, look-fors, level text, sections, checklist and scoring (it reads v1.1's rubric.json and ur.json),
 * and adds what fico_s_v1_2.json holds: N/A only on C2 and C3, each in its own words (C3 arrives chosen when the observer
 * set C1 to level 1); a "Couldn't tell" (IE) line per indicator for the Digital Coach (IE is the Digital Coach's only);
 * scoring notes on C5 and A3. A new form is stamped RUBRIC_KEY (v1.2); a form keeps the id it was made with, so a v1.1
 * form finishes on v1.1 (its N/A, its label). Every function that differs by version takes the form's id last, and
 * defaults to the current version.
 */

const fs = require('fs');
const path = require('path');

const RUBRIC_FILE = path.join(__dirname, 'fico_s_v1_1.rubric.json');
const RUBRIC = JSON.parse(fs.readFileSync(RUBRIC_FILE, 'utf8'));
const URDU = JSON.parse(fs.readFileSync(path.join(__dirname, 'fico_s_v1_1.ur.json'), 'utf8'));

// What v1.2 adds to v1.1's text (N/A words, Couldn't tell lines, scoring notes). Urdu inside it is a DRAFT.
const V12_FILE = path.join(__dirname, 'fico_s_v1_2.json');
const V12 = JSON.parse(fs.readFileSync(V12_FILE, 'utf8'));

// Every FICO-S version's id: fico_s_v<major>_<minor>.
const ID_RX = /^fico_s_v(\d+)_(\d+)$/;
const BASE_KEY = RUBRIC.rubric; // 'fico_s_v1_1': the sheet's text, frozen

const CODES = RUBRIC.indicators.map((i) => i.code);
const BY_CODE = Object.fromEntries(RUBRIC.indicators.map((i) => [i.code, i]));
const SECTIONS = RUBRIC.sections;
const LEVEL_LABELS = RUBRIC.level_labels;
// v1.1's one N/A (C2), as its form showed it: the generic title, the sheet's sentence.
const V11_NA = Object.fromEntries(CODES.filter((c) => BY_CODE[c].na && BY_CODE[c].na.allowed).map((c) => {
  const en = BY_CODE[c].na.text;
  const ur = ((URDU.indicators || {})[c] || {}).na || en;
  return [c, { coach: {
    en: { title: 'N/A · did not happen', sentence: en, description: en },
    ur: { title: 'لاگو نہیں · ایسا نہیں ہوا', sentence: ur, description: ur },
  } }];
}));
const VERSIONS = {
  [BASE_KEY]: { id: BASE_KEY, version: String(RUBRIC.version), label: RUBRIC.label, na: V11_NA, notes: {}, dc_ie: {} },
  [V12.rubric]: { id: V12.rubric, version: V12.version, label: V12.label, na: V12.na, notes: V12.notes || {}, dc_ie: V12.dc_ie || {} },
};
// The ids this code knows, oldest first; a NEW form is stamped with the current one.
const IDS = Object.keys(VERSIONS);
const RUBRIC_KEY = V12.rubric; // 'fico_s_v1_2'
const isFicoSId = (id) => typeof id === 'string' && IDS.includes(id);
const ver = (id) => VERSIONS[isFicoSId(id) ? id : RUBRIC_KEY];
// Shown to people as 'FICO 6-12' (operator 18 Nov ~17:00); v1.2 adds its version: 'FICO 6-12 v1.2'.
const LABEL = VERSIONS[RUBRIC_KEY].label;
/** A version's label ('FICO 6-12' for v1.1, 'FICO 6-12 v1.2'), or null for an id that is not FICO-S. */
const labelOf = (id) => (isFicoSId(id) ? VERSIONS[id].label : null);
/** '1.1' | '1.2', or null. */
const versionOf = (id) => (isFicoSId(id) ? VERSIONS[id].version : null);
/** The codes that offer N/A on a version, in sheet order. */
const naCodes = (id) => CODES.filter((c) => Boolean(ver(id).na[c]));
const NA_CODES = naCodes(RUBRIC_KEY);
// Starred (queue #184, operator 19 Nov): never sent to the Digital Coach (not in its prompt, dropped from its reply) and
// mandatory for the observer. One field on the indicator (rubric.json `starred`); everything reads it from here.
const STARRED_CODES = CODES.filter((c) => BY_CODE[c].starred === true);
const isStarred = (code) => STARRED_CODES.includes(code);
// What the Digital Coach is asked for: every indicator but the starred ones, in sheet order.
const DC_CODES = CODES.filter((c) => !isStarred(c));
const BANDS = RUBRIC.scoring.bands; // highest first
const GRADES = RUBRIC.grades;
// The observer's evidence for a level: at least this many characters once trimmed (as v6's room indicators).
const EVIDENCE_MIN = 20;

const cp = (s) => Array.from(String(s || '')).length;
const round1 = (n) => Math.round(n * 10) / 10;
const langOf = (lang) => (String(lang || '').toLowerCase().startsWith('ur') ? 'ur' : 'en');

function indicator(code) { return BY_CODE[code] || null; }

/** A level as stored: 1-4, or 'NA' where the indicator allows it on that version; anything else is null. */
function normLevel(v, code, id = RUBRIC_KEY) {
  if (v === 'NA' || v === 'na') return code && naCodes(id).includes(code) ? 'NA' : null;
  const s = typeof v === 'string' ? v.trim() : v;
  if (s === '' || s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

/** Evidence that counts: at least EVIDENCE_MIN characters once trimmed. */
function isEvidence(text) { return cp(String(text || '').trim()) >= EVIDENCE_MIN; }

/** The band for an overall % (one decimal is enough: 84.9 is Proficient, 85 Exemplary), else null. */
function bandFor(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const b = BANDS.find((x) => pct >= x.from) || BANDS[BANDS.length - 1];
  return { label: b.label, from: b.from };
}

/** A level's name ('Proficient' / 'ماہر'). */
function levelName(n, lang = 'en') {
  const k = String(n);
  if (langOf(lang) === 'ur' && URDU.level_labels && URDU.level_labels[k]) return URDU.level_labels[k];
  return LEVEL_LABELS[k] || null;
}

const pick = (byLang, lang) => (byLang && (byLang[langOf(lang)] || byLang.en)) || null;

/**
 * An indicator's text in a language: { name, look_for, how, levels[4], na, note }; English for any missing key. `na` is
 * the version's N/A sentence (null where it has none); `note` its scoring note (v1.2: C5, A3), else null.
 */
function indicatorText(code, lang = 'en', id = RUBRIC_KEY) {
  const ind = BY_CODE[code];
  if (!ind) return null;
  const na = naSentence(code, lang, id);
  const note = noteOf(code, lang, id);
  const en = { name: ind.name, look_for: ind.look_for, how: ind.how, levels: ind.levels.map((l) => l.text) };
  if (langOf(lang) !== 'ur') return { ...en, na, note };
  const u = (URDU.indicators || {})[code] || {};
  return {
    name: u.name || en.name,
    look_for: u.look_for || en.look_for,
    how: u.how || en.how,
    levels: en.levels.map((t, i) => (u.levels && u.levels[i]) || t),
    na,
    note,
  };
}

// ── N/A, notes and Couldn't tell, per version ─────────────────────────────────

const clipCp = (s, max) => {
  const c = Array.from(String(s || ''));
  if (c.length <= max) return c.join('');
  const head = c.slice(0, max - 1).join('');
  const cut = head.lastIndexOf(' ');
  return `${(cut > max / 2 ? head.slice(0, cut) : head).trimEnd()}…`;
};
const naRow = (code, id) => ver(id).na[code] || null;

/** An indicator's N/A choice in a language ({ id: 'NA', title ≤ 30, description ≤ 300 }), or null where it has none. */
function naOption(code, lang = 'en', id = RUBRIC_KEY) {
  const row = naRow(code, id);
  if (!row) return null;
  const w = pick(row.coach, lang);
  return { id: 'NA', title: clipCp(w.title, 30), description: clipCp(w.description, 300) };
}
/** The one sentence that says why an indicator is N/A ("No answer was wrong in this lesson."), or null. */
function naSentence(code, lang = 'en', id = RUBRIC_KEY) {
  const row = naRow(code, id);
  return row ? pick(row.coach, lang).sentence : null;
}
/** An N/A's short title ("N/A · No answer was wrong"), or null. */
function naTitle(code, lang = 'en', id = RUBRIC_KEY) {
  const row = naRow(code, id);
  return row ? pick(row.coach, lang).title : null;
}
/** { code, level } an indicator's N/A follows (v1.2 C3: C1 at level 1), or null. */
function naFollows(code, id = RUBRIC_KEY) {
  const row = naRow(code, id);
  return row && row.follows ? { code: row.follows.code, level: Number(row.follows.level) } : null;
}
/** The note shown when N/A was chosen because of another indicator (C3 after C1 = 1); null otherwise. */
function naFollowNote(code, lang = 'en', id = RUBRIC_KEY) {
  const row = naRow(code, id);
  return row && row.follow_note ? pick(row.follow_note, lang) : null;
}
/** When the Digital Coach may answer N/A on an indicator (its rule, English), or null where it may not. */
function naDcRule(code, id = RUBRIC_KEY) {
  const row = naRow(code, id);
  return row && row.dc_level === true && row.dc_rule ? row.dc_rule : null;
}
/** A scoring note for a lesson where part of the indicator does not happen (v1.2: C5, A3), or null. */
function noteOf(code, lang = 'en', id = RUBRIC_KEY) {
  return pick(ver(id).notes[code], lang);
}
/** The Digital Coach's "Couldn't tell" (IE) line for an indicator it is asked (v1.2), or null. */
function ieLine(code, id = RUBRIC_KEY) {
  if (isStarred(code)) return null;
  return ver(id).dc_ie[code] || null;
}

/** A section's name and question in a language. */
function sectionOf(key) { return SECTIONS.find((s) => s.key === key) || null; }
function sectionName(key, lang = 'en') {
  const s = sectionOf(key);
  if (!s) return null;
  return (langOf(lang) === 'ur' && URDU.sections && URDU.sections[key] && URDU.sections[key].name) || s.name;
}
function sectionQuestion(key, lang = 'en') {
  const s = sectionOf(key);
  if (!s) return null;
  return (langOf(lang) === 'ur' && URDU.sections && URDU.sections[key] && URDU.sections[key].question) || s.question;
}

/** A checklist item's text in a language. */
function checklistText(key, lang = 'en') {
  const item = RUBRIC.checklist.find((c) => c.key === key);
  if (!item) return null;
  const u = (URDU.checklist || {})[key];
  return langOf(lang) === 'ur' && u ? u : item.text;
}

/**
 * What a visit's levels add up to. Pure. `levels` maps code → 1-4 | 'NA' (strings are read too). Unanswered codes are
 * left out of the sums and listed in `missing`; N/A codes in `na`.
 *   { sections: [{ key, name, scored, total, max, average, pct }], total, max, counted, pct, band, na, missing }
 */
function score(levels = {}, id = RUBRIC_KEY) {
  const lv = levels || {};
  const rubric = isFicoSId(id) ? id : RUBRIC_KEY;
  const read = (c) => {
    const raw = lv[c];
    return normLevel(raw && typeof raw === 'object' ? raw.level : raw, c, rubric);
  };
  const na = [];
  const missing = [];
  const sections = SECTIONS.map((s) => {
    let total = 0;
    let scored = 0;
    for (const c of s.codes) {
      const v = read(c);
      if (v === 'NA') { na.push(c); continue; }
      if (v === null) { missing.push(c); continue; }
      total += v;
      scored += 1;
    }
    return {
      key: s.key,
      name: s.name,
      scored,
      total,
      max: scored * 4,
      average: scored ? round1(total / scored) : null,
      pct: scored ? round1((total * 100) / (scored * 4)) : null,
    };
  });
  const total = sections.reduce((n, s) => n + s.total, 0);
  const counted = sections.reduce((n, s) => n + s.scored, 0);
  const max = counted * 4;
  const pct = max ? round1((total * 100) / max) : null;
  return { rubric, sections, total, max, counted, pct, band: bandFor(pct), na, missing };
}

/** The lowest-scored indicator (first in sheet order on a tie): where the feedback's one focus starts. */
function lowestIndicator(levels = {}, id = RUBRIC_KEY) {
  let best = null;
  for (const c of CODES) {
    const v = normLevel((levels || {})[c], c, id);
    if (typeof v !== 'number') continue;
    if (!best || v < best.level) best = { code: c, level: v };
  }
  return best;
}

module.exports = {
  RUBRIC,
  RUBRIC_FILE,
  URDU,
  RUBRIC_KEY,
  BASE_KEY,
  LABEL,
  ID_RX,
  IDS,
  VERSIONS,
  V12_FILE,
  isFicoSId,
  labelOf,
  versionOf,
  naCodes,
  naOption,
  naSentence,
  naTitle,
  naFollows,
  naFollowNote,
  naDcRule,
  noteOf,
  ieLine,
  CODES,
  SECTIONS,
  LEVEL_LABELS,
  NA_CODES,
  STARRED_CODES,
  DC_CODES,
  isStarred,
  BANDS,
  GRADES,
  EVIDENCE_MIN,
  cp,
  langOf,
  indicator,
  normLevel,
  isEvidence,
  bandFor,
  levelName,
  indicatorText,
  sectionOf,
  sectionName,
  sectionQuestion,
  checklistText,
  score,
  lowestIndicator,
};
