'use strict';
/**
 * bd-ra8xu.52 — a self-recording reported on FICO17 v6 goes through the reflection pass (enhanceAnalysisWithReflections)
 * like any other. Its v6 record (levels, combined_evidence, the rubric stamps, transcript_quality, and V3 kept under
 * v3_fico) must come through it as the first pass wrote it: the enhance prompt is OECD-shaped and may echo or rewrite
 * any of them. A V3 ('fico') analysis is untouched by this (none of these keys are added to it).
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const G = require('../../bot/shared/services/gpt5-mini.service');

const V6_KEYS = ['levels', 'combined_evidence', 'rubric', 'prompt_version', 'transcript_quality', 'v3_fico'];

function v6FirstPass() {
  return {
    framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'dc-v6.1',
    domains: { C: { indicators: [{ id: 'C1', result: 3, score: 3 }] } },
    scores: { overall_marks: 33, overall_max_marks: 44, rubric: 'fico17_v6' },
    levels: { C1: { result: 3, because: 'seen' } },
    combined_evidence: { C3: { result: null, items: [{ time: '00:10', quote: 'Ali?' }] }, D2: { student_turns_first_half: 3, student_turns_second_half: 2 } },
    transcript_quality: { status: 'ok', coverage: 1, issues: [] },
    v3_fico: { framework: 'fico', scores: { overall_marks: 64, overall_max_marks: 100 } },
    topic: 'Halves',
  };
}

test('every v6 key survives the reflection pass as the first pass wrote it, even when the enhance pass rewrote it', () => {
  const first = v6FirstPass();
  const enhanced = {
    framework: 'oecd', executive_summary: 'enhanced', debrief_reflection: { q: {} },
    levels: { C1: { result: 1, because: 'the enhance pass made this up' } },
    rubric: 'oecd', v3_fico: 'rewritten',
  };
  const out = G._preserveFrameworkShape(enhanced, first);
  for (const k of V6_KEYS) expect(out[k]).toEqual(first[k]);
  expect(out.framework).toBe('fico17_v6');
  expect(out.scores.rubric).toBe('fico17_v6');
  expect(out.debrief_reflection).toEqual({ q: {} });
});

test('a V3 analysis gains none of those keys', () => {
  const first = { framework: 'fico', domains: { a: {} }, scores: { overall_marks: 64 } };
  const out = G._preserveFrameworkShape({ executive_summary: 'x' }, first);
  for (const k of V6_KEYS) expect(out[k]).toBeUndefined();
});
