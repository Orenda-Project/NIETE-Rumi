/**
 * The corrected Urdu share words (app_settings web_quiz_ur_share_copy → the bot's `ur_share: true` beside the card's
 * field; default OFF). On, an Urdu page says:
 *   - the no-class Share button «دوستوں کو بھیجیں» (the quiz finish and the end card), never «شیئر کریں»;
 *   - the score share line ends «اب آپ کھیلیں اور اس سے زیادہ ستارے لیں!», in Urdu digits with the name isolated;
 *   - the class table line and its link preview speak to the reader and invite: «آپ نے ابھی تک نہیں کھیلا؟ … آئیں کھیلیں»
 *     («آپ نے» keeps it the same for any child; «ابھی بھی» = still open), card on or off;
 *   - the challenge ask «محلے میں کوئی دوست» (no gender), and both challenge lines end «لنک دبائیں:».
 * Off (the key absent or anything but true), and on any English page: today's words, byte for byte (pinned below as
 * hashes recorded on the base). The polished Urdu copy (wq-ur2) keeps its own challenge lines on top.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./wq-page-harness');
const { renderPreviewPage } = require('../routes/web-quiz.routes');

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

const CHILD = { first: 'Noor Testwala', chip: 'c1', animal: 'owl' };
const RESULT = {
  card: { first: 'Noor Testwala', animal: 'owl', correct: 3, total: 5, stars: 3, nth: 6 },
  challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 }, art: { card: 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl' },
  hub_door: true, jugnu_card: true,
};
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true } });
const ON = { ur_share: true };
// The six Urdu share strings as the page draws them, one call each.
const words = (T) => [T.sharePlain, T.shareLine('نور ٹیسٹوالا', 3, 5, 'پودے'), T.tableLine('پودے', 'جماعت ۳'), T.whoStreet,
  T.chalLine('نور ٹیسٹوالا', 3, 5, 'پودے'), T.chalPlayed('نور ٹیسٹوالا', 'پودے')];
const finishCard = (lang, bootExtra, htmlClass) => {
  const p = page({ lang, bootExtra, htmlClass, store: store({ ...RESULT, card_v3: true, card_fold: true, no_class: true }) });
  vm.runInContext(FC_SRC, p.ctx);
  p.wq.card();
  return p;
};

const T_ON = () => page({ lang: 'ur', bootExtra: ON }).wq.T;

describe('on: the Urdu page says the corrected words', () => {
  test('the six strings', () => {
    const w = words(page({ lang: 'ur', bootExtra: ON }).wq.T);
    expect(w[0]).toBe('دوستوں کو بھیجیں');
    // Urdu digits like the card's ۳/۵, the name and topic isolated (a Latin name does not jump the line), like the challenge lines
    expect(w[1]).toBe('\u2068نور ٹیسٹوالا\u2069 نے \u2068پودے\u2069 میں ۵ میں سے ۳ ستارے لیے۔ اب آپ کھیلیں اور اس سے زیادہ ستارے لیں!');
    expect(T_ON().shareLine('Noor Testwala', 3, 5, 'Plants')).toMatch(/^\u2068Noor Testwala\u2069 نے \u2068Plants\u2069 میں ۵ میں سے ۳ /);
    expect(w[2]).toBe('پودے: جماعت ۳ کی لیگ ٹیبل۔ آپ نے ابھی تک نہیں کھیلا؟ یہی لنک ابھی بھی کھلا ہے، آئیں کھیلیں:');
    expect(w[3]).toBe('محلے میں کوئی دوست');
    expect(w[4]).toMatch(/مجھ سے آگے نکل کر دکھائیں! 🏆 کھیلنے کے لیے لنک دبائیں:$/);
    expect(w[5]).toMatch(/اب آپ کی باری! کھیلنے کے لیے لنک دبائیں:$/);
    // «نہیں کھیلا» only after «آپ نے» (neutral); never bare, aimed at the child
    for (const s of w) expect(s.replace(/آپ نے ابھی تک نہیں کھیلا/g, '')).not.toMatch(/شیئر|ٹیپ|نہیں کھیلا|کا دوست|ملیں گے/);
  });
  test('the no-class Share on the quiz finish card', () => {
    const h = finishCard('ur', ON).html();
    expect(h).toContain('<button class="wq-btn wq-soft" id="wq-share">دوستوں کو بھیجیں</button>');
    expect(h).not.toContain('شیئر کریں');
  });
  test('the end card\'s no-class Share (WQFC, the host passes urs)', () => {
    const W = { document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem() {} }, location: { origin: 'https://portal.example' }, navigator: {} };
    W.window = W;
    vm.createContext(W);
    vm.runInContext(FC_SRC, W);
    const label = (o) => /id="wqfc-share"[^>]*>([^<]*)<\/a>/.exec(W.WQFC.html({ kind: 'game', deed: 'game_done', lang: 'ur', plain: true, ...o }))[1];
    expect(label({ urs: true })).toBe('دوستوں کو بھیجیں');
    expect(label({})).toBe('شیئر کریں');
    expect(label({ urs: 'true' })).toBe('شیئر کریں');
    // English never changes
    expect(/id="wqfc-share"[^>]*>([^<]*)<\/a>/.exec(W.WQFC.html({ kind: 'game', deed: 'game_done', lang: 'en', plain: true, urs: true }))[1]).toBe('Share');
  });
  test('the class table\'s link preview, card off and card on: «آپ نے ابھی تک نہیں کھیلا؟»', () => {
    const facts = { quiz: { lang: 'ur', topic: 'پودے', n: 5 }, cls: { label: 'جماعت ۳' }, art: {}, ur_share: true };
    const h = renderPreviewPage({ facts, code: 'TEST', view: 'class', origin: 'https://portal.example', assetV: 'v1', url: 'https://portal.example/q/TEST/class' });
    expect(h).toContain('<meta property="og:description" content="آپ نے ابھی تک نہیں کھیلا؟ یہ لنک ابھی بھی کھلا ہے، آئیں کھیلیں!">');
    expect(h).not.toContain('ابھی نہیں کھیلا');
    const on = renderPreviewPage({ facts: { ...facts, card_v3: true }, code: 'TEST', view: 'class', origin: 'https://portal.example', assetV: 'v1', url: 'https://portal.example/q/TEST/class' });
    expect(on).toContain('<meta property="og:description" content="آپ نے ابھی تک نہیں کھیلا؟ یہ لنک ابھی بھی کھلا ہے، آئیں کھیلیں!">');
    expect(on).not.toContain('کھیلنا باقی ہے');
  });
  test('the polished Urdu copy (wq-ur2) keeps its own challenge lines on top', () => {
    const both = page({ lang: 'ur', bootExtra: { ...ON, ui: { ur2: true } } }).wq.T;
    const ur2 = page({ lang: 'ur', bootExtra: { ui: { ur2: true } } }).wq.T;
    expect(both.chalLine('نور ٹیسٹوالا', 3, 5, 'پودے')).toBe(ur2.chalLine('نور ٹیسٹوالا', 3, 5, 'پودے'));
    expect(both.chalPlayed('نور ٹیسٹوالا', 'پودے')).toBe(ur2.chalPlayed('نور ٹیسٹوالا', 'پودے'));
    expect(both.sharePlain).toBe('دوستوں کو بھیجیں');
  });
});

describe('GOLDEN: off, or English — today\'s words byte for byte (hashes recorded on the base 9bf205b80)', () => {
  const BASE = {
    ur: '1ffc41502b6bd510', en: 'c8f71941c4489c5f', urCard: '7172a902e56fbd8c', enCard: 'a5a0572440ffacd5', preview: '3e5d42cbc3bb1091',
  };
  test.each([[{}], [{ ur_share: false }], [{ ur_share: 'true' }], [{ ur_share: 1 }]])('Urdu, boot %j', (extra) => {
    expect(sha(JSON.stringify(words(page({ lang: 'ur', bootExtra: extra }).wq.T)))).toBe(BASE.ur);
    expect(sha(finishCard('ur', extra).html())).toBe(BASE.urCard);
  });
  test('English, on or off', () => {
    for (const extra of [{}, ON]) {
      expect(sha(JSON.stringify(words(page({ lang: 'en', bootExtra: extra }).wq.T)))).toBe(BASE.en);
      expect(sha(finishCard('en', extra).html())).toBe(BASE.enCard);
    }
  });
  test('the class preview, off; and with the card on alone (its own Urdu words, as today)', () => {
    const facts = { quiz: { lang: 'ur', topic: 'پودے', n: 5 }, cls: { label: 'جماعت ۳' }, art: {} };
    const at = (f) => renderPreviewPage({ facts: f, code: 'TEST', view: 'class', origin: 'https://portal.example', assetV: 'v1', url: 'https://portal.example/q/TEST/class' });
    expect(sha(at(facts))).toBe(BASE.preview);
    expect(at({ ...facts, card_v3: true })).toContain('<meta property="og:description" content="کھیلنا باقی ہے؟ وہی لنک ابھی کھلا ہے۔">');
    expect(at({ ...facts, card_v3: true, ur_share: 'true' })).toBe(at({ ...facts, card_v3: true }));
  });
});
