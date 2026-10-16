/**
 * A class round turn on the Challenge page (public/wq/wq-challenge.js, run whole in the harness's vm): when the
 * exercise payload carries `round_say` (only a round turn's does), the same warm line shows under every item, right
 * or not; without it the item screens are as before.
 */
const { page, ok, MENU, CLIPS } = require('./wqc-page-harness');

const SAY = "Not sure? That's fine. Tap the arrow.";
const ITEMS = [[5, 6, 7, null, 8], [14, 15, null, 17, 16], [20, null, 40, 50, 30]].map((r) => ({ seq: r.slice(0, 4), answer: r[4] }));
const COPY = { missAsk: 'Which number is missing?', missYes: 'Yes! {n} goes here.', missWas: '{n} goes here. Let us try another.', missSkip: 'Skip' };
const MENU_M = { ...MENU, record: true, trail: true, trail_copy: { title: "{name}'s Trail", sub: '{done} of {total}', allDone: 'All done', badge: 'Done', next: 'Next', practice: 'Practice', stopDone: 'Stop done!', ...COPY },
  exercises: [{ id: 'missing', name: 'Missing number', mins: 2, done: false, last: null, badge: false }] };
const MISSING = (extra = {}) => ({ ex: 'missing', ct: 'CTM', clips: CLIPS, record: true, trail: true, trail_copy: MENU_M.trail_copy, items: ITEMS,
  practice: [{ seq: [1, 2, null, 4], answer: 3 }], stop_after: 4, first_key_s: 5, ...extra });
const type = async (p, digits) => { for (const d of String(digits)) await p.click(`wqc-k${d}`); await p.click('wqc-kok'); };
const toItems = async (p) => {
  await p.click('wqc-ex-missing');
  await p.click('wqc-go');
  await type(p, 3);
  await p.runTimers((x) => x.ms === 1800);
  await p.runTimers((x) => x.ms === 300);
};

test('a round turn: the warm line under the first item and under the next one, whatever the answer', async () => {
  const p = page({ menu: MENU_M, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING({ round_say: SAY })) } });
  await toItems(p);
  expect(p.screen()).toBe('missing-play');
  expect(p.html()).toContain(`<p class="wqc-roundsay" id="wqc-roundsay">${SAY}</p>`);
  await type(p, 1);                       // a wrong answer: the same line, no reaction
  await p.runTimers((x) => x.ms === 250);
  expect(p.screen()).toBe('missing-play');
  expect(p.html()).toContain('wqc-roundsay');
});

test('without round_say the item screens carry no such line', async () => {
  const p = page({ menu: MENU_M, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING()) } });
  await toItems(p);
  expect(p.screen()).toBe('missing-play');
  expect(p.html()).not.toContain('wqc-roundsay');
});
