'use strict';
/**
 * bd-snkn32.20 — GET /api/internal/lp612/own/mine?userId=&keys=a,b: her plans for these lessons. Real Express over
 * HTTP, the service stubbed. No user or no lessons is a 400; a throw is a 500 and never a list.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const mockListMine = jest.fn();
jest.mock('../../bot/shared/services/lp-own-mine', () => ({
  ...jest.requireActual('../../bot/shared/services/lp-own-mine'),
  listMineLive: (...a) => mockListMine(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let srv;
beforeEach(async () => {
  process.env = { ...ENV, INTERNAL_API_KEY: 'k' };
  mockListMine.mockReset();
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
  expect((await get('/api/internal/lp612/own/mine?userId=u1&keys=s1', 'bad')).status).toBe(401);
  expect(mockListMine).not.toHaveBeenCalled();
});

test('lists her plans for the cleaned lesson ids', async () => {
  mockListMine.mockResolvedValue([{ ownId: 'o1', lesson: 's1', changesLeft: 2 }]);
  const r = await get('/api/internal/lp612/own/mine?userId=u1&keys=s1,bad)id,s2');
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ success: true, plans: [{ ownId: 'o1', lesson: 's1', changesLeft: 2 }] });
  expect(mockListMine).toHaveBeenCalledWith({ userId: 'u1', keys: ['s1', 's2'] });
});

test('no user or no usable lesson id is a 400', async () => {
  expect((await get('/api/internal/lp612/own/mine?keys=s1')).status).toBe(400);
  expect((await get('/api/internal/lp612/own/mine?userId=u1&keys=)')).status).toBe(400);
  expect(mockListMine).not.toHaveBeenCalled();
});

test('a read failure is a 500 with no plans', async () => {
  mockListMine.mockRejectedValue(new Error('db down'));
  const r = await get('/api/internal/lp612/own/mine?userId=u1&keys=s1');
  expect(r.status).toBe(500);
  expect(r.body.plans).toBeUndefined();
});

test('"mine" is not taken as a plan id by the sections route', async () => {
  mockListMine.mockResolvedValue([]);
  expect((await get('/api/internal/lp612/own/mine?userId=u1&keys=s1')).body).toEqual({ success: true, plans: [] });
});
