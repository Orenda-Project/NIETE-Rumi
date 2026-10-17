/**
 * Grade 1's "how many dots?" end with the child home on (the menu's card_fold, app_settings web_quiz_home_v3): ONE next
 * thing — "Pick a story", the child's home on its Stories door — and ONE Home row to the child's home, in place of the
 * single "Back" to the Jugnu menu. Without card_fold the end is today's. The whole page runs in a vm (wqc-page-harness).
 */
const fs = require('fs');
const path = require('path');
const { page, ok } = require('./wqc-page-harness');

const G1_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-g1.js'), 'utf8');
const ITEMS = [[3, [3, 2, 4]], [7, [8, 7, 6]]].map(([n, tiles]) => ({ item_id: `numid.G1.A.0${n}`, n, layout: 'tenframe', tiles }));
const COPY_KEYS = { title: 'jg.g1.title', say: 'jg.g1.say' };
const payload = (lang) => ({ ex: 'numbers', form: 'G1', lang, ct: 'CTG1', copy_keys: COPY_KEYS, items: ITEMS, anchor_block: 'G1A', stop_after: 0, per_item_s: 10,
  show_timer: false, sound_off_safe: true, mode: 'check', record: null, period_id: null, passage_id: null, item_set_id: null, exposure_no: 1, band: null, anchor_exposure_no: 1, draw: { outcome: 'served' } });
const G1_MENU = { form: 'G1', exercises: [{ id: 'numbers', copy_keys: COPY_KEYS, mins: 2, done: false, last: null, anchor_block: 'G1A' }], record: true, period_id: null, rt: false };

async function endOf(lang, menu) {
  const clock = { t: 1000000 };
  const p = page({ lang, menu, freshEls: true, clock, scripts: { '/wq/wq-g1.js': G1_SRC }, routes: { 'ch/HUB\\.TOKEN/numbers': ok(payload(lang)), 'ch/result': ok({ score: { correct: 2, n: 2, stopped: false } }) } });
  await p.flush();
  await p.click('wqc-ex-numbers');
  await p.flush();
  await p.click('wqc-go');
  for (let i = 0; i < ITEMS.length; i += 1) { clock.t += 1000; await p.click('wq-g1-ta'); await p.runTimers(); }
  expect(p.screen()).toBe('numbers-result');
  return p.html();
}

describe('grade 1 "how many dots?": the end with the home on', () => {
  test.each([['en', 'Pick a story', 'Home'], ['ur', 'کہانی چنیں', 'ہوم']])('%s: one primary ("Pick a story" → the Stories door), one Home row to the child\'s home, no Back', async (lang, pick, home) => {
    const h = await endOf(lang, { ...G1_MENU, card_fold: true });
    expect((h.match(/data-primary/g) || []).length).toBe(1);
    expect(h).toMatch(new RegExp(`<a class="wq-btn wq-go" id="wqc-fnext" data-primary href="/h/HUB\\.TOKEN\\?[^"]*from=home#stories">${pick}</a>`));
    expect(h).toMatch(new RegExp(`<a class="wq-btn wq-soft" id="wqc-fhome" data-home href="/h/HUB\\.TOKEN\\?[^"#]*from=home">${home}</a>`));
    expect(h).not.toContain('id="wqc-menu"');
  });
  test('home off (no card_fold): today\'s end — one Back to the Jugnu menu', async () => {
    const h = await endOf('en', G1_MENU);
    expect(h).toContain('id="wqc-menu"');
    expect(h).not.toMatch(/wqc-fnext|wqc-fhome/);
  });
});
