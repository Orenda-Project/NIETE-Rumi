/**
 * Web quiz page, Urdu: a class label like "3-B" (and any other atom that mixes digits and Latin
 * letters) is isolated left-to-right, so inside Urdu prose it never paints as "B-3".
 *
 * Why: in a right-to-left line the bidi algorithm reorders "3-B" around its hyphen; the teacher's
 * Urdu landing showed «… کی طرف سے · B-3». The page now marks such atoms (and every run of two or
 * more Latin words) with span.wq-lat, and wq.css isolates them (direction:ltr; unicode-bidi:isolate).
 */
const { page, rule } = require('./wq-page-harness');

const LAT = (s) => `<span class="wq-lat" lang="en">${s}</span>`;
const STORE = { wq_s_TEST: { st: 's1', child: { first: 'Zara', chip: 'c1', animal: 'owl' }, answers: {}, queue: [],
  result: { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'C', score: { correct: 3, total: 5 } } } };

describe('a class label like 3-B on an Urdu page is one left-to-right atom', () => {
  test('the landing: «استاد کی طرف سے · 3-B»', () => {
    const p = page({ lang: 'ur', cls: { label: '3-B', teacher: 'استاد', chips: [] } });
    p.ctx.__wq.landing();
    expect(p.html()).toContain('کی طرف سے · ' + LAT('3-B'));
  });

  test('the scorecard header', () => {
    const p = page({ lang: 'ur', cls: { label: '5-A', teacher: 'استاد', chips: [] }, store: STORE });
    expect(p.moment()).toBe('M10');
    expect(p.html()).toContain(LAT('5-A') + '</header>');
  });

  test('a lone number or a lone Latin name needs no mark (each is one direction already)', () => {
    const p = page({ lang: 'ur', cls: { label: 'جماعت 3', teacher: 'Amna', chips: [] } });
    p.ctx.__wq.landing();
    expect(p.html()).not.toContain(LAT('3'));
    expect(p.html()).not.toContain(LAT('Amna'));
  });

  test('an English page is not touched', () => {
    const p = page({ lang: 'en', cls: { label: '3-B', teacher: 'Ms Testwala', chips: [] } });
    p.ctx.__wq.landing();
    expect(p.html()).not.toContain('wq-lat');
  });

  test('the stylesheet isolates every marked atom left-to-right', () => {
    const r = rule('html[lang=ur] .wq-lat');
    expect(r).toMatch(/direction:ltr/);
    expect(r).toMatch(/unicode-bidi:isolate/);
  });
});
