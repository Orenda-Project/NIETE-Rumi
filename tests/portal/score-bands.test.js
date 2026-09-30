'use strict';
/**
 * Observation scores are shown as a BAND, never as a number or a percentage
 * (operator, 2026-09-29): "remove the Observation scores everywhere from
 * Numbers and Percentages to brackets of Excellent, Good, Average … <20, <40,
 * <60, <80, <100".
 *
 * One rule, one home. Every surface that shows an observation score — the
 * WhatsApp coaching report, the coaching card, every portal page — reads its
 * band from here, so a teacher can never be "Good" on her PDF and "Average" in
 * her principal's portal for the same lesson.
 *
 * The band is taken from the RAW percentage and never from a rounded one: 79.6
 * is Good, not Excellent. Rounding first would move every score within half a
 * point of a boundary into the band above it, which is exactly the teacher
 * nearest the line.
 */

const { scoreBandFor, BAND_THRESHOLDS } = require('../../bot/shared/config/score-bands');
const { scoreBandLabel } = require('../../bot/shared/config/score-bands');

describe('scoreBandFor — the five brackets', () => {
  test.each([
    [0, 'needs_support'],
    [19.99, 'needs_support'],
    [20, 'below_average'],
    [39.9, 'below_average'],
    [40, 'average'],
    [59.99, 'average'],
    [60, 'good'],
    [79.6, 'good'],        // raw, not rounded — rounding would say excellent
    [80, 'excellent'],
    [100, 'excellent'],
  ])('%p → %s', (pct, band) => {
    expect(scoreBandFor(pct)).toBe(band);
  });

  test('no score is no band — never a fabricated "Needs support"', () => {
    expect(scoreBandFor(null)).toBeNull();
    expect(scoreBandFor(undefined)).toBeNull();
    expect(scoreBandFor(NaN)).toBeNull();
    expect(scoreBandFor('not a number')).toBeNull();
  });

  test('a numeric string from pg is read as a number', () => {
    expect(scoreBandFor('64.2')).toBe('good');
  });

  test('out-of-range values clamp rather than falling off the table', () => {
    // 4 of 172 prod sessions once scored above 100% on a stale denominator.
    expect(scoreBandFor(104)).toBe('excellent');
    expect(scoreBandFor(-3)).toBe('needs_support');
  });

  test('the thresholds are the ones the operator named: 20 / 40 / 60 / 80', () => {
    expect(BAND_THRESHOLDS.map((b) => b.min)).toEqual([80, 60, 40, 20, 0]);
  });
});

describe('scoreBandLabel — what the teacher reads', () => {
  test('English', () => {
    expect(scoreBandLabel(85, 'en')).toBe('Excellent');
    expect(scoreBandLabel(65, 'en')).toBe('Good');
    expect(scoreBandLabel(45, 'en')).toBe('Average');
    expect(scoreBandLabel(25, 'en')).toBe('Below average');
    expect(scoreBandLabel(5, 'en')).toBe('Needs support');
  });

  test('Urdu', () => {
    expect(scoreBandLabel(85, 'ur')).toBe('بہترین');
    expect(scoreBandLabel(65, 'ur')).toBe('اچھا');
    expect(scoreBandLabel(45, 'ur')).toBe('اوسط');
    expect(scoreBandLabel(25, 'ur')).toBe('اوسط سے کم');
    expect(scoreBandLabel(5, 'ur')).toBe('مدد درکار');
  });

  test('a language outside the offer falls to the floor, never to blank', () => {
    expect(scoreBandLabel(85, 'sw')).toBe('Excellent');
  });

  test('no score → null, so a caller renders nothing rather than a band', () => {
    expect(scoreBandLabel(null, 'en')).toBeNull();
  });

  test('a label never contains a digit or a percent sign', () => {
    for (const lang of ['en', 'ur']) {
      for (const pct of [5, 25, 45, 65, 85]) {
        expect(scoreBandLabel(pct, lang)).not.toMatch(/[0-9%٠-٩۰-۹]/);
      }
    }
  });
});
