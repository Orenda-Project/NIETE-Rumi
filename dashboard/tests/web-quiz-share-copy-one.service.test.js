/**
 * One star (app_settings web_quiz_share_copy_one → the bot's `copy_one: true` beside the card's field; default OFF).
 * On, an Urdu share that says «ستارے لیے» says «۱ ستارہ لیا» when the score is 1: the card's share line, the challenge
 * line a child sends, and the challenge line on the friend's page (in each of the Urdu tables: today's, the corrected
 * share words, the polish). The one forms are the tables' `_one` lines (data), picked where the line is drawn when the
 * score is 1. 0 and 2 or more keep today's words; English "1/6 stars" is a fraction and never changes.
 * SC-1: on the one share's sheet in Urdu (the mint's `one`), the quiz title's own line is RTL with the title in <bdi>,
 * so an English title sits right under the Urdu line, not at the left.
 * Off (absent or anything but true): today's words and sheet, byte for byte. Runs the whole shipped page in the harness.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./wq-page-harness');

const CHILD = { first: 'Sana', chip: 'c1', animal: 'owl' };
const result = (correct, total) => ({ card: { first: 'Sana', animal: 'owl', correct, total, stars: correct }, challenge_code: 'CHAL12', score: { correct, total, pct: Math.round((100 * correct) / total) } });
const store = (r) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: r } });
const waHref = (p) => {
  const m = /id="wq-wa" href="([^"]+)"/.exec(p.html());
  return m ? decodeURIComponent(m[1].replace(/&amp;/g, '&')) : null;
};
// the card's two shares (the class group, the friend's challenge), as WhatsApp would get them
function shares({ lang = 'ur', c = 1, n = 6, extra = {}, htmlClass = [] } = {}) {
  const out = [];
  for (const id of ['#wq-share', '#wq-chal']) {
    const p = page({ lang, topic: 'Proper Fraction', store: store(result(c, n)), bootExtra: extra, htmlClass });
    p.tap();
    p.els[id].fire('click');
    out.push(waHref(p));
  }
  return out;
}
// a tile's own challenge words (the invite ask's panel; a score under 60% asks to play, so 1 of 1 is the one-star case)
function tile({ lang = 'ur', c = 1, n = 1, extra = {}, htmlClass = [] } = {}) {
  const p = page({ lang, topic: 'Proper Fraction', store: store(result(c, n)), bootExtra: { invite_ask: 'on', ...extra }, htmlClass });
  p.tap();
  p.els['#wq-who-street'].fire('click');
  return waHref(p);
}
const landing = ({ lang = 'ur', c = 1, extra = {}, htmlClass = [] } = {}) => page({ lang, challenge: { first: 'Sana', correct: c, total: 6 }, bootExtra: extra, htmlClass }).html();
const ON = { copy_one: true };
// today's table has Western digits, the corrected and polished ones Urdu digits (some isolated): the words are the test
const ONE_STAR = /[6۶]⁩? میں سے ⁦?[1۱]⁩? ستارہ لیا۔/;
const ONE_TODAY = /[6۶]⁩? میں سے ⁦?[1۱]⁩? ستارے لیے۔/;
const TABLES = [['today\'s', {}, []], ['the corrected share words', { ur_share: true }, []], ['the polish', { ur_share: true }, ['wq-ur2']]];

describe.each(TABLES)('on, Urdu, %s table', (_n, extra, htmlClass) => {
  const on = { ...extra, ...ON };
  test('the card\'s share and the challenge: «۶ میں سے ۱ ستارہ لیا», never «۱ ستارے لیے»', () => {
    for (const s of shares({ extra: on, htmlClass })) {
      expect(s).toMatch(ONE_STAR);
      expect(s).not.toContain('ستارے لیے');
    }
  });
  test('a tile\'s challenge words, 1 of 1: «۱ ستارہ لیا»', () => {
    const s = tile({ extra: on, htmlClass });
    expect(s).toMatch(/میں سے ⁦?[1۱]⁩? ستارہ لیا۔/);
    expect(s).not.toContain('ستارے لیے');
  });
  test('the friend\'s page: «Sana نے ۶ میں سے ۱ ستارہ لیا۔»', () => {
    const h = landing({ extra: on, htmlClass });
    expect(h).toMatch(ONE_STAR);
    expect(h).not.toContain('ستارے لیے');
  });
  test('2 or more keep today\'s words', () => {
    expect(shares({ c: 2, extra: on, htmlClass })).toEqual(shares({ c: 2, extra, htmlClass }));
    expect(tile({ c: 2, n: 2, extra: on, htmlClass })).toBe(tile({ c: 2, n: 2, extra, htmlClass }));
    expect(landing({ c: 2, extra: on, htmlClass })).toBe(landing({ c: 2, extra, htmlClass }));
  });
});

describe('off, or English: today\'s words byte for byte', () => {
  test.each([[{}], [{ copy_one: false }], [{ copy_one: 'true' }], [{ copy_one: 1 }]])('Urdu, boot %j', (extra) => {
    for (const [, t, htmlClass] of TABLES) {
      expect(shares({ extra: { ...t, ...extra }, htmlClass })).toEqual(shares({ extra: t, htmlClass }));
      expect(tile({ extra: { ...t, ...extra }, htmlClass })).toBe(tile({ extra: t, htmlClass }));
      expect(landing({ extra: { ...t, ...extra }, htmlClass })).toBe(landing({ extra: t, htmlClass }));
    }
    expect(shares({ extra })[0]).toMatch(ONE_TODAY);
  });
  test('English, on: "1/6 stars" (a fraction) stays', () => {
    expect(shares({ lang: 'en', extra: ON })).toEqual(shares({ lang: 'en' }));
    expect(tile({ lang: 'en', extra: ON })).toBe(tile({ lang: 'en' }));
    expect(landing({ lang: 'en', extra: ON })).toBe(landing({ lang: 'en' }));
  });
});

// ─── SC-1, the sheet ─────────────────────────────────────────────────────────

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
function fc() {
  const ctx = { window: {}, document: {}, location: { origin: 'https://portal.example' }, navigator: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FC_SRC, ctx);
  return ctx.WQFC;
}
const IMG = '/wq/card/Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg.png';
const URL_ = 'https://portal.example/k/Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';

describe('SC-1: the quiz title line on the Urdu sheet', () => {
  const FC = fc();
  const text = (lang, title) => FC.shareText({ lang, deed: 'quiz_done', title, url: URL_, v4: true });
  test('on: an English title on an Urdu sheet is an RTL line, the title in its own <bdi>, at a Latin size', () => {
    const h = FC.sheetHtml({ lang: 'ur', img: IMG, text: text('ur', 'Proper Fraction'), url: URL_, iso: true, one: true });
    expect(h).toContain('<p class="wqfc-sh-ttl wqfc-sh-lat" dir="rtl">«<bdi dir="ltr">Proper Fraction</bdi>»</p>');
    expect(FC.SHEET_CSS).toMatch(/\.wqfc-sh-msg p\.wqfc-sh-ttl\.wqfc-sh-lat\{[^}]*line-height:1\.3/);
  });
  test('on: an Urdu title, and the English sheet, are today\'s', () => {
    const ur = { lang: 'ur', img: IMG, text: text('ur', 'پودے'), url: URL_, iso: true };
    expect(FC.sheetHtml({ ...ur, one: true })).toBe(FC.sheetHtml(ur));
    const en = { lang: 'en', img: IMG, text: text('en', 'Proper Fraction'), url: URL_, iso: true };
    expect(FC.sheetHtml({ ...en, one: true })).toBe(FC.sheetHtml(en));
  });
  test.each([[undefined], [false], ['true'], [1]])('off (one %j): today\'s sheet', (one) => {
    const o = { lang: 'ur', img: IMG, text: text('ur', 'Proper Fraction'), url: URL_, iso: true };
    expect(FC.sheetHtml({ ...o, one })).toBe(FC.sheetHtml(o));
    expect(FC.sheetHtml(o)).toContain('<p class="wqfc-sh-ttl" dir="ltr">«<bdi>Proper Fraction</bdi>»</p>');
  });
});
