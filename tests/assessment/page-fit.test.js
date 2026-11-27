/**
 * bd-nr8mrm.1 — FEAT-209 (Ramisha Riaz): "EG page-count option". Schools ask for a 1 or 2 page
 * paper; the teacher sets Pages (1–5) and we tighten the printed paper step by step until it fits,
 * never dropping a question, and tell her how many pages it needs when it still doesn't fit.
 */

const Fit = require('../../bot/shared/services/assessment/page-fit');

describe('page target', () => {
  test.each([[1, 1], [5, 5], ['2', 2], [' 3 ', 3]])('%p is a target of %p pages', (v, n) => {
    expect(Fit.pageTarget(v)).toBe(n);
  });
  test.each([[null], [undefined], [''], [0], [6], [2.5], ['two'], [true], [-1]])('%p is no target', (v) => {
    expect(Fit.pageTarget(v)).toBeNull();
  });
});

describe('fit steps', () => {
  test('tighten in order: as printed, Save paper, two columns, fewer short-answer lines', () => {
    expect(Fit.FIT_STEPS).toEqual([
      { compact: false, twoCol: false, trimLines: false },
      { compact: true, twoCol: false, trimLines: false },
      { compact: true, twoCol: true, trimLines: false },
      { compact: true, twoCol: true, trimLines: true },
    ]);
  });

  test('a paper she asked to Save paper starts at the Save paper step', () => {
    expect(Fit.firstStep({ compact: true })).toBe(1);
    expect(Fit.firstStep({ compact: false })).toBe(0);
    expect(Fit.firstStep({})).toBe(0);
  });
});

describe('fewer short-answer lines', () => {
  test.each([[0, 0], [1, 1], [2, 1], [3, 2], [5, 4]])('a short answer of %p lines gets %p', (n, m) => {
    expect(Fit.trimmedLines(n)).toBe(m);
  });
  test.each([[6], [10], [15]])('a long answer of %p lines keeps them all', (n) => {
    expect(Fit.trimmedLines(n)).toBe(n);
  });
});

describe('fitToPages', () => {
  const pagesByStep = (counts) => jest.fn(async (step) => ({ buffer: `pdf-${step}`, pages: counts[step] }));

  test('stops at the first step that fits', async () => {
    const render = pagesByStep([4, 3, 2, 1]);
    const out = await Fit.fitToPages({ target: 2, start: 0, render });
    expect(out).toEqual({ step: 2, buffer: 'pdf-2', pages: 2, fits: true, needs: null });
    expect(render).toHaveBeenCalledTimes(3);
  });

  test('a paper that already fits is printed as it is', async () => {
    const render = pagesByStep([1, 1, 1, 1]);
    const out = await Fit.fitToPages({ target: 2, start: 0, render });
    expect(out.step).toBe(0);
    expect(out.fits).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
  });

  test('starts from the given step, never looser', async () => {
    const render = pagesByStep([1, 3, 2, 2]);
    const out = await Fit.fitToPages({ target: 2, start: 1, render });
    expect(out.step).toBe(2);
    expect(render).not.toHaveBeenCalledWith(0);
  });

  test('when nothing fits, keeps the tightest print and says how many pages it needs', async () => {
    const render = pagesByStep([6, 5, 4, 3]);
    const out = await Fit.fitToPages({ target: 1, start: 0, render });
    expect(out).toEqual({ step: 3, buffer: 'pdf-3', pages: 3, fits: false, needs: 3 });
    expect(render).toHaveBeenCalledTimes(4);
  });

  test('an unreadable page count is not a fit, and the walk goes on', async () => {
    const render = pagesByStep([null, null, 1, 1]);
    const out = await Fit.fitToPages({ target: 1, start: 0, render });
    expect(out.step).toBe(2);
    expect(out.fits).toBe(true);
  });

  test('when no count is readable at all, it does not claim a fit or invent a number', async () => {
    const render = pagesByStep([null, null, null, null]);
    const out = await Fit.fitToPages({ target: 1, start: 0, render });
    expect(out).toEqual({ step: 3, buffer: 'pdf-3', pages: null, fits: false, needs: null });
  });
});
