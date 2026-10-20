'use strict';
/**
 * bd-tbprit.10 — Rifat's "3. Is this a pattern?": her last 12 lessons up to this one, her average and best, her
 * recordings a week against the ICT average, the step she missed here counted over her last 5 checked lessons, and
 * how often she disagreed before. Nothing is filled in: no plan checked is null, never a guess.
 */
const { patternOf, ICT_PER_WEEK } = require('../../dashboard/services/coach-disagreement-pattern');

const day = (d) => new Date(Date.UTC(2026, 7, 21) + d * 86400000).toISOString();
const L = (d, pct, moves = null) => ({ id: `s${d}`, createdAt: day(d), pct, moves });
const M = (phase, verdict) => ({ phase, verdict });

describe('patternOf: the trend', () => {
  const lessons = [L(0, 71.5), L(7, 68.6), L(14, 75), L(21, 58.2)];

  it('points oldest first, rounded, with their dates; average, best (first time) and now', () => {
    const p = patternOf({ lessons, earlier: 0, recordingLess: false });
    expect(p.points).toEqual([
      { pct: 72, date: day(0) }, { pct: 69, date: day(7) }, { pct: 75, date: day(14) }, { pct: 58, date: day(21) },
    ]);
    expect(p.avg).toBe(68);
    expect(p.best).toEqual({ pct: 75, date: day(14) });
    expect(p.now).toBe(58);
    expect(p.count).toBe(4);
  });

  it('a lesson with no score is left out of the line, never drawn as zero', () => {
    const p = patternOf({ lessons: [L(0, 70), L(3, null), L(6, 60)], earlier: 0, recordingLess: false });
    expect(p.points.map((x) => x.pct)).toEqual([70, 60]);
    expect(p.avg).toBe(65);
  });

  it('no scored lesson: no trend numbers at all', () => {
    const p = patternOf({ lessons: [L(0, null)], earlier: 0, recordingLess: false });
    expect(p.points).toEqual([]);
    expect([p.avg, p.best, p.now]).toEqual([null, null, null]);
  });
});

describe('patternOf: recordings a week', () => {
  it('lessons over the weeks they span, one decimal; the ICT average rides along', () => {
    // Rifat's Annie: 12 lessons, 21 Aug to 13 Oct (53 days) = 1.6 a week, steady
    const twelve = Array.from({ length: 12 }, (_, i) => L(Math.round((i * 53) / 11), 70));
    const p = patternOf({ lessons: twelve, earlier: 0, recordingLess: false });
    expect(p.perWeek).toBe(1.6);
    expect(p.level).toBe('steady');
    expect(p.ictAvg).toBe(ICT_PER_WEEK);
    expect(ICT_PER_WEEK).toBe(1.52);
    expect([p.firstDate, p.lastDate]).toEqual([day(0), day(53)]);
  });

  it('2 or more a week is active; under a week of lessons counts as one week', () => {
    const p = patternOf({ lessons: [L(0, 60), L(2, 60), L(4, 60)], earlier: 0, recordingLess: false });
    expect(p.perWeek).toBe(3);
    expect(p.level).toBe('active');
    const two = patternOf({ lessons: [0, 4, 8, 12, 16, 20, 24, 28].map((d) => L(d, 60)), earlier: 0, recordingLess: false });
    expect(two.perWeek).toBe(2);
    expect(two.level).toBe('active');
  });

  it("recording less (the list's tag) is at risk, whatever the rate", () => {
    expect(patternOf({ lessons: [L(0, 60), L(2, 60), L(4, 60)], earlier: 0, recordingLess: true }).level).toBe('atRisk');
  });

  it('one lesson: no rate', () => {
    const p = patternOf({ lessons: [L(0, 60)], earlier: 0, recordingLess: false });
    expect([p.perWeek, p.level]).toEqual([null, null]);
  });
});

describe('patternOf: the step missed in her last 5 lessons', () => {
  it("this lesson's most-missed step, counted over her last 5 checked lessons", () => {
    const lessons = [
      L(0, 60, [M('guided', 'not_done')]), // 6th from the end: not counted
      L(1, 60, [M('guided', 'executed')]),
      L(2, 60, null), // plan not checked: not counted
      L(3, 60, [M('guided', 'partial')]),
      L(4, 60, [M('guided', 'not_done'), M('explain', 'executed')]),
      L(5, 60, [M('guided', 'executed')]),
      L(6, 60, [M('explain', 'not_done'), M('guided', 'not_done'), M('guided', 'partial')]),
    ];
    expect(patternOf({ lessons, earlier: 0, recordingLess: false }).missed).toEqual({ step: 'guided', n: 3, of: 5 });
  });

  it('ties go to the plan order', () => {
    const lessons = [L(0, 60, [M('explain', 'not_done'), M('guided', 'not_done')])];
    expect(patternOf({ lessons, earlier: 0, recordingLess: false }).missed).toEqual({ step: 'explain', n: 1, of: 1 });
  });

  it('nothing missed in this lesson: no step, still out of the checked lessons', () => {
    const lessons = [L(0, 60, [M('guided', 'not_done')]), L(1, 60, [M('guided', 'executed')])];
    expect(patternOf({ lessons, earlier: 0, recordingLess: false }).missed).toEqual({ step: null, n: 0, of: 2 });
  });

  it("this lesson's plan not checked: null, never a guess", () => {
    const lessons = [L(0, 60, [M('guided', 'not_done')]), L(1, 60, null)];
    expect(patternOf({ lessons, earlier: 0, recordingLess: false }).missed).toBeNull();
  });
});

describe('patternOf: earlier disagreements', () => {
  it('passes her earlier count through', () => {
    expect(patternOf({ lessons: [], earlier: 2, recordingLess: false }).earlier).toBe(2);
    expect(patternOf({ lessons: [], earlier: 0, recordingLess: false }).earlier).toBe(0);
  });
});
