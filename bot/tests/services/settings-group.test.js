'use strict';
/**
 * settings-group: one app_settings read for a host switch and the switches that ride it.
 *
 * Supabase is the faked boundary (an in-memory client that applies the filters); every app_settings query is
 * recorded as `eq:<key>` or `in:<k1,k2,…>`, so a row can say exactly which reads ran.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');

const HOST = 'settings_group_host_testwala';
const RIDER = 'settings_group_rider_testwala';
const TTL = 30 * 1000;
const T0 = Date.UTC(2026, 0, 1);

let G;
let reads;
/** app_settings rows `{ key: value }` (undefined = absent); `fail` = { in: 'error'|'throw', eq: [keys that throw] }. */
function seed(settings = {}, fail = {}) {
  const fake = makeFake({ app_settings: Object.entries(settings).filter(([, v]) => v !== undefined).map(([key, value]) => ({ key, value })) });
  reads = [];
  Object.assign(require('../../shared/config/supabase'), {
    from: (table) => {
      const b = fake.from(table);
      if (table !== 'app_settings') return b;
      const { eq, in: within } = b;
      b.eq = (col, v) => {
        reads.push(`eq:${v}`);
        if ((fail.eq || []).includes(v)) throw new Error('settings down');
        return eq.call(b, col, v);
      };
      b.in = (col, vs) => {
        reads.push(`in:${[].concat(vs).join(',')}`);
        if (fail.in === 'throw') throw new Error('settings down');
        if (fail.in === 'error') return { then: (res, rej) => Promise.resolve({ data: null, error: { message: 'settings down' } }).then(res, rej) };
        return within.call(b, col, vs);
      };
      return b;
    },
  });
}

beforeEach(() => {
  jest.resetModules();
  G = require('../../shared/services/settings-group');
});

describe('the host read', () => {
  test('no rider: the host\'s own .eq read, exactly as before', async () => {
    seed({ [HOST]: true });
    const g = G.settingsGroup(HOST, [], TTL);
    const { data, error } = await g.host(T0);
    expect(error).toBeNull();
    expect(data).toEqual({ key: HOST, value: true });
    expect(reads).toEqual([`eq:${HOST}`]);
  });

  test('a rider joins from its own module: ONE .in read for both, and the rider then answers with no read', async () => {
    seed({ [HOST]: false, [RIDER]: true });
    const host = G.settingsGroup(HOST, [], TTL);
    const rider = G.settingsGroup(HOST, [RIDER], TTL);
    expect((await host.host(T0)).data).toEqual({ key: HOST, value: false });
    expect(reads).toEqual([`in:${HOST},${RIDER}`]);
    expect((await rider.rider(RIDER, T0 + 1000)).data).toEqual({ key: RIDER, value: true });
    expect(reads).toHaveLength(1);
  });

  test.each([['host row first', [HOST, RIDER]], ['rider row first', [RIDER, HOST]]])('the host answers its own row, never a rider\'s (%s)', async (_, order) => {
    seed(Object.fromEntries(order.map((k) => [k, k === RIDER])));
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    expect((await g.host(T0)).data).toEqual({ key: HOST, value: false });
    expect((await g.rider(RIDER, T0)).data).toEqual({ key: RIDER, value: true });
  });

  test('the host row absent: the host answers null (off), the rider its own row', async () => {
    seed({ [RIDER]: true });
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    expect((await g.host(T0)).data).toBeNull();
    expect((await g.rider(RIDER, T0)).data).toEqual({ key: RIDER, value: true });
    expect(reads).toEqual([`in:${HOST},${RIDER}`]);
  });

  test.each([['answers an error', 'error'], ['throws', 'throw']])('the shared read %s: the host re-reads its key ALONE and answers the same; the rider is off for ttl, with no read', async (_, how) => {
    seed({ [HOST]: true, [RIDER]: true }, { in: how });
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    expect((await g.host(T0)).data).toEqual({ key: HOST, value: true });
    expect((await g.rider(RIDER, T0)).data).toBeNull();
    expect((await g.rider(RIDER, T0 + TTL - 1)).data).toBeNull();
    expect(reads).toEqual([`in:${HOST},${RIDER}`, `eq:${HOST}`]);
  });

  test('a good shared read at T0, the shared read failing at T0 + ttl + 1: the rider never answers the T0 value', async () => {
    seed({ [HOST]: false, [RIDER]: true });
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    await g.host(T0);
    expect((await g.rider(RIDER, T0)).data).toEqual({ key: RIDER, value: true });
    seed({ [HOST]: false, [RIDER]: true }, { in: 'throw' });
    await g.host(T0 + TTL + 1);
    expect((await g.rider(RIDER, T0 + TTL + 1)).data).toBeNull();
  });
});

describe('the rider read', () => {
  test('host read at T0: the rider answers from it until T0 + ttl, then reads its own key', async () => {
    seed({ [HOST]: true, [RIDER]: true });
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    await g.host(T0);
    await g.rider(RIDER, T0 + TTL - 1);
    expect(reads).toEqual([`in:${HOST},${RIDER}`]);
    await g.rider(RIDER, T0 + TTL);
    expect(reads).toEqual([`in:${HOST},${RIDER}`, `eq:${RIDER}`]);
  });

  test('a rider\'s own read is kept for ttl', async () => {
    seed({ [RIDER]: true });
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    expect((await g.rider(RIDER, T0)).data).toEqual({ key: RIDER, value: true });
    await g.rider(RIDER, T0 + TTL - 1);
    expect(reads).toEqual([`eq:${RIDER}`]);
  });

  test('a failed own read answers an error once, then off (no row) for ttl: one read, not one per ask', async () => {
    seed({ [RIDER]: true }, { eq: [RIDER] });
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    const first = await g.rider(RIDER, T0);
    expect(first.data).toBeNull();
    expect(first.error).toEqual({ message: 'settings down' });
    expect(await g.rider(RIDER, T0 + 1)).toEqual({ data: null, error: null });
    expect(reads).toEqual([`eq:${RIDER}`]);
  });

  test('the host stale (past ttl), the rider cold: the rider reads its own row and answers the fresh value', async () => {
    seed({ [HOST]: true, [RIDER]: true });
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    await g.host(T0);
    seed({ [HOST]: true, [RIDER]: false });
    expect((await g.rider(RIDER, T0 + TTL + 1)).data).toEqual({ key: RIDER, value: false });
    expect(reads).toEqual([`eq:${RIDER}`]);
  });
});

describe('a prime from a caller that read the group in its own query', () => {
  test('(a) a prime with the whole group: the rider is seen ON with 0 reads', async () => {
    seed({});
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    const hostRow = g.prime([{ key: RIDER, value: true }, { key: HOST, value: false }], T0, [HOST, RIDER]);
    expect(hostRow).toEqual({ key: HOST, value: false });
    expect((await g.rider(RIDER, T0 + 1000)).data).toEqual({ key: RIDER, value: true });
    expect(reads).toEqual([]);
  });

  test('(b) a prime whose asked list lacks a group key throws (never a silent off), whatever rows it carries', () => {
    seed({});
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    const full = [{ key: HOST, value: true }, { key: RIDER, value: true }];
    expect(() => g.prime(full, T0, [HOST])).toThrow(/every key \(missing settings_group_rider_testwala\)/);
    expect(() => g.prime(full, T0, [RIDER])).toThrow(/missing settings_group_host_testwala/);
    for (const asked of [undefined, null, {}, 'x']) expect(() => g.prime(full, T0, asked)).toThrow(/every key/);
  });

  test('(b) a prime that throws leaves the rider unprimed: its next ask reads its own key', async () => {
    seed({ [RIDER]: false });
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    expect(() => g.prime([{ key: HOST, value: true }, { key: RIDER, value: true }], T0, [HOST])).toThrow();
    expect((await g.rider(RIDER, T0)).data).toEqual({ key: RIDER, value: false });
    expect(reads).toEqual([`eq:${RIDER}`]);
  });

  test('an asked key with no row is an absent setting: the rider answers no row (off), with no read', async () => {
    seed({});
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    expect(g.prime([{ key: HOST, value: false }], T0, [HOST, RIDER])).toEqual({ key: HOST, value: false });
    expect((await g.rider(RIDER, T0)).data).toBeNull();
    expect(reads).toEqual([]);
  });

  test('rows are taken by key, never by place', async () => {
    seed({});
    const g = G.settingsGroup(HOST, [RIDER], TTL);
    expect(g.prime([{ key: RIDER, value: true }, { key: HOST, value: false }], T0, [RIDER, HOST])).toEqual({ key: HOST, value: false });
    expect((await g.rider(RIDER, T0)).data).toEqual({ key: RIDER, value: true });
  });

  test('riders(): the keys that ride the host, joined from each module', () => {
    const a = G.settingsGroup(HOST, [], TTL);
    G.settingsGroup(HOST, [RIDER], TTL);
    expect(a.riders()).toEqual([RIDER]);
  });

  test('groupKeys: what a caller must read to prime a group', () => {
    expect(G.groupKeys(HOST)).toEqual([HOST]);
    G.settingsGroup(HOST, [], TTL);
    G.settingsGroup(HOST, [RIDER], TTL);
    expect(G.groupKeys(HOST)).toEqual([HOST, RIDER]);
  });
});
