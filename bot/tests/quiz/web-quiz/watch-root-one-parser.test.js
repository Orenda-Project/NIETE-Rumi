'use strict';
/**
 * The watch root's VALUE (app_settings) has ONE parser, `watch-root.js` `rootOf`, and every reader answers the same for
 * every spelling: the teacher report and the join queue (`watchRootId`), the quiz page and the league (the page's
 * settings read, `watchRoot`), the videos module (the minting side, `watchRoot`). A failed read: the report stays
 * fail-open, the page's readers fail closed (no class, no board), the videos module mints nothing.
 * Supabase is the faked boundary.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ get: jest.fn(async () => null), set: jest.fn(async () => true), setNX: jest.fn(async () => true), delete: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WatchRoot = require('../../../shared/services/quiz/watch-root');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const Videos = require('../../../shared/services/quiz/web-quiz-videos');

const ID = '33333333-3333-4333-8333-777777777777';
const UP = ID.toUpperCase();

let clock = Date.now();
function seed(rows, { fail = false } = {}) {
  const fake = makeFake({ app_settings: rows });
  supabase.from = (t) => {
    if (fail && t === 'app_settings') {
      const b = fake.from(t);
      const err = { data: null, error: { message: 'db down' } };
      b.then = (res) => Promise.resolve(err).then(res);
      b.maybeSingle = async () => err;
      return b;
    }
    return fake.from(t);
  };
  IdRoster._resetCache();
  clock += 60 * 1000;   // past every reader's 30 s cache
}
const readAll = async () => [
  await WatchRoot.watchRootId(clock),
  await IdRoster.watchRoot(clock),
  await Videos.watchRoot(),
];

describe('every reader parses every spelling the same way (one parser)', () => {
  test.each([
    ['absent', null, null],
    ['empty string', '', null],
    ['a plain id', ID, ID],
    ['a JSON-quoted id', JSON.stringify(ID), ID],
    ['padded', `  ${ID}  `, ID],
    ['upper case', UP, ID],
    ['a JSON-quoted, padded, upper-case id', JSON.stringify(` ${UP} `), ID],
    ['not an id', 'abc', null],
    ['a JSON list', JSON.stringify([ID]), null],
    ['a JSON object', JSON.stringify({ id: ID }), null],
    ['a number', '42', null],
    ['double-encoded', JSON.stringify(JSON.stringify(ID)), null],
    ['a jsonb list', [ID], null],
    ['a jsonb object', { id: ID }, null],
    ['a jsonb number', 42, null],
  ])('%s', async (_what, value, want) => {
    seed(value === null ? [] : [{ key: 'web_quiz_watch_root', value }]);
    expect(await readAll()).toEqual([want, want, want]);
    expect(WatchRoot.rootOf(value)).toBe(want);
  });
});

describe('a failed read: each reader\'s policy, named', () => {
  test('the report: no code left out (fail-open, as today)', async () => {
    seed([{ key: 'web_quiz_watch_root', value: ID }], { fail: true });
    expect(await WatchRoot.watchRootId(clock)).toBeNull();
  });
  test('the quiz page: the read is UNREADABLE, never "no root" (its readers fail closed on it)', async () => {
    seed([{ key: 'web_quiz_watch_root', value: ID }], { fail: true });
    expect(await IdRoster.watchRootState(clock)).toEqual({ root: null, unreadable: true });
    seed([{ key: 'web_quiz_watch_root', value: ID }]);
    expect(await IdRoster.watchRootState(clock)).toEqual({ root: ID, unreadable: false });
    seed([]);
    expect(await IdRoster.watchRootState(clock)).toEqual({ root: null, unreadable: false });
  });
  test('the videos module: no root, so no watch code is minted (fail closed, as today)', async () => {
    seed([{ key: 'web_quiz_watch_root', value: ID }], { fail: true });
    expect(await Videos.watchRoot()).toBeNull();
  });
});
