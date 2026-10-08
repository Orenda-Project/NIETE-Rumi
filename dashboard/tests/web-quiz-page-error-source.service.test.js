/**
 * Web quiz page: an error event says WHICH handler caught it and WHERE, so a page that breaks on one phone's
 * browser can be named from the logs.
 *
 * window 'error' sends src 'win' + the line, column and script FILE NAME (never the URL; a script that is not
 * ours is 'other'); an unhandled rejection sends src 'rej' and a non-Error reason's own text ("[object Event]");
 * a failure the page handled itself sends src 'h'. Runs the whole shipped page (wq-page-harness.js); the real
 * window listeners fire and the real flush posts to /api/wq/e.
 */
const { page, flush } = require('./wq-page-harness');

const settle = async () => { for (let i = 0; i < 8; i += 1) await flush(); };
const sentErrors = (p) => p.fetches
  .filter((f) => f.url.indexOf('/api/wq/e') >= 0)
  .flatMap((f) => JSON.parse(f.init.body).events)
  .filter((e) => e.n === 'error');
const hide = (p) => (p.winListeners.pagehide || []).forEach((fn) => fn({}));

test("window 'error': src win, line + col, our script's file name only", () => {
  const p = page({ lang: 'en' });
  p.winListeners.error.forEach((fn) => fn({ message: '[object Event] x', filename: 'https://example.test/wq/wq.js?v=abc123', lineno: 740, colno: 12 }));
  hide(p);
  expect(sentErrors(p)).toEqual([expect.objectContaining({ err: '[object Event] x', src: 'win', file: 'wq.js', line: 740, col: 12 })]);
});

test("a script that is not ours is 'other'; no file or position given sends none", () => {
  const p = page({ lang: 'en' });
  p.winListeners.error.forEach((fn) => fn({ message: 'x is not defined', filename: 'https://ads.vendor.test/inject/a.js', lineno: 3, colno: 9 }));
  p.winListeners.error.forEach((fn) => fn({ message: 'Script error.', filename: '', lineno: 0, colno: 0 }));
  hide(p);
  const [a, b] = sentErrors(p);
  expect(a).toMatchObject({ src: 'win', file: 'other', line: 3, col: 9 });
  expect(b).toMatchObject({ err: 'Script error.', src: 'win' });
  expect(b).not.toHaveProperty('file');
  expect(b).not.toHaveProperty('line');
  for (const e of [a, b]) expect(JSON.stringify(e)).not.toMatch(/vendor\.test|https?:/);
});

test("unhandled rejection: src rej; a non-Error reason sends its own text; an Error's stack gives file + line", () => {
  const p = page({ lang: 'en' });
  const notAnError = { [Symbol.toStringTag]: 'Event' };
  const err = new Error('play() failed');
  err.stack = 'Error: play() failed\n    at f (https://example.test/wq/wq-read-live.js?v=v1:88:21)';
  p.winListeners.unhandledrejection.forEach((fn) => fn({ reason: notAnError }));
  p.winListeners.unhandledrejection.forEach((fn) => fn({ reason: err }));
  hide(p);
  const [a, b] = sentErrors(p);
  expect(a).toMatchObject({ err: '[object Event]', src: 'rej' });
  expect(b).toMatchObject({ err: 'play() failed', src: 'rej', file: 'wq-read-live.js', line: 88, col: 21 });
});

test("a STRING rejection never sends its text (it may be a name): 'string_rejection'", () => {
  const p = page({ lang: 'en' });
  p.winListeners.unhandledrejection.forEach((fn) => fn({ reason: 'Ayesha Khan' }));
  p.winListeners.unhandledrejection.forEach((fn) => fn({ reason: { code: 7 } }));
  hide(p);
  const [a, b] = sentErrors(p);
  expect(a).toMatchObject({ err: 'string_rejection', src: 'rej' });
  expect(JSON.stringify(a)).not.toMatch(/Ayesha|Khan/);
  expect(b).toMatchObject({ err: '[object Object]', src: 'rej' });
});

test("a failure the page handled itself is src 'h'", async () => {
  const Q = [{ qid: 'q1', text: 'Q?', options: [{ slot: 'A', text: 'x' }], correct_slot: 'A' }];
  const played = { st: 'ST1', child: { first: 'Ali', chip: 'c1', animal: 'owl' }, seq: 1, wrong: [], result: null, answers: { q1: { slot: 'A', ok: true } }, queue: [] };
  const p = page({ lang: 'en', questions: Q, store: { wq_s_TEST: played }, api: { '/api/wq/finish': { __status: 409, error: 'too_few_answered' } } });
  p.wq.results(0);
  await settle();
  hide(p);
  expect(p.moment()).toBe('M9-error');
  expect(sentErrors(p).map((e) => e.src)).toEqual(['h']);
});
