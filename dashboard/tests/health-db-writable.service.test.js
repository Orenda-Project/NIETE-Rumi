'use strict';
/**
 * bd-sex15q.19 (fix-r5; SPEC v2.1 §11.5, lander 230600/230605): GET /health gains `db_writable`. On 26 Oct a session
 * `SET default_transaction_read_only = on` through the 6543 pooler made sandbox read-only for 23 minutes while /health
 * stayed 200. The check: SELECT current_setting('default_transaction_read_only'), then a BEGIN; SET LOCAL …; ROLLBACK
 * round trip (never a session SET). Every other key of the body is unchanged (SPEC §6 golden).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { healthHandler, dbWritable } = require('../lib/health');

/** A pg-Pool look-alike: records every statement; `ro` is what current_setting answers; `fail` throws on connect. */
function fakePool({ ro = 'off', txRo = ro, fail = false, hang = false } = {}) {
  const sent = [];
  let released = 0;
  return {
    sent,
    get released() { return released; },
    async connect() {
      if (fail) throw new Error('connect ECONNREFUSED');
      if (hang) return new Promise(() => {});
      let inTx = false;
      return {
        async query(sql) {
          sent.push(sql);
          if (/^BEGIN/i.test(sql)) inTx = true;
          if (/^ROLLBACK/i.test(sql)) inTx = false;
          if (/current_setting\('default_transaction_read_only'\)/.test(sql)) return { rows: [{ v: ro }] };
          if (/current_setting\('transaction_read_only'\)/.test(sql)) return { rows: [{ v: inTx ? txRo : ro }] };
          return { rows: [] };
        },
        release() { released += 1; },
      };
    },
  };
}

function serve(pool) {
  const app = express();
  app.get('/health', healthHandler({ pool, versionFile: path.join(__dirname, 'no-such-VERSION'), timeoutMs: 200 }));
  return new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
}
function get(srv) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: '/health' }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(t) }));
    }).on('error', reject);
  });
}

describe('dbWritable', () => {
  test('a writable database → true; the statements are a read and a SET LOCAL inside a rolled-back transaction, never a session SET', async () => {
    const pool = fakePool();
    await expect(dbWritable(pool)).resolves.toBe(true);
    expect(pool.sent[0]).toMatch(/current_setting\('default_transaction_read_only'\)/);
    expect(pool.sent).toContain('BEGIN');
    expect(pool.sent).toContain('SET LOCAL default_transaction_read_only = on');
    expect(pool.sent[pool.sent.length - 1]).toBe('ROLLBACK');
    for (const s of pool.sent) expect(s).not.toMatch(/^SET (?!LOCAL)/i);
    expect(pool.released).toBe(1);
  });
  test('a poisoned backend or a read-only database (default_transaction_read_only = on) → false', async () => {
    await expect(dbWritable(fakePool({ ro: 'on' }))).resolves.toBe(false);
  });
  test('a new transaction that opens read-only → false', async () => {
    await expect(dbWritable(fakePool({ ro: 'off', txRo: 'on' }))).resolves.toBe(false);
  });
  test('no pool, a connect error or a hang past the timeout → false, never a throw', async () => {
    await expect(dbWritable(null)).resolves.toBe(false);
    await expect(dbWritable(fakePool({ fail: true }))).resolves.toBe(false);
    await expect(dbWritable(fakePool({ hang: true }), { timeoutMs: 50 })).resolves.toBe(false);
  });
});

describe('GET /health', () => {
  const OLD_KEYS = ['status', 'service', 'version', 'uptime', 'timestamp', 'environment'];
  test('the old body is unchanged and db_writable is added (true)', async () => {
    const srv = await serve(fakePool());
    try {
      const res = await get(srv);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual([...OLD_KEYS, 'db_writable']);
      expect(res.body).toMatchObject({ status: 'healthy', service: 'Rumi Dashboard', version: '2.1.0', environment: process.env.NODE_ENV || 'development', db_writable: true });
      expect(typeof res.body.uptime).toBe('number');
    } finally { srv.close(); }
  });
  test('a read-only database → still 200 healthy (the deploy proof reads the key), db_writable false', async () => {
    const srv = await serve(fakePool({ ro: 'on' }));
    try {
      const res = await get(srv);
      expect([res.status, res.body.status, res.body.db_writable]).toEqual([200, 'healthy', false]);
    } finally { srv.close(); }
  });
  test('index.js mounts this handler on /health with the dashboard pool (the server itself cannot load in a test)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    expect(src).toMatch(/app\.get\('\/health', healthHandler\(\{ pool: require\('\.\/config\/database'\)/);
    expect(src).not.toMatch(/app\.get\('\/health', \(req, res\) =>/);
  });
});
