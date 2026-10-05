/**
 * Web quiz page: the animal badge (wq.js ani(), wq.css .wq-ani). In Urdu the badge inherited the
 * Nastaliq stack and its tall line box, so the emoji sat below its 40x40 circle on "Whose turn is it?".
 * Runs the whole shipped page (see wq-page-harness.js).
 */
const { page, rule, flush, SRC, TAIL } = require('./wq-page-harness');

test('the harness reaches the page functions', () => {
  expect(SRC.indexOf(TAIL)).toBeGreaterThan(0);
  const p = page();
  expect(typeof p.wq.who).toBe('function');
});

describe('the animal badge keeps the emoji font and a tight line box (Urdu)', () => {
  test('the stylesheet gives every .wq-ani the emoji-safe stack and line-height 1', () => {
    const r = rule('.wq-ani');
    expect(r).not.toBeNull();
    expect(r).toMatch(/font-family:var\(--f\)/);
    expect(r).toMatch(/line-height:1(;|$)/);
  });

  test('the chip circle on "Whose turn is it?" also sets line-height 1', () => {
    expect(rule('.wq-kid .wq-ani')).toMatch(/line-height:1(;|$)/);
  });

  test('every place an animal renders wraps it in .wq-ani: chips, is-this-you, card, league table', async () => {
    const kid = { chip: 'c1', first: 'Zara', animal: 'owl' };
    const p = page({ store: { wq_kids: [kid] } });
    p.wq.who();
    expect(p.html()).toContain('<span class="wq-ani">🦉</span>Zara');
    expect(p.html()).not.toContain('<span class="wq-ani"><span');

    p.wq.isThisYou([kid], 'Zara');
    expect(p.html()).toContain('<span class="wq-ani">🦉</span>');

    const q = page({ store: { wq_s_TEST: { st: 'st1', child: kid, answers: {}, queue: [], result: { card: { first: 'Zara', animal: 'owl', correct: 4, total: 5, stars: 4 } } } } });
    expect(q.html()).toContain('<div class="wq-name"><span class="wq-ani">🦉</span> Zara');

    const b = page({ board: { finishers_n: 2, class_avg_pct: 60, rows: [{ place: 1, first: 'Omar', animal: 'cat', correct: 5, total: 5 }], more_n: 0 } });
    b.wq.board();
    await flush(); await flush();
    expect(b.html()).toContain('<span class="wq-ani">🐱</span> Omar');
  });
});

