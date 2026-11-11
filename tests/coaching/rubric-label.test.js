'use strict';
/**
 * bd-ra8xu.43 — every observation shows the rubric it was scored with (operator 11 Nov ~18:15), read from what was
 * stored, never the live switch. One pure helper; every branch here.
 */
const { rubricLabelOf, rubricLabelText } = require('../../bot/shared/services/coaching/rubric-label');

const v3Domains = {
  high_leverage_practices: { indicators: Array.from({ length: 12 }, (_, i) => ({ id: `C${i + 1}`, score: 3 })) },
  teacher_subject_knowledge: { indicators: [{ id: 'F1', score: 4 }, { id: 'F5', score: null, applicable: false }] },
};
const v4Domains = {
  high_leverage_practices: { indicators: [{ id: 'C1', score: 2 }, { id: 'C2', score: 1 }, { id: 'C3', score: 2 }, { id: 'C4', score: 0 }] },
  teacher_subject_knowledge: { indicators: [{ id: 'F9', score: 2 }, { id: 'F10', score: 1 }] },
};

describe('rubricLabelOf', () => {
  test('/observe2 v6 visit: from the observe2 stamp; the label is framework + version only, no prompt version', () => {
    expect(rubricLabelOf({ analysis: { framework: 'fico', domains: v3Domains, observe2: { rubric: 'fico17_v6', prompt_version: 'fico17-v6-coach-1+3191bbae' } } }))
      .toEqual({ id: 'fico17_v6', label: 'FICO17 v6' });
  });
  test('/observe2 v5 visit: FICO17 v5, even though framework says fico', () => {
    expect(rubricLabelOf({ analysis: { framework: 'fico', domains: v3Domains, observe2: { rubric: 'fico17' } } })).toEqual({ id: 'fico17', label: 'FICO17 v5' });
  });
  test('/observe2 visit known only by its form', () => {
    expect(rubricLabelOf({ form: { rubric_version: 'fico-ict-17-2026-09' } })).toEqual({ id: 'fico17', label: 'FICO17 v5' });
    expect(rubricLabelOf({ form: { rubric_version: 'fico17_v6' } })).toEqual({ id: 'fico17_v6', label: 'FICO17 v6' });
  });
  test('/observe v6 visit: framework fico17_v6, shown as FICO17 v6 (never the hash)', () => {
    expect(rubricLabelOf({ session: { framework: 'fico17_v6', analysis_data: { framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+3191bbae' } } }))
      .toEqual({ id: 'fico17_v6', label: 'FICO17 v6' });
  });
  test('FICO V3 and V4 told apart by shape', () => {
    expect(rubricLabelOf({ analysis: { framework: 'fico', domains: v3Domains } })).toEqual({ id: 'fico_v3', label: 'FICO V3' });
    expect(rubricLabelOf({ analysis: { framework: 'fico', domains: v4Domains } })).toEqual({ id: 'fico_v4', label: 'FICO V4' });
  });
  test('a self-recording shadow-scored on v6 is labelled by what she was scored and shown with', () => {
    expect(rubricLabelOf({ analysis: { framework: 'fico', domains: v3Domains, shadow: { fico17_v6: { rubric: 'fico17_v6' } } } }).id).toBe('fico_v3');
  });
  test('other frameworks by name; unknown as stored; nothing → null', () => {
    expect(rubricLabelOf({ session: { framework: 'mewaka' } })).toEqual({ id: 'mewaka', label: 'MEWAKA' });
    expect(rubricLabelOf({ analysis: { framework: 'hots' } }).label).toBe('HOTS');
    expect(rubricLabelOf({ analysis: { framework: 'fde_gms' } })).toEqual({ id: 'fde_gms', label: 'FDE_GMS' });
    expect(rubricLabelOf({})).toBeNull();
    expect(rubricLabelOf()).toBeNull();
    expect(rubricLabelText({})).toBe('');
    expect(rubricLabelText({ session: { framework: 'oecd' } })).toBe('OECD');
  });
  test('no label ever carries a hash, a prompt version or a colon-dot separator', () => {
    const inputs = [
      { analysis: { observe2: { rubric: 'fico17_v6', prompt_version: 'fico17-v6-coach-1+3191bbae' } } },
      { analysis: { framework: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+3191bbae' } },
      { analysis: { framework: 'fico', domains: v3Domains } },
      { form: { rubric_version: 'fico-ict-17-2026-09' } },
    ];
    for (const i of inputs) expect(rubricLabelOf(i).label).toMatch(/^FICO(17)? v?\w+$|^FICO V\d$/);
    for (const i of inputs) expect(rubricLabelOf(i).label).not.toMatch(/[+·]|-v6-|\d{4}-\d{2}/);
  });
  test('the session framework is used when the analysis has none', () => {
    expect(rubricLabelOf({ session: { framework: 'fico', analysis_data: { domains: v3Domains } } }).label).toBe('FICO V3');
  });
});
