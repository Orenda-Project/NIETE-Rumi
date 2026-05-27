/**
 * Conformance tests for the reading benchmark seam (bd-1833).
 *
 * Asserts:
 *  1. getBenchmarkStatus returns the expected status shape + values for
 *     representative (grade, language, wcpm/lcpm) cases matching TODAY's
 *     thresholds (seeded identically from migrations 006 / 010).
 *  2. The 3 dead benchmark methods are gone from analysis.service.js (grep).
 *  3. Documents that methodology threshold NUMBERS now live in the config file
 *     bot/shared/config/reading-benchmarks.js (single source of truth).
 *
 * Season note: getBenchmarkStatus derives WCPM season from the month, so these
 * tests pass an explicit `month` to stay deterministic. (Aug-Nov=fall,
 * Dec-Feb=winter, else=spring — matching check_benchmark_status.)
 */

const fs = require('fs');
const path = require('path');

const { getBenchmarkStatus } = require('../../bot/shared/services/reading/benchmark.service');

describe('reading benchmark.service — getBenchmarkStatus (config-driven)', () => {
  describe('WCPM (words/sentences/paragraphs)', () => {
    test('Grade 2 EN spring, wcpm 100 → 25th=68, 75th=107, on_track, p50', () => {
      const r = getBenchmarkStatus({ metric: 'wcpm', grade: 2, language: 'en', value: 100, isSecondLanguage: false, month: 5 });
      expect(r).toEqual({ benchmark_min: 68, benchmark_max: 107, on_track: true, percentile_rank: 50 });
    });

    test('Grade 1 EN spring, wcpm 0 → on_track false, percentile floored to 1', () => {
      const r = getBenchmarkStatus({ metric: 'wcpm', grade: 1, language: 'en', value: 0, isSecondLanguage: false, month: 5 });
      // spring G1 en: 25th=34, 75th=59
      expect(r).toEqual({ benchmark_min: 34, benchmark_max: 59, on_track: false, percentile_rank: 1 });
    });

    test('Grade 3 EN fall (month 9), wcpm 130 → 25th=53, 75th=107, p90', () => {
      const r = getBenchmarkStatus({ metric: 'wcpm', grade: 3, language: 'en', value: 130, isSecondLanguage: false, month: 9 });
      // fall G3 en: 90:123,75:107,50:71,25:53,10:30 → 130>=123 → p90
      expect(r).toEqual({ benchmark_min: 53, benchmark_max: 107, on_track: true, percentile_rank: 90 });
    });

    test('Urdu L2 uses ur norms (winter month 1, G2, wcpm 40)', () => {
      const r = getBenchmarkStatus({ metric: 'wcpm', grade: 2, language: 'ur', value: 40, isSecondLanguage: true, month: 1 });
      // winter G2 ur: 90:75,75:62,50:50,25:36,10:22 → 25th=36,75th=62; 40>=36 on_track; 40>=36 (25) <50 → p25
      expect(r).toEqual({ benchmark_min: 36, benchmark_max: 62, on_track: true, percentile_rank: 25 });
    });

    test('Urdu without L2 flag falls back to EN norms', () => {
      const r = getBenchmarkStatus({ metric: 'wcpm', grade: 2, language: 'ur', value: 100, isSecondLanguage: false, month: 5 });
      // not L2 → en spring G2: 25th=68,75th=107
      expect(r.benchmark_min).toBe(68);
      expect(r.benchmark_max).toBe(107);
    });

    test('low wcpm below 10th percentile floors percentile_rank at 10 (non-zero)', () => {
      const r = getBenchmarkStatus({ metric: 'wcpm', grade: 2, language: 'en', value: 1, isSecondLanguage: false, month: 5 });
      // spring G2 en 10th=45; 1<45 → floor 10; not on_track (1<68)
      expect(r.percentile_rank).toBe(10);
      expect(r.on_track).toBe(false);
    });
  });

  describe('LCPM (letters)', () => {
    test('Grade 2 EN letters (fall row), lcpm 45 → 25th=42, 75th=67, p50, metric LCPM', () => {
      const r = getBenchmarkStatus({ metric: 'lcpm', grade: 2, language: 'en', value: 45 });
      // fall G2 en: 5:22,10:30,25:42,50:55,75:67,90:78 → 45>=42(<55) → p50
      expect(r).toEqual({
        benchmark_min: 42,
        benchmark_max: 67,
        on_track: true,
        percentile_rank: 50,
        metric_name: 'LCPM',
        metric_display_name: 'Letters Correct Per Minute'
      });
    });

    test('Grade 1 UR letters, lcpm 3 → below 5th percentile, not on_track', () => {
      const r = getBenchmarkStatus({ metric: 'lcpm', grade: 1, language: 'ur', value: 3 });
      // fall G1 ur: 5:0,10:1,25:5,50:20,75:33,90:40 → 3>=1(<5) → p25; 3<5 → not on_track
      expect(r.benchmark_min).toBe(5);
      expect(r.benchmark_max).toBe(33);
      expect(r.on_track).toBe(false);
      expect(r.percentile_rank).toBe(25);
    });
  });

  describe('return shape parity with the SQL RPCs', () => {
    test('WCPM result has exactly the RPC keys', () => {
      const r = getBenchmarkStatus({ metric: 'wcpm', grade: 2, language: 'en', value: 60, month: 5 });
      expect(Object.keys(r).sort()).toEqual(['benchmark_max', 'benchmark_min', 'on_track', 'percentile_rank']);
    });
    test('LCPM result adds metric_name/metric_display_name like the LCPM RPC', () => {
      const r = getBenchmarkStatus({ metric: 'lcpm', grade: 2, language: 'en', value: 60 });
      expect(Object.keys(r).sort()).toEqual(
        ['benchmark_max', 'benchmark_min', 'metric_display_name', 'metric_name', 'on_track', 'percentile_rank']
      );
    });
  });
});

describe('dead benchmark methods are removed (single source of truth)', () => {
  const analysisSrc = fs.readFileSync(
    path.resolve(__dirname, '../../bot/shared/services/reading/analysis.service.js'),
    'utf8'
  );

  test.each([
    'calculateFluencyPercentage',
    'calculateCompositeScore',
    'getOverallRiskLevel'
  ])('analysis.service.js no longer defines %s', (name) => {
    expect(analysisSrc).not.toContain(`static ${name}(`);
  });

  test('analysis.service.js consumes the benchmark.service seam', () => {
    expect(analysisSrc).toContain("require('./benchmark.service')");
    expect(analysisSrc).toContain('BenchmarkService.getBenchmarkStatus');
  });
});

describe('methodology numbers live in the config file', () => {
  test('reading-benchmarks config exports the threshold tables', () => {
    const cfg = require('../../bot/shared/config/reading-benchmarks');
    // Spot-check a few seeded numbers match migrations 006/010 verbatim.
    expect(cfg.WCPM_PERCENTILES[2].en.spring[25]).toBe(68);
    expect(cfg.WCPM_PERCENTILES[2].en.spring[75]).toBe(107);
    expect(cfg.LCPM_BENCHMARKS[2].en.fall[25]).toBe(42);
    expect(cfg.WCPM_FALLBACK[2]).toEqual({ min: 51, max: 89 });
    expect(cfg.seasonForMonth(9)).toBe('fall');
    expect(cfg.seasonForMonth(1)).toBe('winter');
    expect(cfg.seasonForMonth(5)).toBe('spring');
  });
});
