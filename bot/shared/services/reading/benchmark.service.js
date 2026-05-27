/**
 * Reading Benchmark Service (in-app, config-driven)
 * ============================================================================
 * Pure-JS reimplementation of the SQL benchmark RPCs, reading its numbers from
 * bot/shared/config/reading-benchmarks.js. This is the SEAM that lets an agent
 * change benchmark thresholds by editing ONE config file instead of writing a
 * SQL migration.
 *
 * Behavioural parity: getBenchmarkStatus() returns the SAME shape the RPCs
 * return (keys: benchmark_min, benchmark_max, on_track, percentile_rank, and —
 * for LCPM — metric_name, metric_display_name) and computes the SAME values
 * for the seeded numbers, so swapping it in front of the RPC does not change
 * results.
 *
 * Parity notes (kept faithful to migrations 006 / 010):
 *   WCPM:
 *     - season derived from current month (seasonForMonth).
 *     - language: 'ur' only when isSecondLanguage (p_is_l2) true, else 'en'.
 *     - wcpm rounded for lookup.
 *     - benchmark_min/max = the 25th / 75th percentile thresholds.
 *     - on_track = wcpm >= 25th percentile.
 *     - percentile_rank = highest percentile whose threshold <= wcpm
 *       (COALESCE 10 floor); wcpm==0 → 1; <10 → 10.
 *     - if no rows: WCPM_FALLBACK CASE, ur scaled by urduFactor then ROUND.
 *   LCPM:
 *     - always uses the 'fall' row, language defaults to 'en'.
 *     - benchmark_min/max = 25th / 75th percentile.
 *     - on_track = lcpm >= 25th percentile.
 *     - percentile_rank by ascending band (5/10/25/50/75/90, else 95).
 *     - if no row: LCPM_FALLBACK.
 */

const {
  WCPM_PERCENTILES,
  WCPM_FALLBACK,
  LCPM_BENCHMARKS,
  LCPM_FALLBACK,
  seasonForMonth,
} = require('../../config/reading-benchmarks');

/**
 * WCPM benchmark status — mirrors check_benchmark_status().
 * @param {number} grade
 * @param {string} language 'en' | 'ur'
 * @param {number} value WCPM
 * @param {boolean} isSecondLanguage L2 flag (p_is_l2)
 * @param {number} month 1-12 (defaults to current month)
 */
function wcpmStatus(grade, language, value, isSecondLanguage, month) {
  const season = seasonForMonth(month);
  const lookupLang = language === 'ur' && isSecondLanguage ? 'ur' : 'en';
  const wcpm = Math.round(value);

  const byLang = WCPM_PERCENTILES[grade] && WCPM_PERCENTILES[grade][lookupLang];
  const seasonRow = byLang && byLang[season];

  let min;
  let max;

  if (seasonRow && seasonRow[25] != null && seasonRow[75] != null) {
    min = seasonRow[25];
    max = seasonRow[75];
  } else {
    // Fallback CASE (RPC lines ~240-251)
    const base = WCPM_FALLBACK[grade] || WCPM_FALLBACK.default;
    min = base.min;
    max = base.max;
    if (lookupLang === 'ur') {
      min = Math.round(min * WCPM_FALLBACK.urduFactor);
      max = Math.round(max * WCPM_FALLBACK.urduFactor);
    }
  }

  const onTrack = wcpm >= min;

  // percentile = highest percentile whose threshold <= wcpm, COALESCE floor 10
  let percentile = 10;
  if (seasonRow) {
    const reached = Object.keys(seasonRow)
      .map(Number)
      .filter((p) => seasonRow[p] <= wcpm);
    percentile = reached.length ? Math.max(...reached) : 10;
  }

  // edge cases (RPC lines ~267-272)
  if (wcpm === 0) {
    percentile = 1;
  } else if (percentile < 10) {
    percentile = 10;
  }

  return {
    benchmark_min: min,
    benchmark_max: max,
    on_track: onTrack,
    percentile_rank: percentile,
  };
}

/**
 * LCPM benchmark status — mirrors check_lcpm_benchmark_status().
 * @param {number} grade 0-3
 * @param {string} language 'en' | 'ur'
 * @param {number} value LCPM
 */
function lcpmStatus(grade, language, value) {
  const lang = language || 'en';
  const byLang = LCPM_BENCHMARKS[grade] && LCPM_BENCHMARKS[grade][lang];
  const row = byLang && byLang.fall;

  if (!row) {
    return {
      benchmark_min: LCPM_FALLBACK.benchmarkMin,
      benchmark_max: LCPM_FALLBACK.benchmarkMax,
      on_track: value >= LCPM_FALLBACK.onTrackThreshold,
      percentile_rank: LCPM_FALLBACK.percentileRank,
      metric_name: LCPM_FALLBACK.metricName,
      metric_display_name: LCPM_FALLBACK.metricDisplayName,
    };
  }

  let percentile;
  if (value < row[5]) percentile = 5;
  else if (value < row[10]) percentile = 10;
  else if (value < row[25]) percentile = 25;
  else if (value < row[50]) percentile = 50;
  else if (value < row[75]) percentile = 75;
  else if (value < row[90]) percentile = 90;
  else percentile = 95;

  return {
    benchmark_min: row[25],
    benchmark_max: row[75],
    on_track: value >= row[25],
    percentile_rank: percentile,
    metric_name: 'LCPM',
    metric_display_name: 'Letters Correct Per Minute',
  };
}

/**
 * Config-driven benchmark status. Same return shape as the SQL RPCs.
 * @param {object} args
 * @param {'wcpm'|'lcpm'} args.metric  metric family ('letters' passages → 'lcpm')
 * @param {number} args.grade          grade level
 * @param {string} args.language       'en' | 'ur'
 * @param {number} args.value          WCPM or LCPM value
 * @param {boolean} [args.isSecondLanguage=true]  L2 flag (WCPM only)
 * @param {number} [args.month]        1-12, defaults to current month (WCPM season)
 * @returns {{benchmark_min:number,benchmark_max:number,on_track:boolean,percentile_rank:number,metric_name?:string,metric_display_name?:string}}
 */
function getBenchmarkStatus({ metric, grade, language, value, isSecondLanguage = true, month }) {
  const m = (month == null) ? new Date().getMonth() + 1 : month;
  if (metric === 'lcpm') {
    return lcpmStatus(grade, language, value);
  }
  return wcpmStatus(grade, language, value, isSecondLanguage, m);
}

module.exports = { getBenchmarkStatus };
