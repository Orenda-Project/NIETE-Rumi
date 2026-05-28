/**
 * Reading Assessment Benchmark Thresholds (methodology config)
 * ============================================================================
 * SINGLE SOURCE OF TRUTH for the WCPM + LCPM fluency benchmark NUMBERS used by
 * the in-app benchmark comparison (see benchmark.service.js).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Historically these numbers were welded into SQL RPCs and seed-data tables:
 *   - check_benchmark_status()      → bot/database/migrations/006_add_percentile_calculation.sql
 *   - check_lcpm_benchmark_status() → bot/database/migrations/010_add_lcpm_benchmarks.sql
 *   - table wcpm_percentiles (Hasbrouck-Tindal 2017 norms)
 *   - table lcpm_benchmarks   (DIBELS LNF norms)
 * To change a threshold you had to write+apply a SQL migration. This file lifts
 * the methodology to a data-edit depth: change a number HERE and the in-app
 * comparison changes, no migration required.
 *
 * The numbers below are SEEDED FROM and kept IDENTICAL to the SQL so behaviour
 * is unchanged. The SQL/tables remain in place for DB integrity and as a
 * documented fallback (see benchmark.service.js → useRpcFallback / RPC path).
 *
 * WHAT IS / ISN'T A CONFIG EDIT
 * -----------------------------
 *  - Threshold NUMBERS (WCPM/LCPM by grade × language × season × percentile):
 *      ✅ edit this file.
 *  - The metric SHAPE (WCPM vs LCPM vs ASER 5-level Nothing→Story):
 *      ❌ still schema-bound — a deeper change (new columns / RPC / report
 *         surface). See docs/agent-customization.md §reading-assessment.
 *
 * SEASON LOGIC (must match the RPC to preserve results)
 * -----------------------------------------------------
 * The WCPM RPC derives season from the current month:
 *   Aug-Nov → fall, Dec-Feb → winter, else → spring.
 * The LCPM RPC always uses the 'fall' (conservative, start-of-year) row.
 * `seasonForMonth()` below replicates the WCPM rule exactly.
 */

// ---------------------------------------------------------------------------
// WCPM percentile norms  (grade_level → language → season → { percentile: threshold })
// Source: wcpm_percentiles table, migration 006. Hasbrouck-Tindal 2017 (en),
// L2-adjusted ~30% lower (ur). percentile = minimum WCPM to reach that rank.
// ---------------------------------------------------------------------------
const WCPM_PERCENTILES = {
  1: {
    en: {
      fall:   { 90: 15, 75: 10, 50: 5,  25: 2,  10: 0 },
      winter: { 90: 47, 75: 34, 50: 23, 25: 12, 10: 6 },
      spring: { 90: 72, 75: 59, 50: 47, 25: 34, 10: 24 },
    },
    ur: {
      fall:   { 90: 11, 75: 7,  50: 4,  25: 1,  10: 0 },
      winter: { 90: 33, 75: 24, 50: 16, 25: 8,  10: 4 },
      spring: { 90: 50, 75: 41, 50: 33, 25: 24, 10: 17 },
    },
  },
  2: {
    en: {
      fall:   { 90: 87,  75: 72,  50: 51, 25: 34, 10: 18 },
      winter: { 90: 107, 75: 89,  50: 72, 25: 51, 10: 31 },
      spring: { 90: 123, 75: 107, 50: 89, 25: 68, 10: 45 },
    },
    ur: {
      fall:   { 90: 61, 75: 50, 50: 36, 25: 24, 10: 13 },
      winter: { 90: 75, 75: 62, 50: 50, 25: 36, 10: 22 },
      spring: { 90: 86, 75: 75, 50: 62, 25: 48, 10: 32 },
    },
  },
  3: {
    en: {
      fall:   { 90: 123, 75: 107, 50: 71,  25: 53, 10: 30 },
      winter: { 90: 137, 75: 120, 50: 92,  25: 71, 10: 46 },
      spring: { 90: 153, 75: 137, 50: 107, 25: 83, 10: 61 },
    },
    ur: {
      fall:   { 90: 86,  75: 75, 50: 50, 25: 37, 10: 21 },
      winter: { 90: 96,  75: 84, 50: 64, 25: 50, 10: 32 },
      spring: { 90: 107, 75: 96, 50: 75, 25: 58, 10: 43 },
    },
  },
};

// ---------------------------------------------------------------------------
// WCPM fallback CASE (used by the RPC only when no percentile row is found).
// Source: migration 006 lines ~240-251. Urdu values are derived at lookup time
// by * 0.70 then ROUND (matching the SQL), so only the English bases live here.
// ---------------------------------------------------------------------------
const WCPM_FALLBACK = {
  // grade → { min, max }  (English base; ur = ROUND(value * 0.70))
  1: { min: 12, max: 34 },
  2: { min: 51, max: 89 },
  3: { min: 71, max: 107 },
  default: { min: 50, max: 100 },
  urduFactor: 0.70,
};

// ---------------------------------------------------------------------------
// LCPM benchmarks  (grade_level → language → season → { p5..p90 })
// Source: lcpm_benchmarks table, migration 010. DIBELS LNF norms (en),
// L2-adjusted (ur). grade 0=PreK, 1=K, 2=Grade1, 3=Grade2.
// The RPC reads the 'fall' row; full seasons are kept for completeness/parity.
// ---------------------------------------------------------------------------
const LCPM_BENCHMARKS = {
  0: {
    en: {
      fall:   { 5: 0, 10: 0, 25: 2,  50: 5,  75: 12, 90: 20 },
      winter: { 5: 0, 10: 2, 25: 5,  50: 12, 75: 22, 90: 32 },
      spring: { 5: 2, 10: 5, 25: 12, 50: 22, 75: 35, 90: 45 },
    },
  },
  1: {
    en: {
      fall:   { 5: 0,  10: 2,  25: 8,  50: 29, 75: 47, 90: 58 },
      winter: { 5: 5,  10: 13, 25: 26, 50: 42, 75: 55, 90: 66 },
      spring: { 5: 15, 10: 24, 25: 37, 50: 52, 75: 64, 90: 74 },
    },
    ur: {
      fall:   { 5: 0,  10: 1,  25: 5,  50: 20, 75: 33, 90: 40 },
      winter: { 5: 3,  10: 9,  25: 18, 50: 29, 75: 38, 90: 46 },
      spring: { 5: 10, 10: 17, 25: 26, 50: 36, 75: 45, 90: 52 },
    },
  },
  2: {
    en: {
      fall:   { 5: 22, 10: 30, 25: 42, 50: 55, 75: 67, 90: 78 },
      winter: { 5: 28, 10: 36, 25: 48, 50: 61, 75: 72, 90: 83 },
      spring: { 5: 32, 10: 40, 25: 52, 50: 65, 75: 76, 90: 86 },
    },
    ur: {
      fall:   { 5: 15, 10: 21, 25: 29, 50: 38, 75: 47, 90: 55 },
      winter: { 5: 20, 10: 25, 25: 34, 50: 43, 75: 50, 90: 58 },
      spring: { 5: 22, 10: 28, 25: 36, 50: 46, 75: 53, 90: 60 },
    },
  },
  3: {
    en: {
      fall:   { 5: 38, 10: 45, 25: 55, 50: 68, 75: 79, 90: 89 },
      winter: { 5: 42, 10: 48, 25: 58, 50: 71, 75: 82, 90: 92 },
      spring: { 5: 45, 10: 52, 25: 62, 50: 74, 75: 85, 90: 95 },
    },
    ur: {
      fall:   { 5: 27, 10: 32, 25: 38, 50: 48, 75: 55, 90: 62 },
      winter: { 5: 29, 10: 34, 25: 41, 50: 50, 75: 57, 90: 64 },
      spring: { 5: 32, 10: 36, 25: 43, 50: 52, 75: 60, 90: 66 },
    },
  },
};

// LCPM fallback (RPC: when no benchmark row found). Source: migration 010 ~114-122.
const LCPM_FALLBACK = {
  benchmarkMin: 20,
  benchmarkMax: 60,
  onTrackThreshold: 20,
  percentileRank: 50,
  metricName: 'LCPM',
  metricDisplayName: 'Letters Correct Per Minute',
};

/**
 * Map a calendar month (1-12) to the assessment season, matching the WCPM RPC's
 * CASE EXTRACT(MONTH FROM CURRENT_DATE): Aug-Nov=fall, Dec-Feb=winter, else=spring.
 * @param {number} month 1-12
 * @returns {'fall'|'winter'|'spring'}
 */
function seasonForMonth(month) {
  if ([8, 9, 10, 11].includes(month)) return 'fall';
  if ([12, 1, 2].includes(month)) return 'winter';
  return 'spring';
}

module.exports = {
  WCPM_PERCENTILES,
  WCPM_FALLBACK,
  LCPM_BENCHMARKS,
  LCPM_FALLBACK,
  seasonForMonth,
};
