'use strict';
/**
 * Stage 6, rollups (NIGHTLY_JOB §4 stage 6, §5; FICO_CROSSWALK rule 3). Per coach, school and sector × W × series
 * (source + grader), the window rule: 4 weeks at the floor, else 8, else the 8-week row `insufficient` with its counts.
 * A window starting before its series start, or one an instrument change falls inside, is not computed (B19): the
 * 4-week row reads `insufficient` and `meta.scoring_changed_on` names the boundary. `meta` is a side field the store
 * ignores. Pure: facts and signals in, rows out. Rows carry counts only, never a teacher key.
 */
const C = require('./constants');
const { countable } = require('./signals');
const { windowFor, seriesStartFor, refusesB19, inWindow, NEVER } = require('./windows');

const SECTOR_SET = new Set(C.SECTORS);

const family = (source) => (source === 'lp_fidelity' || source === 'code' ? 'lp' : /^fico/.test(source) ? 'fico' : 'any');
function factFamily(f) {
  if (f.framework_version === 'lp_fidelity') return 'lp';
  if (/^fico/.test(String(f.instrument || f.framework_version || ''))) return 'fico';
  return 'other';
}

/** One exclusion reason per fact: failed, then mismatch, unusable, duplicate. */
function exclusionOf(f) {
  if (f.status === 'failed') return 'excluded_failed';
  if (f.is_mismatch || f.status === 'mismatch') return 'excluded_mismatch';
  if (f.is_unusable) return 'excluded_unusable';
  if (f.is_duplicate) return 'excluded_duplicate';
  return null;
}

function statOf(statFor, wId, hitFacts) {
  const s = typeof statFor === 'function' ? statFor(wId, hitFacts) : null;
  if (!s || s.stat_kind == null || s.stat_unit == null || s.stat_value == null || s.stat_base == null) {
    return { stat_kind: null, stat_unit: null, stat_value: null, stat_base: null };
  }
  return { stat_kind: s.stat_kind, stat_unit: s.stat_unit, stat_value: Math.round(Number(s.stat_value) * 10) / 10, stat_base: s.stat_base };
}

function computeRollups({ facts, signals, scopes, runDate, jobRunId, statFor, computedAt, pipelineVersion = C.PIPELINE_VERSION }) {
  const computed = computedAt || new Date().toISOString();
  const coaches = scopes.coaches instanceof Map ? scopes.coaches : new Map(Object.entries(scopes.coaches || {}));
  const schools = scopes.schools instanceof Map ? scopes.schools : new Map(Object.entries(scopes.schools || {}));
  const sectors = (scopes.sectors || C.SECTORS).filter((s) => SECTOR_SET.has(s));

  // Product facts only: a history-only grader never enters a product window.
  const live = (facts || []).filter((f) => !C.HISTORY_ONLY_GRADERS.includes(f.grader_model));
  const byId = new Map(live.map((f) => [f.id, f]));

  // Scope membership: a fact counts for every coach holding its school.
  const coachesOf = new Map();
  const members = new Map();
  const add = (key, f) => { if (!members.has(key)) members.set(key, []); members.get(key).push(f); };
  for (const f of live) {
    const held = [];
    for (const [cid, c] of coaches) if (c.schoolIds && c.schoolIds.has(f.school_id)) held.push(cid);
    coachesOf.set(f.id, held);
    for (const cid of held) add(`coach|${cid}`, f);
    if (schools.has(f.school_id)) add(`school|${f.school_id}`, f);
    const sector = SECTOR_SET.has(f.sector) ? f.sector : schools.get(f.school_id);
    if (SECTOR_SET.has(sector)) add(`sector|${sector}`, f);
  }

  // Signals by fact, and the series (source + grader) each W was read on.
  const sigs = new Map();
  const seriesByW = new Map();
  for (const s of signals || []) {
    const f = byId.get(s.fact_id);
    if (!f) continue;
    if (!sigs.has(f.id)) sigs.set(f.id, new Map());
    sigs.get(f.id).set(s.w_id, s);
    if (!seriesByW.has(s.w_id)) seriesByW.set(s.w_id, new Map());
    const key = `${s.source}|${f.grader_model}`;
    const m = seriesByW.get(s.w_id);
    if (!m.has(key)) m.set(key, { key, source: s.source, grader: f.grader_model, n: 0 });
    m.get(key).n += 1;
  }

  const w4 = windowFor(runDate, 4);
  const w8 = windowFor(runDate, 8);
  const rows = [];
  const scopeList = [
    ...[...coaches.keys()].map((id) => ({ kind: 'coach', id })),
    ...[...schools.keys()].map((id) => ({ kind: 'school', id })),
    ...sectors.map((id) => ({ kind: 'sector', id })),
  ];

  for (const wId of [...seriesByW.keys()].sort()) {
    const all = [...seriesByW.get(wId).values()];
    const dominant = all.reduce((a, b) => (b.n > a.n ? b : a));
    for (const scope of scopeList) {
      const scopeFacts = members.get(`${scope.kind}|${scope.id}`) || [];
      const sigOf = (f, series) => {
        const s = sigs.get(f.id) && sigs.get(f.id).get(wId);
        return s && s.source === series.source && f.grader_model === series.grader ? s : null;
      };
      const present = all.filter((series) => scopeFacts.some((f) => inWindow(f.karachi_date, w8) && sigOf(f, series)));
      const list = present.length ? present : [dominant];
      const firstSeen = (series) => {
        let d = null;
        for (const f of scopeFacts) {
          const seen = series.source === 'fico_v4' ? f.instrument === 'fico_v4' : !!sigOf(f, series);
          if (seen && f.karachi_date && (d == null || f.karachi_date < d)) d = f.karachi_date;
        }
        return d;
      };
      const starts = new Map(list.map((series) => [series.key, seriesStartFor(series.source, series.grader, { firstSeen: firstSeen(series) })]));

      for (const series of list) {
        const start = starts.get(series.key);
        const refusal = (w) => {
          if (refusesB19(w, start)) return { refused: true, on: start === NEVER ? null : start };
          for (const [k, s] of starts) {
            if (k !== series.key && s !== NEVER && s > w.window_start && s <= w.window_end) return { refused: true, on: s };
          }
          return { refused: false, on: null };
        };
        const counts = (w) => {
          const c = { numerator: 0, denominator: 0, numerator_observed: 0, denominator_observed: 0, excluded_mismatch: 0,
            excluded_unusable: 0, excluded_duplicate: 0, excluded_failed: 0 };
          const hitTeachers = new Set(); const denTeachers = new Set(); const perCoach = new Map();
          const sessions = new Set(); const linked = new Set(); const hitFacts = [];
          for (const f of scopeFacts) {
            if (!inWindow(f.karachi_date, w)) continue;
            sessions.add(f.session_id);
            if (f.is_lp_linked) linked.add(f.session_id);
            if (!countable(f)) {
              const fam = family(series.source);
              const reason = exclusionOf(f);
              if (reason && (fam === 'any' || fam === factFamily(f))) c[reason] += 1;
              continue;
            }
            const s = sigOf(f, series);
            if (!s || !s.is_in_denominator) continue;
            c.denominator += 1;
            if (f.is_observed) c.denominator_observed += 1;
            if (f.teacher_key) denTeachers.add(f.teacher_key);
            for (const cid of coachesOf.get(f.id) || []) perCoach.set(cid, (perCoach.get(cid) || 0) + 1);
            if (s.is_hit) {
              c.numerator += 1;
              if (f.is_observed) c.numerator_observed += 1;
              if (f.teacher_key) hitTeachers.add(f.teacher_key);
              hitFacts.push(f);
            }
          }
          let coachCount = 1; let with5 = c.denominator >= C.SECTOR_COACH_MIN_LESSONS ? 1 : 0;
          if (scope.kind !== 'coach') {
            coachCount = [...perCoach.values()].filter((n) => n >= 1).length;
            with5 = [...perCoach.values()].filter((n) => n >= C.SECTOR_COACH_MIN_LESSONS).length;
          }
          return { ...c, teacher_count: hitTeachers.size, coach_count: coachCount, coaches_with_5plus: with5,
            recordings: sessions.size, recordings_linked: linked.size, hitFacts, teachersInDenominator: denTeachers.size };
        };
        const floor = C.FLOORS[scope.kind];
        const qualifies = (c) => c.denominator >= floor
          && (scope.kind !== 'sector' || c.coaches_with_5plus >= C.SECTOR_MIN_COACHES_5PLUS);

        const r4 = refusal(w4); const r8 = refusal(w8);
        const c4 = counts(w4);
        let pickW; let pickC; let status; let changedOn = null;
        if (!r4.refused && qualifies(c4)) { pickW = w4; pickC = c4; status = 'ok'; } else if (!r8.refused) {
          pickW = w8; pickC = counts(w8); status = qualifies(pickC) ? 'ok' : 'insufficient';
        } else {
          pickW = w4; pickC = c4; status = 'insufficient'; changedOn = r4.refused ? r4.on : r8.on;
        }

        rows.push({
          scope_kind: scope.kind,
          coach_user_id: scope.kind === 'coach' ? scope.id : null,
          school_id: scope.kind === 'school' ? scope.id : null,
          sector: scope.kind === 'sector' ? scope.id : null,
          w_id: wId,
          window_start: pickW.window_start,
          window_end: pickW.window_end,
          window_weeks: pickW.window_weeks,
          numerator: pickC.numerator,
          denominator: pickC.denominator,
          numerator_observed: pickC.numerator_observed,
          denominator_observed: pickC.denominator_observed,
          teacher_count: pickC.teacher_count,
          coach_count: pickC.coach_count,
          coaches_with_5plus: pickC.coaches_with_5plus,
          excluded_mismatch: pickC.excluded_mismatch,
          excluded_unusable: pickC.excluded_unusable,
          excluded_duplicate: pickC.excluded_duplicate,
          excluded_failed: pickC.excluded_failed,
          recordings: pickC.recordings,
          recordings_linked: pickC.recordings_linked,
          ...statOf(statFor, wId, pickC.hitFacts),
          rank: null,
          product: null,
          is_hysteresis_applied: false,
          grader_model: String(series.grader || 'unknown').slice(0, 120),
          framework_version: series.source,
          pipeline_version: pipelineVersion,
          status,
          job_run_id: jobRunId,
          computed_at: computed,
          meta: { scoring_changed_on: changedOn, series_start: start === NEVER ? null : start,
            teachers_in_denominator: pickC.teachersInDenominator },
        });
      }
    }
  }
  return rows;
}

module.exports = { computeRollups };
