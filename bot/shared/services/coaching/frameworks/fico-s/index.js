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
 * standard. N/A (C2 only, "no answer was wrong") leaves both sides of the ratio. A FICO-S number is never a FICO V3 or
 * v6 number: it is stamped 'fico_s_v1_1' and frameworks/own-rubric.js keeps it out of every FICO total and average.
 */

const fs = require('fs');
const path = require('path');

const RUBRIC_FILE = path.join(__dirname, 'fico_s_v1_1.rubric.json');
const RUBRIC = JSON.parse(fs.readFileSync(RUBRIC_FILE, 'utf8'));
const URDU = JSON.parse(fs.readFileSync(path.join(__dirname, 'fico_s_v1_1.ur.json'), 'utf8'));

const RUBRIC_KEY = RUBRIC.rubric; // 'fico_s_v1_1'
// Shown to people as 'FICO 6-12' (operator 18 Nov ~17:00); FICO-S v1.1 is its code name, branched off FICO17 v6.
const LABEL = RUBRIC.label; // 'FICO 6-12'
// Every FICO-S version's id: fico_s_v<major>_<minor>. Only this one is known to this code.
const ID_RX = /^fico_s_v(\d+)_(\d+)$/;
const isFicoSId = (id) => id === RUBRIC_KEY;

const CODES = RUBRIC.indicators.map((i) => i.code);
const BY_CODE = Object.fromEntries(RUBRIC.indicators.map((i) => [i.code, i]));
const SECTIONS = RUBRIC.sections;
const LEVEL_LABELS = RUBRIC.level_labels;
const NA_CODES = CODES.filter((c) => BY_CODE[c].na && BY_CODE[c].na.allowed);
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

/** A level as stored: 1-4, or 'NA' where the indicator allows it; anything else is null. */
function normLevel(v, code) {
  if (v === 'NA' || v === 'na') return code && NA_CODES.includes(code) ? 'NA' : null;
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

/** An indicator's text in a language: { name, look_for, how, levels[4], na }; English for any missing key. */
function indicatorText(code, lang = 'en') {
  const ind = BY_CODE[code];
  if (!ind) return null;
  const en = {
    name: ind.name,
    look_for: ind.look_for,
    how: ind.how,
    levels: ind.levels.map((l) => l.text),
    na: ind.na && ind.na.allowed ? ind.na.text : null,
  };
  if (langOf(lang) !== 'ur') return en;
  const u = (URDU.indicators || {})[code] || {};
  return {
    name: u.name || en.name,
    look_for: u.look_for || en.look_for,
    how: u.how || en.how,
    levels: en.levels.map((t, i) => (u.levels && u.levels[i]) || t),
    na: en.na ? (u.na || en.na) : null,
  };
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
function score(levels = {}) {
  const lv = levels || {};
  const read = (c) => {
    const raw = lv[c];
    return normLevel(raw && typeof raw === 'object' ? raw.level : raw, c);
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
  return { rubric: RUBRIC_KEY, sections, total, max, counted, pct, band: bandFor(pct), na, missing };
}

/** The lowest-scored indicator (first in sheet order on a tie): where the feedback's one focus starts. */
function lowestIndicator(levels = {}) {
  let best = null;
  for (const c of CODES) {
    const v = normLevel((levels || {})[c], c);
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
  LABEL,
  ID_RX,
  isFicoSId,
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
