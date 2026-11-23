'use strict';

/**
 * FICO17 v6.1 (queue #218, the operator's go 21 Nov after approving #216's lists): v6 with per-indicator N/A (C2 C3 C5
 * D4, each with its own words), D2 in words, and one refinement: D4 is N/A only when the teacher asked no question at
 * all (asked and then gave the answer is D4's level 1). The rubric key stays 'fico17_v6' (its codes and level meanings
 * do not change); every new observation is stamped rubric_version '6.1' and shown as 'FICO17 v6.1'. An observation
 * stored before carries no version and keeps 'FICO17 v6'.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const { rubricLabelOf, rubricLabelText } = require('../../bot/shared/services/coaching/rubric-label');

function reply() {
  const levels = {};
  for (const c of v6.DC_CODES) levels[c] = { result: 2, because: 'seen', evidence: [] };
  levels.C2 = { result: 'NA', because: 'no wrong answers', evidence: [] };
  const combined = Object.fromEntries(v6.COMBINED_CODES.map((c) => [c, { result: null, items: [] }]));
  return { levels, combined_evidence: combined };
}

describe('FICO17 v6.1: the version stamp', () => {
  test('the rubric names its version and label; the key stays fico17_v6', () => {
    expect(v6.RUBRIC_KEY).toBe('fico17_v6');
    expect(v6.RUBRIC_VERSION).toBe('6.1');
    expect(v6.LABEL).toBe('FICO17 v6.1');
  });

  test('every stamp (Digital Coach and coach) carries rubric_version 6.1', () => {
    expect(v6.stamp('dc')).toEqual(expect.objectContaining({ rubric: 'fico17_v6', rubric_version: '6.1' }));
    expect(v6.stamp('coach')).toEqual(expect.objectContaining({ rubric: 'fico17_v6', rubric_version: '6.1' }));
  });

  test("a new Digital Coach analysis is stamped 6.1", () => {
    const a = fw.computeScores(reply());
    expect(a.rubric).toBe('fico17_v6');
    expect(a.rubric_version).toBe('6.1');
  });

  test("the coach's review of a new visit is stamped 6.1", () => {
    const review = O6.buildReview(fw.computeScores(reply()), { r_C1: '3' });
    expect(review.rubric).toBe('fico17_v6');
    expect(review.rubric_version).toBe('6.1');
  });

  test('versionOf: 6.1 when stamped, 6.0 for an observation stored before v6.1 (no field), null for non-v6', () => {
    expect(v6.versionOf({ rubric: 'fico17_v6', rubric_version: '6.1' })).toBe('6.1');
    expect(v6.versionOf({ framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+3191bbae' })).toBe('6.0');
    expect(v6.versionOf({ framework: 'fico', domains: {} })).toBeNull();
  });
});

describe("FICO17 v6.1: the label every observation shows", () => {
  test('a new observation reads FICO17 v6.1 (by its analysis, or by the coach review inside it)', () => {
    expect(rubricLabelOf({ analysis: { framework: 'fico17_v6', rubric: 'fico17_v6', rubric_version: '6.1' } }))
      .toEqual({ id: 'fico17_v6', label: 'FICO17 v6.1' });
    expect(rubricLabelText({ session: { framework: 'fico17_v6', analysis_data: { framework: 'fico17_v6', fico17_v6_review: { rubric: 'fico17_v6', rubric_version: '6.1' } } } }))
      .toBe('FICO17 v6.1');
  });

  test('an old observation keeps FICO17 v6', () => {
    expect(rubricLabelOf({ session: { framework: 'fico17_v6', analysis_data: { framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-2+abcd1234' } } }))
      .toEqual({ id: 'fico17_v6', label: 'FICO17 v6' });
    expect(rubricLabelOf({ form: { rubric_version: 'fico17_v6' } })).toEqual({ id: 'fico17_v6', label: 'FICO17 v6' });
  });

  test("the label never carries a hash or a prompt version", () => {
    const l = rubricLabelText({ analysis: { framework: 'fico17_v6', rubric_version: '6.1', prompt_version: v6.DC_PROMPT_VERSION } });
    expect(l).toBe('FICO17 v6.1');
    expect(l).not.toMatch(/[+]|-dc-|coach-/);
  });
});

describe('FICO17 v6.1: D4 is N/A only when no question was asked at all (#216 refinement)', () => {
  test("D4's note after C1 = 1 says to keep N/A only if no question was asked, and level 1 if the teacher answered it", () => {
    const en = v6.naFollowNote('D4', 'en');
    expect(en).toMatch(/C1/);
    expect(en).toMatch(/no question at all/i);
    expect(en).toMatch(/gave the answer/i);
    expect(en).toMatch(/Not Observed/);
    const ur = v6.naFollowNote('D4', 'ur');
    expect(ur).toMatch(/لاگو نہیں/);
    expect(ur).toMatch(/خود جواب/);
  });

  test("D4's N/A option says the same in its description (en + ur), within WhatsApp's limits", () => {
    const en = v6.naOption('D4', 'en');
    expect(en.title).toBe('N/A · No question asked');
    expect(en.description).toMatch(/no question at all/i);
    expect(en.description).toMatch(/gave the answer/i);
    expect(Array.from(en.description).length).toBeLessThanOrEqual(300);
    const ur = v6.naOption('D4', 'ur');
    expect(ur.description).toMatch(/خود جواب/);
    expect(Array.from(ur.description).length).toBeLessThanOrEqual(300);
  });

  test("C3's note and words are unchanged (no question asked means no child chosen)", () => {
    expect(v6.naFollowNote('C3', 'en')).toBe('You set C1 to Not Observed (no question for the children to answer), so N/A is chosen here. Change it if a child was asked.');
    expect(v6.naOption('C3', 'en').description).toBe('The teacher asked the children no question to answer, so no child was chosen.');
  });

  test('the coach Flow shows the D4 note under the definition when C1 = 1', () => {
    const a = fw.computeScores(reply());
    const d = O6.screenData(a, 'IND_D_FOUR', { lang: 'en', edits: { r_C1: '1' } });
    expect(d.init.r_D4).toBe('NA');
    expect(d.definition).toMatch(/no question at all/i);
  });
});
