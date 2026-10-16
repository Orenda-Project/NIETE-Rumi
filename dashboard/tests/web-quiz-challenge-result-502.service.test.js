/**
 * The Challenge page's reading result when the portal cannot reach the bot in time: POST /api/wq/ch/result answers
 * 502 {error: 'bot_unreachable'} (the portal's own bot timeout; the bot may still be scoring the read). The page
 * then asks GET /ch/result/<ct> as it does for a pending score, instead of the error card. Any other failure keeps
 * the error card. Only the browser and the network are faked (wqc-page-harness.js).
 */
const { page, ok, READ } = require('./wqc-page-harness');

const unreachable = () => ({ status: 502, body: { error: 'bot_unreachable' } });
const routes = (result, poll) => ({
  'ch/HUB.TOKEN/read': ok(READ),
  'ch/upload': ok({ put_url: 'https://r2.test/put/abc', key: 'k', content_type: 'audio/webm' }),
  'r2.test/put': () => ({ status: 200, body: {} }),
  'ch/result$': result,
  ...(poll ? { 'ch/result/CT1': poll } : {}),
});
async function readAndStop(p) {
  await p.click('wqc-ex-read');
  await p.click('wqc-go');
  await p.click('wqc-stop');
}

describe('POST ch/result answers 502 bot_unreachable: the page polls the result', () => {
  test('a 502 then a 200 poll: the reading result, no error card', async () => {
    let calls = 0;
    const p = page({ routes: routes(unreachable, () => { calls += 1; return { status: 200, body: { score: { correct: 30, stopped: false }, wcpm: 30 } }; }) });
    await readAndStop(p);
    expect(p.screen()).toBe('read-wait');
    expect(p.html()).not.toContain('Something went wrong. Try again.');
    await p.runTimers((x) => x.ms === 3000);
    expect(calls).toBe(1);
    expect(p.screen()).toBe('read-result');
  });
  test('a 502 then pending, then the score: polled every 3 s like a pending POST', async () => {
    let calls = 0;
    const p = page({ routes: routes(unreachable, () => { calls += 1; return { status: 200, body: calls < 2 ? { pending: true } : { score: { correct: 30, stopped: false }, wcpm: 30 } }; }) });
    await readAndStop(p);
    await p.runTimers((x) => x.ms === 3000);
    expect(p.screen()).toBe('read-wait');
    await p.runTimers((x) => x.ms === 3000);
    expect(calls).toBe(2);
    expect(p.screen()).toBe('read-result');
  });
  test('a 502 and the bot never had the read (poll 404): the error card, as today', async () => {
    const p = page({ routes: routes(unreachable, () => ({ status: 404, body: { error: 'not_found' } })) });
    await readAndStop(p);
    await p.runTimers((x) => x.ms === 3000);
    expect(p.html()).toContain('Something went wrong. Try again.');
  });
});

describe('every other failure of POST ch/result keeps the error card, at once', () => {
  test.each([
    ['502 upstream_error', { status: 502, body: { error: 'upstream_error' } }],
    ['500', { status: 500, body: {} }],
    ['400', { status: 400, body: { error: 'bad_request' } }],
  ])('%s', async (what, res) => {
    const p = page({ routes: routes(() => res, () => ({ status: 200, body: { score: { correct: 30 }, wcpm: 30 } })) });
    await readAndStop(p);
    expect(p.html()).toContain('Something went wrong. Try again.');
    expect(p.fetches.some((f) => /ch\/result\/CT1/.test(f.url))).toBe(false);
  });
});
