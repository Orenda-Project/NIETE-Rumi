'use strict';
/**
 * Stage 8, the circle (NIGHTLY_JOB §4 stage 8; SPEC v2 B3). For one sector and week, one moment per coach on the
 * sector's rank-1 W: the highest-confidence `missing` moment (high, medium, none; newest among equals), else a `good`
 * one, else nothing. The rows are the stored predicate the RM route checks.
 *
 * SPEC v2.1 §11.1: when the sector has no rank-1 W (under a B23 floor, or held), each coach brings the same pick on the
 * coach's OWN rank-1 W (`coachRank1W`, the coach-level ranking, already past the coach floor); a coach with no coach-level
 * rank 1 gets no row. Each row stores which ranking chose it (`basis`), because the first choice in the week stands.
 *
 * No moment is chosen twice in one sector-week (fix-r5 s2 item 10, qa-rm R3a): two coaches who share a school see the
 * same lessons, so a coach whose best moment is already taken gets their next eligible one (missing first, then good,
 * same order), else no row. `existing` = the rows already stored for this sector-week ({coach_user_id, moment_id}):
 * those coaches keep their row (they get none here) and their moments count as taken.
 */
const C = require('./constants');
const { isoDow } = require('./windows');

const CONFIDENCE = { high: 2, medium: 1, none: 0 };
const better = (a, b) => (CONFIDENCE[b.confidence] || 0) - (CONFIDENCE[a.confidence] || 0)
  || String(b.recorded_at).localeCompare(String(a.recorded_at));

const lookup = (mapOrObj, id) => (mapOrObj instanceof Map ? mapOrObj.get(id) : mapOrObj && mapOrObj[id]);

function pickCircle({ sector, weekStart, coachIds, rank1W, coachRank1W, momentsByCoach, jobRunId, existing = [] }) {
  if (!C.SECTORS.includes(sector)) throw new Error('unknown sector');
  if (isoDow(weekStart) !== 1) throw new Error('week_start must be a Monday');
  const basis = rank1W ? 'sector' : 'coach';
  const stored = new Set((existing || []).map((e) => e.coach_user_id));
  const taken = new Set((existing || []).map((e) => e.moment_id).filter(Boolean));
  const rows = [];
  for (const coachId of coachIds || []) {
    if (stored.has(coachId)) continue;   // the first choice in the week stands
    const wId = rank1W || lookup(coachRank1W, coachId);
    if (!wId) continue;
    const onW = (lookup(momentsByCoach, coachId) || []).filter((m) => m && m.w_id === wId && m.id && !taken.has(m.id));
    const pick = [...onW.filter((m) => m.kind === 'missing')].sort(better)[0] || [...onW.filter((m) => m.kind === 'good')].sort(better)[0];
    if (!pick) continue;
    taken.add(pick.id);
    rows.push({ sector, week_start: weekStart, coach_user_id: coachId, moment_id: pick.id, job_run_id: jobRunId, basis });
  }
  return rows;
}

module.exports = { pickCircle };
