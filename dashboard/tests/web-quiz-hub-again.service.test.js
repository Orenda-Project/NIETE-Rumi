/**
 * The quiz page's two hub hooks (wq.js boot): "Play again" from the kid hub opens
 * /q/<code>?again=1&k=<chip>, and every hub link carries k = this quiz's chip for the
 * child. ?again=1 clears a FINISHED attempt kept on this phone (never unsent answers);
 * ?k starts the session as that child, like a tapped remembered card. Runs the whole
 * shipped page in the harness's vm; the bot API is the faked boundary.
 */
const { page, flush } = require('./wq-page-harness');

const CHIP = '0123456789abcdef';
const CHILD = { first: 'Zara', chip: CHIP, animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, score: { correct: 3, total: 5 } };
const finished = (extra = {}) => ({ wq_s_TEST: { st: 'old-st', child: CHILD, answers: { q1: { slot: 'A', ok: true } }, queue: [], result: RESULT, ...extra } });
const store = (p, k) => { const v = p.ctx.localStorage.getItem(k); return v == null ? null : JSON.parse(v); };
const sessionCalls = (p) => p.fetches.filter((f) => f.url === '/api/wq/session').map((f) => JSON.parse(f.init.body));
const SESSION = { st: 'new-st', child: CHILD, counted: false, reason: 'already_finished' };

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

test('?again=1&k=<chip>: a new attempt starts at once as that child, with no old session to resume', async () => {
  const p = page({ lang: 'en', store: finished(), search: `?again=1&k=${CHIP}`, api: { '/session': SESSION } });
  await flush();
  const calls = sessionCalls(p);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ code: 'TEST', chip: CHIP, via: 'hub' });
  expect(calls[0].resume_st).toBeUndefined();
  expect(store(p, 'wq_s_TEST').st).toBe('new-st');
  // The child is remembered on this phone, as after a tapped card.
  expect((store(p, 'wq_kids') || []).map((k) => k.chip)).toContain(CHIP);
});

test('?k=<chip> on a fresh phone: no "Whose turn?", the session starts as that child', async () => {
  const p = page({ lang: 'ur', search: `?k=${CHIP}`, api: { '/session': SESSION } });
  await flush();
  expect(sessionCalls(p)[0]).toMatchObject({ chip: CHIP, via: 'hub' });
  expect(p.moment()).not.toMatch(/^M4/);
});

test('?k=<chip> the class does not know (404 chip_unknown): ask who is playing, no error', async () => {
  const p = page({ lang: 'en', search: `?k=${CHIP}`, api: { '/session': { __status: 404, error: 'chip_unknown' } } });
  await flush();
  expect(p.moment()).toMatch(/^M4/);
  expect(p.toasts()).toEqual([]);
});

test('?k=<chip> that fails for another reason lands on the start screen, never a dead boot screen', async () => {
  const p = page({ lang: 'en', search: `?k=${CHIP}`, api: { '/session': { __status: 502, error: 'db_unavailable' } } });
  await flush();
  expect(p.moment()).toBe('M3');
});

test('a k that is not chip-shaped is ignored (the start screen, no session call)', async () => {
  const p = page({ lang: 'en', search: '?k=<script>' });
  await flush();
  expect(sessionCalls(p)).toHaveLength(0);
  expect(p.moment()).toBe('M3');
});
