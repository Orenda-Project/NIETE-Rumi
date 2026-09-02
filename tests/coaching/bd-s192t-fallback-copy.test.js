'use strict';
/**
 * bd-s192t.4 — one fallback copy served four distinct failure states, and the
 * one it served ("No usable lesson plan was linked…") was FALSE for the
 * dominant state: guard-refused sessions where a plan WAS linked and moves DID
 * resolve. That single string misdirected every field report — and the Sep-1
 * fix cycle — toward LP linking while the real failure sat in transcription.
 * Every non-editable state now names what actually happened.
 */
const { buildScreenPrefill } = require('../../bot/shared/services/observe/observe-draft.service');

describe("bd-s192t.4 — Section B fallback copy is honest per state", () => {
  const prev = process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
  beforeEach(() => { process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'editable'; });
  afterAll(() => {
    if (prev === undefined) delete process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
    else process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = prev;
  });

  const build = (lp) => buildScreenPrefill(
    { framework: 'fico', lp_fidelity: lp, domains: {} },
    'lesson_plan_fidelity',
  );

  test('guard-refused (ok, pct null): says the plan WAS linked and the recording could not be matched — never "no usable lesson plan"', () => {
    const d = build({ status: 'ok', fidelity_pct: null, recording_unusable: true, moves: [{ text: 'm1', verdict: 'not_adjudicable' }] });
    expect(d.no_fidelity).toBe(true);
    expect(d.fid_fallback).not.toMatch(/No usable lesson plan/i);
    expect(d.fid_fallback).toMatch(/linked/i);
    expect(d.fid_fallback).toMatch(/recording/i);
  });

  test('engine failure (fidelity_unavailable): says the check could not run — never "no usable lesson plan"', () => {
    const d = build({ status: 'fidelity_unavailable', error: 'lp_unparseable' });
    expect(d.no_fidelity).toBe(true);
    expect(d.fid_fallback).not.toMatch(/No usable lesson plan/i);
    expect(d.fid_fallback).toMatch(/could not/i);
  });

  test('genuinely no plan (lp_absent, and missing blob): keeps the original copy', () => {
    for (const lp of [{ status: 'lp_absent' }, undefined]) {
      const d = build(lp);
      expect(d.no_fidelity).toBe(true);
      expect(d.fid_fallback).toMatch(/No usable lesson plan was linked/);
      expect(d.fid_fallback).toMatch(/AI assessment/);
    }
  });

  test('all three states produce three DIFFERENT strings', () => {
    const refused = build({ status: 'ok', fidelity_pct: null }).fid_fallback;
    const failed = build({ status: 'fidelity_unavailable' }).fid_fallback;
    const absent = build({ status: 'lp_absent' }).fid_fallback;
    expect(new Set([refused, failed, absent]).size).toBe(3);
  });
});
