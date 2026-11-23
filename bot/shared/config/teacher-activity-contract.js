'use strict';
/**
 * The teacher activity store's contract (docs/teacher-activity-store.md). Pure: no Redis, no database, so the
 * twice-a-day writer (bot worker) and the portal reader (dashboard/services/teacher-activity-store.js) share it.
 *
 *   teacher_activity:v1:<users.id>                 one teacher's Home numbers, trend, tip and journey     TTL 36 h
 *   teacher_activity:v1:team                       the team's furthest-step summary                        TTL 36 h
 *   teacher_activity:v1:run:<YYYY-MM-DD>:<slot>    run marker (Pakistan date; slot day | night)           TTL 36 h
 *
 * checkTeacherActivity / checkTeamActivity answer the value when it is well formed and fresh (≤ 36 h), else null.
 * The writer writes only what passes; the reader shows only what passes. Bands are score-band KEYS, never marks.
 */
const { BAND_THRESHOLDS } = require('./score-bands');

const PREFIX = 'teacher_activity:v1';
const TEAM_ACTIVITY_KEY = `${PREFIX}:team`;
const TTL_SECONDS = 36 * 3600;
const MAX_AGE_MS = TTL_SECONDS * 1000;
const FUTURE_SLACK_MS = 60 * 1000;
const SLOTS = Object.freeze(['day', 'night']);
const TILE_KEYS = Object.freeze(['plans_opened', 'taught', 'coached', 'quizzes', 'exams']);
const JOURNEY_KINDS = Object.freeze(['plan_opened', 'taught', 'coached', 'report', 'tip', 'quiz', 'exam']);
const LADDER = Object.freeze(['plan_opened', 'taught', 'coached', 'report', 'quiz']);
const TEAM_STEPS = Object.freeze(['none', ...LADDER]);
const GRADE_BANDS = Object.freeze(['k5', 'g612']);
const BAND_KEYS = Object.freeze(BAND_THRESHOLDS.map((b) => b.key));
const MAX_TREND = 2;
const MAX_JOURNEY = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const teacherActivityKey = (userId) => (typeof userId === 'string' && UUID.test(userId) ? `${PREFIX}:${userId}` : null);
const runMarkerKey = (date, slot) => (typeof date === 'string' && DATE.test(date) && SLOTS.includes(slot)
  ? `${PREFIX}:run:${date}:${slot}` : null);

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isCount = (n) => Number.isInteger(n) && n >= 0;
const isText = (s) => typeof s === 'string' && s.trim() !== '';
const isTime = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));

/** updated_at is a time no older than 36 h and not ahead of now (a minute's clock slack). */
function fresh(updatedAt, now) {
  if (!isTime(updatedAt)) return false;
  const age = now - Date.parse(updatedAt);
  return age <= MAX_AGE_MS && age >= -FUTURE_SLACK_MS;
}

const tilesOk = (tiles) => isObj(tiles)
  && TILE_KEYS.every((k) => isObj(tiles[k]) && isCount(tiles[k].now) && isCount(tiles[k].prev));

const pointOk = (p) => isObj(p) && isText(p.session_id) && isTime(p.at) && BAND_KEYS.includes(p.band);
const trendOk = (trend) => Array.isArray(trend) && trend.length <= MAX_TREND && trend.every((t) => isObj(t)
  && isText(t.indicator_id) && isText(t.indicator_name) && isText(t.framework)
  && Array.isArray(t.points) && t.points.length >= 2 && t.points.every(pointOk));

const tipOk = (tip) => tip === null || (isObj(tip) && isText(tip.session_id) && isText(tip.text) && isTime(tip.at));

const stepOk = (s) => isObj(s) && JOURNEY_KINDS.includes(s.kind) && isTime(s.at) && isText(s.ref_id) && isObj(s.meta);

/** One teacher's stored value, or null. A journey over the cap keeps its newest MAX_JOURNEY steps. */
function checkTeacherActivity(value, now = Date.now()) {
  if (!isObj(value) || !fresh(value.updated_at, now) || !SLOTS.includes(value.slot)) return null;
  if (!tilesOk(value.tiles) || !trendOk(value.trend) || !tipOk(value.tip)) return null;
  if (!Array.isArray(value.journey) || !value.journey.every(stepOk)) return null;
  if (value.furthest_step !== null && !LADDER.includes(value.furthest_step)) return null;
  if (value.grade_band !== null && !GRADE_BANDS.includes(value.grade_band)) return null;
  return value.journey.length > MAX_JOURNEY ? { ...value, journey: value.journey.slice(0, MAX_JOURNEY) } : value;
}

const isNullableText = (v) => v === null || typeof v === 'string';
/** One roster entry: where she is placed (organization, region), her band, name and school, and her last step. */
const whoOk = (w) => isObj(w) && isNullableText(w.org) && isNullableText(w.region) && isNullableText(w.name)
  && isNullableText(w.school) && (w.band === null || GRADE_BANDS.includes(w.band)) && TEAM_STEPS.includes(w.furthest)
  && (w.last_kind === null || JOURNEY_KINDS.includes(w.last_kind)) && (w.last_at === null || isTime(w.last_at));
const rosterOk = (r) => r === undefined || (isObj(r) && Object.values(r).every(whoOk));

const teamStepOk = (s) => isObj(s) && isCount(s.count) && Array.isArray(s.user_ids)
  && s.user_ids.every(isText) && s.user_ids.length === s.count;

/**
 * The team summary, or null. Steps outside TEAM_STEPS are dropped (a later rung an older reader does not know).
 * `teachers` (optional) is the roster the team view scopes and lists by: { <users.id>: { org, region, band, name,
 * school, furthest, last_kind, last_at } }; a malformed roster fails the whole value.
 */
function checkTeamActivity(value, now = Date.now()) {
  if (!isObj(value) || !fresh(value.updated_at, now) || !isCount(value.window_days) || !isObj(value.steps)) return null;
  if (!rosterOk(value.teachers)) return null;
  const steps = {};
  for (const step of TEAM_STEPS) {
    if (value.steps[step] === undefined) continue;
    if (!teamStepOk(value.steps[step])) return null;
    steps[step] = value.steps[step];
  }
  return { ...value, steps };
}

module.exports = {
  TEAM_ACTIVITY_KEY,
  TTL_SECONDS,
  SLOTS,
  TILE_KEYS,
  JOURNEY_KINDS,
  LADDER,
  TEAM_STEPS,
  GRADE_BANDS,
  BAND_KEYS,
  MAX_TREND,
  MAX_JOURNEY,
  teacherActivityKey,
  runMarkerKey,
  checkTeacherActivity,
  checkTeamActivity,
};
