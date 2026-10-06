/**
 * Web quiz page: a practice round that beats the child's best earlier score says "New best!".
 */
const { page } = require('./wq-page-harness');

const kid = { chip: 'c1', first: 'Omar', animal: 'owl' };
const card = (c) => ({ wq_s_TEST: { st: 'st1', child: kid, answers: {}, queue: [], result: { card: { first: 'Omar', animal: 'owl', practice: true, kept: { correct: 3, total: 5 }, ...c } } } });

test('beating the best earlier score shows New best with both scores, each read left to right', () => {
  const p = page({ lang: 'en', store: card({ correct: 5, total: 5, best: { correct: 4, total: 5 } }) });
  p.wq.card();
  expect(p.html()).toMatch(/New best! <bdi dir="ltr">5\/5<\/bdi> · was <bdi dir="ltr">4\/5<\/bdi> ⭐/);
});
test('in Urdu too', () => {
  const p = page({ lang: 'ur', store: card({ correct: 5, total: 5, best: { correct: 4, total: 5 } }) });
  p.wq.card();
  expect(p.html()).toMatch(/نیا ریکارڈ! <bdi dir="ltr">5\/5<\/bdi> · پہلے <bdi dir="ltr">4\/5<\/bdi> ⭐/);
});
test('equal to or below the best says nothing extra', () => {
  for (const c of [{ correct: 4, total: 5 }, { correct: 2, total: 5 }]) {
    const p = page({ lang: 'en', store: card({ ...c, best: { correct: 4, total: 5 } }) });
    p.wq.card();
    expect(p.html()).not.toContain('New best');
  }
});
