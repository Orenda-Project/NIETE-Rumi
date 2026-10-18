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
const http = require('http');
const express = require('express');
const { page, flush } = require('./wq-page-harness');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
const HOME_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.js');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

const CHILD = { first: 'Zara Testwala', chip: 'c1', animal: 'owl' };
const NEXT = { kind: 'game', id: 'stop.missing', href: '/h/tok.abc#missing', title: 'Find the missing word', title_ur: 'گم شدہ لفظ ڈھونڈیں', minutes: 2, source: 'ranked' };
const RESULT = {
  card: { first: 'Zara Testwala', animal: 'owl', correct: 3, total: 5, stars: 3, nth: 6 },
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
const BOARD = { rows: [{ place: 1, first: 'Zara Testwala', animal: 'owl', correct: 3, total: 5 }], you: { place: 1, correct: 3, total: 5 }, finishers_n: 1, class_avg_pct: 60 };
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

// The league and the class table with the switch on (the bot adds `class_doors` to both answers): the cold recipient's
// "Play and add points for <school>" is ONE label (the button is a flex row: the words and the school's name were two
// side-by-side columns), the one primary is marked, and a short lower-case sector code reads as a name ("ict" -> "ICT").
describe('the league and the class table (class_doors on their answers)', () => {
  const LEAGUE = { mine: { name: 'Model School Testwala', place: 2, points: 40, kids: 4, sector: 'ict' }, rows: [{ place: 1, name: 'Other School', points: 50, kids: 5, sector: 'ict' }, { place: 2, name: 'Model School Testwala', points: 40, kids: 4, sector: 'ict', mine: true }], ranked_n: 2 };
  const cold = async (lang, body) => { const p = page({ lang, store: {}, view: 'schools', api: { '/schools/TEST': body } }); await flush(); await flush(); return p; };
  const playBtn = (h) => /<button[^>]*id="wq-play-s"[^>]*>([\s\S]*?)<\/button>/.exec(h);
  for (const lang of ['en', 'ur']) {
    test(`${lang}, on: the play button holds one label and is the one primary; the sector chip says ICT`, async () => {
      const h = (await cold(lang, { ...LEAGUE, class_doors: true })).html();
      const m = playBtn(h);
      expect(m).not.toBeNull();
      expect(m[0]).toMatch(/\sdata-primary[\s>]/);
      expect(m[1]).toMatch(/^<span class="wq-btn-t">[\s\S]*<\/span>$/);
      expect(primaries(h)).toBe(1);
      expect(h).toMatch(/<bdi>ICT<\/bdi><\/button>/);
    });
    test(`${lang}, off: the league is today's (no wrapper, no primary mark, the sector as stored)`, async () => {
      const h = (await cold(lang, LEAGUE)).html();
      expect(playBtn(h)[1]).not.toContain('wq-btn-t');
      expect(primaries(h)).toBe(0);
      expect(h).toMatch(/<bdi>ict<\/bdi><\/button>/);
    });
  }
  test('a played child, on: Share is the league\'s one primary; a sector that is a name stays as it is', async () => {
    const p = page({ lang: 'en', store: store({ ...RESULT }), api: { 'board/': BOARD, 'schools/': { ...LEAGUE, mine: { ...LEAGUE.mine, sector: 'Sector One' }, class_doors: true } } });
    p.wq.board();
    await flush(); await flush();
    p.els['#wq-schools'].fire('click');
    await flush(); await flush();
    const h = p.html();
    expect(h).toMatch(/<button[^>]*id="wq-share-s"[^>]*\sdata-primary[\s>]/);
    expect(primaries(h)).toBe(1);
    expect(h).toContain('<bdi>Sector One</bdi>');
  });
  test('the class table, on: "Share the class table" is its one primary; off: no mark', async () => {
    for (const [extra, n] of [[{ class_doors: true }, 1], [{}, 0]]) {
      const p = page({ lang: 'en', store: store({ ...RESULT }), api: { 'board/': { ...BOARD, ...extra } } });
      p.wq.board();
      await flush(); await flush();
      const h = p.html();
      expect(h).toContain('data-m="M11"');
      expect(primaries(h)).toBe(n);
      if (n) expect(h).toMatch(/<button[^>]*id="wq-share-t"[^>]*\sdata-primary[\s>]/);
    }
  });
});

describe('the home: "My class" and "My school" (wq-home.js)', () => {
  const win = {};
  vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent });
  const H = win.WQHOME;
  const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  const KID = '0123456789abcdef';
  // (the golden hashes below were taken on the base with this exact fixture, so its first name stays as it was)
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
    // the hub's language on the link (the bot adds &lang=) is drawn as it came
    expect(H.html({ ...HOME, class_doors: { class: '/q/MATH01/class?k=kk&lang=ur', schools: '/q/MATH01/schools?k=kk&lang=ur' } }, { token: TOKEN, lang: 'ur' })).toContain('href="/q/MATH01/class?k=kk&amp;lang=ur"');
    const none = H.html({ ...HOME, class_doors: { class: 'javascript:x', schools: '//evil' } }, { token: TOKEN, lang: 'en' });
    expect(none).not.toContain('wq-social');
  });
  test('golden: no class_doors -> the home is today\'s, byte for byte (hashed on the base)', () => {
    expect(sha(H.html(HOME, { token: TOKEN, lang: 'en' }))).toBe('d8ed8374bf08a858');
    expect(sha(H.html(HOME, { token: TOKEN, lang: 'ur' }))).toBe('c99ec2ab45081c89');
  });
});

// The class table and the league in the child's language (the portal sets `ui_lang` from the link's ?lang only with
// the switch on), titled with the child's own class, and their shares carrying the language.
describe('the class table and the league in the child\'s language (ui_lang), titled with the child\'s class', () => {
  const LEAGUE = { mine: { name: 'Model School Testwala', place: 2, points: 40, kids: 4, sector: 'ict' }, rows: [{ place: 1, name: 'Other School', points: 50, kids: 5, sector: 'ict' }, { place: 2, name: 'Model School Testwala', points: 40, kids: 4, sector: 'ict', mine: true }], ranked_n: 2 };
  const MINE = { ...BOARD, class_doors: true, my_class: '3-B', one_class: true };
  const boardPage = async (o) => {
    const p = page({ lang: 'en', store: o.store || {}, view: o.view || 'class', bootExtra: o.ui ? { ui_lang: o.ui } : {}, nav: o.nav || {}, api: { '/board/TEST': o.board || MINE, '/schools/TEST': o.schools || { ...LEAGUE, class_doors: true } } });
    await flush(); await flush();
    return p;
  };
  const h2 = (h) => (/<h2>([\s\S]*?)<\/h2>/.exec(h) || [])[1];
  test('an English quiz, ui_lang ur: the class table speaks Urdu and is titled with the child\'s class', async () => {
    const p = await boardPage({ ui: 'ur' });
    expect(p.wq.T.yourClass).toBe('آپ کی کلاس');
    expect(h2(p.html())).toBe('کلاس <bdi>۳-B</bdi>');
  });
  test('ui_lang en on an Urdu quiz: English, "Class 3-B"', async () => {
    const p = page({ lang: 'ur', store: {}, view: 'class', bootExtra: { ui_lang: 'en' }, api: { '/board/TEST': MINE } });
    await flush(); await flush();
    expect(h2(p.html())).toBe('Class <bdi>3-B</bdi>');
  });
  test('the league with ui_lang ur: the league\'s Urdu title, never the class', async () => {
    const p = await boardPage({ ui: 'ur', view: 'schools' });
    expect(p.html()).toContain('<h2>' + p.wq.T.schoolsT + '</h2>');
    expect(p.wq.T.schoolsT).toMatch(/[؀-ۿ]/);
  });
  test('a table of more than one class: "Your class", never a list of grades', async () => {
    const p = await boardPage({ board: { ...MINE, one_class: false } });
    expect(h2(p.html())).toBe('Your class');
  });
  test('a viewer the table does not know (no my_class): today\'s title', async () => {
    const p = await boardPage({ board: { ...BOARD, class_doors: true } });
    expect(h2(p.html())).toBe('Class 3-B league table');
  });
  test('off (no class_doors): today\'s title even with my_class; no ui_lang: the quiz\'s language', async () => {
    const p = await boardPage({ board: { ...BOARD, my_class: '3-B', one_class: true } });
    expect(h2(p.html())).toBe('Class 3-B league table');
    expect(p.wq.T.yourClass).toBe('Your class');
  });
  test('ui_lang other than the quiz\'s: Play opens the quiz page in its own language (keeps k)', async () => {
    const p = page({ lang: 'en', store: {}, view: 'class', search: '?lang=ur&k=abc123', bootExtra: { ui_lang: 'ur' }, api: { '/board/TEST': MINE } });
    await flush(); await flush();
    p.els['#wq-play'].fire('click');
    expect(p.hist.assigned).toEqual(['/q/TEST?k=abc123']);
  });
  test('ui_lang the same as the quiz\'s: Play stays on the page (today\'s)', async () => {
    const p = page({ lang: 'en', store: {}, view: 'class', bootExtra: { ui_lang: 'en' }, api: { '/board/TEST': MINE } });
    await flush(); await flush();
    p.els['#wq-play'].fire('click');
    expect(p.hist.assigned).toEqual([]);
  });
  test('on: the class table\'s and the league\'s share links carry the page\'s language; off: today\'s links', async () => {
    const got = [];
    const nav = { share: (d) => { got.push(d.url); return Promise.resolve(); } };
    for (const [b, s] of [[MINE, { ...LEAGUE, class_doors: true }], [BOARD, LEAGUE]]) {
      const p = page({ lang: 'en', store: store({ ...RESULT }), bootExtra: { ui_lang: 'ur' }, nav, api: { 'board/': b, 'schools/': s } });
      p.wq.board();
      await flush(); await flush();
      p.els['#wq-share-t'].fire('click');
      p.els['#wq-schools'].fire('click');
      await flush(); await flush();
      p.els['#wq-share-s'].fire('click');
      await flush();
    }
    const on = got.slice(0, got.length / 2);
    const off = got.slice(got.length / 2);
    expect(on[0]).toMatch(/\/q\/TEST\/class\?v=1&lang=ur$/);
    expect(on.slice(1).every((u) => /\/q\/TEST\/schools\?v=\d+&lang=ur$/.test(u))).toBe(true);
    expect(off[0]).toMatch(/\/q\/TEST\/class\?v=1$/);
    expect(off.every((u) => !u.includes('lang='))).toBe(true);
  });
  test('on, the page in the quiz\'s own language: the share links leave lang out (it is the quiz\'s anyway)', async () => {
    const got = [];
    const p = page({ lang: 'en', store: store({ ...RESULT }), nav: { share: (d) => { got.push(d.url); return Promise.resolve(); } }, api: { 'board/': MINE } });
    p.wq.board();
    await flush(); await flush();
    p.els['#wq-share-t'].fire('click');
    await flush();
    expect(got[0]).toMatch(/\/q\/TEST\/class\?v=1$/);
  });
});

// The edge: /q/<code>/class and /schools open in the link's ?lang (en|ur) when the bot's quiz answer carries
// class_doors (web_quiz_class_doors on): the html's lang/dir and the boot's ui_lang. Off, or any other page: today's.
describe('the edge: the class table and the league open in the link\'s language (class_doors)', () => {
  const QUIZ = (extra) => ({ quiz: { id: 'q', code: 'AB12CD', topic: 'Plants', lang: 'en', dir: 'ltr', grade: '3', n: 1, questions: [{ qid: 'q1', text: 'a?', options: [{ slot: 'A', text: 'x' }] }] }, cls: { label: 'Class 3', teacher: null, chips: [] }, live: {}, ...extra });
  function serve(body) {
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }) }));
    return new Promise((r) => { const s = app.listen(0, () => r(s)); });
  }
  function get(srv, path) {
    return new Promise((resolve) => http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, html: d })); }));
  }
  const bootOf = (html) => JSON.parse(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'));
  test('on: /class?lang=ur and /schools?lang=ur on an English quiz are Urdu pages (rtl, ui_lang ur)', async () => {
    const srv = await serve(QUIZ({ class_doors: true }));
    try {
      for (const v of ['class', 'schools']) {
        const r = await get(srv, `/q/AB12CD/${v}?lang=ur&k=abc`);
        expect(r.status).toBe(200);
        expect(r.html).toMatch(/<html[^>]*\slang="ur"[^>]*\sdir="rtl"/);
        expect(bootOf(r.html).ui_lang).toBe('ur');
      }
    } finally { srv.close(); }
  });
  test('on, but the quiz page itself, no lang, or a lang that is not en/ur: today\'s page', async () => {
    const srv = await serve(QUIZ({ class_doors: true }));
    try {
      for (const path of ['/q/AB12CD?lang=ur', '/q/AB12CD/class', '/q/AB12CD/class?lang=fr']) {
        const r = await get(srv, path);
        expect(r.html).toMatch(/<html[^>]*\slang="en"/);
        expect(bootOf(r.html)).not.toHaveProperty('ui_lang');
      }
    } finally { srv.close(); }
  });
  test('off (no class_doors on the answer): /class?lang=ur is today\'s page, byte for byte', async () => {
    const srv = await serve(QUIZ({}));
    try {
      const a = await get(srv, '/q/AB12CD/class?lang=ur');
      const b = await get(srv, '/q/AB12CD/class');
      expect(a.html).toBe(b.html);
      expect(a.html).toMatch(/<html[^>]*\slang="en"/);
    } finally { srv.close(); }
  });
});

// A table that mixes classes (the board's `only`, web_quiz_class_doors): "All" / "Only Class 3", the league's own
// chips; and Play from a table shown in the child's language opens the quiz's twin in it when there is one.
describe('the class table: "Only Class 3" on a mixed table, and Play opens the quiz in the child\'s language', () => {
  const MIXED = {
    rows: [{ place: 1, first: 'Amna Testwala', animal: 'owl', correct: 5, total: 5 }, { place: 2, first: 'Zara Testwala', animal: 'cat', correct: 3, total: 5 }, { place: 3, first: 'Bano Testwala', animal: 'fox', correct: 2, total: 5 }],
    you: { place: 2, correct: 3, total: 5 }, finishers_n: 3, class_avg_pct: 67, class_doors: true, my_class: '3', one_class: false,
    only: { rows: [{ place: 1, first: 'Zara Testwala', animal: 'cat', correct: 3, total: 5 }, { place: 2, first: 'Bano Testwala', animal: 'fox', correct: 2, total: 5 }], you: { place: 1, correct: 3, total: 5 }, finishers_n: 2, class_avg_pct: 50, more_n: 0 },
  };
  const open = async (lang, board, extra = {}) => {
    const p = page({ lang, store: store({ ...RESULT }), api: { 'board/': board }, ...extra });
    p.wq.board();
    await flush(); await flush();
    return p;
  };
  const places = (h) => (h.match(/<tr[^>]*><td>(\d+)<\/td>/g) || []).map((x) => Number(/<td>(\d+)/.exec(x)[1]));
  test('a mixed table: "All" (on) and "Only Class 3" chips in the league\'s chip row; EN and UR', async () => {
    const en = await open('en', MIXED);
    expect(en.html()).toContain('<div class="wq-chips wq-schips"><button class="wq-chip wq-on" id="wq-call">All</button><button class="wq-chip" id="wq-conly">Only Class <bdi>3</bdi></button></div>');
    expect(places(en.html())).toEqual([1, 2, 3]);
    const ur = await open('ur', MIXED);
    expect(ur.html()).toContain('id="wq-conly">صرف کلاس <bdi>۳</bdi></button>');
  });
  test('"Only Class 3": the child\'s class re-ranked, the child\'s own place and that class\'s average; "All" goes back', async () => {
    const p = await open('en', MIXED);
    p.els['#wq-conly'].fire('click');
    let h = p.html();
    expect(h).toContain('<button class="wq-chip wq-on" id="wq-conly">');
    expect(places(h)).toEqual([1, 2]);
    expect(h).toMatch(/<tr class="wq-you"><td>1<\/td>/);
    expect(h).not.toContain('Amna Testwala');
    expect(h).toContain('<span>50%</span>');
    p.els['#wq-call'].fire('click');
    h = p.html();
    expect(places(h)).toEqual([1, 2, 3]);
    expect(h).toContain('Amna Testwala');
  });
  test('one class, no `only`, or switch off: no chips (today\'s table)', async () => {
    for (const b of [{ ...MIXED, one_class: true, only: undefined }, { ...MIXED, only: undefined }, { ...BOARD, only: MIXED.only }]) {
      const p = await open('en', b);
      expect(p.html()).not.toContain('wq-conly');
    }
  });
  test('Play from a table in the other language: the twin\'s page with its key; no twin: the quiz page; same language: today\'s', async () => {
    const tw = { ...MINE_TW, twin: { code: 'UR12CD', k: 'kk9' } };
    let p = page({ lang: 'en', store: {}, view: 'class', search: '?lang=ur&k=abc123', bootExtra: { ui_lang: 'ur' }, api: { '/board/TEST': tw } });
    await flush(); await flush();
    p.els['#wq-play'].fire('click');
    expect(p.hist.assigned).toEqual(['/q/UR12CD?k=kk9']);
    p = page({ lang: 'en', store: {}, view: 'class', search: '?lang=ur&k=abc123', bootExtra: { ui_lang: 'ur' }, api: { '/board/TEST': { ...tw, twin: { code: 'bad/../x' } } } });
    await flush(); await flush();
    p.els['#wq-play'].fire('click');
    expect(p.hist.assigned).toEqual(['/q/TEST?k=abc123']);
    // a twin with no code is no twin: the quiz page, never "/q/null"
    p = page({ lang: 'en', store: {}, view: 'class', search: '?lang=ur&k=abc123', bootExtra: { ui_lang: 'ur' }, api: { '/board/TEST': { ...tw, twin: { code: null } } } });
    await flush(); await flush();
    p.els['#wq-play'].fire('click');
    expect(p.hist.assigned).toEqual(['/q/TEST?k=abc123']);
    p = page({ lang: 'en', store: {}, view: 'class', bootExtra: { ui_lang: 'en' }, api: { '/board/TEST': tw } });
    await flush(); await flush();
    p.els['#wq-play'].fire('click');
    expect(p.hist.assigned).toEqual([]);
  });
  test('the league\'s Play from the other language: the twin (no key on the league)', async () => {
    const p = page({ lang: 'en', store: {}, view: 'schools', search: '?lang=ur', bootExtra: { ui_lang: 'ur' }, api: { '/schools/TEST': { mine: { name: 'Model School Testwala', place: 1, points: 40, kids: 4, sector: 'ict' }, rows: [{ place: 1, name: 'Model School Testwala', points: 40, kids: 4, sector: 'ict', mine: true }], ranked_n: 1, class_doors: true, twin: { code: 'UR12CD' } } } });
    await flush(); await flush();
    p.els['#wq-play-s'].fire('click');
    expect(p.hist.assigned).toEqual(['/q/UR12CD']);
  });
});
const MINE_TW = { rows: [{ place: 1, first: 'Zara Testwala', animal: 'owl', correct: 3, total: 5 }], finishers_n: 1, class_avg_pct: 60, class_doors: true };

// The list-state contract on the class table and the league (web_quiz_class_doors on the quiz page's boot): a skeleton
// of rows while the answer is in flight, then data-fetch pending|done|failed, data-skel-from/-to and data-empty-at on
// the list's root. Never an empty note while pending; a failure always has a retry. Off: today's waiting Jugnu.
describe('the class table and the league: a skeleton while loading, and the list-state marks', () => {
  const later = () => { let go; const p = new Promise((r) => { go = r; }); return { fn: () => p, go }; };
  const attr = (h, sel, a) => { const m = new RegExp('<[^>]*' + sel + '[^>]*\\s' + a + '="([^"]*)"').exec(h); return m ? m[1] : null; };
  const LEAGUE = { mine: { name: 'Model School Testwala', place: 1, points: 40, kids: 4, sector: 'ict' }, rows: [{ place: 1, name: 'Model School Testwala', points: 40, kids: 4, sector: 'ict', mine: true }], ranked_n: 1, class_doors: true };
  test('class table, on: skeleton rows + pending (no empty note); then the table: done, skel-from <= skel-to', async () => {
    const w = later();
    const p = page({ lang: 'en', store: store({ ...RESULT }), bootExtra: { class_doors: true }, api: { 'board/': w.fn } });
    p.wq.board();
    await flush();
    let h = p.html();
    expect(h).toContain('data-list="table"');
    expect(attr(h, 'data-list="table"', 'data-fetch')).toBe('pending');
    expect((h.match(/class="wq-skrow"/g) || []).length).toBe(5);
    expect(h).not.toContain('data-empty-at');
    expect(h).not.toContain(p.wq.T.noRows);
    w.go({ ...BOARD, class_doors: true });
    await flush(); await flush();
    h = p.html();
    expect(attr(h, 'data-list="table"', 'data-fetch')).toBe('done');
    const from = Number(attr(h, 'data-list="table"', 'data-skel-from'));
    const to = Number(attr(h, 'data-list="table"', 'data-skel-to'));
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThanOrEqual(from);
    expect(h).not.toContain('wq-skrow');
    expect(h).not.toContain('data-empty-at');
  });
  test('class table, on: nobody yet -> the empty note carries data-empty-at; a failure -> failed + a retry', async () => {
    let p = page({ lang: 'en', store: store({ ...RESULT }), bootExtra: { class_doors: true }, api: { 'board/': { rows: [], finishers_n: 0, class_avg_pct: 0, class_doors: true } } });
    p.wq.board();
    await flush(); await flush();
    expect(attr(p.html(), 'data-list="table"', 'data-fetch')).toBe('done');
    expect(attr(p.html(), 'data-list="table"', 'data-empty-at')).toMatch(/^\d+$/);
    p = page({ lang: 'ur', store: store({ ...RESULT }), bootExtra: { class_doors: true }, api: { 'board/': { __status: 500 } } });
    p.wq.board();
    await flush(); await flush();
    expect(attr(p.html(), 'data-list="table"', 'data-fetch')).toBe('failed');
    expect(p.html()).toContain('id="wq-retry"');
  });
  test('the league, on: skeleton + pending, then done; a failure -> failed + a retry', async () => {
    const w = later();
    let p = page({ lang: 'en', store: {}, view: 'schools', bootExtra: { class_doors: true }, api: { '/schools/TEST': w.fn } });
    await flush();
    expect(attr(p.html(), 'data-list="schools"', 'data-fetch')).toBe('pending');
    expect(p.html()).toContain('wq-skrow');
    w.go(LEAGUE);
    await flush(); await flush();
    expect(attr(p.html(), 'data-list="schools"', 'data-fetch')).toBe('done');
    expect(Number(attr(p.html(), 'data-list="schools"', 'data-skel-to'))).toBeGreaterThanOrEqual(Number(attr(p.html(), 'data-list="schools"', 'data-skel-from')));
    p = page({ lang: 'en', store: {}, view: 'schools', bootExtra: { class_doors: true }, api: { '/schools/TEST': { __status: 503 } } });
    await flush(); await flush();
    expect(attr(p.html(), 'data-list="schools"', 'data-fetch')).toBe('failed');
    expect(p.html()).toContain('id="wq-retry"');
  });
  test('off (no class_doors on the boot): today\'s waiting Jugnu and no marks, start to end', async () => {
    const w = later();
    const p = page({ lang: 'en', store: store({ ...RESULT }), api: { 'board/': w.fn } });
    p.wq.board();
    await flush();
    expect(p.html()).toContain('<div class="wq-boot"><img src="');
    expect(p.html()).not.toContain('data-fetch');
    w.go(BOARD);
    await flush(); await flush();
    expect(p.html()).not.toMatch(/data-(fetch|list|skel|empty)/);
  });
});
