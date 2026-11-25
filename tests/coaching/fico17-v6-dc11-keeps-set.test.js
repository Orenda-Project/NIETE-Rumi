'use strict';
/**
 * Queue #282 (bd-ra8xu.64) — found by the prod smoke on 25 Nov: after the reflection pass, a self-recording reported on
 * the 11 lost analysis_data.indicator_set ('dc11'), so the report's dc11 rules (the couldn't-tell lines, no headline
 * when nothing was levelled, the narrative's 11-only list) silently fell back. The reflection pass keeps the v6 record
 * as the first pass wrote it; indicator_set (and dropped_six) are part of that record.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const G = require('../../bot/shared/services/gpt5-mini.service');

const first = () => ({
  framework: 'fico17_v6', rubric: 'fico17_v6', indicator_set: 'dc11', dropped_six: ['D3'],
  domains: { v6_teacher: { indicators: [{ id: 'C1', result: 3, score: 3 }] } },
  scores: { overall_marks: 3, overall_max_marks: 4, rubric: 'fico17_v6' },
  levels: { C1: { result: 3 } },
});

test('indicator_set and dropped_six survive the reflection pass even when the enhance output echoes or blanks them', () => {
  for (const enhanced of [{ executive_summary: 'x' }, { indicator_set: null }, { indicator_set: 'full', dropped_six: [] }]) {
    const out = G._preserveFrameworkShape({ ...enhanced }, first());
    expect(out.indicator_set).toBe('dc11');
    expect(out.dropped_six).toEqual(['D3']);
  }
});

test('a V3 analysis gains neither key', () => {
  const out = G._preserveFrameworkShape({ executive_summary: 'x' }, { framework: 'fico', domains: { a: {} }, scores: {} });
  expect(out.indicator_set).toBeUndefined();
  expect(out.dropped_six).toBeUndefined();
});
