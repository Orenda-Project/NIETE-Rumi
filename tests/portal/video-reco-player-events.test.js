'use strict';
/**
 * bd-gzfdu9 (VIDREC): the /v player's own script, run against a fake <video> (lead-review ruling 20261020T201806).
 * `play` fires when play() is CALLED, even when the media never loads (qa-e2e finding 20261020T201609: src="",
 * readyState 0, a `play` row written and the first-only index then hid the real one). The row is written on the
 * media's `playing` event instead, the first time only.
 */
const vm = require('vm');
const { renderPlayer } = require('../../dashboard/services/video-reco-page');

const VIEW = { language: 'en', title: 'Asking why-questions', reason: 'r', src: 'https://x/v.mp4', startS: 95, endS: 229, eventsUrl: '/v/t/e' };

function runPlayer() {
  const html = renderPlayer(VIEW);
  const code = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const video = new EventTarget();
  Object.assign(video, { currentTime: 0, paused: true, seeking: false, readyState: 0, play() {} });
  const win = new EventTarget();
  const doc = new EventTarget();
  Object.assign(doc, { visibilityState: 'visible', getElementById: (id) => (id === 'v' ? video : null) });
  const beacons = [];
  const sandbox = {
    document: doc, window: win, Blob, JSON, Math, Date,
    navigator: { sendBeacon: (_url, blob) => { beacons.push(blob); return true; } },
    setInterval: () => 0, fetch: () => {},
  };
  vm.runInNewContext(code, sandbox);
  const sent = async () => {
    win.dispatchEvent(new Event('pagehide'));
    const bodies = await Promise.all(beacons.splice(0).map((b) => b.text()));
    return bodies.flatMap((b) => JSON.parse(b).events.map((e) => e.event));
  };
  return { video, sent };
}

describe('/v player: the play row', () => {
  test('play() called on media that never loads (readyState 0) writes no play row', async () => {
    const { video, sent } = runPlayer();
    video.dispatchEvent(new Event('play'));
    expect(await sent()).toEqual(['open']);
  });

  test('`playing` writes one play row at the current position, first time only', async () => {
    const { video, sent } = runPlayer();
    await sent();
    video.readyState = 4; video.paused = false; video.currentTime = 95.2;
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('playing'));
    expect(await sent()).toEqual(['play']);
  });

  test('the browser order play → playing still writes exactly one play row', async () => {
    const { video, sent } = runPlayer();
    video.dispatchEvent(new Event('play'));
    video.readyState = 4; video.paused = false; video.currentTime = 95.2;
    video.dispatchEvent(new Event('playing'));
    expect((await sent()).filter((e) => e === 'play')).toEqual(['play']);
  });
});
