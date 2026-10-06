/**
 * The quiz page's hub hook (wq.js boot): "Play again" on the kid hub opens
 * /q/<code>?again=1&k=<chip>. ?again=1 clears a FINISHED attempt kept on this phone
 * (never unsent answers) and shows the start screen. ?k belongs to the identity code
 * (a confirm card unless this device knows the child) and is tested there. Runs the
 * whole shipped page in the harness's vm; the bot API is the faked boundary.
 */
const { page } = require('./wq-page-harness');

const CHIP = '0123456789abcdef';
const CHILD = { first: 'Zara', chip: CHIP, animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, score: { correct: 3, total: 5 } };
const finished = (extra = {}) => ({ wq_s_TEST: { st: 'old-st', child: CHILD, answers: { q1: { slot: 'A', ok: true } }, queue: [], result: RESULT, ...extra } });
const store = (p, k) => { const v = p.ctx.localStorage.getItem(k); return v == null ? null : JSON.parse(v); };

test('?again=1 on a finished attempt: the kept result is cleared on this phone and the start screen shows (not the scorecard)', () => {
  const p = page({ lang: 'en', store: finished(), search: '?again=1' });
  expect(p.moment()).toBe('M3');
  const s = store(p, 'wq_s_TEST');
  expect(s.result).toBeNull();
  expect(s.st).toBeNull();
  expect(s.answers).toEqual({});
});

test('without ?again the same phone still opens the scorecard (unchanged)', () => {
  const p = page({ lang: 'en', store: finished() });
  expect(p.moment()).toBe('M10');
});

test('?again=1 never drops answers still waiting to be sent', () => {
  const p = page({ lang: 'en', store: finished({ queue: [{ qid: 'q1', slot: 'A' }] }), search: '?again=1' });
  expect(store(p, 'wq_s_TEST').result).not.toBeNull();
});

test('?again=1 with a hub chip: the old attempt is cleared before the identity code reads k (no stale resume)', () => {
  const p = page({ lang: 'en', store: finished(), search: `?again=1&k=${CHIP}` });
  const s = store(p, 'wq_s_TEST');
  expect(s.result).toBeNull();
  expect(s.st).toBeNull();
  expect(p.moment()).not.toBe('M10');
});
