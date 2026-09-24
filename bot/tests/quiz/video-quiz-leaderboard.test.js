'use strict';
/**
 * bd-2yyry.10 — the child's class card: ranking and what gets painted.
 *
 * The card is for the CHILD (never the teacher): where they stand against
 * the class on this quiz, the top performers named, their own row lit. The
 * rules under test are the ones a wrong card would break for a real class:
 * shared rank on a tie, a bounded list, the child's row always present, and
 * the copy addressing the child as "you" only.
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const render = require('../../shared/templates/video-quiz-leaderboard.template');
const { rankRows, visibleRows, MAX_ROWS } = render;
const { resolveUx } = require('../../shared/config/ux-strings');

const mk = (n, scores) => scores.map((c, i) => ({
  sessionId: `s${i + 1}`, name: `Child ${i + 1}`, correct: c, total: n, pct: Math.round(100 * c / n),
  completedAt: `2026-09-14T0${(i % 9) + 1}:00:00Z`,
}));

describe('rankRows', () => {
  test('orders by percentage, then correct count, then who finished first; ties share a rank', () => {
    const ranked = rankRows(mk(8, [8, 8, 7, 6, 6, 6, 2]));
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3, 4, 4, 4, 7]);
    expect(ranked.map((r) => r.tied)).toEqual([true, true, false, true, true, true, false]);
  });

  test('rows without a numeric pct are dropped rather than ranked', () => {
    const ranked = rankRows([{ sessionId: 'x', pct: 'n/a' }, { sessionId: 'y', pct: 50 }]);
    expect(ranked.map((r) => r.sessionId)).toEqual(['y']);
  });
});

describe('visibleRows', () => {
  const ranked = rankRows(mk(8, [8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1]));   // 20 children

  test('a small class is painted whole', () => {
    const small = rankRows(mk(8, [8, 6, 4]));
    expect(visibleRows(small, 1, 'full').map((r) => r.sessionId)).toEqual(['s1', 's2', 's3']);
  });

  test('a big class is bounded to MAX_ROWS with a gap row, and the child low down is still on the card', () => {
    const target = ranked.findIndex((r) => r.sessionId === 's16');   // one of the 1/8s, far down
    expect(target).toBeGreaterThan(MAX_ROWS);
    const rows = visibleRows(ranked, target, 'full');
    expect(rows.length).toBeLessThanOrEqual(MAX_ROWS + 1);
    expect(rows.some((r) => !r.gap && r.sessionId === 's16')).toBe(true);
    const gaps = rows.filter((r) => r.gap);
    expect(gaps.reduce((s, g) => s + g.count, 0) + rows.filter((r) => !r.gap).length).toBe(20);
  });

  test('a child inside the top sees the top and one gap row counting the rest', () => {
    const rows = visibleRows(ranked, 2, 'full');
    expect(rows.filter((r) => !r.gap)).toHaveLength(MAX_ROWS - 1);
    expect(rows[rows.length - 1]).toMatchObject({ gap: true, count: 20 - (MAX_ROWS - 1) });
  });

  test("'top' mode hides names below the top five except the child's own", () => {
    const rows = visibleRows(rankRows(mk(8, [8, 7, 6, 5, 4, 3, 2, 1])), 6, 'top');
    expect(rows.map((r) => r.anon)).toEqual([false, false, false, false, false, true, false, true]);
  });
});

describe('the rendered card', () => {
  const rows = mk(8, [8, 8, 7, 6, 6, 6, 2]);

  test('names the child as "you" with their rank, their score and the class average, in the quiz language', () => {
    const html = render({ topic: 'Proper Fractions', subject: 'Maths', className: 'Class 4',
      language: 'en', rows, targetSessionId: 's4', mode: 'full' });
    expect(html).toContain('You are joint 4th of 7');
    expect(html).toContain("<div class='n'>75%</div>");   // the child's own score
    expect(html).toContain("<div class='n'>77%</div>");   // the class average
    expect(html).toContain("class='row me'");
    expect(html).toContain(resolveUx('vqClassYou', { language: 'en' }));
    expect(html).not.toMatch(/\b(she|her|he|his)\b/i);
  });

  test('the Urdu card is right-to-left, from the catalog, and its number-led lines carry the RTL mark', () => {
    const html = render({ topic: 'صحیح کسر', subject: 'ریاضی', className: 'جماعت 4',
      language: 'ur', rows, targetSessionId: 's1', mode: 'full' });
    expect(html).toContain("<div class='card' dir='rtl'>");
    expect(html).toContain(resolveUx('vqClassEyebrow', { language: 'ur' }));
    expect(html).toContain('‏7 میں سے آپ مشترکہ پہلے نمبر پر');  // oblique before نمبر پر
  });

  test('a class of one still renders: rank 1 of 1, no gap row', () => {
    const html = render({ topic: 'T', language: 'en', rows: rows.slice(0, 1), targetSessionId: 's1', mode: 'full' });
    expect(html).toContain('You came 1st of 1');
    expect(html).not.toContain("class='row gap");
  });
});
