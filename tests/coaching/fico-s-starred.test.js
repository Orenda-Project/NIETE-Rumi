'use strict';
/**
 * Queue #184 — "starred" indicators (operator 19 Nov ~11:20: "the E3 indicator is the 'starred' indicator ...
 * Starred indicators are the one that do not get sent to DC and are mandatorily filled by the HITL"; ~14:15: "yeah those
 * six are the starred ones. hitl only are the starred ones basically").
 *   FICO17 v6: the six the workbook marks "HITL only" (C3 C5 C7 D2 D3 D4).
 *   FICO-S:    E3, and what the sheet marks HITL-only: an indicator whose "Aligned v6" codes are all starred in v6
 *              (C3 C5 C7 D2 D3; C6 also aligns with v6 C6, a DC one, so it stays), and the checks the sheet's "How"
 *              says the principal makes himself (E2: 5 random students; E3: 3 random notebooks).
 *
 * Starred is ONE field on each indicator of the rubric registry (rubric.json, written by the rubric's builder), read
 * through the rubric module. No parallel list anywhere else: the DC prompt, the review form and the portal all read
 * STARRED_CODES / isStarred from here.
 */
const fs = require('fs');
const path = require('path');

const S = require('../../bot/shared/services/coaching/frameworks/fico-s');
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { build } = require('../../bot/scripts/build-fico-s-rubric');

describe('FICO-S: starred is one field on each indicator', () => {
  test('every indicator carries starred: true | false in the rubric JSON', () => {
    for (const ind of S.RUBRIC.indicators) expect(typeof ind.starred).toBe('boolean');
  });

  test('starred: E3, the five aligned with v6 HITL-only, and E2 (the principal\'s own check)', () => {
    expect(S.STARRED_CODES).toEqual(['C3', 'C5', 'C7', 'D2', 'D3', 'E2', 'E3']);
    expect(S.isStarred('E3')).toBe(true);
    expect(S.isStarred('C6')).toBe(false); // also aligned with v6 C6, a DC indicator
    expect(S.isStarred('nope')).toBe(false);
  });

  test('DC_CODES are every indicator but the starred ones, in sheet order', () => {
    expect(S.DC_CODES).toEqual(S.CODES.filter((c) => !S.STARRED_CODES.includes(c)));
    expect(S.DC_CODES).toHaveLength(16);
  });

  test("the builder writes it, and says it is ours (the operator's word, not the sheet)", () => {
    const src = JSON.parse(fs.readFileSync(path.join(path.dirname(S.RUBRIC_FILE), 'fico_s_v1_1.source.json'), 'utf8'));
    const out = build(src);
    expect(out.indicators.find((i) => i.code === 'E3').starred).toBe(true);
    expect(out.indicators.filter((i) => i.starred).map((i) => i.code)).toEqual(['C3', 'C5', 'C7', 'D2', 'D3', 'E2', 'E3']);
    expect(out.ours.starred).toMatch(/E3/);
    expect(out.ours.starred).toMatch(/HITL/);
    // the committed JSON is what the builder writes (no hand edits)
    expect(`${JSON.stringify(out, null, 2)}\n`).toBe(fs.readFileSync(S.RUBRIC_FILE, 'utf8'));
  });
});

describe('FICO17 v6: the same field, the six HITL-only indicators', () => {
  test('every v6 indicator carries starred: true | false; the starred ones are the workbook\'s "HITL only" six', () => {
    for (const ind of V6.RUBRIC.indicators) expect(typeof ind.starred).toBe('boolean');
    expect(V6.STARRED_CODES).toEqual(['C3', 'C5', 'C7', 'D2', 'D3', 'D4']);
    expect(V6.STARRED_CODES).toEqual(V6.COMBINED_CODES);
    expect(V6.isStarred('C1')).toBe(false);
  });
});
