'use strict';
/**
 * The home's ONE Next tile across views (web-quiz-next-offer.js nextFor + the state's taps), with the taps heard
 * (web_quiz_events_v3 on):
 *   - an activity opened and left unfinished counts as ONE shown-without-a-tap, not as done: the same tile comes back
 *     on the next home view; a second unfinished open, or one more untapped show, rotates it (the two of #C3); a read
 *     or a storybook comes back as "Carry on reading" / «پڑھنا جاری رکھیں», a game or a listen keeps its words; finished (its
 *     finish card shown) it rotates as today;
 *   - a render never uses up the once-a-day tile ("Finish your story"): only a tap on it, or a tap on another tile or
 *     door from the home that showed it; with the taps not heard (events v3 off) today's rule stands.
 * Faked boundaries only: Supabase (the switches), Redis (the state), the logger transport. Invented ids only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable() { return true; },
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, typeof v === 'string' ? v : JSON.parse(JSON.stringify(v))); return true; }),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }), delete: jest.fn(async () => true),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const NO = require('../../../shared/services/quiz/web-quiz-next-offer');
const Leaf = require('../../../shared/services/quiz/web-quiz-next-offer-state');
const Svc = require('../../../shared/services/quiz/web-quiz.service');

const KID = '44444444-4444-4444-8444-000000000002';
const DEV = 'BBBBBBBBBBBBBBBBBBBBBB';
const NOW = Date.parse('2026-10-17T06:00:00.000Z');   // 11:00 PKT
const flush = () => new Promise((r) => setTimeout(r, 30));

const video = { kind: 'video', variant: 'recommended', id: 'vid-1', href: '/h/t?kid=c#watch/vid-1', title: 'Watch a video' };
const game = { kind: 'game', id: 'numbers', href: '/c/t?kid=c#numbers', title: 'Play with Jugnu' };
const invite = { kind: 'invite', id: 'invite', href: '/h/t#invite', title: 'Invite a friend' };
const story = { kind: 'story', id: 'en.read.2.k07', href: '/c/t?kid=c&room=story&pid=en.read.2.k07', title: 'Read with Jugnu', sub: 'The Testwala Kite' };
const book = { kind: 'storybook', id: 'sb-7', href: '/h/t?kid=c#story/sb-7', title: 'Finish your story', title_ur: 'اپنی کہانی پوری کریں', rule: 'resume' };

async function seed(events) {
  const db = { app_settings: [{ key: 'web_quiz_next_offer', value: true }, ...(events ? [{ key: 'web_quiz_events_v3', value: true }] : [])],
    quiz_sessions: [], students: [{ id: KID }] };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  NO._resetCache();
  require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache();
}

const kid = () => NO.childKey(KID);
const view = (candidates, { open = null, now = NOW } = {}) => NO.nextFor({ ctx: 'home', studentId: KID, candidates, hasRoot: true, now, open });
const offerOf = (n, id) => [n, ...n.alts].find((x) => x.id === id).offer;
const tap = (n, id, now = NOW) => Leaf.noteTap(kid(), offerOf(n, id), now);

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'carry-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 'c'.repeat(40);
  jest.spyOn(NO, 'armOf').mockReturnValue('rank');
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe('#C49a: an opened, unfinished activity counts as one shown-without-a-tap, not as done', () => {
  // The game is the ranked alt under the video, so "the same tile came back" is the carry-on and nothing else.
  async function gameIsTheAlt() {
    await seed(true);
    const v1 = await view([video, game, invite]);
    expect(v1.id).toBe('vid-1');
    expect(v1.alts.map((a) => a.id)).toContain('numbers');
    return v1;
  }

  test('a game opened and left: the same tile, with its own words, on the next home view', async () => {
    const v1 = await gameIsTheAlt();
    await tap(v1, 'numbers');
    const v2 = await view([video, game, invite]);
    expect(v2).toMatchObject({ kind: 'game', id: 'numbers', title: 'Play with Jugnu', href: game.href });
  });

  test('left twice (a second unfinished open): rotated', async () => {
    const v1 = await gameIsTheAlt();
    await tap(v1, 'numbers');
    const v2 = await view([video, game, invite]);
    await tap(v2, 'numbers');
    const v3 = await view([video, game, invite]);
    expect(v3.id).not.toBe('numbers');
  });

  test('left, then shown once more without a tap (the open is the first of #C3\'s two): rotated', async () => {
    const v1 = await gameIsTheAlt();
    await tap(v1, 'numbers');
    const v2 = await view([video, game, invite]);
    expect(v2.id).toBe('numbers');
    // a render alone is no show (C77): the same tile
    expect((await view([video, game, invite])).id).toBe('numbers');
    // the page's beacon for the tile drawn in view is the show
    const v3 = await view([video, game, invite]);
    await Leaf.noteShown(kid(), v3.offer, NOW + 1000);
    expect((await view([video, game, invite])).id).not.toBe('numbers');
  });

  test('finished (its finish card shown): it rotates as today', async () => {
    const v1 = await gameIsTheAlt();
    await tap(v1, 'numbers');
    expect(await Leaf.noteDone(kid(), 'game')).toBe(true);
    expect((await view([video, game, invite])).id).toBe('vid-1');
  });

  test('another kind\'s finish card (a book finished) does not finish the game', async () => {
    const v1 = await gameIsTheAlt();
    await tap(v1, 'numbers');
    expect(await Leaf.noteDone(kid(), 'book')).toBe(false);
    expect((await view([video, game, invite])).id).toBe('numbers');
  });

  test('a read opened and left (no longer "unseen", its runs unfinished): back as "Carry on reading" / «پڑھنا جاری رکھیں»', async () => {
    await seed(true);
    const v1 = await view([video, story, invite]);
    await tap(v1, story.id);
    const v2 = await view([video, invite], { open: new Set([story.id]) });
    expect(v2).toMatchObject({ kind: 'story', id: story.id, href: story.href, title: 'Carry on reading', title_ur: 'پڑھنا جاری رکھیں', sub: 'The Testwala Kite' });
  });

  test('a listening story opened and left comes back with its own words, never "Carry on reading"', async () => {
    const listen = { kind: 'story', id: 'en.listen.2.k03', href: '/c/t?kid=c&room=story&pid=en.listen.2.k03&ex=listen', title: 'Listen to a story', title_ur: 'کہانی سنیں', sub: 'The Testwala Drum', read_aloud: false };
    await seed(true);
    const v1 = await view([video, listen, invite]);
    await tap(v1, listen.id);
    // built again (still in the pool), then from the tap's own copy (no longer built)
    expect(await view([video, listen, invite])).toMatchObject({ id: listen.id, title: 'Listen to a story', title_ur: 'کہانی سنیں' });
    redis._store.clear();
    const w1 = await view([video, listen, invite]);
    await tap(w1, listen.id);
    expect(await view([video, invite], { open: new Set([listen.id]) })).toMatchObject({ id: listen.id, href: listen.href, title: 'Listen to a story', title_ur: 'کہانی سنیں' });
  });

  test('a listening stop of the month opened and left keeps its own words', async () => {
    const stop = { kind: 'story', id: 'stop.listen', href: '/c/t?kid=c#listen', title: 'Listen to a story', title_ur: 'کہانی سنیں', read_aloud: false };
    await seed(true);
    const v1 = await view([video, stop, invite]);
    await tap(v1, stop.id);
    expect(await view([video, stop, invite])).toMatchObject({ id: stop.id, title: 'Listen to a story', title_ur: 'کہانی سنیں' });
  });

  test('a read finished (no unfinished run on it): not brought back', async () => {
    await seed(true);
    const v1 = await view([video, story, invite]);
    await tap(v1, story.id);
    expect((await view([video, invite], { open: new Set() })).id).not.toBe(story.id);
  });

  test('a video opened and left keeps its own words; a tap on the result surface\'s tile carries nothing onto it', async () => {
    await seed(true);
    const v1 = await view([game, video, invite]);
    await tap(v1, 'vid-1');
    const v2 = await view([game, video, invite]);
    expect(v2).toMatchObject({ kind: 'video', id: 'vid-1', title: 'Watch a video', variant: 'recommended' });
    const card = await NO.nextFor({ ctx: 'after_quiz', studentId: KID, candidates: [game, video, invite], hasRoot: true, now: NOW });
    expect(card.rank_src).not.toBe('rule');
  });

  test('events v3 off: no tap is heard, so nothing is carried (today)', async () => {
    await seed(false);
    const v1 = await view([video, game, invite]);
    expect(v1.id).toBe('vid-1');
    const v2 = await view([video, game, invite]);
    expect(v2.id).toBe('vid-1');
  });
});

describe('#C50: a render never uses up the once-a-day tile', () => {
  test('rendered twice (a reload, a background return, a second /quiz reply): the same "Finish your story" tile', async () => {
    await seed(true);
    expect((await view([video, book])).id).toBe('sb-7');
    expect((await view([video, book])).id).toBe('sb-7');
    expect((await view([video, book], { now: NOW + 3 * 3600 * 1000 })).id).toBe('sb-7');
  });

  test('tapped: spent for the PKT day (gone on the next view), back the next day', async () => {
    await seed(true);
    const v1 = await view([video, book]);
    await tap(v1, 'sb-7');
    expect((await view([video, book])).id).not.toBe('sb-7');
    expect((await view([video, book], { now: NOW + 24 * 3600 * 1000 })).id).toBe('sb-7');
  });

  test('another tile tapped from the home that showed it: spent', async () => {
    await seed(true);
    const v1 = await view([video, book]);
    await tap(v1, 'vid-1');
    expect((await view([video, book])).id).not.toBe('sb-7');
  });

  test('a door tapped from the home that showed it (the page\'s door_tap, through the relay): spent', async () => {
    // The relay stamps the tap with the real clock; pin it to the views' NOW so the day is the same on any run date.
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    await seed(true);
    expect((await view([video, book])).id).toBe('sb-7');
    Svc.events({ ht: T.signHub([KID]), chip: T.chipId('h', KID), events: [{ n: 'door_tap', door: 'stories', pos: 1 }] }, { device: DEV });
    await flush();
    expect((await view([video, book])).id).not.toBe('sb-7');
  });

  test('a door tapped after a view that did NOT show it spends nothing', async () => {
    await seed(true);
    expect(await Leaf.noteDoor(kid(), NOW)).toBe(false);
    expect((await view([video, book])).id).toBe('sb-7');
  });

  test('events v3 off (no tap can be heard): today\'s rule, the render spends it', async () => {
    await seed(false);
    expect((await view([video, book])).id).toBe('sb-7');
    expect((await view([video, book])).id).not.toBe('sb-7');
  });
});

describe('the relay hands a finish card to the slot (card_shown, events v3 on)', () => {
  test('a game\'s finish card from the child\'s page ends the carry-on; a coach\'s preview card does not', async () => {
    await seed(true);
    const v1 = await view([video, game, invite]);
    await tap(v1, 'numbers');
    const hub = { ht: T.signHub([KID]), chip: T.chipId('h', KID) };
    Svc.events({ ...hub, events: [{ n: 'card_shown', src: 'game', source: 'challenge', share_ok: true, practice: 1 }] }, { device: DEV });
    await flush();
    expect(redis._store.get(`wq:next:${kid()}`).t).toMatchObject({ id: 'numbers', u: 1 });
    Svc.events({ ...hub, events: [{ n: 'card_shown', src: 'game', source: 'challenge', share_ok: true }] }, { device: DEV });
    await flush();
    expect(redis._store.get(`wq:next:${kid()}`)).not.toHaveProperty('t');
    expect((await view([video, game, invite])).id).toBe('vid-1');
  });
});
