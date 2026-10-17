'use strict';
/**
 * The pages of web-quiz-one-urdu-face.service.test.js: each case renders one child page with the exported
 * renderers. With web_quiz_one_face off their bytes are pinned in one-urdu-face-off-golden.json (fast page off) and
 * one-urdu-face-off-fast-golden.json (fast page on), both captured from the code before the one-face change; with it on,
 * the same pages are checked for the Nastaliq file they name.
 * Test strings only: no real child names.
 */
const QUIZ = (lang, extra = {}) => ({
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: lang === 'ur' ? 'پودے کے حصے' : 'Parts of a plant', lang, dir: lang === 'ur' ? 'rtl' : 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  video: null,
  preview: false,
  brand: 'niete',
  rt: false,
  ...extra,
});
const MENU = (lang, extra = {}) => ({ lang, exercises: [], ...extra });
const CARD = (lang) => ({ lang, first: 'Test', deed_text: lang === 'ur' ? 'ٹیسٹ' : 'Test', ret: { text: lang === 'ur' ? 'ٹیسٹ' : 'Test', cta: 'Go', href: 'https://wa.me/0000000000?text=hi' } });
const HUB = (lang, extra = {}) => ({ lang, brand: 'niete', kids: [{ kid: '0123456789abcdef', name: 'Test Child' }], ...extra });

const ORIGIN = 'http://portal.example';
const ASSET_V = 'abc123';
const HUB_TOKEN = `${'a'.repeat(20)}.${'b'.repeat(22)}`;

/**
 * name → html. `oneFace`: the value the answers carry as `one_face` (the bot sends only `true`; any other value checks
 * that the edge reads nothing but JSON true as on); `fast`: the fast page's `fast: true`.
 * The shells that call no bot (library, closed, card) get what the router keeps from the last answer, and the challenge
 * menu what the router hands its renderer: the one face only for `one_face: true`.
 */
function cases(R, { fast = false, oneFace } = {}) {
  const on = oneFace === true;
  const more = { ...(fast ? { fast: true } : {}), ...(oneFace !== undefined ? { one_face: oneFace } : {}) };
  const shellUi = (ui) => (on ? { ...(ui || {}), uf: true } : ui);
  const out = {};
  for (const lang of ['en', 'ur']) {
    for (const [look, ui] of [['plain', null], ['ur2', { ur2: true }]]) {
      const x = ui ? { ...more, ui } : more;
      out[`quiz_${lang}_${look}`] = R.renderQuizPage({ payload: QUIZ(lang, x), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: ASSET_V });
      out[`hub_${lang}_${look}`] = R.renderHubPage({ payload: HUB(lang, x), token: HUB_TOKEN, origin: ORIGIN, assetV: ASSET_V });
      out[`lib_${lang}_${look}`] = R.renderLibPage({ hub: HUB_TOKEN, kid: 'k1', lang, origin: ORIGIN, assetV: ASSET_V, brandKey: 'niete', ui: shellUi(ui) });
      out[`challenge_${lang}_${look}`] = R.renderChallengePage({ menu: MENU(lang, on ? { ...x, ui: shellUi(ui) } : x), token: HUB_TOKEN, kid: null, origin: ORIGIN, assetV: ASSET_V, chV: 'ch1', brandKey: 'niete' });
      out[`closed_${lang}_${look}`] = R.renderClosedPage({ lang, kind: 'closed', origin: ORIGIN, assetV: ASSET_V, brandKey: 'niete', ui: shellUi(ui) });
    }
    out[`card_${lang}`] = R.renderCardPage({ facts: CARD(lang), token: 'c'.repeat(40), origin: ORIGIN, url: `${ORIGIN}/k/${'c'.repeat(40)}`, brandKey: 'niete', ...(on ? { oneFace: true } : {}) });
  }
  return out;
}

module.exports = { QUIZ, HUB, MENU, CARD, ORIGIN, ASSET_V, HUB_TOKEN, cases };
