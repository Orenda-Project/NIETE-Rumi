'use strict';
/**
 * bd-snkn32.5 — GET /api/internal/lp612/own/recent?userId=: "My own plans" on Lesson Plans home. Real Express over
 * HTTP, the service stubbed. No user is a 400; a throw is a 500 and never a list.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const mockRecent = jest.fn();
jest.mock('../../bot/shared/services/lp-own-recent', () => ({ listRecentLive: (...a) => mockRecent(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let srv;
beforeEach(async () => {
  process.env = { ...ENV, INTERNAL_API_KEY: 'k' };
  mockRecent.mockReset();
  const a = express();
  a.use('/api/internal', require('../../bot/shared/routes/internal-lp612-own.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
});
afterEach(async () => { await new Promise((r) => srv.close(r)); });
afterAll(() => { process.env = ENV; });

const get = (path, key = 'k') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path, agent: false, headers: { 'x-api-key': key } }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => { let body = null; try { body = s ? JSON.parse(s) : null; } catch { body = s; } resolve({ status: res.statusCode, body }); });
  }).on('error', reject);
});

test('needs the internal key', async () => {
  expect((await get('/api/internal/lp612/own/recent?userId=u1', 'bad')).status).toBe(401);
  expect(mockRecent).not.toHaveBeenCalled();
});

test('lists her recent plans', async () => {
  mockRecent.mockResolvedValue([{ ownId: 'o1', lesson: 's1', grade: 9 }]);
  const r = await get('/api/internal/lp612/own/recent?userId=u1');
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ success: true, plans: [{ ownId: 'o1', lesson: 's1', grade: 9 }] });
  expect(mockRecent).toHaveBeenCalledWith({ userId: 'u1' });
});

test('no user is a 400; a throw is a 500', async () => {
  expect((await get('/api/internal/lp612/own/recent')).status).toBe(400);
  mockRecent.mockRejectedValue(new Error('db'));
  const r = await get('/api/internal/lp612/own/recent?userId=u1');
  expect(r.status).toBe(500);
  expect(r.body.plans).toBeUndefined();
});
