'use strict';
/**
 * The nightly's run lock, unit level (bd-sex15q.19 session 2a). The pooler behaviour itself is proven against a real
 * pgbouncer in run-lock-pooler.service.test.js (scripts/coachip_lock_harness.sh); this file pins the statements and the
 * release path so CI catches a regression without a server.
 */
const cli = require('../../jobs/coachip-nightly');
const store = require('../../lib/insights/store');

function fakePg({ locked = true, failAfter = Infinity } = {}) {
  const sql = [];
  const { EventEmitter } = require('events');
  return Object.assign(new EventEmitter(), {
    sql,
    query: jest.fn(async (text) => {
      sql.push(text);
      if (sql.length > failAfter) throw new Error('connection lost');
      if (/advisory/.test(text)) return { rows: [{ ok: locked }] };
      return { rows: [] };
    }),
  });
}

afterEach(() => { jest.useRealTimers(); });

describe('acquireLock', () => {
  test('takes a transaction-scoped lock inside an open transaction, never a session lock or a session SET', async () => {
    const pg = fakePg();
    const lock = await store.acquireLock(pg);
    expect(lock).toEqual({ release: expect.any(Function) });
    expect(pg.sql).toEqual(['BEGIN', "SELECT pg_try_advisory_xact_lock(hashtext('coachip-nightly')) AS ok"]);
    await lock.release();
    expect(pg.sql[2]).toBe('ROLLBACK');
    expect(pg.sql.join(';')).not.toMatch(/pg_try_advisory_lock\(|\bSET\b/i);
  });

  test('held elsewhere: ends its transaction and answers null', async () => {
    const pg = fakePg({ locked: false });
    expect(await store.acquireLock(pg)).toBe(null);
    expect(pg.sql).toEqual(['BEGIN', expect.stringMatching(/pg_try_advisory_xact_lock/), 'ROLLBACK']);
  });

  test('a heartbeat keeps the transaction busy and reports a lost connection once', async () => {
    jest.useFakeTimers();
    const pg = fakePg({ failAfter: 3 });
    const onLost = jest.fn();
    const lock = await store.acquireLock(pg, { heartbeatMs: 1000, onLost });
    jest.advanceTimersByTime(1000);
    await Promise.resolve(); await Promise.resolve();
    expect(pg.sql[2]).toBe('SELECT 1');
    jest.advanceTimersByTime(2000);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(onLost).toHaveBeenCalledTimes(1);
    const before = pg.sql.length;
    await lock.release();
    expect(pg.sql.length).toBe(before); // nothing to roll back on a dead connection
  });

  test("the connection's 'error' event (a dropped lock connection) is reported once, never thrown", async () => {
    const pg = fakePg();
    const onLost = jest.fn();
    const lock = await store.acquireLock(pg, { onLost });
    expect(() => pg.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
    pg.emit('error', new Error('again'));
    expect(onLost).toHaveBeenCalledTimes(1);
    await lock.release();
  });
});

describe('withRunLock (the nightly CLI)', () => {
  test('runs the job and releases the lock after it', async () => {
    const pg = fakePg();
    const fn = jest.fn(async () => 0);
    expect(await cli.withRunLock(pg, () => {}, fn)).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(pg.sql[pg.sql.length - 1]).toBe('ROLLBACK');
  });

  test('another run holds it: exit 4, "already running", the job never starts', async () => {
    const pg = fakePg({ locked: false });
    const lines = [];
    const fn = jest.fn(async () => 0);
    expect(await cli.withRunLock(pg, (m) => lines.push(m), fn)).toBe(4);
    expect(fn).not.toHaveBeenCalled();
    expect(lines).toEqual(['already running']);
  });

  test('a job that throws still releases the lock, and the error reaches the caller', async () => {
    const pg = fakePg();
    await expect(cli.withRunLock(pg, () => {}, async () => { throw new Error('stage failed'); })).rejects.toThrow('stage failed');
    expect(pg.sql[pg.sql.length - 1]).toBe('ROLLBACK');
  });
});
