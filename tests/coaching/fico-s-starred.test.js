'use strict';
/**
 * Queue #184 — "starred" indicators (operator 19 Nov ~11:20: "the E3 indicator is the 'starred' indicator ...
 * Starred indicators are the one that do not get sent to DC and are mandatorily filled by the HITL").
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

  test('E3 (notebooks) is the one starred indicator', () => {
    expect(S.STARRED_CODES).toEqual(['E3']);
    expect(S.isStarred('E3')).toBe(true);
    expect(S.isStarred('E2')).toBe(false);
    expect(S.isStarred('nope')).toBe(false);
  });

  test('DC_CODES are every indicator but the starred ones, in sheet order', () => {
    expect(S.DC_CODES).toEqual(S.CODES.filter((c) => c !== 'E3'));
    expect(S.DC_CODES).toHaveLength(22);
  });

  test("the builder writes it, and says it is ours (the operator's word, not the sheet)", () => {
    const src = JSON.parse(fs.readFileSync(path.join(path.dirname(S.RUBRIC_FILE), 'fico_s_v1_1.source.json'), 'utf8'));
    const out = build(src);
    expect(out.indicators.find((i) => i.code === 'E3').starred).toBe(true);
    expect(out.indicators.filter((i) => i.starred).map((i) => i.code)).toEqual(['E3']);
    expect(out.ours.starred).toMatch(/E3/);
    // the committed JSON is what the builder writes (no hand edits)
    expect(`${JSON.stringify(out, null, 2)}\n`).toBe(fs.readFileSync(S.RUBRIC_FILE, 'utf8'));
  });
});

describe('FICO17 v6: the same reader', () => {
  test('v6 exposes STARRED_CODES / isStarred from the same field (none starred until the operator names them)', () => {
    expect(Array.isArray(V6.STARRED_CODES)).toBe(true);
    for (const c of V6.STARRED_CODES) expect(V6.indicator(c).starred).toBe(true);
    expect(V6.STARRED_CODES).toEqual(V6.CODES.filter((c) => V6.indicator(c).starred === true));
    expect(typeof V6.isStarred).toBe('function');
  });
});
