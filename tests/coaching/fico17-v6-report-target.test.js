'use strict';
/**
 * bd-ra8xu.40 — a FICO17 v6 /observe report names its next horizon and its strength from the coach's final levels.
 *
 * A v6 analysis has no focus_area (the v6 scorer and the review write none), so resolveTarget returned null and the
 * report's horizon, card and debrief had nothing to name. For a v6 analysis (not /observe2, which keeps its own
 * target) the target is now the LOWEST numeric final level among the 17, and the strength the HIGHEST (level 2 or
 * above, never the target's row). NA, couldn't-tell and no-level rows never count: they are not low marks.
 * Tie-break, both ways: a row with evidence text (as the coach submitted it) first, then rubric order (C1 … F4).
 * The rationale is that row's evidence as submitted; Rumi's own (rumi_evidence) is never read. The levels are the v6
 * level texts: v6 C3 is not V3 C3, so no V3 spec (count bar, levels) ever rides on a v6 row.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { resolveTarget, resolveIndicator, resolveStrength, v6NextLevel } = require('../../bot/shared/services/coaching/target-resolver');
const { selectNextStep, focusPatch } = require('../../bot/shared/services/coaching/next-step');
const { RUMI, COACH, dcV6, reviewedV6, rowOf } = require('../fixtures/fico17-v6-reviewed');
const { v3Lesson } = require('../fixtures/report-prompt-pins');

const v6Levels = (code) => Object.fromEntries([1, 2, 3, 4].map((n) => [n, V6.levelText(code, n)]));

describe('resolveTarget on a reviewed v6 /observe visit', () => {
  test('the lowest final level, named and described by the v6 rubric, with the coach\'s evidence', () => {
    const t = resolveTarget(reviewedV6());
    expect(t).toEqual({
      indicator: 'C4',
      domain: 'v6_teacher',
      name: V6.indicator('C4').name,
      rung: 1,
      rationale: COACH.EV_C4,
      try: '',
      title: V6.indicator('C4').name,
      count: null,
      levels: v6Levels('C4'),
      rubric: 'fico17_v6',
    });
  });

  test('never Rumi\'s own evidence, even on a row the coach changed', () => {
    const t = resolveTarget(reviewedV6());
    expect(t.rationale).not.toContain(RUMI.C4[1]);
    expect(t.rationale).not.toContain(RUMI.C4[3]);
  });

  test('tie-break: a row with evidence text beats an earlier one without (the coach cleared C4\'s box)', () => {
    const t = resolveTarget(reviewedV6({ ev_C4: '' }));
    expect(t.indicator).toBe('D3');
    expect(t.rationale).toBe(COACH.D3);
    expect(t.levels).toEqual(v6Levels('D3'));
  });

  test('tie-break: rubric order among rows that all have evidence (C4 before D3 and D5)', () => {
    const a = reviewedV6();
    expect([rowOf(a, 'C4').score, rowOf(a, 'D3').score, rowOf(a, 'D5').score]).toEqual([1, 1, 1]);
    expect(resolveTarget(a).indicator).toBe('C4');
  });

  test('NA, couldn\'t-tell and no-level rows never count as low', () => {
    const a = reviewedV6({ r_C4: '4', r_D3: '4', why_D3: COACH.D3, r_D5: '4', r_C3: '4', r_F3: '4', r_F4: '4' });
    const t = resolveTarget(a);
    expect(['C2', 'C7', 'C8']).not.toContain(t.indicator);
    expect(typeof t.rung).toBe('number');
    expect(t.rung).toBe(3);
    expect(t.indicator).toBe('C1');
  });

  test('a focus_area written back by the next step (focusPatch) round-trips to the same v6 target', () => {
    const a = reviewedV6();
    const first = resolveTarget(a);
    Object.assign(a, focusPatch(a, first));
    expect(a.focus_area.indicator).toBe('C4');
    const again = resolveTarget(a);
    expect(again).toMatchObject({ indicator: 'C4', domain: 'v6_teacher', rung: 1, count: null, levels: v6Levels('C4') });
  });

  test('a focus_area on a row with no level is not used: the target is derived from the levels', () => {
    const a = reviewedV6();
    a.focus_area = { indicator: 'C7', title: 'Group work', rationale: 'x' };
    expect(resolveTarget(a).indicator).toBe('C4');
  });
});

describe('a DC v6 self-recording (no review)', () => {
  test('the six combined indicators have no level, so the target is among the 11', () => {
    const t = resolveTarget(dcV6());
    expect(V6.isCombined(t.indicator)).toBe(false);
    expect(t.indicator).toBe('D5');
    expect(t.rung).toBe(1);
    expect(t.rationale).toContain(RUMI.D5[1]);
  });
  test('resolveIndicator on a combined code is null (no level)', () => {
    expect(resolveIndicator(dcV6(), 'C3')).toBeNull();
  });
});

describe('resolveIndicator on v6 ids', () => {
  test('a v6 id resolves to the v6 row, never V3\'s indicator of the same id', () => {
    const t = resolveIndicator(reviewedV6(), 'C3');
    expect(t).toMatchObject({ indicator: 'C3', domain: 'v6_teacher', name: 'Who got to answer', rung: 2, rationale: COACH.C3, count: null });
    expect(t.levels).toEqual(v6Levels('C3'));
    const v3 = resolveIndicator(v3Lesson(), 'C3');
    expect(v3.levels).not.toEqual(t.levels);
  });
  test('NA and couldn\'t-tell rows are null', () => {
    expect(resolveIndicator(reviewedV6(), 'C7')).toBeNull();
    expect(resolveIndicator(reviewedV6(), 'C8')).toBeNull();
  });
  test('an id that is not a v6 row is null', () => {
    expect(resolveIndicator(reviewedV6(), 'B1')).toBeNull();
  });
});

describe('resolveStrength — the strongest final level', () => {
  test('the highest level, with the coach-submitted evidence; tie-break rubric order (C6 before F1)', () => {
    const s = resolveStrength(reviewedV6());
    expect(s).toMatchObject({ indicator: 'C6', domain: 'v6_teacher', name: V6.indicator('C6').name, rung: 4 });
    expect(s.rationale).toContain(RUMI.C6[3]);
  });
  test('tie-break: a row with evidence text first (the coach cleared C6\'s box)', () => {
    expect(resolveStrength(reviewedV6({ ev_C6: '' })).indicator).toBe('F1');
  });
  test('never the target\'s own row', () => {
    const a = reviewedV6();
    expect(resolveStrength(a, { indicator: 'C6' }).indicator).toBe('F1');
  });
  test('null when nothing reached level 2', () => {
    const lows = {};
    for (const c of V6.CODES) lows[`r_${c}`] = V6.isCombined(c) ? '1' : '1';
    lows.d2_children = '0';
    const a = reviewedV6(lows);
    expect(resolveStrength(a)).toBeNull();
  });
  test('null for a V3 analysis (its strengths are its own)', () => {
    expect(resolveStrength(v3Lesson())).toBeNull();
  });
});

describe('v6NextLevel — what the next level asks, in plain rubric words', () => {
  test('level 1 → the level 2 text', () => {
    expect(v6NextLevel(resolveTarget(reviewedV6()))).toBe(V6.levelText('C4', 2));
  });
  test('a "Beyond level 3, …" text loses its number', () => {
    const t = resolveIndicator(reviewedV6(), 'C1');
    expect(V6.levelText('C1', 4)).toMatch(/^Teacher asks/);
    const f2 = resolveIndicator(reviewedV6(), 'F2');
    expect(v6NextLevel(f2)).toBe('The teacher makes students use the subject words, and corrects loose words by giving the right one.');
    expect(v6NextLevel(t)).toBe(V6.levelText('C1', 4));
  });
  test('null at the top level, and for a V3 target', () => {
    expect(v6NextLevel(resolveIndicator(reviewedV6(), 'C6'))).toBeNull();
    expect(v6NextLevel(resolveTarget(v3Lesson()))).toBeNull();
  });
});

describe('the report\'s ONE next step names the same v6 target (next-step, report-generator)', () => {
  test('selectNextStep takes the v6 target, not the weakest-row fallback', () => {
    const a = reviewedV6();
    const step = selectNextStep(a, null);
    expect(step.fallback).toBe(false);
    expect(step.target).toEqual(resolveTarget(a));
  });
});
