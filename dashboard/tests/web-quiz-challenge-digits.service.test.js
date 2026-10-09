/**
 * Which digits the Challenge page writes in Urdu (public/wq/wq-challenge.js ud()): Western, isolated left to right, on
 * the trail or under the Urdu polish (the edge puts `wq-ur2` on <html> when web_quiz_ur_polish is on); today's Urdu
 * digits otherwise. English never changes. The whole page runs in the harness's vm.
 */
const { page, ok, MENU, CLIPS } = require('./wqc-page-harness');

const URDU_DIGIT = /[۰-۹]/;
const BIGGER = { ex: 'bigger', ct: 'CTB', clips: CLIPS, items: [{ a: 7, b: 3 }], practice: [], per_item_s: 10, stop_after: 4 };

describe('Urdu digits on the old menu follow the Urdu polish', () => {
  test('polish on (wq-ur2): no Urdu digit in any number the page writes — menu minutes, the counter, the score', async () => {
    const p = page({ lang: 'ur', htmlClass: 'wq-ur2', menu: MENU, routes: { 'ch/HUB.TOKEN/bigger': ok(BIGGER), 'ch/result$': ok({ score: { correct: 7, n: 10, stopped: false } }) } });
    expect(p.html()).toContain('⁦2⁩ منٹ');
    expect(p.html()).not.toMatch(URDU_DIGIT);
    await p.click('wqc-ex-bigger');
    p.w.bigger.result({ correct: 7, n: 10, stopped: false });
    expect(p.html()).toContain('⁦10⁩ میں سے ⁦7⁩');
    expect(p.html()).not.toMatch(URDU_DIGIT);
  });

  test('polish off: today\'s Urdu digits, unchanged', () => {
    const p = page({ lang: 'ur', menu: MENU });
    expect(p.html()).toContain('۲ منٹ');
  });

  test('English is the same with or without the class', () => {
    const on = page({ lang: 'en', htmlClass: 'wq-ur2', menu: MENU });
    const off = page({ lang: 'en', menu: MENU });
    expect(on.html()).toBe(off.html());
    expect(on.html()).toContain('2 min');
  });
});
