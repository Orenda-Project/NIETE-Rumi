/**
 * The Challenge page's own answers and the sound + motion kit: a practice pick in "Which is bigger?" and an answer
 * to a story question call WQJ.correct / WQJ.wrong on the tapped tile. With the kit absent (web_quiz_juice off) the
 * screens are today's. The page runs whole in a vm (wqc-page-harness.js) with WQJ a recorder placed before it.
 */
const H = require('./wqc-page-harness');

const KIT = 'window.WQJ = { calls: [], correct: function (o) { window.WQJ.calls.push(["correct", o.el && o.el.id]); }, wrong: function (o) { window.WQJ.calls.push(["wrong", o.el && o.el.id]); }, finish: function () {} };';
const BIGGER = { ex: 'bigger', ct: 'CT2', clips: H.CLIPS, per_item_s: 10, stop_after: 4, practice: [{ a: 8, b: 4, answer: 8 }, { a: 3, b: 9, answer: 9 }], items: [{ a: 7, b: 5 }] };
const MENU = { lang: 'en', form: 'G3', exercises: [{ id: 'bigger', name: 'Which is bigger?', mins: 2, done: false, last: null }] };

async function practice(pre) {
  const p = H.page({ menu: MENU, pre, routes: { 'ch/HUB.TOKEN/bigger': H.ok(BIGGER) } });
  await p.click('wqc-ex-bigger');
  await p.click('wqc-go');
  return p;
}

test('kit on: a right practice pick calls WQJ.correct on the tile, a not-yet pick WQJ.wrong', async () => {
  const p = await practice([KIT]);
  expect(p.screen()).toBe('bigger-practice');
  await p.click('wqc-a'); // 8: right
  await p.runTimers((x) => x.ms === 1600);
  expect(p.screen()).toBe('bigger-practice');
  await p.click('wqc-a'); // 3: not yet
  expect(p.win.WQJ.calls).toEqual([['correct', 'wqc-a'], ['wrong', 'wqc-a']]);
});

test('kit off: the same screens and words', async () => {
  const on = await practice([KIT]);
  const off = await practice([]);
  await on.click('wqc-a'); await off.click('wqc-a');
  expect(off.html()).toBe(on.html());
  expect(off.els['wqc-say'].textContent).toBe(on.els['wqc-say'].textContent);
});
