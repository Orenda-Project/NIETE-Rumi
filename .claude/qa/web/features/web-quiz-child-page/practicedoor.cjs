// web-quiz-child-page/practicedoor — the practice door after a lesson quiz (A/B test ict-quiz-practice-door, arm B;
// app_settings ab_quiz_practice_door, bd-ek4vxb.1). Not the same thing as practice.cjs (web_quiz_practice_play).
// The demo seed has no G1-5 English lesson-plan quiz, so this lane proves the switch-off and the not-eligible paths;
// arm B and the daily cap are held by the unit tests named in NO_POOL.
'use strict';
const L = require('./lib.cjs');
const { expect, CODES } = L;
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };
const KEY = 'ab_quiz_practice_door';
const NO_POOL = 'demo seed has no G1-5 English lesson-plan quiz or practice pool; held by '
  + 'dashboard/tests/web-quiz-practice-door-page.service.test.js + bot/tests/quiz/test-practice/*';

async function noDoor(page, ctx, name) {
  const f = await L.finishFast(page, ctx, CODES.OPEN, name);
  expect(!(f.result && f.result.practice_door), 'finish offered a practice door: ' + JSON.stringify(f.result.practice_door));
  expect(await page.locator('#wq-pd-go').count() === 0, 'the card shows "Practise for your test"');
  const asked = await page.evaluate(() => [...document.scripts].some((s) => /wq-practice\.js/.test(s.src)));
  expect(!asked, 'the page asked for wq-practice.js');
  const said = {};
  for (const k of ['start', 'finish']) {
    const r = await page.request.post(ctx.baseUrl + '/api/wq/practice/' + k, { data: { st: f.st, round_id: 'x', answers: {} } });
    said[k] = r.status();
    expect(r.status() === 404, 'practice/' + k + ' answered ' + r.status());
  }
  return said;
}

on('WQ287', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, KEY, null, null);
  return { off: await noDoor(page, ctx, 'Pari Testwala') };
});

on('WQ288', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  try {
    await L.setFlag(ctx, page, KEY, 'true', null);
    return { science: await noDoor(page, ctx, 'Saba Testwala') };
  } finally { await L.setFlag(ctx, page, KEY, null, null); }
});

for (const id of ['WQ289', 'WQ290']) on(id, 'off', async () => ({ blocked: NO_POOL }));

module.exports = { runs, modes };
