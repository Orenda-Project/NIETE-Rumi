'use strict';
/**
 * Fictional facts and the coachip_rollups CHECKs as a test helper (w-rollups). Ids are made-up UUIDs, teacher keys
 * made-up hex; no names anywhere.
 */
const F = require('./analysis');
const { readAllowed } = require('../../../lib/insights/allowlist');
const { buildLpFact, buildFicoFact } = require('../../../lib/insights/facts');

const uuid = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const teacherKey = (n) => String(n).padStart(16, 'a').slice(-16).replace(/[^0-9a-f]/g, 'b');

const SCOPE = {
  coachA: uuid('c', 1), coachB: uuid('c', 2), coachC: uuid('c', 3), coachD: uuid('c', 4),
  school1: uuid('5', 1), school2: uuid('5', 2), school3: uuid('5', 3), school4: uuid('5', 4),
};

let seq = 0;
function base(opts) {
  seq += 1;
  const n = opts.n != null ? opts.n : seq;
  const day = opts.day || '2026-10-20';
  return {
    id: uuid('f', n),
    session_id: uuid('e', n),
    teacher_key: teacherKey(opts.teacher != null ? opts.teacher : n),
    school_id: opts.school || SCOPE.school1,
    sector: opts.sector || 'Nilore',
    coach_user_ids: opts.coaches || [SCOPE.coachA],
    recorded_at: `${day}T05:00:00.000Z`,
    karachi_date: day,
    is_observed: !!opts.observed,
    is_duplicate: !!opts.duplicate,
    duplicate_of_session_id: opts.duplicate ? uuid('e', 999999) : null,
  };
}

/** An lp_fidelity fact through the real reader and fact builder, plus the job's scope fields. */
function lpFact(moves, opts = {}) {
  const allowed = readAllowed({ lp_fidelity: F.lp(moves, opts) });
  const b = base(opts);
  const fact = buildLpFact({ id: b.session_id }, allowed);
  return { ...fact, ...b, instrument: 'lp_fidelity', allowed, ...(opts.override || {}) };
}

/** A FICO fact (v3, v4, fico17) through the real reader and fact builder. */
function ficoFact(ad, opts = {}) {
  const allowed = readAllowed(ad);
  const b = base(opts);
  const fact = buildFicoFact({ id: b.session_id }, allowed);
  return { ...fact, ...b, allowed, ...(opts.override || {}) };
}

const ROLLUP_COLUMNS = ['scope_kind', 'coach_user_id', 'school_id', 'sector', 'w_id', 'window_start', 'window_end', 'window_weeks',
  'numerator', 'denominator', 'numerator_observed', 'denominator_observed', 'teacher_count', 'coach_count', 'coaches_with_5plus',
  'excluded_mismatch', 'excluded_unusable', 'excluded_duplicate', 'excluded_failed', 'recordings', 'recordings_linked',
  'stat_kind', 'stat_unit', 'stat_value', 'stat_base', 'rank', 'product', 'is_hysteresis_applied', 'grader_model',
  'framework_version', 'pipeline_version', 'status', 'job_run_id', 'computed_at', 'meta'];

const SECTORS = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol'];
const isoDow = (d) => { const x = new Date(`${d}T00:00:00Z`).getUTCDay(); return x === 0 ? 7 : x; };
const plusDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isNull = (v) => v === null || v === undefined;

/** Every CHECK on coachip_rollups (insights_schema.sql), plus the exact column set. Throws with the broken rule. */
function assertRollupChecks(r) {
  const fail = (msg) => { throw new Error(`rollup CHECK broken: ${msg} (${r.scope_kind} ${r.w_id} ${r.window_weeks}w)`); };
  const keys = Object.keys(r).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...ROLLUP_COLUMNS].sort())) fail(`columns ${keys.join(',')}`);
  if (!['coach', 'school', 'sector'].includes(r.scope_kind)) fail('scope_kind');
  const scopeOk = (r.scope_kind === 'coach' && r.coach_user_id && isNull(r.school_id) && isNull(r.sector))
    || (r.scope_kind === 'school' && r.school_id && isNull(r.coach_user_id) && isNull(r.sector))
    || (r.scope_kind === 'sector' && r.sector && isNull(r.coach_user_id) && isNull(r.school_id));
  if (!scopeOk) fail('scope columns');
  if (!isNull(r.sector) && !SECTORS.includes(r.sector)) fail('sector literal');
  if (![4, 8].includes(r.window_weeks)) fail('window_weeks');
  for (const k of ['numerator', 'denominator', 'numerator_observed', 'denominator_observed', 'teacher_count', 'coach_count',
    'coaches_with_5plus', 'excluded_mismatch', 'excluded_unusable', 'excluded_duplicate', 'excluded_failed', 'recordings',
    'recordings_linked']) if (!Number.isInteger(r[k]) || r[k] < 0) fail(`${k} >= 0`);
  if (!(r.numerator <= r.denominator && r.numerator_observed <= r.numerator && r.denominator_observed <= r.denominator)) fail('n <= d');
  if (r.recordings_linked > r.recordings) fail('recordings_linked <= recordings');
  if (r.window_end !== plusDays(r.window_start, 7 * r.window_weeks - 1)) fail('window_end');
  if (isoDow(r.window_start) !== 1) fail('window_start Monday');
  const nulls = [r.stat_kind, r.stat_value, r.stat_base, r.stat_unit].map(isNull);
  if (!nulls.every((x) => x === nulls[0])) fail('stat_* together');
  if (!isNull(r.stat_kind) && !['median', 'mean'].includes(r.stat_kind)) fail('stat_kind');
  if (!isNull(r.stat_unit) && !['min', 's'].includes(r.stat_unit)) fail('stat_unit');
  if (!isNull(r.stat_base) && r.stat_base < 0) fail('stat_base');
  if (r.status === 'ok' && r.scope_kind === 'sector' && !(r.denominator >= 40 && r.coaches_with_5plus >= 3)) fail('sector ok floor + B23');
  if (r.status === 'ok' && r.scope_kind === 'coach' && r.denominator < 20) fail('coach ok floor');
  if (!isNull(r.rank) && ![1, 2].includes(r.rank)) fail('rank 1|2');
  if (!isNull(r.rank) && r.status !== 'ok') fail('rank only on ok');
  if (!isNull(r.product) && !(r.product >= 0)) fail('product >= 0');
  if (typeof r.is_hysteresis_applied !== 'boolean') fail('is_hysteresis_applied');
  if (!(typeof r.grader_model === 'string' && r.grader_model.length >= 1 && r.grader_model.length <= 120)) fail('grader_model');
  if (!/^(lp_fidelity|fico_v3|fico_v4|fico17|coachip_detector|egra|code)(:[A-Za-z0-9._-]+)?$/.test(r.framework_version)) fail('framework_version');
  if (!/^coachip-[0-9]+\.[0-9]+\.[0-9]+$/.test(r.pipeline_version)) fail('pipeline_version');
  if (!['ok', 'insufficient', 'failed', 'mismatch'].includes(r.status)) fail('status');
  if (!r.job_run_id) fail('job_run_id');
  if (!r.computed_at) fail('computed_at');
  return true;
}

module.exports = { uuid, teacherKey, SCOPE, lpFact, ficoFact, assertRollupChecks, ROLLUP_COLUMNS, plusDays, isoDow };
