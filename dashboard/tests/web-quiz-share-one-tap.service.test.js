/**
 * The quiz card's "Share to class group" with the one share on (app_settings web_quiz_share_v4, the finish's
 * `share_v4`; default OFF): one tap is ONE share. With the one share's card (the mint says v4) it is the sheet
 * (web-quiz-share-v4-page.service.test.js); without it (here: the mint answers no v4) it is the page's own — the picture
 * as a file (or the phone's share sheet, or the send screen with the picture and "Save picture") and the class link
 * that carries the picture (?a=).
 * Switch off (absent, false, or the string "true"): today's tap, the finish card's share, byte for byte.
 */
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, flush } = require('./wq-page-harness');

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
const TOK = 'Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
const CARD = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const CHILD = { first: 'Noor Testwala', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Noor Testwala', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 }, art: { card: CARD }, card_v3: true };
const RET = { text: 'Play with Jugnu any day. Tap, then send:', words: 'quiz please', href: 'https://wa.me/15550001111?text=quiz%20please' };
const MINT = { '/api/wq/card': { token: TOK, url: `/q/TEST?k=${TOK}`, img: `/wq/card/${TOK}.png`, ret: RET } };
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true } });

// The quiz card (the full card, or the folded one with the home on), the finish card's script loaded as the edge does.
async function tapped(lang, extra, { phoneShares = true } = {}) {
  const shares = [];
  const nav = phoneShares ? { share: (d) => { shares.push(d); return Promise.resolve(); } } : {};
  const p = page({ lang, store: store({ ...RESULT, ...extra }), api: MINT, nav });
  vm.runInContext(FC_SRC, p.ctx);
  // the harness keeps one element per selector across renders; a real render draws a new button with no listeners
  Object.values(p.els).forEach((el) => { el.listeners = {}; });
  p.wq.card();
  await flush(); await flush();
  p.els['#wq-share'].fire('click');
  await flush(); await flush();
  return { p, shares, sendScreen: p.moment() === 'M12-fallback' };
}

describe('switch on: one tap, one share — the page\'s own, with the picture and the class link', () => {
  for (const lang of ['en', 'ur']) {
    for (const [name, fold] of [['the card', {}], ['the folded card', { card_fold: true }]]) {
      test(`${lang}, ${name}: a phone that can share: exactly one share, the class link with the picture`, async () => {
        const { shares, sendScreen } = await tapped(lang, { share_v4: true, ...fold });
        expect(shares.length).toBe(1);
        expect(sendScreen).toBe(false);
        expect(shares[0].url).toBe(`https://example.test/q/TEST?a=${encodeURIComponent(CARD)}`);
      });
      test(`${lang}, ${name}: WhatsApp's own browser (no share): the send screen WITH the picture and "Save picture"`, async () => {
        const { p } = await tapped(lang, { share_v4: true, ...fold }, { phoneShares: false });
        const h = p.html();
        expect(p.moment()).toBe('M12-fallback');
        expect(h).toContain('class="wq-artprev"');
        expect(h).toContain('id="wq-save"');
        expect(h).toContain(encodeURIComponent(`https://example.test/q/TEST?a=${encodeURIComponent(CARD)}`));
      });
    }
  }
});

describe('switch off: today\'s tap (the finish card\'s share runs, the page\'s does not)', () => {
  for (const off of [{}, { share_v4: false }, { share_v4: 'true' }, { share_v4: 1 }]) {
    test(`share_v4 ${JSON.stringify(off.share_v4)}: the finish card's share only (its card link), never the page's class link`, async () => {
      const { p, shares } = await tapped('en', { ...off, card_fold: true });
      expect(shares.filter((s) => /\?a=/.test(String(s.url || '')))).toEqual([]);
      expect(p.moment()).toBe('M12-fallback');
      expect(p.html()).toContain(encodeURIComponent(`/q/TEST?k=${TOK}`));
    });
  }
});
