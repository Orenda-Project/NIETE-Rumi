/**
 * The class-quiz end screen fits its score (app_settings web_quiz_end_fit, the answer's `end_fit`; default off): the star
 * row never wraps (wq-fitstars: one grid row, each star min(48 px, its share of the card)), and the "You got 3 of 7 right"
 * headline wraps balanced (wq-endh: text-wrap balance), so an Urdu line never leaves «کیے» alone. The same on the offline
 * end screen. Off (no `end_fit`): both end screens are today's, byte for byte. wq.js runs whole in the harness's vm; the
 * geometry (every star's top equal for N = 5…10 at 360 + 390, EN + UR) is checked in a real browser on the shots.
 */
const { page, flush } = require('./wq-page-harness');
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const CHILD = { first: 'Zara', chip: 'c1' };
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result } });
const RES = (n) => ({ score: { correct: 3, total: n }, card: {} });
// Jugnu's done line is drawn at random from the recorded set: masked, the rest must match exactly
const norm = (h) => h.replace(/(<div class="wq-say">)[\s\S]*?<\/div>/, '$1*</div>');

async function end(lang, n, bootExtra) {
  const p = page({ lang, store: store(RES(n)), bootExtra, api: { '/finish': RES(n) } });
  p.wq.results(0);
  for (let k = 0; k < 6; k += 1) await flush();
  expect(p.moment()).toBe('M9');
  return norm(p.html());
}

describe('web_quiz_end_fit on: one star row, a balanced headline', () => {
  for (const lang of ['en', 'ur']) {
    for (const n of [5, 7, 10]) {
      test(`${lang}, ${n} questions: wq-fitstars with ${n} stars, the headline wq-endh`, async () => {
        const h = await end(lang, n, { end_fit: true });
        expect(h).toMatch(/<h1 class="wq-endh">[^<]+<\/h1><div class="wq-stars wq-fitstars" role="img" aria-label="3\/\d+">/);
        const row = /<div class="wq-stars wq-fitstars"[^>]*>([\s\S]*?)<\/div>/.exec(h)[1];
        expect((row.match(/class="wq-star/g) || []).length).toBe(n);
      });
    }
  }
  test('the stylesheet: one grid row of columns at most 48 px, stars filling them; the headline balanced', () => {
    expect(CSS).toMatch(/\.wq-fitstars\{[^}]*display:grid[^}]*grid-auto-flow:column[^}]*grid-auto-columns:minmax\(0,48px\)/);
    expect(CSS).toMatch(/\.wq-fitstars \.wq-star\{[^}]*width:100%[^}]*aspect-ratio:1/);
    expect(CSS).toMatch(/\.wq-endh\{[^}]*text-wrap:balance/);
  });
});

describe('web_quiz_end_fit off: today\'s end screen, byte for byte', () => {
  for (const lang of ['en', 'ur']) {
    test(`${lang}: absent and false draw the same page, with no fit class`, async () => {
      const base = await end(lang, 7, {});
      const off = await end(lang, 7, { end_fit: false });
      expect(off).toBe(base);
      expect(base).not.toMatch(/wq-fitstars|wq-endh/);
      expect(base).toContain('<h1>');
    });
  }
});
