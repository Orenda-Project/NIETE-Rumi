/**
 * The adventure look (<html class="wq-adv">) on an Urdu quiz door: an English quiz title ("Proper Fraction") is set left
 * to right in the Latin face, as an English question is (wq.js latDir), on both doors (today's landing and the identity
 * v2 door). An Urdu title, an English page and a page without the look are today's. Invented content only.
 */
const { page } = require('./wq-page-harness');

const V2 = { label: 'Class 4-A', teacher: '<Name> Testwala', chips: [], identity: { mode: 'v2', class: { state: 'known', label: '4-A', ask: null }, roster: true, invited: false } };
const h1 = (h) => (/<h1[^>]*>/.exec(h) || [])[0];
const door = (o) => page({ topic: 'Proper Fraction', ...o }).html();

describe.each([['today\'s landing', {}], ['the identity v2 door', { cls: V2, ident: true }]])('%s', (_n, extra) => {
  test('UR + the look: an English title is marked left to right', () => {
    expect(h1(door({ lang: 'ur', htmlClass: ['wq-adv'], ...extra }))).toBe('<h1 dir="ltr">');
  });
  test('UR + the look, an Urdu title: today\'s', () => {
    expect(h1(door({ lang: 'ur', htmlClass: ['wq-adv'], topic: 'کسر', ...extra }))).toBe('<h1>');
  });
  test('without the look, or an English page: today\'s', () => {
    expect(h1(door({ lang: 'ur', ...extra }))).toBe('<h1>');
    expect(h1(door({ lang: 'en', htmlClass: ['wq-adv'], ...extra }))).toBe('<h1>');
  });
});
