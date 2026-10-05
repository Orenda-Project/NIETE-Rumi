/**
 * Web quiz page: the scorecard header never shows a dangling separator ("NIETE ·").
 */
const { page, flush } = require('./wq-page-harness');

describe('the scorecard header', () => {
  const kid = { chip: 'c1', first: 'Zara', animal: 'owl' };
  const store = { wq_s_TEST: { st: 'st1', child: kid, answers: {}, queue: [], result: { card: { first: 'Zara', animal: 'owl', correct: 4, total: 5 } } } };
  test('a class with no label shows "NIETE" with no dangling separator', () => {
    const p = page({ cls: { label: '', chips: [] }, store });
    expect(p.html()).toMatch(/<header><i><\/i>NIETE<\/header>/);
  });
  test('a class with a label keeps "NIETE · label"', () => {
    const p = page({ store });
    expect(p.html()).toContain('<header><i></i>NIETE · Class 3-B</header>');
  });
});


describe('no dangling separator elsewhere', () => {
  test('the league table subtitle with no topic shows only the count', async () => {
    const p = page({ topic: '', board: { finishers_n: 3, class_avg_pct: 50, rows: [], more_n: 0 } });
    p.wq.board();
    await flush(); await flush();
    expect(p.html()).toMatch(/<p class="wq-sub">[^<·]+<\/p>/);
    expect(p.html()).not.toMatch(/<p class="wq-sub"> · /);
  });
  test('a friend row with no topic shows only the name', async () => {
    const p = page({ store: { wq_kids: [{ chip: 'c1', first: 'Zara', animal: 'owl' }] }, me: { history: [], friends_finished: [{ first: 'Omar', topic: '', correct: 3, total: 5 }] } });
    p.wq.history();
    await flush(); await flush();
    expect(p.html()).toContain('<li><span>Omar</span>');
  });
});
