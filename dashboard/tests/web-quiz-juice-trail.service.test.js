/**
 * The Trail (v2) end cards and the sound + motion kit: every end card (a read, a tap game, a story) calls
 * WQJ.finish once, with what was finished; a class round's hand-back card too. With the kit absent
 * (web_quiz_juice off) the cards are today's. The page runs whole in a vm (wqc-page-harness.js) with wq-trail.js
 * loaded before it and WQJ a recorder; only the browser and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');

const TRAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-trail.js'), 'utf8');
const KIT = 'window.WQJ = { calls: [], finish: function (o) { window.WQJ.calls.push(["finish", o]); }, correct: function () {}, wrong: function () {} };';
const TC = { stopDone: 'Stop done!', badge: 'Done', next: 'Next', mic: 'uses the microphone' };
const V2 = { pool: true, story: false };
const MENU = { lang: 'en', form: 'G3', record: true, trail: true, trail_copy: TC, v2: V2, exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }] };
const READ = { ...H.READ, lang: 'en', record: true, trail: true, trail_copy: TC, v2: V2 };

async function readCard(pre, r) {
  const p = H.page({ lang: 'en', menu: MENU, freshEls: true, pre, routes: { 'ch/HUB.TOKEN/read': H.ok(READ) } });
  p.w.open('read');
  await p.flush();
  p.w.readResult(r);
  return p;
}
const GOOD = { score: { correct: 40, attempted: 44, stopped: false }, wcpm: 40 };

test('kit on: the read result card calls WQJ.finish once, kind read-result', async () => {
  const p = await readCard([KIT, TRAIL_SRC], GOOD);
  expect(p.screen()).toBe('read-result');
  expect(p.win.WQJ.calls).toEqual([['finish', { kind: 'read-result' }]]);
});

test('kit on: a read that heard nothing still ends kindly but with no celebration', async () => {
  const p = await readCard([KIT, TRAIL_SRC], { failed: true, reason: 'unheard' });
  expect(p.screen()).toBe('read-result');
  expect(p.win.WQJ.calls).toEqual([]);
});

test('kit off: the same card, no kit, nothing breaks', async () => {
  const on = await readCard([KIT, TRAIL_SRC], GOOD);
  const off = await readCard([TRAIL_SRC], GOOD);
  expect(off.html()).toBe(on.html());
});

test('kit on: a story read\'s end calls WQJ.finish too', async () => {
  const STORY_MENU = { ...MENU, v2: { ...V2, story: { pid: 'p1' } } };
  const p = H.page({ lang: 'en', menu: STORY_MENU, freshEls: true, pre: [KIT, TRAIL_SRC], href: 'https://portal.test/c/HUB.TOKEN?room=story&pid=p1', routes: { 'ch/HUB.TOKEN/read': H.ok({ ...READ, practice_round: true }) } });
  p.w.open('read');
  await p.flush();
  p.w.readResult(GOOD);
  expect(p.win.WQJ.calls.filter((c) => c[0] === 'finish').length).toBe(1);
});
