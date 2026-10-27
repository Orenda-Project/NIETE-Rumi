'use strict';
/**
 * The window calendar (NIGHTLY_JOB §5; FICO_CROSSWALK §1, rule 3). Weeks are Monday to Sunday on Karachi calendar days,
 * held as 'YYYY-MM-DD' strings and computed in UTC so no clock or zone can shift them. The window ends on the last
 * Sunday before the run's Monday, rolls on Monday and is held for the week. `runDate` is the Karachi date the run
 * starts on (the §11 example: a run on Mon 26 Oct reads 28 Sep-25 Oct).
 */
const C = require('./constants');

const DAY_MS = 86400000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// A series that never opens a product window (a history-only grader, v4 before its first session).
const NEVER = '9999-12-31';

function toMs(d) {
  if (typeof d !== 'string' || !ISO_DAY.test(d)) throw new Error('date must be YYYY-MM-DD');
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error('date must be YYYY-MM-DD');
  return ms;
}
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => fromMs(toMs(d) + n * DAY_MS);
const isoDow = (d) => { const x = new Date(toMs(d)).getUTCDay(); return x === 0 ? 7 : x; };
const mondayOf = (d) => addDays(d, 1 - isoDow(d));
const mondayOnOrAfter = (d) => (isoDow(d) === 1 ? d : addDays(d, 8 - isoDow(d)));

function windowFor(runDate, weeks) {
  if (!C.WINDOW_WEEKS.includes(weeks)) throw new Error('weeks must be 4 or 8');
  const end = addDays(mondayOf(runDate), -1);
  return { window_start: addDays(end, 1 - 7 * weeks), window_end: end, window_weeks: weeks };
}

const inWindow = (day, w) => typeof day === 'string' && day >= w.window_start && day <= w.window_end;

/**
 * True when this run should leave the week's rollups as they are: the previous rollup computation covered the same
 * window, on the same pipeline version, and did not fail. `previous` = {window_end, pipeline_version, status} or null.
 */
function isHeldForWeek(runDate, previous, pipelineVersion = C.PIPELINE_VERSION) {
  if (!previous) return false;
  if (previous.window_end !== windowFor(runDate, 4).window_end) return false;
  if (previous.pipeline_version !== pipelineVersion) return false;
  return previous.status === 'ok' || previous.status === 'partial';
}

/**
 * The first Monday a W's window may start on (FICO_CROSSWALK §1). `opts.firstSeen` is the Karachi day of the first
 * v4-shaped session in the scope (fico_v4) or the job's first night (coachip_detector).
 */
function seriesStartFor(frameworkVersion, grader, opts = {}) {
  const fw = String(frameworkVersion || '').split(':')[0];
  if (fw === 'lp_fidelity' || fw === 'code') {
    if (grader && C.HISTORY_ONLY_GRADERS.includes(grader)) return NEVER;
    return (grader && C.SERIES_START[`lp_fidelity:${grader}`]) || C.SERIES_START[fw];
  }
  if (fw === 'fico_v4') return opts.firstSeen ? mondayOnOrAfter(opts.firstSeen) : NEVER;
  if (fw === 'coachip_detector') return opts.firstSeen || C.SERIES_START.coachip_detector;
  if (Object.prototype.hasOwnProperty.call(C.SERIES_START, fw)) return C.SERIES_START[fw];
  return NEVER;
}

/** B19: a window that would start before its series start is not computed. A null start is not known yet. */
const refusesB19 = (w, seriesStart) => seriesStart != null && w.window_start < seriesStart;

module.exports = { windowFor, isHeldForWeek, seriesStartFor, refusesB19, inWindow, addDays, isoDow, mondayOf, mondayOnOrAfter, NEVER };
