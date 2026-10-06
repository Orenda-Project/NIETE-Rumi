/**
 * Web quiz page, finishing with no internet (public/wq/wq.js results / finish / boot).
 * A child whose connection drops near the end still finishes: the page shows the score the
 * phone graded itself, says the result reaches the teacher once the phone is back online,
 * and sends it by itself when the connection returns — on this visit or the next one.
 * Runs the whole shipped page in the fake DOM (wq-page-harness.js).
 */
const { page, flush } = require('./wq-page-harness');

const Q3 = [1, 2, 3].map((n) => ({
  qid: `q${n}`, text: `Q${n}?`, options: [{ slot: 'A', text: 'x' }, { slot: 'B', text: 'y' }], correct_slot: 'A',
  img: `https://cdn.test/q${n}.png`,
  audio: { q: `https://r2.test/q${n}-stem.ogg`, opts: [`https://r2.test/q${n}-a.ogg`, null], why: `https://r2.test/q${n}-why.ogg` },
}));

// A child who answered all three (two right) on this phone, with the last answer still queued.
function played(extra = {}) {
  return {
    st: 'ST1', child: { first: 'Ali', chip: 'c1', animal: 'owl' }, seq: 3, wrong: ['q2'], result: null,
    answers: { q1: { slot: 'A', ok: true }, q2: { slot: 'B', ok: false }, q3: { slot: 'A', ok: true } },
    queue: [{ qid: 'q3', slot: 'A', ms: 900, seq: 3 }], ...extra,
  };
}

const OFFLINE = { __offline: true };
const FINISHED = { score: { correct: 2, total: 3, pct: 67, level: 'developing' }, counted: true, card: { first: 'Ali', animal: 'owl', correct: 2, total: 3, stars: 2 } };
const settle = async () => { for (let i = 0; i < 8; i += 1) await flush(); };

function net(state) {
  return {
    '/api/wq/answers': () => (state.on ? { recorded: ['q3'], dup: [], unknown: [] } : OFFLINE),
    '/api/wq/finish': () => (state.on ? FINISHED : OFFLINE),
    '/api/wq/session': () => OFFLINE,
  };
}

test('no internet at the end: the phone shows its own score and says the result will reach the teacher', async () => {
  const state = { on: false };
  const p = page({ lang: 'en', questions: Q3, store: { wq_s_TEST: played() }, api: net(state) });
  p.wq.results(0);
  await settle();
  expect(p.moment()).toBe('M9-pending');
  expect(p.html()).toContain('You got 2 out of 3');
  expect(p.html()).toContain('Your results will reach your teacher when you are back online.');
  expect(p.html()).not.toContain('No internet right now');
  // remembered across a closed tab
  expect(JSON.parse(p.ls.get('wq_s_TEST')).pending).toBeTruthy();
});

test('Urdu: the same screen in Urdu', async () => {
  const p = page({ lang: 'ur', questions: Q3, store: { wq_s_TEST: played() }, api: net({ on: false }) });
  p.wq.results(0);
  await settle();
  expect(p.moment()).toBe('M9-pending');
  expect(p.html()).toContain('انٹرنیٹ واپس آتے ہی آپ کا نتیجہ استاد تک پہنچ جائے گا۔');
});

test('back online: the page sends the result by itself and opens the real results', async () => {
  const state = { on: false };
  const p = page({ lang: 'en', questions: Q3, store: { wq_s_TEST: played() }, api: net(state) });
  p.wq.results(0);
  await settle();
  expect(p.moment()).toBe('M9-pending');
  state.on = true;
  p.fire('online');
  await settle();
  expect(p.moment()).toBe('M9');
  expect(p.fetches.some((f) => f.url === '/api/wq/finish')).toBe(true);
  expect(JSON.parse(p.ls.get('wq_s_TEST')).pending).toBeFalsy();
  expect(JSON.parse(p.ls.get('wq_s_TEST')).result).toMatchObject({ counted: true });
});

test('still offline: a timer keeps retrying, backing off, without the child tapping anything', async () => {
  const state = { on: false };
  const p = page({ lang: 'en', questions: Q3, store: { wq_s_TEST: played() }, api: net(state) });
  p.wq.results(0);
  await settle();
  const finishes = () => p.fetches.filter((f) => f.url === '/api/wq/finish').length;
  const first = finishes();
  p.runTimers(60000);
  await settle();
  expect(p.moment()).toBe('M9-pending');
  state.on = true;
  p.runTimers(60000);
  await settle();
  expect(finishes()).toBeGreaterThan(first);
  expect(p.moment()).toBe('M9');
});

test('the tab was closed offline: the next open goes straight to the results and sends them', async () => {
  const p = page({ lang: 'en', questions: Q3, store: { wq_s_TEST: played({ pending: 1, pendingAt: Date.now() - 60000 }) }, api: net({ on: true }) });
  await settle();
  expect(p.moment()).toBe('M9');
  expect(p.fetches.some((f) => f.url === '/api/wq/finish')).toBe(true);
});

test('too few answered is still "answer a few more" (409), not the offline screen', async () => {
  const p = page({ lang: 'en', questions: Q3, store: { wq_s_TEST: played() },
    api: { '/api/wq/answers': { recorded: ['q3'], dup: [], unknown: [] }, '/api/wq/finish': { __status: 409, error: 'too_few_answered' } } });
  p.wq.results(0);
  await settle();
  expect(p.moment()).toBe('M9-error');
});

test('lookahead: while Q1 is on screen the next two questions\' pictures and clips are fetched (no-cors), not Q1-blocking', async () => {
  const p = page({ lang: 'en', questions: Q3, store: { wq_s_TEST: played({ answers: {}, queue: [], wrong: [], seq: 0 }) } });
  p.wq.question(0, false);
  await settle();
  const clip = (u) => p.fetches.find((f) => f.url === u);
  // clips wait for Q1's own voice to get the line first
  expect(clip('https://r2.test/q2-stem.ogg')).toBeUndefined();
  p.runTimers(5000);
  await settle();
  ['https://r2.test/q2-stem.ogg', 'https://r2.test/q2-a.ogg', 'https://r2.test/q3-why.ogg'].forEach((u) => {
    expect(clip(u)).toBeDefined();
    expect(clip(u).init).toMatchObject({ mode: 'no-cors' });
  });
});
