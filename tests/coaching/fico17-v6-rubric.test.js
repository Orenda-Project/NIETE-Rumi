'use strict';
/**
 * bd-ra8xu.38 — fico17_v6.rubric.json is generated from the binding text (deploy spec Appendix A) and matches it.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const gen = require('../../bot/scripts/build-fico17-v6-rubric');

describe('FICO17 v6 rubric data', () => {
  test('the committed JSON is exactly what the generator writes from Appendix A', () => {
    const out = execFileSync('node', [path.join(ROOT, 'bot/scripts/build-fico17-v6-rubric.js'), '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/current/);
    expect(gen.render(gen.build())).toBe(require('fs').readFileSync(gen.OUT, 'utf8'));
  });

  test('17 indicators in order, 11 DC and 6 combined (spec §5.1)', () => {
    expect(v6.CODES).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'D1', 'D2', 'D3', 'D4', 'D5', 'F1', 'F2', 'F3', 'F4']);
    expect(v6.DC_CODES).toEqual(['C1', 'C2', 'C4', 'C6', 'C8', 'D1', 'D5', 'F1', 'F2', 'F3', 'F4']);
    expect(v6.COMBINED_CODES).toEqual(['C3', 'C5', 'C7', 'D2', 'D3', 'D4']);
    expect(v6.RUBRIC.rubric).toBe('fico17_v6');
    expect(v6.LEVEL_LABELS).toEqual({ 1: 'Not Observed', 2: 'Developing', 3: 'Proficient', 4: 'Highly Effective' });
  });

  test('v6 names, word for word', () => {
    expect(v6.indicator('C1').name).toBe('Quality of Questions Asked by the Teacher');
    expect(v6.indicator('C5').name).toBe('Switching activities');
    expect(v6.indicator('C5').was).toBe('Classroom Management');
    expect(v6.indicator('D2').name).toBe('How many children spoke');
  });

  test('levels with no example carry example: null (C7, C8, F4, D2 level 1)', () => {
    for (const code of ['C7', 'C8', 'F4', 'D2']) expect(v6.indicator(code).levels[0].example).toBeNull();
    expect(v6.indicator('C1').levels[0].example).toMatch(/capital of Pakistan/);
  });

  test('every indicator has 4 levels, a definition and a couldn\'t-tell line', () => {
    for (const code of v6.CODES) {
      const ind = v6.indicator(code);
      expect(ind.levels.map((l) => l.n)).toEqual([1, 2, 3, 4]);
      expect(ind.definition).toBeTruthy();
      expect(ind.couldnt_tell).toBeTruthy();
    }
  });

  test('D3 carries its N/A rule; combined ones carry what the DC reports and what the coach adds', () => {
    expect(v6.indicator('D3').na_rule).toMatch(/^Do not score this indicator if there are no two Student lines/);
    for (const code of v6.COMBINED_CODES) {
      expect(v6.indicator(code).combined_evidence).toBeTruthy();
      expect(v6.indicator(code).coach_adds).toBeTruthy();
    }
    for (const code of v6.DC_CODES) expect(v6.indicator(code).combined_evidence).toBeNull();
    expect(v6.indicator('D2').levels_for).toBe('coach');
    expect(v6.indicator('C1').na_link).toBe('C3 and D4 are N/A when C1 is scored 1.');
  });

  test('every level title fits WhatsApp\'s 30-code-point option cap; descriptions fit 300', () => {
    for (const code of v6.CODES) {
      expect(v6.TITLES[code]).toHaveLength(4);
      for (const t of v6.TITLES[code]) expect(v6.cp(t)).toBeLessThanOrEqual(30);
      for (const o of v6.levelOptions(code, { couldntTell: true })) {
        expect(v6.cp(o.title)).toBeLessThanOrEqual(30);
        expect(v6.cp(o.description)).toBeLessThanOrEqual(300);
      }
    }
  });

  test('the combined titles are the spec\'s (§7.3)', () => {
    expect(v6.TITLES.C3).toEqual(['Took whoever answered', 'Chose who answered once', 'Chose who answered 2+ times', '2+ named children answered']);
    expect(v6.TITLES.C5).toEqual(['Over 3 min, no signal', 'Signal, 2-3 min', 'Under 2 min', 'Switched without being told']);
    expect(v6.TITLES.D2).toEqual(['No child spoke', 'Only 1-2 children', '3-5 children', '6+, and 2+ quiet ones later']);
  });

  test('the DC prompt version carries the rubric data hash', () => {
    expect(v6.DC_PROMPT_VERSION).toMatch(/^fico17-v6-dc-1\+[0-9a-f]{8}$/);
    expect(v6.stamp()).toEqual({ rubric: 'fico17_v6', prompt_version: v6.DC_PROMPT_VERSION });
  });
});
