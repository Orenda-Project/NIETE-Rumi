/**
 * bd-v0toag.59 — hero-report.style.js (split out of hero-report.template.js).
 * Pure constants: every brand palette and language has the keys the template reads.
 */

const { PALETTES, MARKS_WORD, NOT_ASSESSED_FALLBACK, CHROME } = require('../../shared/services/coaching/report-v2/hero-report.style');

describe('hero-report.style', () => {
  it('palettes share the same keys across brands', () => {
    expect(Object.keys(PALETTES).sort()).toEqual(['default', 'niete']);
    expect(Object.keys(PALETTES.niete).sort()).toEqual(Object.keys(PALETTES.default).sort());
  });

  it('every language has chrome copy and a marks word', () => {
    for (const lang of ['en', 'sw', 'ur', 'ar']) {
      expect(typeof CHROME[lang].celebrate).toBe('string');
      expect(CHROME[lang].journey(3)).toContain('3');
      expect(CHROME[lang].made('Sadia')).toContain('Sadia');
      expect(CHROME[lang].caption('d', 't')).toContain('t');
      expect(typeof MARKS_WORD[lang]).toBe('string');
    }
  });

  it('keeps the not-assessed fallback', () => {
    expect(NOT_ASSESSED_FALLBACK).toBe('not assessed');
  });
});
