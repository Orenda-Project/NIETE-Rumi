'use strict';
/**
 * The home's ONE Next tile is steady (web-quiz-next-offer.js nextFor + the state's beacons and taps, events v3 on):
 *   - a render (a reload, a background return, a second fetch) changes nothing, for every kind of tile, in the rank and
 *     the rand arm, whatever the time between renders;
 *   - the tile moves only by IA §3 step 3: shown in view (the page's next_shown, pos 0) twice in a row without a tap,
 *     two beacons inside 60 s counting once -> it drops exactly one place, and the drop holds for the PKT day;
 *   - a tap or a finish may bring a new tile;
 *   - the rand arm's kind is drawn once per child per PKT day (a drop never re-draws it); another day may differ;
 *   - a month's "home open" (rule 2) is a PKT day with a home view, never a render.
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

const KID = '44444444-4444-4444-8444-0000000000c7';
const DEV = 'CCCCCCCCCCCCCCCCCCCCCC';
const NOW = Date.parse('2026-10-17T07:08:00.000Z');   // 12:08 PKT
const S = 1000;
const DAY = 24 * 3600 * S;
const flush = () => new Promise((r) => setTimeout(r, 30));

const video = { kind: 'video', variant: 'recommended', id: 'vid-1', href: '/h/t?kid=c#watch/vid-1', title: 'Watch a video' };
const story = { kind: 'story', id: 'ur.listen.1.story01', href: '/c/t?kid=c&room=story&pid=ur.listen.1.story01&ex=listen', title: 'Listen to a story', released_at: '2026-10-10T00:00:00Z', seen: false };
const story2 = { kind: 'story', id: 'en.read.2.k07', href: '/c/t?kid=c&room=story&pid=en.read.2.k07', title: 'Read to Jugnu', released_at: '2026-10-09T00:00:00Z', seen: false };
const game = { kind: 'game', id: 'numbers', href: '/c/t?kid=c#numbers', title: 'Play the numbers game' };
const game2 = { kind: 'game', id: 'stop.bigger', href: '/c/t?kid=c#bigger', title: 'Play with Jugnu' };
const sticker = { kind: 'sticker', id: 'book', href: '/h/t?kid=c#book', title: 'See your stickers' };
const again = { kind: 'quiz', variant: 'again', id: 'qk00000001', href: '/q/TSTQ42?again=1&k=x', title: 'Play again' };
const book = { kind: 'storybook', id: 'sb-7', href: '/h/t?kid=c#story/sb-7', title: 'Finish your story', title_ur: 'اپنی کہانی پوری کریں', rule: 'resume' };
const stop = { kind: 'game', id: 'stop.missing', href: '/c/t?kid=c#missing', title: 'Play with Jugnu', rule: 'month_stop' };

// Each kind as the rank arm's head (the committed scores file, home): the list it leads.
const LEADS = {
  resume: [book, video, story, game],
  story: [story, story2, game, sticker],
  game: [game, game2],
  quiz: [again, story, game],
  video: [video, story, game],
  sticker: [sticker, game],
};
const ALL = [video, story, story2, game, game2, sticker, again];

async function seed() {
  const db = { app_settings: [{ key: 'web_quiz_next_offer', value: true }, { key: 'web_quiz_events_v3', value: true }], quiz_sessions: [], students: [{ id: KID }] };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  NO._resetCache();
  require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache();
}

const keyOf = (id) => NO.childKey(id);
const view = (candidates, now, id = KID) => NO.nextFor({ ctx: 'home', studentId: id, candidates, hasRoot: true, now });
// the page's beacon for the ONE tile it drew in view (what Svc.events relays for a pos-0 next_shown)
const shown = (n, now, id = KID) => Leaf.noteShown(keyOf(id), n.offer, now);
const offerOf = (n, id) => [n, ...n.alts].find((x) => x.id === id).offer;

beforeEach(async () => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'steady-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 's'.repeat(40);
  await seed();
});
afterEach(() => jest.restoreAllMocks());

describe('a render changes nothing: render x3 (30 s, then 90 s apart; no tap) -> the same tile', () => {
  test.each(Object.keys(LEADS))('rank arm, %s tile', async (kind) => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    const list = LEADS[kind];
    const a = await view(list, NOW);
    const b = await view(list, NOW + 30 * S);
    const c = await view(list, NOW + 120 * S);
    expect(a.id).toBe(list[0].id);
    expect([b.id, c.id]).toEqual([a.id, a.id]);
    expect([b.href, c.href]).toEqual([a.href, a.href]);
  });

  // The rand arm draws the kind per child per day: find a child whose draw is each kind, then render it x3.
  test.each(['story', 'game', 'quiz', 'video', 'sticker', 'resume'])('rand arm, %s tile', async (kind) => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rand');
    const list = kind === 'resume' ? [book, ...ALL] : ALL;
    let who = null;
    for (let i = 0; i < 200 && !who; i += 1) {
      const id = `44444444-4444-4444-8444-${String(100000000000 + i)}`;
      const n = await view(list, NOW, id);
      if (kind === 'resume' ? n.id === 'sb-7' : n.kind === kind) who = { id, first: n };
      else redis._store.clear();
    }
    expect(who).not.toBeNull();
    const b = await view(list, NOW + 30 * S, who.id);
    const c = await view(list, NOW + 120 * S, who.id);
    expect([b.id, c.id]).toEqual([who.first.id, who.first.id]);
    expect([b.href, c.href]).toEqual([who.first.href, who.first.href]);
  });

  test('rank arm, every render beaconed but inside 60 s (one show): the same tile x4', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    const ids = [];
    for (const t of [0, 20, 40, 55]) {
      const n = await view(LEADS.video, NOW + t * S);
      await shown(n, NOW + t * S);
      ids.push(n.id);
    }
    ids.push((await view(LEADS.video, NOW + 58 * S)).id);
    expect(new Set(ids)).toEqual(new Set(['vid-1']));
  });
});

describe('IA §3 step 3: shown in view twice in a row (>= 60 s apart), not tapped -> exactly one place down', () => {
  test('rank arm: the head drops one place, holds there on later renders, and the next one drops one place too', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    const list = [video, again, story];    // ranked: video, quiz, story
    const a = await view(list, NOW);
    await shown(a, NOW);
    expect((await view(list, NOW + 61 * S)).id).toBe('vid-1');
    const b = await view(list, NOW + 70 * S);
    await shown(b, NOW + 70 * S);
    // two shows -> one place: the quiz leads, the video is right under it (the alt)
    const c = await view(list, NOW + 80 * S);
    expect(c.id).toBe('qk00000001');
    // the drop holds: renders (no beacon) never undo it
    expect((await view(list, NOW + 200 * S)).id).toBe('qk00000001');
    expect((await view(list, NOW + 400 * S)).id).toBe('qk00000001');
    // the quiz shown twice -> one place down: the video is back on top (one place, never two: never the story)
    await shown(c, NOW + 80 * S);
    const d = await view(list, NOW + 150 * S);
    await shown(d, NOW + 150 * S);
    expect((await view(list, NOW + 160 * S)).id).toBe('vid-1');
  });

  test('two beacons inside 60 s count once: no drop', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    const a = await view(LEADS.video, NOW);
    await shown(a, NOW);
    const b = await view(LEADS.video, NOW + 59 * S);
    await shown(b, NOW + 59 * S);
    expect((await view(LEADS.video, NOW + 61 * S)).id).toBe('vid-1');
  });

  test('a beacon heard through the page relay (next_shown, pos 0) counts; a pos-1 line and a coach\'s preview do not', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    const hub = { ht: T.signHub([KID]), chip: T.chipId('h', KID) };
    const line = (n, over = {}) => ({ n: 'next_shown', ctx: 'home', kind: n.kind, pos: 0, offer: n.offer, arm: 'rank', rank_src: n.rank_src, source: 'ranked', ...over });
    const T0 = Date.now();   // the relay stamps a beacon with the server's own clock
    const a = await view(LEADS.video, T0);
    Svc.events({ ...hub, events: [line(a, { pos: 1 }), line(a, { practice: 1 })] }, { device: DEV });
    await flush();
    expect(redis._store.get(`wq:next:${keyOf(KID)}`).s || null).toBeNull();
    Svc.events({ ...hub, events: [line(a)] }, { device: DEV });
    await flush();
    expect(redis._store.get(`wq:next:${keyOf(KID)}`).s).toMatchObject({ id: 'vid-1', n: 1 });
    await shown(await view(LEADS.video, T0 + 90 * S), Date.now() + 90 * S);
    expect((await view(LEADS.video, T0 + 100 * S)).id).toBe('ur.listen.1.story01');
  });

  test('a render with no beacon (a tile never drawn in view) never counts', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    for (let i = 0; i < 6; i += 1) expect((await view(LEADS.video, NOW + i * 90 * S)).id).toBe('vid-1');
  });

  test('a drop lasts the PKT day: the next day starts from the ranked order again', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    const a = await view(LEADS.video, NOW);
    await shown(a, NOW);
    await shown(await view(LEADS.video, NOW + 90 * S), NOW + 90 * S);
    expect((await view(LEADS.video, NOW + 100 * S)).id).not.toBe('vid-1');
    expect((await view(LEADS.video, NOW + DAY)).id).toBe('vid-1');
  });
});

describe('a tap or a finish may bring a new tile', () => {
  test('the once-a-day "Finish your story" tile: steady over renders and beacons, then tapped -> another tile', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    const a = await view(LEADS.resume, NOW);
    await shown(a, NOW);
    const b = await view(LEADS.resume, NOW + 90 * S);
    await shown(b, NOW + 90 * S);
    const c = await view(LEADS.resume, NOW + 180 * S);
    expect([a.id, b.id, c.id]).toEqual(['sb-7', 'sb-7', 'sb-7']);
    await Leaf.noteTap(keyOf(KID), c.offer, NOW + 181 * S);
    expect((await view(LEADS.resume, NOW + 200 * S)).id).not.toBe('sb-7');
  });

  test('a finish (the thing leaves the list) -> the next one; a tap on an alt -> that tile comes back (carry on)', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    const a = await view([video, again, story], NOW);
    expect(a.id).toBe('vid-1');
    expect((await view([again, story], NOW + 10 * S)).id).toBe('qk00000001');
    const b = await view([video, again, story], NOW + 20 * S);
    await Leaf.noteTap(keyOf(KID), offerOf(b, 'ur.listen.1.story01'), NOW + 21 * S);
    expect((await view([video, again, story], NOW + 30 * S)).id).toBe('ur.listen.1.story01');
  });
});

describe('the rand arm draws once per child per PKT day', () => {
  // A list whose ranked order a drop reorders across kinds (video over quiz): the kind must not follow the order.
  test('the drawn kind holds over renders and over a drop; another day may draw another kind', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rand');
    const list = [video, again, story, game, sticker];
    const days = new Set();
    for (let i = 0; i < 12; i += 1) {
      const id = `44444444-4444-4444-8444-${String(200000000000 + i)}`;
      const a = await view(list, NOW, id);
      await shown(a, NOW, id);
      const b = await view(list, NOW + 90 * S, id);
      await shown(b, NOW + 90 * S, id);
      const c = await view(list, NOW + 120 * S, id);
      const d = await view(list, NOW + 3600 * S, id);
      expect([b.kind, c.kind, d.kind]).toEqual([a.kind, a.kind, a.kind]);
      expect(c.rank_src).toBe('rand');
      for (let k = 1; k <= 6; k += 1) days.add((await view(list, NOW + k * DAY, id)).kind);
    }
    expect(days.size).toBeGreaterThan(1);
  });
});

describe('rule 2: a month\'s home open is a PKT day with a home view, never a render', () => {
  test('the month\'s stop leads every render of day 1 and day 2; on day 3 it competes', async () => {
    jest.spyOn(NO, 'armOf').mockReturnValue('rank');
    const list = [stop, video, story];
    const d1 = [];
    for (let i = 0; i < 4; i += 1) d1.push((await view(list, NOW + i * 40 * S)).id);
    expect(d1).toEqual(['stop.missing', 'stop.missing', 'stop.missing', 'stop.missing']);
    expect((await view(list, NOW + DAY)).rank_src).toBe('rule');
    expect((await view(list, NOW + DAY + 300 * S)).rank_src).toBe('rule');
    expect((await view(list, NOW + 2 * DAY)).rank_src).not.toBe('rule');
  });
});
