/**
 * bd-f01ob — lib/continuous.js: the joined two-page print. Its wiring into the renderer is
 * covered by continuous-two-page-pdf.test.js; this pins the module's own contract.
 */
const path = require('path');

const { CONTINUOUS, usableSizes, joinParts } = require(path.join(
  __dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'lib', 'continuous'));

describe('usableSizes — a page with no height is never printed', () => {
  test('every part with a real height is usable', () => {
    expect(usableSizes([{ part: 'teach', h: 5200 }, { part: 'support', h: 1900 }])).toBe(true);
  });
  test.each([
    ['nothing measured', undefined],
    ['an empty list', []],
    ['a zero-height part', [{ part: 'teach', h: 2 }]],
    ['a part with no name', [{ h: 900 }]],
  ])('%s is not usable', (_, sizes) => {
    expect(usableSizes(sizes)).toBe(false);
  });
});

describe('the in-page script', () => {
  test('frees the fixed page height and names one @page per part', () => {
    expect(CONTINUOUS).toContain("'lp612-continuous'");
    expect(CONTINUOUS).toContain('height:auto!important');
    expect(CONTINUOUS).toContain("'@page ' + s.part");
    expect(CONTINUOUS).toContain("']{page:' + s.part");
  });
  test('parses as a function expression', () => {
    // eslint-disable-next-line no-new-func
    expect(typeof new Function(`return (${CONTINUOUS})`)()).toBe('function');
  });
});

describe('joinParts', () => {
  const run = async (sizes) => {
    const written = [];
    const page = { evaluate: jest.fn(async () => sizes) };
    const load = jest.fn(async () => {});
    const rebuild = jest.fn(() => ({ html: '<joined>' }));
    const out = await joinParts(page, load, '/x.html', rebuild, (p, h) => written.push([p, h]));
    return { out, written, rebuild, load };
  };

  test('rebuilds with no breaks, writes it, loads it and returns the sizes', async () => {
    const sizes = [{ part: 'teach', h: 5200 }, { part: 'support', h: 1900 }];
    const { out, written, rebuild, load } = await run(sizes);
    expect(rebuild).toHaveBeenCalledWith({ teach: [], support: [] });
    expect(written).toEqual([['/x.html', '<joined>']]);
    expect(load).toHaveBeenCalledWith('/x.html');
    expect(out).toEqual(sizes);
  });

  test('returns null when the page could not be measured', async () => {
    expect((await run(null)).out).toBeNull();
  });
});
