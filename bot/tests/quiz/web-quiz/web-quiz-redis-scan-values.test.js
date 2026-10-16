'use strict';
/**
 * The Redis service's scanValues(match): every value whose key matches, by SCAN (cursor until 0) and GET, and never
 * a key. Unavailable or a failed command → null (the caller skips its line). Faked boundary: the ioredis client.
 */
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { logToFile } = require('../../../shared/utils/logger');

let svc;
beforeAll(() => {
  const saved = process.env.REDIS_URL;
  delete process.env.REDIS_URL;                 // the constructor makes no connection
  jest.isolateModules(() => { svc = require('../../../shared/services/cache/railway-redis.service'); });
  if (saved != null) process.env.REDIS_URL = saved;
});

const fakeClient = (store, { pages = 2, fail = false } = {}) => {
  const keys = [...store.keys()];
  const per = Math.ceil(keys.length / pages) || 1;
  return {
    status: 'ready',
    scan: jest.fn(async (cursor, _m, match, _c, _n) => {
      if (fail) throw new Error('LOADING');
      const rx = new RegExp(`^${match.replace(/\*/g, '.*')}$`);
      const i = Number(cursor);
      const page = keys.slice(i, i + per).filter((k) => rx.test(k));
      const next = i + per >= keys.length ? '0' : String(i + per);
      return [next, i === 0 ? page : [...page, keys[0]].filter((k) => rx.test(k))];   // SCAN may repeat a key
    }),
    mget: jest.fn(async (...ks) => ks.map((k) => (store.has(k) ? store.get(k) : null))),
  };
};

afterEach(() => { jest.clearAllMocks(); svc.redis = null; });

test('returns the values of every matching key across SCAN pages, each key once, and no key', async () => {
  const store = new Map([['wq:reply_cap:2026-10-18:aa', '3'], ['wq:reply_cap:2026-10-18:bb', '9'], ['wq:reply_cap:2026-10-17:cc', '1'], ['other', 'x']]);
  svc.redis = fakeClient(store, { pages: 2 });
  const vals = await svc.scanValues('wq:reply_cap:2026-10-18:*');
  expect(vals.sort()).toEqual(['3', '9']);
  expect(svc.redis.scan).toHaveBeenCalledTimes(2);
  expect(svc.redis.scan.mock.calls[0]).toEqual(['0', 'MATCH', 'wq:reply_cap:2026-10-18:*', 'COUNT', expect.any(Number)]);
});

test('unavailable → null, and no command is sent', async () => {
  expect(await svc.scanValues('wq:reply_cap:2026-10-18:*')).toBeNull();
  const c = fakeClient(new Map());
  c.status = 'reconnecting';
  svc.redis = c;
  expect(await svc.scanValues('wq:reply_cap:2026-10-18:*')).toBeNull();
  expect(c.scan).not.toHaveBeenCalled();
});

test('a failed command → null and one log line that names no key', async () => {
  svc.redis = fakeClient(new Map([['wq:reply_cap:2026-10-18:aa', '3']]), { fail: true });
  expect(await svc.scanValues('wq:reply_cap:2026-10-18:*')).toBeNull();
  expect(logToFile).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logToFile.mock.calls)).not.toMatch(/:aa/);
});
