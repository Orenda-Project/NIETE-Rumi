'use strict';
/**
 * The pure shaper of the twice-a-day teacher activity job (docs/teacher-activity-store.md). No Redis, no database:
 *
 *   shapeTeacher(row, { now, slot, teacher })  one teacher_activity_batch row (migration V1.10.5) → the stored
 *                                              per-teacher value, or null when the row is not usable (the run then
 *                                              keeps her previous value)
 *   buildTeam(entries, { now })                the shaped values → the team summary ("Where teachers get to")
 *   windowStart(now, days)                     the instant the last `days` Pakistan days start
 *
 * Bands, never marks: a report's overall percentage and an indicator's 0-2 score become score-band keys here and are
 * not stored. Every value is run through the contract's check before it is returned.
 */
const { scoreBandFor, scoreBandForScore } = require('../../config/score-bands');
const {
  JOURNEY_KINDS, LADDER, TEAM_STEPS, BAND_KEYS, MAX_JOURNEY, MAX_TREND, TILE_KEYS,
  checkTeacherActivity, checkTeamActivity,
} = require('../../config/teacher-activity-contract');
const { pktDate, PKT_OFFSET_MIN } = require('../nudges/pkt-time');

const WINDOW_DAYS = 30;
/** The top of each framework's indicator scale (fico: 0 Not observed / 1 Developing / 2 Proficient). */
const INDICATOR_MAX = Object.freeze({ fico: 2, 'fico17-v6': 2 });
/** Band rank, best first (score-bands order). */
const RANK = Object.fromEntries(BAND_KEYS.map((k, i) => [k, BAND_KEYS.length - i]));

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isoOf = (v) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function windowStart(now, days) {
  const [y, m, d] = pktDate(new Date(now)).split('-').map(Number);
  return Date.UTC(y, m - 1, d - (days - 1)) - PKT_OFFSET_MIN * 60000;
}

/** A plan reference's grade and subject ("grade_3_math_ch2_seg1", "grade_7_general_science.c03.p033"). */
function planLabel(ref) {
  const m = /(?:^|_)grade_(\d{1,2})_([a-z][a-z_]*?)(?:_ch\d|\.c\d|_seg\d|$)/.exec(String(ref || ''));
  return m ? { grade: Number(m[1]), subject: m[2] } : {};
}

function stepMeta(kind, ref, meta) {
  const out = { ...meta };
  if (kind === 'plan_opened' && out.grade === undefined) Object.assign(out, planLabel(ref));
  if (kind === 'report') {
    const band = scoreBandFor(out.pct);
    delete out.pct;
    if (band) out.band = band;
    if (out.opened_at !== undefined) out.opened_at = isoOf(out.opened_at) || undefined;
  }
  return JSON.parse(JSON.stringify(out));
}

function shapeJourney(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => {
      const at = isObj(s) ? isoOf(s.at) : null;
      const ref = isObj(s) && s.ref_id !== undefined && s.ref_id !== null ? String(s.ref_id) : '';
      if (!at || !ref || !JOURNEY_KINDS.includes(s.kind)) return null;
      return { kind: s.kind, at, ref_id: ref, meta: stepMeta(s.kind, ref, isObj(s.meta) ? s.meta : {}) };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_JOURNEY);
}

/** Her furthest rung in the window: a report counts only once she opened it inside the window. */
function furthestStep(journey, from) {
  let best = -1;
  for (const s of journey) {
    const when = s.kind === 'report' ? Date.parse(s.meta.opened_at || '') : Date.parse(s.at);
    if (!(when >= from)) continue;
    best = Math.max(best, LADDER.indexOf(s.kind));
  }
  return best >= 0 ? LADDER[best] : null;
}

/** indicator id → { name, band } for one report, scores outside the framework's scale dropped. */
function bandsOf(report) {
  const max = INDICATOR_MAX[report.framework];
  const out = new Map();
  for (const i of Array.isArray(report.indicators) ? report.indicators : []) {
    const name = isObj(i) ? text(i.name) : null;
    if (!name || !text(i.id) || typeof i.score !== 'number' || i.score < 0 || i.score > max) continue;
    out.set(i.id, { name, band: scoreBandForScore(i.score, max) });
  }
  return out;
}

function trendFrom(reports) {
  const list = (Array.isArray(reports) ? reports : []).filter((r) => isObj(r) && INDICATOR_MAX[r.framework] && isoOf(r.at) && text(r.session_id));
  const latest = list[0];
  const prev = latest && list.slice(1).find((r) => r.framework === latest.framework);
  if (!prev) return [];
  const now = bandsOf(latest);
  const before = bandsOf(prev);
  const shared = [...now.keys()].filter((id) => before.has(id))
    .map((id) => ({ id, name: now.get(id).name, from: before.get(id).band, to: now.get(id).band }));
  if (!shared.length) return [];
  const rise = (x) => RANK[x.to] - RANK[x.from];
  const rose = shared.filter((x) => rise(x) > 0).sort((a, b) => rise(b) - rise(a));
  const first = rose[0] || [...shared].sort((a, b) => RANK[b.to] - RANK[a.to])[0];
  const second = shared.filter((x) => x !== first).sort((a, b) => RANK[a.to] - RANK[b.to])[0];
  const point = (r, band) => ({ session_id: String(r.session_id), at: isoOf(r.at), band });
  return [first, second].filter(Boolean).slice(0, MAX_TREND).map((x) => ({
    indicator_id: x.id, indicator_name: x.name, framework: latest.framework,
    points: [point(prev, x.from), point(latest, x.to)],
  }));
}

function tipFrom(latest) {
  const t = isObj(latest) ? text(latest.tip) : null;
  const at = t ? isoOf(latest.at) : null;
  return t && at && latest.session_id ? { session_id: String(latest.session_id), text: t, at } : null;
}

const PRIMARY = /^(grade_[1-5]|early_years)$/;
/** 'k5' | 'g612' | null — users.teacher_level first, then her registration grades (lp-engagement's reading). */
function gradeBandOf(teacher) {
  const level = isObj(teacher) && Array.isArray(teacher.level) ? teacher.level.map((l) => String(l).toUpperCase()) : [];
  if (level.includes('PRIMARY')) return 'k5';
  if (level.some((l) => l === 'MIDDLE' || l === 'HIGH')) return 'g612';
  let grades = [];
  try { grades = JSON.parse(isObj(teacher) ? teacher.grades : '[]'); } catch (_) { grades = []; }
  if (!Array.isArray(grades) || !grades.length) return null;
  return grades.some((g) => PRIMARY.test(String(g))) ? 'k5' : 'g612';
}

function shapeTeacher(row, { now = Date.now(), slot, teacher } = {}) {
  if (!isObj(row) || !isObj(row.tiles)) return null;
  const tiles = {};
  for (const k of TILE_KEYS) {
    const t = row.tiles[k];
    if (!isObj(t)) return null;
    tiles[k] = { now: Number(t.now), prev: Number(t.prev) };
  }
  const journey = shapeJourney(row.journey);
  const value = {
    updated_at: new Date(now).toISOString(),
    slot,
    tiles,
    trend: trendFrom(row.reports),
    tip: tipFrom(row.latest),
    journey,
    furthest_step: furthestStep(journey, windowStart(now, WINDOW_DAYS)),
    grade_band: gradeBandOf(teacher),
  };
  return checkTeacherActivity(value, now);
}

/** entries: [{ userId, value (shaped), who: { org, region, name, school } }] → the team summary, or null. */
function buildTeam(entries, { now = Date.now() } = {}) {
  const steps = Object.fromEntries(TEAM_STEPS.map((s) => [s, []]));
  const teachers = {};
  for (const { userId, value, who = {} } of entries) {
    const furthest = value.furthest_step || 'none';
    const last = value.journey[0] || null;
    teachers[userId] = {
      org: who.org || null, region: who.region || null, band: value.grade_band, name: text(who.name), school: text(who.school),
      furthest, last_kind: last ? last.kind : null, last_at: last ? last.at : null,
    };
    steps[furthest].push(userId);
  }
  const lastAt = (id) => (teachers[id].last_at ? Date.parse(teachers[id].last_at) : -Infinity);
  const out = {};
  for (const [step, ids] of Object.entries(steps)) {
    ids.sort((a, b) => lastAt(a) - lastAt(b));
    out[step] = { count: ids.length, user_ids: ids };
  }
  return checkTeamActivity({ updated_at: new Date(now).toISOString(), window_days: WINDOW_DAYS, steps: out, teachers }, now);
}

module.exports = { shapeTeacher, buildTeam, windowStart, planLabel, gradeBandOf, trendFrom, WINDOW_DAYS };
