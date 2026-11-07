const c = require('../../../shared/services/lp-v10-card/check');
const r = require('../../../shared/services/lp-v10-card/render');
const { card, MUST, V9 } = require('../../fixtures/lp-v10-card/load');

const HTML = r.render(card());

describe('check: pure checks on a card html', () => {
  test('moves are numbered 1..8 and carry their v9 ids', () => {
    expect(c.moves(HTML).map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(c.moves('<div class="mv"><span class="n">3</span>')).toEqual([[3, new Set()]]);
  });
  test('uncovered returns the must-happen ids no move carries, numerically', () => {
    expect(c.uncovered(HTML, MUST)).toEqual([]);
    expect(c.uncovered(HTML, ['m99', 'm100', 'm1'])).toEqual(['m99', 'm100']);
    expect(c.uncovered('', ['m2', 'm1'])).toEqual(['m1', 'm2']);
  });
  test('minutes reads the time bar', () => {
    expect(c.minutes(HTML)).toEqual([['open', 5], ['explain', 7], ['we', 12], ['you', 12], ['check', 4]]);
  });
  test('star_hidden needs a hidden slot and no ringed section', () => {
    expect(c.starHidden(HTML)).toBe(true);
    expect(c.starHidden(HTML.replace('class="star" hidden', 'class="star"'))).toBe(false);
    expect(c.starHidden(HTML + '<section class="sec mark">')).toBe(false);
    expect(c.starHidden('')).toBe(false);
  });
  test('badLinks flags a Full details link with no v9 section', () => {
    expect(c.badLinks(HTML, card().v9_html)).toEqual([]);
    expect(c.badLinks('<a class="fd" href="x.html#v9-nope">', 'x.html')).toEqual(['x.html#v9-nope']);
    expect(c.badLinks('<a class="fd" href="y.html#v9-we">', 'x.html')).toEqual(['y.html#v9-we']);
  });
  test('fixedWidth ignores print rules and max-width', () => {
    expect(c.fixedWidth(HTML)).toBe(false);
    expect(c.fixedWidth('.page{width:520px}')).toBe(true);
    expect(c.fixedWidth('.page{max-width:480px}')).toBe(false);
    expect(c.fixedWidth('@media print{.page{width:520px}}')).toBe(false);
  });
  test('v9 diagrams and card pictures are counted', () => {
    expect(c.v9Diagrams(V9)).toBeGreaterThanOrEqual(1);
    expect(c.v9Diagrams('<figure class="dg"><figure class="dg">')).toBe(2);
    expect(c.cardPictures(HTML)).toBeGreaterThanOrEqual(c.v9Diagrams(V9));
  });
  test('v9Video returns the unescaped href and title, or null', () => {
    const v = '<div class="vres"><span>x</span><a href="https://s.pk/v.php?a=1&amp;b=2" target="_blank">Word &amp; Fam</a></div>';
    expect(c.v9Video(v)).toEqual(['https://s.pk/v.php?a=1&b=2', 'Word & Fam']);
    expect(c.v9Video('<div></div>')).toBeNull();
  });
});
