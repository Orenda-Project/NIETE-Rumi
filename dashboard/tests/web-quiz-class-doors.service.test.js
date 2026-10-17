/**
 * The class table and the school league with the child home on (app_settings web_quiz_class_doors, default OFF; the bot
 * sends finish's `class_doors: true` beside `card_fold`, and the hub's `class_doors: {class, schools}`).
 *  - the folded card keeps the ranked Next tile as the one primary, and gets "See my class" + "School league" back
 *    under Share; each opens its screen (the board, the league);
 *  - the results screen keeps "See my class";
 *  - the home draws "My class" + "My school" under the Next tile, links to the quiz page's own class and league views;
 *  - switch off (no `class_doors`): the card, the results and the home are today's (the home hashed on the base).
 * wq.js runs whole in the harness's vm; wq-home.js in its own vm. Invented children only.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, flush } = require('./wq-page-harness');

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
const HOME_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.js');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const NEXT = { kind: 'game', id: 'stop.missing', href: '/h/tok.abc#missing', title: 'Find the missing word', title_ur: 'گم شدہ لفظ ڈھونڈیں', minutes: 2, source: 'ranked' };
const RESULT = {
  card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3, nth: 6 },
  challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 }, art: { card: 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl' },
  hub_door: true, jugnu_card: true,
};
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true } });
const primaries = (h) => (h.match(/\sdata-primary[\s>=]/g) || []).length;
const actions = (h) => {
  const body = h.replace(/^[\s\S]*?<\/div>(?=<div class="wq-scorecard)/, '');
  return (body.match(/<(?:a|button)\b[^>]*\bid="([^"]+)"/g) || []).map((x) => /id="([^"]+)"/.exec(x)[1]);
};
function cardPage(lang, result, o = {}) {
  const p = page({ lang, store: store(result), api: o.api || {} });
  if (o.fc) { vm.runInContext(FC_SRC, p.ctx); p.wq.card(); }
  return p;
}
const BOARD = { rows: [{ place: 1, first: 'Zara', animal: 'owl', correct: 3, total: 5 }], you: { place: 1, correct: 3, total: 5 }, finishers_n: 1, class_avg_pct: 60 };
const SCHOOLS = { mine: { name: 'Model School Testwala', place: 2, points: 40, kids: 4 }, rows: [{ place: 1, name: 'Other School', points: 50, kids: 5 }, { place: 2, name: 'Model School Testwala', points: 40, kids: 4, mine: true }], ranked_n: 2 };

describe('the folded card: the class and the league are back (class_doors)', () => {
  for (const lang of ['en', 'ur']) {
    for (const fc of [true, false]) {
      test(`${lang}${fc ? '' : ', the finish card file not in yet'}: Next stays the one primary; "See my class" + "School league" under Share; Home last`, () => {
        const p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, class_doors: true, next_offer: NEXT }, { fc });
        const h = p.html();
        expect(primaries(h)).toBe(1);
        expect(actions(h)).toEqual([fc ? 'wqfc-next' : 'wq-fnext', 'wq-share', 'wq-class', 'wq-schools', 'wq-fhome']);
        expect(h).toContain(p.wq.T.classBtn);
        expect(h).toContain(p.wq.T.schoolsBtn);
        // the old card's own words, nothing new to translate
        expect(h).not.toContain(p.wq.T.challenge);
      });
    }
    test(`${lang}: "See my class" opens the class table, "School league" the league; Back from the league is the card`, async () => {
      const p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, class_doors: true, next_offer: NEXT }, { fc: true, api: { 'board/': BOARD, 'schools/': SCHOOLS } });
      p.els['#wq-class'].fire('click');
      await flush(); await flush();
      expect(p.html()).toContain('data-m="M11"');
      expect(p.html()).toContain('wq-table');
      p.wq.card();
      p.els['#wq-schools'].fire('click');
      await flush(); await flush();
      expect(p.html()).toContain('data-m="M16"');
      expect(p.html()).toContain('Model School Testwala');
      p.els['#wq-back'].fire('click');
      expect(p.html()).toContain('data-m="M10"');
    });
  }
  test('a child with no class (no_class): no class, no league, even with class_doors', () => {
    const p = cardPage('en', { ...RESULT, card_v3: true, card_fold: true, class_doors: true, no_class: true, next_offer: NEXT }, { fc: true });
    expect(actions(p.html())).toEqual(['wqfc-next', 'wq-share', 'wq-fhome']);
  });
  test('switch off (no class_doors): the folded card is today\'s — Next, Share, Home', () => {
    for (const lang of ['en', 'ur']) {
      const p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, next_offer: NEXT }, { fc: true });
      expect(actions(p.html())).toEqual(['wqfc-next', 'wq-share', 'wq-fhome']);
    }
  });
});

describe('the results screen (class_doors)', () => {
  const resultsOf = async (lang, finish) => {
    const p = page({ lang, store: store(null), api: { finish } });
    vm.runInContext('Math.random = function () { return 0; };', p.ctx);
    p.wq.results(0);
    await flush(); await flush();
    return p;
  };
  test('on: "See my card" first, then "See my class"', async () => {
    for (const lang of ['en', 'ur']) {
      const p = await resultsOf(lang, { ...RESULT, card_fold: true, class_doors: true });
      const h = p.html();
      expect(h).toContain('data-m="M9"');
      expect(h.indexOf('id="wq-card"')).toBeLessThan(h.indexOf('id="wq-class"'));
      expect(h).toContain(p.wq.T.classBtn);
      expect(h).not.toContain('id="wq-more"');
    }
  });
  test('off: no "See my class" (today\'s folded results)', async () => {
    const p = await resultsOf('en', { ...RESULT, card_fold: true });
    expect(p.html()).not.toContain('id="wq-class"');
  });
});

describe('the home: "My class" and "My school" (wq-home.js)', () => {
  const win = {};
  vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent });
  const H = win.WQHOME;
  const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  const KID = '0123456789abcdef';
  const HUB = { lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false };
  const DOORS = { stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: 'The red kite' }], games: [{ kind: 'quiz', code: 'MATH01', k: 'kk', topic: 'Fractions', subject: 'Maths', done: false, from: 'teacher' }, { kind: 'numbers' }], videos: { href: '/lib/x' } };
  const HOME = { ...HUB, home_v3: 1, doors: DOORS, head: { dots: 2, today: false, jar: { fresh: true } } };
  const CD = { class: '/q/MATH01/class?k=kk', schools: '/q/MATH01/schools?k=kk' };
  const BANNED = /\b(test|exam|assess\w*|rank|position|prize|level|challenge)\b|امتحان|ٹیسٹ|چیلنج/i;
  const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ');

  test.each(['en', 'ur'])('%s: two links under the Next tile, to the class table and the league; Next stays the one primary', (lang) => {
    const h = H.html({ ...HOME, class_doors: CD }, { token: TOKEN, lang });
    expect((h.match(/\sdata-primary[\s>=]/g) || []).length).toBe(1);
    expect(h).toContain('href="/q/MATH01/class?k=kk"');
    expect(h).toContain('href="/q/MATH01/schools?k=kk"');
    expect(h).toContain(lang === 'ur' ? 'میری کلاس' : 'My class');
    expect(h).toContain(lang === 'ur' ? 'میرا اسکول' : 'My school');
    expect(h.indexOf('class="wq-next')).toBeLessThan(h.indexOf('class="wq-social'));
    expect(h.indexOf('class="wq-social')).toBeLessThan(h.indexOf('class="wq-grown'));
    expect(visible(h)).not.toMatch(BANNED);
  });
  test('only a same-site class or league path is drawn (anything else: no link)', () => {
    const h = H.html({ ...HOME, class_doors: { class: 'https://evil.example/x', schools: '/q/MATH01/schools?k=kk' } }, { token: TOKEN, lang: 'en' });
    expect(h).not.toContain('evil.example');
    expect(h).toContain('href="/q/MATH01/schools?k=kk"');
    const none = H.html({ ...HOME, class_doors: { class: 'javascript:x', schools: '//evil' } }, { token: TOKEN, lang: 'en' });
    expect(none).not.toContain('wq-social');
  });
  test('golden: no class_doors -> the home is today\'s, byte for byte (hashed on the base)', () => {
    expect(sha(H.html(HOME, { token: TOKEN, lang: 'en' }))).toBe('d8ed8374bf08a858');
    expect(sha(H.html(HOME, { token: TOKEN, lang: 'ur' }))).toBe('c99ec2ab45081c89');
  });
});
