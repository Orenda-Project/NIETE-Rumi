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

describe('Missing number practice and the story questions', () => {
  const MISS = { ex: 'missing', ct: 'CTM', clips: H.CLIPS, items: [{ seq: [5, 6, null, 8], answer: 7 }], practice: [{ seq: [1, 2, null, 4], answer: 3 }, { seq: [2, 4, null, 8], answer: 6 }], stop_after: 4, first_key_s: 5 };
  const MMENU = { lang: 'en', form: 'G3', exercises: [{ id: 'missing', name: 'Missing number', mins: 2, done: false, last: null }] };
  const type = async (p, digits) => { for (const d of String(digits)) await p.click(`wqc-k${d}`); await p.click('wqc-kok'); };
  async function missing(pre) {
    const p = H.page({ menu: MMENU, pre, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': H.ok(MISS) } });
    await p.click('wqc-ex-missing');
    await p.click('wqc-go');
    return p;
  }

  test('kit on: a right practice number calls WQJ.correct on the gap, a not-yet one WQJ.wrong; the counted rows call nothing', async () => {
    const p = await missing([KIT]);
    expect(p.screen()).toBe('missing-practice');
    await type(p, 3); // right
    await p.runTimers((x) => x.ms === 1800);
    await type(p, 5); // not yet (6)
    expect(p.win.WQJ.calls).toEqual([['correct', 'wqc-gap'], ['wrong', 'wqc-gap']]);
    await p.runTimers((x) => x.ms === 1800);
    await p.runTimers((x) => x.ms === 300);
    expect(p.screen()).toBe('missing-play');
    await type(p, 7);
    expect(p.win.WQJ.calls).toHaveLength(2); // a counted row shows no right or wrong, so no sound either
  });

  test('kit off: the Missing practice screens and words are today\'s', async () => {
    const on = await missing([KIT]);
    const off = await missing([]);
    await type(on, 5); await type(off, 5);
    expect(off.html()).toBe(on.html());
  });

  const QS = { questions: [{ id: 'q1', prompt: 'Why?', options: ['a', 'b', 'c'], clip: null }, { id: 'q2', prompt: 'Who?', options: ['d', 'e', 'f'], clip: null }] };
  const QA = (url, init) => { const b = JSON.parse(init.body); const right = { q1: 1, q2: 0 }[b.q]; const q = QS.questions.find((x) => x.id === b.q); return { status: 200, body: { ok: b.pick === right, answer: q.options[right] } }; };
  async function questions(pre) {
    const p = H.page({ menu: MENU, pre, freshEls: true, routes: { 'ch/qs': H.ok(QS), 'ch/qa': QA } });
    p.w.S.data = { ct: 'CT1' };
    p.w.qa.open();
    await p.flush(); await p.flush();
    return p;
  }

  test('kit on: a right story answer calls WQJ.correct on the tile, a not-yet one WQJ.wrong', async () => {
    const p = await questions([KIT]);
    expect(p.screen()).toBe('qa');
    await p.click('wqc-o1'); await p.flush(); // right
    await p.runTimers((x) => x.ms === 1600);
    await p.click('wqc-o2'); await p.flush(); // not yet
    expect(p.win.WQJ.calls).toEqual([['correct', 'wqc-o1'], ['wrong', 'wqc-o2']]);
  });

  test('kit off: the story question screens and words are today\'s', async () => {
    const on = await questions([KIT]);
    const off = await questions([]);
    await on.click('wqc-o2'); await off.click('wqc-o2'); await on.flush(); await off.flush();
    expect(off.html()).toBe(on.html());
  });
});
