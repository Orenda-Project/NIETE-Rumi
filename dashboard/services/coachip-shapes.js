'use strict';
/**
 * bd-sex15q.13 — COACHIP's shared wire pieces (contracts/API.md §1-§3): the validation grammar, the error bodies,
 * Asia/Karachi dates, Window / Count / Text builders, the server-composed copy (COPY.md §W, §RM-T, §F) and the
 * intervention library. Pure: no database, no request. Every route module builds its answer from these, so one
 * rule (a Count is never a bare number, a 404 has one body, a date is ISO) lives in one place.
 */
const path = require('path');

// ── grammar (API.md §2) ─────────────────────────────────────────────────────────────────────────────────────────
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const W_RX = /^W-[A-Z0-9-]{1,40}$/;
const I_RX = /^I-[A-Z0-9-]{1,40}$/;
const TEMPLATE_RX = /^RM-T[1-4]$/;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const isUuid = (v) => typeof v === 'string' && UUID_RX.test(v);
const isWId = (v) => typeof v === 'string' && W_RX.test(v);
const isIId = (v) => typeof v === 'string' && I_RX.test(v);
const isIsoDate = (v) => typeof v === 'string' && DATE_RX.test(v) && toDate(v).toISOString().slice(0, 10) === v;

// ── answers (API.md §1: byte-identical bodies) ──────────────────────────────────────────────────────────────────
const BODIES = Object.freeze({
  400: { error: 'bad_request' },
  401: { success: false, error: 'Not authenticated. Please log in.' },
  404: { error: 'not_found' },
  '409_closed': { error: 'step_closed' },
  500: { error: 'server_error' },
  '503_codec': { error: 'unavailable' },
});
/** A handler's answer. Handlers return these; the router writes them. */
const reply = (status, body) => ({ status, body });
const BAD = () => reply(400, BODIES[400]);
const NOT_FOUND = () => reply(404, BODIES[404]);
const STEP_CLOSED = () => reply(409, BODIES['409_closed']);
const STEP_EXISTS = (stepId) => reply(409, { error: 'step_exists', step_id: stepId });

/** Thrown anywhere below a handler to answer at once (e.g. new HttpAnswer(NOT_FOUND())). */
class HttpAnswer extends Error {
  constructor(answer) { super(`coachip ${answer.status}`); this.answer = answer; }
}

// ── dates: Asia/Karachi calendar days, ISO strings (API.md §1 "Dates") ──────────────────────────────────────────
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;   // PKT is UTC+5 all year (no DST since 2009)
function toDate(iso) { return new Date(`${iso}T00:00:00Z`); }
/** The Karachi calendar day of an instant, as YYYY-MM-DD. */
function karachiDay(instant = new Date()) {
  return new Date(new Date(instant).getTime() + KARACHI_OFFSET_MS).toISOString().slice(0, 10);
}
function addDays(iso, n) { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(fromIso, toIso) { return Math.round((toDate(toIso) - toDate(fromIso)) / 86400000); }
function weekdayOf(iso) { return toDate(iso).getUTCDay(); }   // 0 Sunday … 1 Monday
/** The Monday on or before an ISO day. */
function mondayOf(iso) { const wd = weekdayOf(iso); return addDays(iso, -((wd + 6) % 7)); }
function karachiMonday(instant = new Date()) { return mondayOf(karachiDay(instant)); }
/** First and last day of the calendar month holding iso. */
function monthOf(iso) {
  const from = `${iso.slice(0, 7)}-01`;
  const d = toDate(from); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
}
const isoTime = (instant = new Date()) => new Date(instant).toISOString();

// ── Text / Count / Stat / Window (API.md §3) ───────────────────────────────────────────────────────────────────
const text = (en, ur) => ({ en: String(en), ur: String(ur) });
function count(n, d, windowId) {
  const nn = Math.max(0, Math.trunc(Number(n) || 0));
  const dd = Math.max(nn, Math.trunc(Number(d) || 0));
  if (!windowId) throw new Error('a Count needs its window');
  return { n: nn, d: dd, window_id: windowId };
}
function stat(kind, value, unit, base, windowId) {
  return { kind, value: Math.round(Number(value) * 10) / 10, unit, base: Math.trunc(base), window_id: windowId };
}

const GRADER_FRAMEWORKS = new Set(['lp_fidelity', 'fico_v3', 'fico_v4', 'fico17', 'coachip_detector', 'egra']);
/**
 * The Window id grammar (API.md §3): lp_fidelity "w{weeks}-{from}"; another graded framework
 * "{framework}-w{weeks}-{from}" (fico_v3 → "fico3", fico_v4 → "fico4", fico17 as is); egra "egra-{from}";
 * activity "act-4w-{to}" | "act-m-YYYY-MM"; Listen/weekly "week-{from}".
 */
function windowId({ framework, weeks, from, to, kind }) {
  if (kind === 'week') return `week-${from}`;
  if (framework === 'activity') return weeks === null ? `act-m-${from.slice(0, 7)}` : `act-4w-${to}`;
  if (framework === 'egra') return `egra-${from}`;
  if (framework === 'lp_fidelity') return `w${weeks}-${from}`;
  const short = { fico_v3: 'fico3', fico_v4: 'fico4' }[framework] || framework;
  return `${short}-w${weeks}-${from}`;
}
function graderLabel(framework) {
  const copy = loadCopy().grader_label;
  if (framework === 'activity') return null;
  if (framework === 'lp_fidelity') return copy.lp_fidelity;
  if (framework === 'coachip_detector') return copy.coachip_detector;
  if (framework === 'egra') return copy.egra;
  return copy.fico;
}
/** A graded Window. */
function gradedWindow({ framework, weeks, from, to, grader, scoringChangedOn = null }) {
  if (!GRADER_FRAMEWORKS.has(framework)) throw new Error(`unknown framework ${framework}`);
  return {
    id: windowId({ framework, weeks, from, to }), from, to, weeks, grader: grader || null,
    grader_label: graderLabel(framework), framework, scoring_changed_on: scoringChangedOn,
  };
}
/** An activity Window (visits, debriefs, checks: no grader; API.md A7): "4w" ending today, or the calendar month. */
function activityWindow(kind, todayIso) {
  if (kind === 'month') {
    const { from, to } = monthOf(todayIso);
    return { id: windowId({ framework: 'activity', weeks: null, from }), from, to, weeks: null, grader: null, grader_label: null, framework: 'activity', scoring_changed_on: null };
  }
  const from = addDays(todayIso, -27);
  return { id: windowId({ framework: 'activity', weeks: 4, from, to: todayIso }), from, to: todayIso, weeks: 4, grader: null, grader_label: null, framework: 'activity', scoring_changed_on: null };
}
/** A one-week Window (Listen; the circle's moment week). */
function weekWindow(mondayIso, framework = 'lp_fidelity', grader = null) {
  return {
    id: windowId({ kind: 'week', from: mondayIso }), from: mondayIso, to: addDays(mondayIso, 6), weeks: 1,
    grader, grader_label: graderLabel(framework), framework, scoring_changed_on: null,
  };
}
/** The last four (or eight) full Monday-to-Sunday weeks before this Karachi week (SPEC §4: rolls on Monday). */
function currentGradedRange(todayIso, weeks = 4) {
  const thisMonday = mondayOf(todayIso);
  return { from: addDays(thisMonday, -7 * weeks), to: addDays(thisMonday, -1) };
}
/** Collect every distinct Window in a list (API.md §1: every read response carries windows: Window[]). */
function windowsOf(...ws) {
  const seen = new Map();
  for (const w of ws.flat(Infinity)) if (w && w.id && !seen.has(w.id)) seen.set(w.id, w);
  return [...seen.values()];
}

// ── COPY (server-composed strings only; the client renders the rest) ───────────────────────────────────────────
let COPY = null;
function loadCopy() {
  if (!COPY) COPY = require(path.join(__dirname, '..', 'data', 'coachip', 'copy.json'));
  return COPY;
}
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';   // U+06F0..U+06F9 (COPY §0: never U+0660)
const urDigits = (s) => String(s).replace(/[0-9]/g, (c) => URDU_DIGITS[Number(c)]);
/** COPY §F "{n} of {d}": "17 of 49" / "۴۹ میں سے ۱۷" (d first in Urdu). */
const numberLine = (n, d) => text(`${n} of ${d}`, `${urDigits(d)} میں سے ${urDigits(n)}`);
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
/** COPY §F "{date_short}": "30 Oct" / "۳۰ اکتوبر" (the year only when it differs from today's). The RM note lines use
 *  this form: a stored line never carries a weekday (COPY §6 lint 6; FIXTURES rm_notes_post_201). */
function formatDateShort(iso, todayIso) {
  const d = toDate(iso);
  const year = iso.slice(0, 4) !== todayIso.slice(0, 4) ? ` ${iso.slice(0, 4)}` : '';
  return text(`${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]}${year}`, `${urDigits(d.getUTCDate())} ${MONTHS_UR[d.getUTCMonth()]}${urDigits(year)}`);
}
/** COPY §0 rule 3: an ASCII run inside an Urdu string sits in LRI U+2066 … PDI U+2069. */
const isolate = (s) => `\u2066${s}\u2069`;
/** The W's short name and sentence (COPY §W); null for a W the copy deck does not carry. */
function wCopy(wId) {
  const w = loadCopy().w[wId];
  return w ? { short_name: w.short_name, sentence: w.sentence } : null;
}

// ── the intervention library (contracts/INTERVENTIONS.json, versioned; text verbatim, a url never leaves) ───────
let LIB = null;
function library() {
  if (!LIB) {
    const raw = require(path.join(__dirname, '..', 'data', 'coachip', 'INTERVENTIONS.json'));
    const ws = new Map(raw.weaknesses.map((w) => [w.id, w]));
    const is = new Map(raw.interventions.map((i) => [i.id, i]));
    const byW = new Map();
    for (const i of raw.interventions) {
      if (!byW.has(i.weakness_id)) byW.set(i.weakness_id, []);
      byW.get(i.weakness_id).push(i);
    }
    for (const list of byW.values()) list.sort((a, b) => (a.rank_in_w || 99) - (b.rank_in_w || 99));
    LIB = { raw, version: raw.library_version, weakness: (id) => ws.get(id) || null, intervention: (id) => is.get(id) || null, forW: (id) => byW.get(id) || [] };
  }
  return LIB;
}

module.exports = {
  UUID_RX, W_RX, I_RX, TEMPLATE_RX, DATE_RX, isUuid, isWId, isIId, isIsoDate,
  BODIES, reply, BAD, NOT_FOUND, STEP_CLOSED, STEP_EXISTS, HttpAnswer,
  karachiDay, karachiMonday, mondayOf, addDays, daysBetween, weekdayOf, monthOf, isoTime,
  text, count, stat, windowId, gradedWindow, activityWindow, weekWindow, currentGradedRange, windowsOf, graderLabel,
  loadCopy, urDigits, numberLine, formatDateShort, isolate, wCopy, library,
};
