'use strict';
/**
 * bd-snkn32.42 — the bot's internal doors for the shelf and the human check (internal-lp612-shelf.routes.js).
 * Real Express over HTTP, services stubbed: the routes add no rules beyond input shape and status mapping.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const mockShelf = jest.fn();
jest.mock('../../bot/shared/services/lp612-own-library', () => ({ listShelf: (...a) => mockShelf(...a) }));
const mockQueue = jest.fn();
const mockDecide = jest.fn();
const mockKey = jest.fn();
jest.mock('../../bot/shared/services/lp612-own-approval', () => ({
  listQueue: (...a) => mockQueue(...a), decide: (...a) => mockDecide(...a), reviewKey: (...a) => mockKey(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => `pub/${k}`, getPresignedUrl: jest.fn(async (u) => `signed:${u}`),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let srv;
beforeEach(async () => {
  process.env = { ...ENV, INTERNAL_API_KEY: 'k' };
  [mockShelf, mockQueue, mockDecide, mockKey].forEach((m) => m.mockReset());
  const a = express();
  a.use(express.json());
  a.use('/api/internal', require('../../bot/shared/routes/internal-lp612-shelf.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
});
afterEach(async () => { await new Promise((r) => srv.close(r)); });
afterAll(() => { process.env = ENV; });

const call = (method, path, body, key = 'k') => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : '';
  const req = http.request({
    host: '127.0.0.1', port: srv.address().port, path: `/api/internal${path}`, method, agent: false,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
  }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  });
  req.on('error', reject);
  req.end(data);
});

test('every door needs the internal key', async () => {
  expect((await call('GET', '/lp612/own/shelf?keys=a', null, 'bad')).status).toBe(401);
  expect((await call('GET', '/lp612/own/review', null, 'bad')).status).toBe(401);
  expect((await call('POST', '/lp612/own/review/o1', { reviewerId: 'r', decision: 'approve' }, 'bad')).status).toBe(401);
  expect(mockShelf).not.toHaveBeenCalled();
  expect(mockDecide).not.toHaveBeenCalled();
});

test('the shelf: the chapter lesson keys in, the approved plans out', async () => {
  mockShelf.mockResolvedValue([{ ownId: 'o1', lesson: 'L1', band: 'k5', lang: 'en' }]);
  const r = await call('GET', '/lp612/own/shelf?keys=L1,L2');
  expect(r).toEqual({ status: 200, body: { success: true, plans: [{ ownId: 'o1', lesson: 'L1', band: 'k5', lang: 'en' }] } });
  expect(mockShelf).toHaveBeenCalledWith({ keys: ['L1', 'L2'] });
  expect((await call('GET', '/lp612/own/shelf')).status).toBe(400);
  mockShelf.mockRejectedValue(new Error('x'));
  expect((await call('GET', '/lp612/own/shelf?keys=L1')).status).toBe(500);
});

test('the queue', async () => {
  mockQueue.mockResolvedValue([{ ownId: 'o1' }]);
  expect(await call('GET', '/lp612/own/review')).toEqual({ status: 200, body: { success: true, plans: [{ ownId: 'o1' }] } });
});

test('a decision maps each outcome to a status, with the reviewer from the body', async () => {
  mockDecide.mockResolvedValue({ outcome: 'ok', decision: 'approved' });
  const ok = await call('POST', '/lp612/own/review/o1', { reviewerId: 'r1', decision: 'approve', reason: 'fine' });
  expect(ok).toEqual({ status: 200, body: { success: true, decision: 'approved' } });
  expect(mockDecide).toHaveBeenCalledWith({ ownId: 'o1', reviewerId: 'r1', decision: 'approve', reason: 'fine' });
  for (const [outcome, status] of [['bad_request', 400], ['not_found', 404], ['error', 500]]) {
    mockDecide.mockResolvedValue({ outcome });
    expect((await call('POST', '/lp612/own/review/o1', { reviewerId: 'r1', decision: 'approve' })).status).toBe(status);
  }
  mockDecide.mockRejectedValue(new Error('x'));
  expect((await call('POST', '/lp612/own/review/o1', { reviewerId: 'r1', decision: 'approve' })).status).toBe(500);
});

test('the reviewer opens the PDF by a fresh presigned link; not reviewable is 404', async () => {
  mockKey.mockResolvedValue('lp612/a.pdf');
  expect(await call('GET', '/lp612/own/review/o1/file')).toEqual({ status: 200, body: { success: true, url: 'signed:pub/lp612/a.pdf' } });
  mockKey.mockResolvedValue(null);
  expect((await call('GET', '/lp612/own/review/o1/file')).status).toBe(404);
});
