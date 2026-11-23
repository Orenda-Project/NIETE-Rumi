// web-quiz-child-page/classlink — the standing class link (/j/<code>) and the class round. Both sit under
// web_quiz_challenge_v2, which is off on this lane; what can be proved is that with the switches off every /j/ address
// is exactly the unknown-code page and the round addresses answer not-found.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, text, sleep } = L;
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };
const V2 = 'the standing class link and the class round are under web_quiz_class_link / web_quiz_class_round with parent web_quiz_challenge_v2, off on this lane; the switch-off behaviour is WQ251 / WQ256';

on('WQ251', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const unknown = await page.request.get(ctx.baseUrl + '/q/ZZZZ9999');
  const uBody = (await unknown.text()).replace(/\?v=[0-9a-f]+/g, '').replace(/<meta property="og:url"[^>]*>/, '');
  for (const code of ['ABCD1234', 'ZZZZ9999', 'x']) {
    const r = await page.request.get(ctx.baseUrl + '/j/' + code);
    const body = (await r.text()).replace(/\?v=[0-9a-f]+/g, '').replace(/<meta property="og:url"[^>]*>/, '');
    expect(r.status() === unknown.status(), '/j/' + code + ' answered ' + r.status() + ', the unknown /q/ answers ' + unknown.status());
    expect(body === uBody, '/j/' + code + ' is not the unknown-code page');
    expect(!/Jugnu's Challenge|Stories and number games/.test(body), 'a closed class link still previews as the Challenge');
  }
  const q1 = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN)).text();
  expect(/<script id="boot"/.test(q1), 'the quiz page itself changed');
  return { off: 'every /j/<code> is the unknown-code page' };
});

on('WQ256', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const r = await page.request.get(ctx.baseUrl + '/r/not-a-real-token/round');
  const body = await r.text();
  expect(r.status() === 404, '/r/<token>/round answered ' + r.status());
  expect(!/class round|Start the round/i.test(body), 'a round page leaked with the switch off');
  return { round: 404, note: 'the teacher\'s report page (/r/<token>) belongs to the teacher-report spec; its token is minted when a quiz report is sent' };
});

// bd-ptl6x9.7: the weak-skill nudge's game link. Off on this lane, so what is proved is that ?ex= changes nothing
// about a closed link; the jump itself is pinned by dashboard/tests/weak-skill-jugnu-deeplink.service.test.js.
on('WQ285', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const strip = (b) => b.replace(/\?v=[0-9a-f]+/g, '').replace(/<meta property="og:url"[^>]*>/, '');
  const unknown = await page.request.get(ctx.baseUrl + '/q/ZZZZ9999');
  const r = await page.request.get(ctx.baseUrl + '/j/ABCD1234?ex=missing');
  expect(r.status() === unknown.status(), '/j/<code>?ex=missing answered ' + r.status() + ', the unknown /q/ answers ' + unknown.status());
  expect(strip(await r.text()) === strip(await unknown.text()), '/j/<code>?ex=missing is not the unknown-code page');
  return { off: '/j/<code>?ex=missing is the unknown-code page', on: V2 };
});

for (const id of ['WQ249', 'WQ250', 'WQ252', 'WQ253', 'WQ254', 'WQ255', 'WQ257']) on(id, 'off', async () => ({ blocked: V2 }));

module.exports = { runs, modes };
