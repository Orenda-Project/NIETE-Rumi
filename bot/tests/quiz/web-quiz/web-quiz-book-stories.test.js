'use strict';
/**
 * Jugnu's Book shows a storybook sticker for each book the child finished (web_quiz_stories); with Stories off the
 * Book's JSON has no new key (the page is today's). Invented children and books only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const redis = require('../../../shared/services/cache/railway-redis.service');

const KID = '44444444-4444-4444-8444-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const CLASS = '66666666-6666-4666-8666-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
// Wednesday 11 November 2026, 10:00 PKT: the week began Monday 9 November 00:00 PKT, the term on 1 October.
const NOW = Date.parse('2026-11-11T05:00:00Z');
const MON = '2026-11-09T06:00:00Z';
const WED = '2026-11-11T04:00:00Z';
const THU_LAST = '2026-11-05T06:00:00Z';
const OCT = '2026-10-15T06:00:00Z';
const GOLDEN = path.join(__dirname, 'web-quiz-book-hub-golden.json');

let db;
const ON = ['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_challenge_v2', 'web_quiz_challenge_book'];
const settings = (keys) => keys.map((key) => ({ key, value: true }));

function seed(over = {}) {
  db = {
    app_settings: settings(ON),
    students: [{ id: KID, student_name: 'Zara Khan', student_name_urdu: 'زارا خان', self_reported_class: '3', list_id: LIST, is_active: true }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    web_quiz_challenge_runs: [],
    ...over,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
// A v2 check row of this child.
let seq = 0;
function run(extra = {}) {
  seq += 1;
  return { id: `r${seq}`, student_id: KID, canonical_id: null, exercise: 'read', status: 'scored', mode: 'check', record: true, period_id: '2026-11',
    passage_id: null, item_set_id: null, class_id: null, exposure_no: 1, created_at: WED, scored_at: WED, wcpm: 30, score: { correct: 20 }, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'book-test-secret';
  Hub._resetCache();
  redis._store.clear();
  redis._up = true;
  seed();
  try { require('../../../shared/services/quiz/web-quiz-book')._resetCache(); } catch (_) { /* absent on the base */ }
});

const book = (over = {}) => require('../../../shared/services/quiz/web-quiz-book').bookFor({ hub: T.signHub([KID]), kid: T.chipId('h', KID), device: DEV, lang: 'en', ...over }, NOW);

const F = require('./__fixtures__/stories-testwala');

describe('storybook stickers on the Book', () => {
  beforeEach(() => { require('../../../shared/services/quiz/web-quiz-stories')._reset(); });
  test('Stories off: no book_stickers key at all, even with a finished book', async () => {
    db.story_books = [F.book(1)];
    db.story_events = [{ child_id: KID, book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: WED }];
    const out = await book();
    expect(Object.prototype.hasOwnProperty.call(out, 'book_stickers')).toBe(false);
  });
  test.each([['false', false], ['the word yes', 'yes'], ['a JSON string true with spaces', ' true '], ['the JSON string "true"', 'true']])('Stories set to %s: no book_stickers key', async (_, value) => {
    db.story_books = [F.book(1)];
    db.story_events = [{ child_id: KID, book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: WED }];
    db.app_settings.push({ key: 'web_quiz_stories', value });
    const out = await book();
    expect(Object.prototype.hasOwnProperty.call(out, 'book_stickers')).toBe(false);
  });
  test('the Stories settings read throws: no book_stickers key, the Book still answers', async () => {
    db.story_books = [F.book(1)];
    db.story_events = [{ child_id: KID, book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: WED }];
    const fake = makeFake(db);
    Object.assign(supabase, { from: (t) => (t === 'app_settings' ? { select: () => ({ in: async (c, keys) => (keys.includes('web_quiz_stories') ? { data: null, error: { message: 'down' } } : fake.from(t).select('key, value').in(c, keys)) }) } : fake.from(t)) });
    const out = await book();
    expect(Object.prototype.hasOwnProperty.call(out, 'book_stickers')).toBe(false);
  });
  test('Stories on: one sticker per finished ready book, with its title and cover', async () => {
    db.app_settings.push({ key: 'web_quiz_stories', value: true });
    db.story_books = [F.book(1), F.book(2, { status: 'off' })];
    db.story_events = [
      { child_id: KID, book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: WED },
      { child_id: KID, book_id: F.BOOK(2), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: WED },
      { child_id: KID, book_id: F.BOOK(1), event: 'story_opened', data: {}, at: WED },
    ];
    const out = await book();
    expect(out.book_stickers).toEqual([{ book_id: F.BOOK(1), title: 'Book 1 Testwala', cover: `/s/${F.BOOK(1)}/cover-aaaa0001.webp` }]);
  });
  test('Stories on, nothing finished: an empty list', async () => {
    db.app_settings.push({ key: 'web_quiz_stories', value: true });
    db.story_books = [F.book(1)];
    db.story_events = [];
    expect((await book()).book_stickers).toEqual([]);
  });
});

// Golden (SPEC §5): with Stories off in any of its four shapes the hub payload and its events are the base's, byte for byte.
describe('golden: Stories off (absent, false, "yes", the string "true", a read that throws) -> the hub payload is the base\'s', () => {
  const BASE = ['web_quiz_hub', 'web_quiz_challenge'];
  async function snap(extra, broken) {
    jest.useFakeTimers({ now: NOW, doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      seed({ app_settings: [...settings(BASE), ...extra], web_quiz_challenge_runs: [run({ class_id: CLASS, passage_id: 'p-g' })], child_rungs: [{ canonical_id: KID, ladder: 'reading', rung: 3, period_id: '2026-11', set_at: WED }] });
      if (broken) {
        const fake = makeFake(db);
        Object.assign(supabase, { from: (t) => (t === 'app_settings' ? { select: () => ({ in: async (c, keys) => (keys.includes('web_quiz_stories') ? { data: null, error: { message: 'down' } } : fake.from(t).select('key, value').in(c, keys)) }) } : fake.from(t)) });
      }
      Hub._resetCache();
      require('../../../shared/services/quiz/web-quiz-book')._resetCache();
      require('../../../shared/services/quiz/web-quiz-stories')._reset();
      redis._store.clear();
      logEvent.mockClear();
      const payload = await Hub.hub(T.signHub([KID]), { kid: T.chipId('h', KID), device: DEV });
      return JSON.parse(JSON.stringify({ payload, events: logEvent.mock.calls }));
    } finally {
      jest.useRealTimers();
    }
  }
  test.each([
    ['absent', [], false],
    ['false', [{ key: 'web_quiz_stories', value: false }], false],
    ['"yes"', [{ key: 'web_quiz_stories', value: 'yes' }], false],
    ['the string "true"', [{ key: 'web_quiz_stories', value: 'true' }, { key: 'web_quiz_stories_band', value: true }], false],
    ['a read that throws', [{ key: 'web_quiz_stories', value: true }], true],
  ])('Stories %s: equals the golden', async (_, extra, broken) => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(await snap(extra, broken)).toEqual(golden);
  });
});
