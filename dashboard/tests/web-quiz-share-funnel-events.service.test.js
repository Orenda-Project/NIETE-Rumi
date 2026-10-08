/**
 * The friend-invite funnel's labels: a share tap says which browser it was in, what the phone could share
 * with, and (for a challenge) which code it sent; leaving the share screen by Back is a step of its own;
 * the card says how the child did and whether they were a friend; a page open says where its link came from.
 * Labels and codes only, never a person. Runs the whole shipped page in the harness's vm, then the bot's
 * allow-list over what the page sent.
 */
const { page } = require('./wq-page-harness');

// The allow-list is pure; only its module's database client is stood in for.
jest.mock('../../bot/shared/config/supabase', () => ({}));
const { cleanEvent } = require('../../bot/shared/services/quiz/web-quiz.service');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const result = (correct, total) => ({ card: { first: 'Zara', animal: 'owl', correct, total, stars: correct }, challenge_code: 'CHAL12', score: { correct, total, pct: Math.round((100 * correct) / total) } });
const finished = (r = result(3, 5)) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: r } });

// Every event the page posted, after a pagehide flush.
function sent(p) {
  p.fireWin('pagehide');
  return p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
}
const named = (p, n) => sent(p).filter((e) => e.n === n);

describe('share taps', () => {
  test('a challenge tap in WhatsApp\'s own browser says so, that the phone had no share sheet, and the code it sent', () => {
    const p = page({ lang: 'en', store: finished(), ua: 'Mozilla/5.0 (Linux; Android 13) WhatsApp/2.24 WA4A/2.24' });
    p.tap();
    p.els['#wq-chal'].fire('click');
    const tap = named(p, 'share_click').find((e) => e.step === 'tap');
    expect(tap).toMatchObject({ src: 'challenge', iab: 1, cap: 'none', to: 'CHAL12' });
    expect(cleanEvent(tap).props).toMatchObject({ src: 'challenge', step: 'tap', iab: 1, cap: 'none', to: 'CHAL12' });
  });

  test('a class-group tap in a browser that can share a file says "file" and carries no "to" (it sends the class link)', () => {
    const p = page({ lang: 'en', store: finished(), ua: 'Mozilla/5.0 (Linux; Android 13) Chrome/129', nav: { share: () => new Promise(() => {}), canShare: () => true } });
    p.tap();
    p.els['#wq-share'].fire('click');
    const tap = named(p, 'share_click').find((e) => e.step === 'tap');
    expect(tap.iab).toBe(0);
    expect(['file', 'native']).toContain(tap.cap);
    expect(tap.to).toBeUndefined();
  });

  test('leaving the share screen by Back is logged as its own step', () => {
    const p = page({ lang: 'en', store: finished() });
    p.tap();
    p.els['#wq-chal'].fire('click');
    expect(p.moment()).toBe('M12-fallback');
    p.els['#wq-back'].fire('click');
    expect(named(p, 'share_click').map((e) => e.step)).toEqual(['tap', 'fb_back']);
  });
});

describe('the card and the page open', () => {
  test.each([[1, 5, 'low'], [3, 5, 'mid'], [5, 5, 'high']])('card_view %i/%i is band %s, not a friend', (c, t, band) => {
    const p = page({ lang: 'ur', store: finished(result(c, t)) });
    p.tap();
    const v = named(p, 'card_view')[0];
    expect(v).toMatchObject({ band, friend: 0 });
    expect(cleanEvent(v).props).toMatchObject({ band, friend: 0 });
  });

  test('a friend\'s own card says friend', () => {
    const p = page({ lang: 'en', store: finished(), challenge: { first: 'Ali', correct: 3, total: 5 } });
    p.tap();
    expect(named(p, 'card_view')[0].friend).toBe(1);
  });

  test.each([
    [{ search: '?a=c.abc' }, 'card'],
    [{ search: '?v=3', view: 'class' }, 'table'],
    [{ challenge: { first: 'Ali', correct: 3, total: 5 } }, 'invite'],
    [{}, 'direct'],
  ])('page_open says where its link came from (%j → %s)', (opts, via) => {
    const p = page({ lang: 'en', ...opts });
    const o = named(p, 'page_open')[0];
    expect(o.via).toBe(via);
    expect(cleanEvent(o).props.via).toBe(via);
  });
});

describe('the allow-list', () => {
  test('keeps only well-formed labels', () => {
    const c = cleanEvent({ n: 'share_click', step: 'tap', src: 'challenge', to: 'not a code!', cap: 'everything', band: 'top', via: 'somewhere', friend: 2 });
    expect(c.props).toEqual({ step: 'tap', src: 'challenge' });
  });
});
