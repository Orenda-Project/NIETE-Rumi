/**
 * Web quiz page: a sitting whose session token has expired (q380, bd-7rnfvn).
 *
 * Production, 20-27 Nov: 22 phones reopened a quiz they had started 7-28 days earlier. The page resumed the old
 * sitting ("Continue question 2") with the saved session token, whose life is 7 days (web-quiz-token.js SYNC_TTL_S).
 * The server refused every answer (401), the finish could not land, the page said "your results will reach your
 * teacher when you are back online" and retried forever: the child's score never reached the teacher
 * (284 answers_401 events). A sitting the server can no longer take is started fresh instead, and a 401 on the
 * answers drops the dead sitting rather than retrying it.
 * Runs the whole shipped page in the harness's vm.
 */
const { page, flush } = require('./wq-page-harness');

const settle = async () => { for (let i = 0; i < 8; i += 1) await flush(); };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = (expS) => `${b64u({ k: 's', sid: 'sess-1', d: 'dev', sc: 'sc1', exp: expS })}.sig0123456789abcdefghij`;
const nowS = () => Math.floor(Date.now() / 1000);
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const Q2 = [1, 2].map((n) => ({ qid: `q${n}`, text: `Q${n}?`, options: [{ slot: 'A', text: 'x' }, { slot: 'B', text: 'y' }], correct_slot: 'A' }));
const sitting = (st, extra = {}) => ({
  wq_s_TEST: { st, child: CHILD, answers: { q1: { slot: 'A', ok: true } }, queue: [{ qid: 'q1', slot: 'A', ms: 900, seq: 1 }], seq: 1, wrong: [], result: null, ...extra },
});
const answersCalls = (p) => p.fetches.filter((f) => f.url === '/api/wq/answers').length;
const saved = (p) => JSON.parse(p.ls.get('wq_s_TEST'));

test('a sitting whose token expired days ago is not resumed: the child starts fresh, nothing is sent with the dead token', async () => {
  const p = page({ lang: 'en', questions: Q2, store: sitting(tok(nowS() - 2 * 86400)), api: { '/api/wq/answers': { __status: 401, error: 'bad_token' } } });
  await settle();
  expect(p.moment()).not.toBe('M3-continue');
  expect(answersCalls(p)).toBe(0);
  expect(saved(p).st).toBeNull();
  expect(saved(p).queue).toEqual([]);
  expect(saved(p).answers).toEqual({});
});

test('an expired sitting that finished offline is not left "waiting for the internet" forever', async () => {
  const p = page({ lang: 'en', questions: Q2, store: sitting(tok(nowS() - 86400), { pending: 1, pendingAt: Date.now() - 9 * 86400000 }), api: { '/api/wq/finish': { __status: 401, error: 'bad_token' } } });
  await settle();
  expect(p.moment()).not.toBe('M9-pending');
  expect(p.fetches.some((f) => f.url === '/api/wq/finish')).toBe(false);
  expect(saved(p).pending).toBeFalsy();
});

test('a live token still resumes as before ("Continue")', async () => {
  const p = page({ lang: 'en', questions: Q2, store: sitting(tok(nowS() + 3600)), api: { '/api/wq/answers': { recorded: ['q1'], dup: [], unknown: [] } } });
  await settle();
  expect(p.moment()).toBe('M3-continue');
  expect(saved(p).st).toMatch(/^ey/);
});

test('a token the page cannot read is left to the server (no guess)', async () => {
  const p = page({ lang: 'en', questions: Q2, store: sitting('s1') });
  await settle();
  expect(p.moment()).toBe('M3-continue');
});

test('the server refuses the answers (401): the dead sitting is dropped, not retried on every flush', async () => {
  const p = page({ lang: 'en', questions: Q2, store: sitting('s1'), api: { '/api/wq/answers': { __status: 401, error: 'bad_token' } } });
  await settle();
  expect(answersCalls(p)).toBe(1);
  expect(saved(p).st).toBeNull();
  expect(saved(p).queue).toEqual([]);
  p.fire('online');
  await settle();
  expect(answersCalls(p)).toBe(1);
  expect(p.moment()).not.toBe('M3-continue');
});
