/**
 * The quiz card's Share with the one share on (the finish's `share_v4`) and a SLOW card. The phone lets a page open
 * its share sheet (navigator.share) only for a few seconds after the tap. So when the card comes too late, or not at
 * all, the page never calls navigator.share from a timer (it would be refused, and the child would tap twice). It
 * draws its own send screen at once instead: the picture, "Send on WhatsApp" (a link: the next tap is a real tap)
 * and "Save picture". A card that answers in time shares as before.
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
const RESULT = { card: { first: 'Noor Testwala', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 }, art: { card: CARD }, card_v3: true, share_v4: true };
const RET = { text: 'Play with Jugnu any day. Tap, then send:', words: 'quiz please', href: 'https://wa.me/15550001111?text=quiz%20please' };
// a card without the one share's mark (no v4): the page's own share runs
const NO_V4 = { token: TOK, url: `/q/TEST?k=${TOK}`, img: `/wq/card/${TOK}.png`, ret: RET };
const store = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT, vdone: true } });

async function slowCard(lang) {
  let release;
  const shares = [];
  const nav = { share: (d) => { shares.push(d); return Promise.resolve(); } };
  const p = page({ lang, store: store(), api: { '/api/wq/card': () => new Promise((r) => { release = r; }) }, nav });
  vm.runInContext(FC_SRC, p.ctx);
  Object.values(p.els).forEach((el) => { el.listeners = {}; });
  p.wq.card();
  await flush(); await flush();
  p.els['#wq-share'].fire('click');
  await flush();
  return { p, shares, release: async (v) => { release(v); await flush(); await flush(); await flush(); } };
}
const sendScreen = (p) => {
  const h = p.html();
  return p.moment() === 'M12-fallback' && h.includes('class="wq-artprev"') && h.includes('id="wq-save"') && h.includes('id="wq-wa"');
};

describe.each(['en', 'ur'])('%s: a slow card never makes the child tap twice', (lang) => {
  test('no card at all (the wait gives up): the send screen at once, navigator.share never called', async () => {
    const { p, shares } = await slowCard(lang);
    p.runTimers(4000);
    p.runTimers(12000);
    await flush(); await flush();
    expect(shares).toHaveLength(0);
    expect(sendScreen(p)).toBe(true);
    expect(p.html()).toContain(encodeURIComponent(`https://example.test/q/TEST?a=${encodeURIComponent(CARD)}`));
  });
  test('the card comes after the tap\'s few seconds: the send screen, navigator.share never called', async () => {
    const { p, shares, release } = await slowCard(lang);
    p.runTimers(4000);
    await release(NO_V4);
    expect(shares).toHaveLength(0);
    expect(sendScreen(p)).toBe(true);
  });
  test('the card comes in time: the page shares as before, one share with the picture\'s link', async () => {
    const { p, shares, release } = await slowCard(lang);
    await release(NO_V4);
    expect(shares).toHaveLength(1);
    expect(shares[0].url).toBe(`https://example.test/q/TEST?a=${encodeURIComponent(CARD)}`);
    expect(p.moment()).not.toBe('M12-fallback');
  });
});
