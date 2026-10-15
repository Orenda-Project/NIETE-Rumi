/**
 * The Jugnu card on the scorecard (wq-card.js, app_settings web_quiz_challenge_card): when finish says so
 * (result.jugnu_card) a class child's card offers Jugnu's challenge first under the score; a tap asks "<name>'s turn"
 * on one screen (never straight into a run), Play asks the server for this child's challenge link
 * (POST hubdoor {st, jugnu:1}) and opens it; "Not my turn? Go back" returns to the card. The door events
 * (door_shown / door_tap {door:'card', surface:'scorecard', slot:1}) ride the page's own event batch when finish
 * says the events are on (result.jugnu_ev). Runs the whole shipped page in the harness's vm.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, flush } = require('./wq-page-harness');

const CARD_JS = path.join(__dirname, '..', 'public', 'wq', 'wq-card.js');
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, hub_door: true };
const JC = { ...RESULT, jugnu_card: true, jugnu_ev: true };
const store = (result, extra = {}) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true, ...extra } });
const HREF = '/c/tok.abc?kid=k1&via=quiz_card';

// The page as a phone sees it once wq-card.js has arrived (wq.js asks for it when finish offers the card).
function withCard(opts, before) {
  const p = page(opts);
  if (before) before(p.ctx);
  vm.runInContext(fs.readFileSync(CARD_JS, 'utf8'), p.ctx);
  p.wq.card();
  return p;
}
const evs = (p) => { p.fireWin('pagehide'); return p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events); };
const doors = (p, n) => evs(p).filter((e) => e.n === n);

describe('the card: first under the score, above the shares', () => {
  test('EN: the challenge tile with the hub\'s own words', () => {
    const h = withCard({ lang: 'en', store: store(JC) }).html();
    expect(h).toContain('id="wq-jc-go"');
    expect(h).toContain('Jugnu&#39;s Challenge');
    expect(h).toContain('Short games for reading and numbers');
    expect(h.indexOf('wq-scorecard')).toBeLessThan(h.indexOf('id="wq-jc-go"'));
    expect(h.indexOf('id="wq-jc-go"')).toBeLessThan(h.indexOf('id="wq-share"'));
  });
  test('UR: in Urdu', () => {
    const h = withCard({ lang: 'ur', store: store(JC) }).html();
    expect(h).toContain('جگنو کا چیلنج');
    expect(h).toContain('پڑھنے اور گنتی کے چھوٹے کھیل');
  });
  test('not on a friend\'s challenge run, nor when finish did not offer it', () => {
    expect(withCard({ lang: 'en', store: store(JC), challenge: { code: 'CHAL12', first: 'Omar' } }).html()).not.toContain('wq-jc');
    expect(withCard({ lang: 'en', store: store(RESULT) }).html()).not.toContain('wq-jc');
  });
});

describe('the D1 rule: the card and its door_shown ship together', () => {
  test('door_shown {door:card, surface:scorecard, slot:1} once per page view, even after Back re-renders the card', () => {
    const p = withCard({ lang: 'en', store: store(JC) });
    p.wq.card();
    p.wq.card();
    const shown = doors(p, 'door_shown');
    expect(shown.length).toBe(1);
    expect(shown[0]).toMatchObject({ door: 'card', surface: 'scorecard', slot: 1 });
  });
  test('with an IntersectionObserver: only once the card is half in view', () => {
    let cb = null;
    const p = withCard({ lang: 'en', store: store(JC) }, (ctx) => {
      ctx.IntersectionObserver = function IO(fn) { cb = fn; this.observe = () => {}; this.disconnect = () => {}; };
    });
    expect(doors(p, 'door_shown').length).toBe(0);
    cb([{ isIntersecting: true, intersectionRatio: 0.3 }]);
    cb([{ isIntersecting: true, intersectionRatio: 0.6 }]);
    cb([{ isIntersecting: true, intersectionRatio: 0.9 }]);
    expect(doors(p, 'door_shown').length).toBe(1);
  });
  test('events off (jugnu_ev absent): the card, no door events', () => {
    const p = withCard({ lang: 'en', store: store({ ...JC, jugnu_ev: undefined }) });
    p.els['#wq-jc-go'].fire('click');
    expect(doors(p, 'door_shown').length + doors(p, 'door_tap').length).toBe(0);
  });
});

describe('the identity step: a tap asks whose turn it is, never straight into a run', () => {
  test('tap: door_tap once (debounced), the confirm screen names the child; Play asks the server and follows the link', async () => {
    const p = withCard({ lang: 'en', store: store(JC), api: { hubdoor: { href: HREF, animal: 'owl' } } });
    p.els['#wq-jc-go'].fire('click');
    p.els['#wq-jc-go'].fire('click');
    const h = p.html();
    expect(h).toContain('Zara&#39;s turn');
    expect(h).toContain('id="wq-jc-play"');
    expect(h).toContain('Not my turn? Go back');
    expect(p.fetches.some((f) => f.url.indexOf('hubdoor') >= 0)).toBe(false);
    p.els['#wq-jc-play'].fire('click');
    await flush(); await flush();
    const call = p.fetches.find((f) => f.url.indexOf('hubdoor') >= 0);
    expect(JSON.parse(call.init.body)).toEqual({ st: 's1', jugnu: 1 });
    expect(p.hist.assigned).toEqual([HREF + '&lang=en']);
    const taps = doors(p, 'door_tap');
    expect(taps.length).toBe(1);
    expect(taps[0]).toMatchObject({ door: 'card', surface: 'scorecard', slot: 1 });
  });
  test('UR: the confirm screen in Urdu', () => {
    const p = withCard({ lang: 'ur', store: store(JC) });
    p.els['#wq-jc-go'].fire('click');
    expect(p.html()).toContain('کی باری');
    expect(p.html()).toContain('میری باری نہیں؟ واپس جائیں');
  });
  test('"Not my turn? Go back": back to the card, nothing asked of the server', () => {
    const p = withCard({ lang: 'en', store: store(JC) });
    p.els['#wq-jc-go'].fire('click');
    p.els['#wq-jc-back'].fire('click');
    expect(p.html()).toContain('id="wq-jc-go"');
    expect(p.html()).toContain('id="wq-share"');
    expect(p.fetches.some((f) => f.url.indexOf('hubdoor') >= 0)).toBe(false);
  });
  test('never a link that is not a challenge page; the server says no: a toast, no navigation', async () => {
    const p = withCard({ lang: 'en', store: store(JC), api: { hubdoor: { href: 'https://evil.example/c/x' } } });
    p.els['#wq-jc-go'].fire('click');
    p.els['#wq-jc-play'].fire('click');
    await flush(); await flush();
    expect(p.hist.assigned).toEqual([]);
    const q = withCard({ lang: 'en', store: store(JC), api: { hubdoor: { __status: 404, error: 'no_door' } } });
    q.els['#wq-jc-go'].fire('click');
    q.els['#wq-jc-play'].fire('click');
    await flush(); await flush();
    expect(q.hist.assigned).toEqual([]);
    expect(q.toasts().length).toBe(1);
  });
});

// Golden (SPEC §5.1-5.2): with the card switch off finish sends no jugnu_card, and the scorecard is the base's, string
// for string (written from origin/sandbox with JC_GOLDEN_WRITE=1, EN and UR, with and without the hub door).
describe('golden: the card switch off', () => {
  const FIX = path.join(__dirname, 'fixtures', 'jugnu-card-off-scorecard.json');
  test('the scorecard HTML is string-equal to the base\'s', () => {
    const out = {};
    for (const lang of ['en', 'ur']) {
      out[lang + '_door'] = page({ lang, store: store(RESULT) }).html();
      out[lang + '_plain'] = page({ lang, store: store({ ...RESULT, hub_door: undefined }) }).html();
    }
    if (process.env.JC_GOLDEN_WRITE === '1') { fs.mkdirSync(path.dirname(FIX), { recursive: true }); fs.writeFileSync(FIX, JSON.stringify(out, null, 1)); }
    expect(out).toEqual(JSON.parse(fs.readFileSync(FIX, 'utf8')));
  });
});
