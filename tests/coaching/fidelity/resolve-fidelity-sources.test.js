'use strict';
/**
 * bd-dflr7 — the analysis-processor was gating uploaded-LP fidelity on
 * `lesson_plan_link_method === 'uploaded'`, but real uploads carry
 * link_method=None (auto-detected) and `lesson_plan_text` was never populated,
 * so uploadedText was ALWAYS null and uploaded fidelity never fired.
 *
 * resolveFidelitySources(session) centralises the decision:
 *   - a corpus _fidelity_ref  → corpusKey (preferred), no uploadedText
 *   - else any extracted LP text → uploadedText (regardless of link_method)
 *   - else neither
 */
const { resolveFidelitySources } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

describe('resolveFidelitySources (bd-dflr7)', () => {
  test('corpus _fidelity_ref → corpusKey (preferred), uploadedText null, meta.lesson_id', () => {
    const ref = { lesson_id: 'L1', version_stamp: 'v1', content_hash: 'h1' };
    const r = resolveFidelitySources({ lesson_plan_structured: { _fidelity_ref: ref }, lesson_plan_text: 'ignored when corpus present' });
    expect(r.corpusKey).toEqual(ref);
    expect(r.uploadedText).toBeNull();
    expect(r.meta.lesson_id).toBe('L1');
  });

  test('no ref + lesson_plan_text present → uploadedText, even when link_method is null', () => {
    const r = resolveFidelitySources({ lesson_plan_link_method: null, has_lesson_plan: true, lesson_plan_text: 'LP body text ...' });
    expect(r.corpusKey).toBeNull();
    expect(r.uploadedText).toBe('LP body text ...');
  });

  test("no ref + lesson_plan_text present + link_method 'uploaded' → uploadedText", () => {
    const r = resolveFidelitySources({ lesson_plan_link_method: 'uploaded', has_lesson_plan: true, lesson_plan_text: 'X' });
    expect(r.uploadedText).toBe('X');
  });

  test('no ref + no text → neither', () => {
    const r = resolveFidelitySources({ lesson_plan_link_method: 'none' });
    expect(r.corpusKey).toBeNull();
    expect(r.uploadedText).toBeNull();
  });

  test('null / empty session → neither, no throw', () => {
    expect(() => resolveFidelitySources(null)).not.toThrow();
    const r = resolveFidelitySources(undefined);
    expect(r.corpusKey).toBeNull();
    expect(r.uploadedText).toBeNull();
    expect(r.meta).toBeDefined();
  });
});
