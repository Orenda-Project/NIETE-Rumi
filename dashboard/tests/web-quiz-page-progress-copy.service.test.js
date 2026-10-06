/**
 * Web quiz page: numbers a child can misread.
 *
 * (1) The resume button said "Continue 2/5" — the same "n/5" shape as every score on the page, so a
 *     child who had answered one question read it as "I got 2". It names the question instead.
 * (2) "Your scores" printed the server's ISO date ("2026-10-06"); a child reads "6 Oct" / «6 اکتوبر».
 * (The harness quiz has one question, so a child who answered it resumes at question 1 of 1.)
 * Runs the whole shipped page in the harness's vm.
 */
const { page } = require('./wq-page-harness');

const flush = () => new Promise((r) => setImmediate(r));
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const midQuiz = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: { q1: { slot: 'A', ok: true } }, queue: [] } });
const contText = (p) => { const m = /id="wq-cont">([^<]*)</.exec(p.html()); return m ? m[1] : null; };

describe('the resume button names the question, never a score-shaped "n/5"', () => {
  test('English', () => {
    const p = page({ lang: 'en', store: midQuiz() });
    expect(p.moment()).toBe('M3-continue');
    const t = contText(p);
    expect(t).toMatch(/question 1 of 1/);
    expect(t).not.toMatch(/\d+\s*\/\s*\d+/);
  });
  test('Urdu', () => {
    const p = page({ lang: 'ur', store: midQuiz() });
    expect(p.moment()).toBe('M3-continue');
    const t = contText(p);
    expect(t).toMatch(/سوال 1 از 1/);
    expect(t).not.toMatch(/\d+\s*\/\s*\d+/);
  });
});

describe('"Your scores" shows a date a child can read', () => {
  const me = { history: [{ topic: 'Plants', date: '2026-10-06', correct: 4, total: 5 }], friends_finished: [] };
  const store = { wq_kids: [{ chip: 'c1', first: 'Zara', animal: 'owl' }] };
  test('English: 6 Oct', async () => {
    const p = page({ lang: 'en', store, me });
    p.wq.history();
    await flush(); await flush();
    expect(p.moment()).toBe('M13');
    expect(p.html()).toContain('6 Oct');
    expect(p.html()).not.toContain('2026-10-06');
  });
  test('Urdu: 6 اکتوبر', async () => {
    const p = page({ lang: 'ur', store, me });
    p.wq.history();
    await flush(); await flush();
    expect(p.html()).toContain('6 اکتوبر');
    expect(p.html()).not.toContain('2026-10-06');
  });
  test('a date the page cannot read is shown as it came, never "undefined"', async () => {
    const p = page({ lang: 'en', store, me: { history: [{ topic: 'Plants', date: 'yesterday', correct: 1, total: 5 }], friends_finished: [] } });
    p.wq.history();
    await flush(); await flush();
    expect(p.html()).toContain('yesterday');
    expect(p.html()).not.toContain('undefined');
  });
});
