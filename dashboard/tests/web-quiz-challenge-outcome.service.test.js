/**
 * Web quiz page: a friend's challenge has an outcome on both sides, and the challenge link
 * carries no child's name.
 */
const { page, flush } = require('./wq-page-harness');

const kid = { chip: 'c1', first: 'Omar', animal: 'owl' };
const finished = (vs) => ({ wq_s_TEST: { st: 'st1', child: kid, answers: {}, queue: [],
  result: { card: { first: 'Omar', animal: 'owl', correct: 4, total: 4 }, challenge_code: 'CH12AB', ...(vs ? { vs } : {}) } } });

describe('the friend\'s scorecard compares with the challenger', () => {
  test('a win says so, with both scores', () => {
    const p = page({ lang: 'en', store: finished({ first: 'Zara', correct: 3, total: 4, outcome: 'win' }) });
    p.wq.card();
    expect(p.html()).toContain('You beat the challenge!');
    expect(p.html()).toMatch(/You <bdi dir="ltr">4\/4<\/bdi> · Zara <bdi dir="ltr">3\/4<\/bdi>/);
  });
  test('a tie and a loss, in Urdu', () => {
    let p = page({ lang: 'ur', store: finished({ first: 'زارا', correct: 4, total: 4, outcome: 'tie' }) });
    p.wq.card();
    expect(p.html()).toContain('مقابلہ برابر رہا!');
    p = page({ lang: 'ur', store: finished({ first: 'زارا', correct: 4, total: 4, outcome: 'lose' }) });
    p.wq.card();
    expect(p.html()).toContain('تھوڑی سی کمی رہ گئی!');
  });
  test('a class card has no compare strip', () => {
    const p = page({ lang: 'en', store: finished(null) });
    p.wq.card();
    expect(p.html()).not.toContain('wq-vs');
  });
});

describe('the challenge link carries no name', () => {
  test('Challenge a friend shares /q/<challenge code> with no from=', () => {
    const p = page({ lang: 'en', store: finished(null) });
    p.wq.card();
    p.els['#wq-chal'].fire('click');
    expect(p.html()).toContain('https://example.test/q/CH12AB');
    expect(p.html()).not.toMatch(/from=/);
  });
});

describe('the challenger sees how each friend did', () => {
  test('"My scores" marks a friend who beat you, and one you beat', async () => {
    const p = page({ lang: 'en', store: { wq_kids: [kid] }, me: { history: [], friends_finished: [
      { first: 'Rida', topic: 'Plants', correct: 4, total: 4, outcome: 'win' },
      { first: 'Ayan', topic: 'Plants', correct: 1, total: 4, outcome: 'lose' }] } });
    p.wq.history();
    await flush(); await flush();
    expect(p.html()).toContain('Rida · Plants · beat you!');
    expect(p.html()).toContain('Ayan · Plants · you won');
  });
});

describe('a challenger who scored 0 is never offered as a score to beat', () => {
  test('the friend\'s landing says the challenger played, not "0/5 stars. Can you beat it?"', () => {
    const p = page({ lang: 'en', challenge: { first: 'Ali', correct: 0, total: 5 } });
    expect(p.html()).toContain('Ali challenged you. Can you beat their score?');
    expect(p.html()).not.toContain('0/5 stars');
  });
  test('a real score is still the one to beat', () => {
    const p = page({ lang: 'en', challenge: { first: 'Ali', correct: 3, total: 5 } });
    expect(p.html()).toContain('Ali got 3/5 stars. Can you beat it?');
  });
});
