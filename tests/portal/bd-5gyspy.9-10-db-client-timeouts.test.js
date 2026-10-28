'use strict';
/**
 * bd-5gyspy.9 and bd-5gyspy.10, the portal's two database-client failures on NIETE prod, 28 Oct.
 *
 * .10: at 13:20:37Z the database ended every connection (57P01 «terminating connection due to administrator command»).
 *      The pool's 'error' listener only covers IDLE clients, so a client a request was holding threw an unhandled
 *      'error' event on the pg Client and two cluster workers died with every request in flight on them.
 * .9:  the DB-context middleware answers 504 at 30 s on every path. The app's own timeout gives the coaching-session
 *      routes 120 s (middleware/timeout.js GPT_HEAVY_ROUTES), so a reflection that waits on the bot's LLM for 30 s got
 *      a 504 from the wrong layer (04:01:35Z, 04:03:32Z).
 *
 * Both run the real modules. Only the network boundary is replaced: no database is reached (the pool never connects;
 * the middleware's pool is the mocked first-party module, checked against the real one's exports below).
 */
const { EventEmitter } = require('events');

describe('bd-5gyspy.10: a held client that the database disconnects does not take the worker down', () => {
  let pool;
  beforeAll(() => {
    jest.useFakeTimers(); // the module's 30 s health interval
    jest.isolateModules(() => { pool = require('../../dashboard/config/database'); });
  });
  afterAll(() => { jest.useRealTimers(); });

  test('an error event on a checked-out client is handled (no unhandled throw)', () => {
    // the root suite maps 'pg' to tests/__mocks__/pg.js, whose Pool records `on` calls: run the module's own listener
    const onConnect = pool.on.mock.calls.filter(([ev]) => ev === 'connect').map(([, fn]) => fn);
    expect(onConnect.length).toBeGreaterThan(0);
    const client = new EventEmitter(); // what pg-pool hands its 'connect' listeners: the Client, an EventEmitter
    onConnect.forEach((fn) => fn(client));
    const err = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01', severity: 'FATAL' });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => client.emit('error', err)).not.toThrow();
    expect(spy.mock.calls.some((c) => String(c.join(' ')).includes('57P01'))).toBe(true);
    spy.mockRestore();
  });
});

describe('bd-5gyspy.9: the DB-context budget follows the route budget', () => {
  const realPool = jest.requireActual('../../dashboard/config/database');
  let setDatabaseContext;
  let fakeClient;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    fakeClient = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() };
    jest.doMock('../../dashboard/config/database', () => ({ connect: jest.fn(async () => fakeClient) }));
    ({ setDatabaseContext } = require('../../dashboard/middleware/rbac/database-context'));
  });
  afterEach(() => { jest.useRealTimers(); jest.dontMock('../../dashboard/config/database'); });

  test('the mock matches the real module (contract)', () => {
    expect(typeof realPool.connect).toBe('function');
  });

  function run(path) {
    const req = { method: 'POST', url: path, path, originalUrl: path, session: { userId: 'u-1' } };
    const res = Object.assign(new EventEmitter(), {
      headersSent: false, writableEnded: false, statusCode: 200, sent: [],
      status(c) { this.statusCode = c; return this; },
      json(b) { this.sent.push({ status: this.statusCode, body: b }); this.headersSent = true; return this; },
    });
    const next = jest.fn();
    return { req, res, next, ready: setDatabaseContext(req, res, next) };
  }

  test('a coaching-session reflection still waiting at 31 s gets no 504 from the DB context', async () => {
    const { res, next, ready } = run('/api/portal/coaching-session/abc/reflection');
    await ready;
    expect(next).toHaveBeenCalled();
    jest.advanceTimersByTime(31000);
    expect(res.sent).toEqual([]);
    jest.advanceTimersByTime(90000); // past the route's 120 s budget: the DB context lets go
    expect(res.sent).toEqual([{ status: 504, body: { error: 'Request timeout' } }]);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // cleanup awaits RESET ROLE before it releases
    expect(fakeClient.query).toHaveBeenCalledWith('RESET ROLE');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('an ordinary route keeps the 30 s budget', async () => {
    const { res, ready } = run('/api/portal/me');
    await ready;
    jest.advanceTimersByTime(30001);
    expect(res.sent).toEqual([{ status: 504, body: { error: 'Request timeout' } }]);
  });
});
