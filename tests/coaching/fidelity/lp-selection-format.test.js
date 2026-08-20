'use strict';
/**
 * P2 — the LP-selection row LABEL (design decision: Option A — topic headline + a context line that
 * carries the disambiguators a heavy generator actually uses: chapter · day · pages · recency).
 * Sourced from niete_lp_downloads + V8 catalog (so it also carries the version keys P3.3 needs).
 * Caps are measured in CODE POINTS (language-protocol): title ≤24, description ≤72.
 */
const { formatLpRow } = require('../../../bot/shared/services/coaching/lp-coaching/lp-selection-format');

const cp = (s) => [...s].length;
// fixed "now" so relative dates are deterministic (no Date.now flakiness)
const NOW = new Date('2026-08-20T12:00:00Z');
const lp = (over = {}) => ({
  lesson_id: 'grade_5_math_ch5_seg3', id: 'dl1', topic: 'Adding unlike fractions',
  grade: '5', subject: 'math', chapter_number: 5, day_label: 'Day 3', pages_label: 'p.113–115',
  created_at: '2026-08-20T09:00:00Z', ...over,
});

describe('lp-selection-format · formatLpRow (Option A)', () => {
  test('topic is the headline; context line = Grade/Subject · Ch·Day · pages · recency', () => {
    const r = formatLpRow(lp(), { now: NOW });
    expect(r.title).toBe('Adding unlike fractions');
    expect(r.description).toBe('Grade 5 Math · Ch5 Day 3 · p.113–115 · today');
  });

  test('subject is Title-cased (urdu → Urdu)', () => {
    expect(formatLpRow(lp({ subject: 'urdu', topic: 'اکائیوں کی جمع' }), { now: NOW }).description)
      .toContain('Grade 5 Urdu');
  });

  test('relative recency: today / yesterday / short date', () => {
    expect(formatLpRow(lp({ created_at: '2026-08-20T06:00:00Z' }), { now: NOW }).description).toMatch(/· today$/);
    expect(formatLpRow(lp({ created_at: '2026-08-19T06:00:00Z' }), { now: NOW }).description).toMatch(/· yesterday$/);
    expect(formatLpRow(lp({ created_at: '2026-08-10T06:00:00Z' }), { now: NOW }).description).toMatch(/· 10 Aug$/);
  });

  test('caps are enforced in CODE POINTS (Urdu-safe), not JS .length', () => {
    const longTopic = 'ا'.repeat(40); // 40 code points
    const r = formatLpRow(lp({ topic: longTopic }), { now: NOW });
    expect(cp(r.title)).toBeLessThanOrEqual(24);
    expect(cp(r.description)).toBeLessThanOrEqual(72);
    expect(r.title.endsWith('…')).toBe(true); // truncation marker
  });

  test('special segments render as Revision / Assessment when day_label is absent', () => {
    expect(formatLpRow(lp({ lesson_id: 'grade_5_math_ch5_seg995', day_label: null, topic: null }), { now: NOW }).description)
      .toContain('Ch5 Revision');
    expect(formatLpRow(lp({ lesson_id: 'grade_5_math_ch5_seg990', day_label: null, topic: null }), { now: NOW }).description)
      .toContain('Ch5 Assessment');
  });

  test('missing pieces degrade gracefully (no empty "·" segments, no crash)', () => {
    const r = formatLpRow({ lesson_id: 'x', id: 'd', grade: '5', subject: 'math', created_at: NOW.toISOString() }, { now: NOW });
    expect(r.title.length).toBeGreaterThan(0); // falls back to a sensible headline
    expect(r.description).not.toMatch(/·\s*·/); // no doubled separators
    expect(r.description).not.toMatch(/·\s*$/); // no trailing separator
  });

  test('topic falls back to the day/lesson label when the catalog has no topic', () => {
    const r = formatLpRow(lp({ topic: null, day_label: 'Day 3' }), { now: NOW });
    expect(r.title).toBe('Day 3');
  });
});
