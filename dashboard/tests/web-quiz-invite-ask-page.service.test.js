/**
 * The challenge asked as "Who can beat your 7/9?" (app_settings web_quiz_invite_ask, the boot's invite_ask):
 * a panel right under "Share to class group" with three "who" tiles, the challenge's own first-person words
 * (first name only), a play-at-home ask below 60%, and the arm on the card and share events. Switch off, or
 * a friend's own card: today's "Challenge a friend" button. Runs the whole shipped page in the harness's vm.
 */
const { page } = require('./wq-page-harness');

jest.mock('../../bot/shared/config/supabase', () => ({}));
const { cleanEvent } = require('../../bot/shared/services/quiz/web-quiz.service');

const CHILD = { first: 'Zara', name: 'Zara Khan', chip: 'c1', animal: 'owl' };
const result = (correct, total, extra = {}) => ({
  card: { first: 'Zara', animal: 'owl', correct, total, stars: correct }, challenge_code: 'CHAL12',
  score: { correct, total, pct: Math.round((100 * correct) / total) }, hub_door: true, ...extra,
});
const store = (r = result(7, 9), dev) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: r }, ...(dev ? { wq_d: dev } : {}) });
const open = (o = {}) => { const p = page({ lang: 'en', topic: 'Plants', store: store(o.r, o.dev), ...o, bootExtra: o.mode ? { invite_ask: o.mode } : {} }); p.tap(); return p; };
function sent(p) {
  p.fireWin('pagehide');
  return p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
}
const waHref = (p) => {
  const m = /id="wq-wa" href="([^"]+)"/.exec(p.html());
  return m ? decodeURIComponent(m[1].replace(/&amp;/g, '&')) : null;
};

describe('switch off (today)', () => {
  test('the card keeps "Challenge a friend" and shows no panel; card_view carries no arm', () => {
    const p = open();
    expect(p.moment()).toBe('M10');
    expect(p.html()).toContain('id="wq-chal"');
    expect(p.html()).not.toContain('wq-ask');
    expect(sent(p).find((e) => e.n === 'card_view').v).toBeUndefined();
  });
});

describe('switch on', () => {
  test('the panel sits right under "Share to class group", before the hub door, and replaces the old button', () => {
    const h = open({ mode: 'on' }).html();
    const share = h.indexOf('id="wq-share"'), ask = h.indexOf('class="wq-ask"'), door = h.indexOf('id="wq-hubdoor"');
    expect(share).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(share);
    expect(door).toBeGreaterThan(ask);
    expect(h).not.toContain('id="wq-chal"');
    expect(h).toContain('Who can beat your <bdi dir="ltr">7/9</bdi>?');
    ['wq-who-home', 'wq-who-cousin', 'wq-who-street'].forEach((id) => expect(h).toContain(`id="${id}"`));
    expect(h).toContain('Someone at home');
    expect(h).toContain('A cousin');
    expect(h).toContain('A friend in my street');
  });

  test('a tile shares the challenge link in its own first-person words: first name only, no tile label', () => {
    const p = open({ mode: 'on' });
    p.els['#wq-who-street'].fire('click');
    const text = waHref(p);
    expect(text).toContain('Zara here! I got 7/9 stars on Plants. Can you beat me?');
    expect(text).toContain('https://example.test/q/CHAL12');
    expect(text).not.toContain('Khan');
    expect(text).not.toMatch(/street|cousin|home/i);
  });

  test('the tile and the arm go on the tap; the arm on card_view and every share event', () => {
    const p = open({ mode: 'on' });
    p.els['#wq-who-cousin'].fire('click');
    p.els['#wq-back'].fire('click');
    const ev = sent(p);
    expect(ev.find((e) => e.n === 'card_view')).toMatchObject({ v: 'a1', band: 'mid' });
    const taps = ev.filter((e) => e.n === 'share_click');
    expect(taps[0]).toMatchObject({ src: 'challenge', step: 'tap', who: 'cousin', v: 'a1' });
    expect(taps.every((e) => e.v === 'a1')).toBe(true);
    expect(taps.filter((e) => e.who).length).toBe(1);
    expect(cleanEvent(taps[0]).props).toMatchObject({ who: 'cousin', v: 'a1' });
  });

  test('below 60%: play with someone at home, no score to beat, the "played" words', () => {
    const p = open({ mode: 'on', r: result(2, 9) });
    const h = p.html();
    expect(h).toContain('Play it with someone at home');
    expect(h).not.toContain('Who can beat');
    p.els['#wq-who-home'].fire('click');
    const text = waHref(p);
    expect(text).toContain('Zara here! I played Plants. Your turn!');
    expect(text).not.toContain('2/9');
  });

  test('a friend\'s own card keeps today\'s button (the panel is for a class child\'s card)', () => {
    const p = open({ mode: 'on', challenge: { first: 'Ali', correct: 3, total: 5 } });
    expect(p.html()).not.toContain('wq-ask');
    expect(p.html()).toContain('id="wq-chal"');
  });

  test('Urdu: the heading asks whom to challenge, the score an isolated LTR run; the message is first person, first name only', () => {
    const p = open({ mode: 'on', lang: 'ur', topic: 'پودے' });
    const h = p.html();
    expect(h).toContain('<bdi dir="ltr">7/9</bdi> سے آگے نکلنے کا چیلنج کسے دیں؟');
    expect(h).toContain('گھر میں کوئی');
    expect(h).toContain('کزن');
    expect(h).toContain('محلے کا دوست');
    p.els['#wq-who-home'].fire('click');
    const text = waHref(p);
    // The first name and the topic are first-strong isolates (U+2068 … U+2069); the numbers are Urdu digits.
    expect(text).toContain('میں \u2068Zara\u2069 ہوں!');
    expect(text).toContain('\u2068پودے\u2069 کوئز میں ۹ میں سے ۷ ستارے لیے۔');
    expect(text).toContain('مجھ سے آگے نکل کر دکھائیں!');
    expect(text).not.toContain('Khan');
  });
});

describe('split', () => {
  const armOf = (dev) => { const p = open({ mode: 'split', dev }); return sent(p).find((e) => e.n === 'card_view').v; };
  test('one phone always gets the same arm, and both arms occur', () => {
    const devs = ['AAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBB', 'CCCCCCCCCCCCCCCCCCCCCC', 'DDDDDDDDDDDDDDDDDDDDDD', 'k3Jx9QpLm2Zt8Wv4Yb6Rn1', 'Hq7Tz2Ln5Vb8Xc1Mw4Pd9F'];
    const arms = devs.map(armOf);
    expect(devs.map(armOf)).toEqual(arms);
    expect(new Set(arms)).toEqual(new Set(['a0', 'a1']));
  });
  test('arm a0 is today\'s card, with the arm on its events; a phone with no key is a0', () => {
    const p = open({ mode: 'split' });
    expect(p.html()).toContain('id="wq-chal"');
    expect(p.html()).not.toContain('wq-ask');
    p.els['#wq-chal'].fire('click');
    const ev = sent(p);
    expect(ev.find((e) => e.n === 'card_view').v).toBe('a0');
    expect(ev.find((e) => e.n === 'share_click').v).toBe('a0');
  });
});
