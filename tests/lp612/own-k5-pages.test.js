/**
 * bd-snkn32.17 — the book pages of a grades 1–5 Make my own (lp-k5-own-pages, pure): the day's own pages from the
 * catalogue, her range checked (whole numbers, start ≤ end, not longer than a sensible span), and the one line the
 * rewrite is told so the plan teaches those pages.
 */
const { dayPages, parseK5Pages, pagesLine, MAX_SPAN, MAX_PAGE } = require('../../bot/shared/services/lp-k5-own-pages');

describe('dayPages — the day\'s own pages from its catalogue row', () => {
  it('is the first and last page of the list, in any order', () => {
    expect(dayPages({ pages: [3, 4] })).toEqual({ start: 3, end: 4 });
    expect(dayPages({ pages: [6, 4, 5] })).toEqual({ start: 4, end: 6 });
    expect(dayPages({ pages: [2] })).toEqual({ start: 2, end: 2 });
  });

  it('is null when the row has no pages', () => {
    expect(dayPages({ pages: [] })).toBeNull();
    expect(dayPages({})).toBeNull();
    expect(dayPages(null)).toBeNull();
    expect(dayPages({ pages: ['x'] })).toBeNull();
  });
});

describe('parseK5Pages — her range, checked', () => {
  const day = { start: 3, end: 4 };

  it('no range is fine: she keeps the day\'s own pages', () => {
    expect(parseK5Pages(undefined, day)).toEqual({ ok: true, pages: null });
    expect(parseK5Pages(null, day)).toEqual({ ok: true, pages: null });
  });

  it('a narrower, wider or extended range is kept as whole numbers', () => {
    expect(parseK5Pages({ start: 3, end: 3 }, day)).toEqual({ ok: true, pages: { start: 3, end: 3 } });
    expect(parseK5Pages({ start: '3', end: '6' }, day)).toEqual({ ok: true, pages: { start: 3, end: 6 } });
  });

  it('the same pages as the day are no change (null)', () => {
    expect(parseK5Pages({ start: 3, end: 4 }, day)).toEqual({ ok: true, pages: null });
  });

  it('refuses what is not a page range', () => {
    expect(parseK5Pages('3-4', day).ok).toBe(false);
    expect(parseK5Pages({ start: 'a', end: 4 }, day).ok).toBe(false);
    expect(parseK5Pages({ start: 3.5, end: 4 }, day).ok).toBe(false);
    expect(parseK5Pages({ start: 0, end: 4 }, day).ok).toBe(false);
    expect(parseK5Pages({ start: 3, end: MAX_PAGE + 1 }, day).ok).toBe(false);
    expect(parseK5Pages({ start: 3 }, day).ok).toBe(false);
  });

  it('refuses a start after the end', () => {
    expect(parseK5Pages({ start: 6, end: 4 }, day)).toEqual({ ok: false, error: 'pages: the first page is after the last' });
  });

  it('refuses a span longer than MAX_SPAN, unless the day itself is longer', () => {
    expect(parseK5Pages({ start: 3, end: 3 + MAX_SPAN - 1 }, day).ok).toBe(true);
    expect(parseK5Pages({ start: 3, end: 3 + MAX_SPAN }, day).ok).toBe(false);
    const longDay = { start: 1, end: 20 };
    expect(parseK5Pages({ start: 1, end: 20 }, longDay)).toEqual({ ok: true, pages: null });
    expect(parseK5Pages({ start: 2, end: 21 }, longDay).ok).toBe(true);
    expect(parseK5Pages({ start: 1, end: 21 }, longDay).ok).toBe(false);
  });

  it('with no day pages known, the plain span rule still holds', () => {
    expect(parseK5Pages({ start: 5, end: 7 }, null)).toEqual({ ok: true, pages: { start: 5, end: 7 } });
    expect(parseK5Pages({ start: 5, end: 5 + MAX_SPAN }, null).ok).toBe(false);
  });
});

describe('pagesLine — what the rewrite is told', () => {
  it('names her pages and the day\'s pages, and asks to teach hers', () => {
    const line = pagesLine({ start: 3, end: 6 }, { start: 3, end: 4 });
    expect(line).toContain('pages 3-6');
    expect(line).toContain('pages 3-4');
    expect(line).toMatch(/teach/i);
  });

  it('a single page reads as one page', () => {
    expect(pagesLine({ start: 3, end: 3 }, { start: 3, end: 4 })).toContain('page 3 ');
  });

  it('is empty when she kept the day\'s pages', () => {
    expect(pagesLine(null, { start: 3, end: 4 })).toBe('');
  });
});
