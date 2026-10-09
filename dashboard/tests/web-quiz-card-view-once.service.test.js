/**
 * card_view counts score cards, not renders: the card re-renders when the child comes back from the share
 * screen, the class table or the school league, and each re-render logged another card_view, so the share rate
 * per card was understated (more for children who share more). One card_view per finished session.
 * Runs the whole shipped page in the harness's vm.
 */
const { page } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 } };
const finished = (st = 's1') => ({ wq_s_TEST: { st, child: CHILD, answers: {}, queue: [], result: RESULT } });
function views(p) {
  p.fireWin('pagehide');
  return p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events).filter((e) => e.n === 'card_view');
}

test('back from the share screen re-renders the card but logs no second card_view', () => {
  const p = page({ lang: 'en', store: finished() });
  p.tap();
  p.els['#wq-chal'].fire('click');
  p.els['#wq-back'].fire('click');
  p.wq.card();
  expect(p.moment()).toBe('M10');
  expect(views(p)).toHaveLength(1);
});

test('the same session reopened on this phone is not a new card; another session is', () => {
  const p = page({ lang: 'en', store: { ...finished('s1'), wq_cv: 's1' } });
  p.tap();
  expect(views(p)).toHaveLength(0);
  const q = page({ lang: 'en', store: { ...finished('s2'), wq_cv: 's1' } });
  q.tap();
  expect(views(q)).toHaveLength(1);
});
