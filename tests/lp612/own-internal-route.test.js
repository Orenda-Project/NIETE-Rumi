'use strict';
/**
 * bd-snkn32 — POST /api/internal/lp612/own: the portal's door to "Make my own". Real Express over HTTP, the service
 * stubbed. The route adds no rules: each service outcome maps to one status, and a throw is a 500 with no ownId.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const mockRequestOwn = jest.fn();
jest.mock('../../bot/shared/services/lp612-own.service', () => ({ requestOwn: (...a) => mockRequestOwn(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let srv;
beforeEach(async () => {
  process.env = { ...ENV, INTERNAL_API_KEY: 'k' };
  mockRequestOwn.mockReset();
  const a = express();
  a.use(express.json());
  a.use('/api/internal', require('../../bot/shared/routes/internal-lp612-own.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
});
afterEach(async () => { await new Promise((r) => srv.close(r)); });
afterAll(() => { process.env = ENV; });

const post = (body, key = 'k') => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = http.request({
    host: '127.0.0.1', port: srv.address().port, path: '/api/internal/lp612/own', method: 'POST', agent: false,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
  }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  });
  req.on('error', reject);
  req.end(data);
});

const BODY = { userId: 'u1', segmentId: 'seg', answers: { size: 'up30' }, correlationId: 'c1' };

test('needs the internal key', async () => {
  expect((await post(BODY, 'wrong')).status).toBe(401);
  expect(mockRequestOwn).not.toHaveBeenCalled();
});

test('passes user, segment, answers and correlation id through, and answers 202 with her id', async () => {
  mockRequestOwn.mockResolvedValue({ outcome: 'queued', ownId: 'own-1' });
  const out = await post(BODY);
  expect(mockRequestOwn).toHaveBeenCalledWith({ userId: 'u1', segmentId: 'seg', answers: { size: 'up30' }, correlationId: 'c1' });
  expect(out).toEqual({ status: 202, body: { success: true, state: 'authoring', renderId: 'own-1' } });
});

test.each([
  ['bad_request', 400], ['not_found', 404], ['held', 403], ['error', 500],
])('%s → %i, no id', async (outcome, status) => {
  mockRequestOwn.mockResolvedValue({ outcome, error: 'x' });
  const out = await post(BODY);
  expect(out.status).toBe(status);
  expect(out.body.success).toBe(false);
  expect(out.body.renderId).toBeUndefined();
});

test('a throw is a 500 with no id', async () => {
  mockRequestOwn.mockRejectedValue(new Error('boom'));
  const out = await post(BODY);
  expect(out.status).toBe(500);
  expect(out.body.renderId).toBeUndefined();
});

// bd-snkn32.4 — a grades 1–5 day comes as lessonId; the route passes it on and adds no rule.
test('passes a grades 1–5 lessonId through', async () => {
  mockRequestOwn.mockResolvedValue({ outcome: 'queued', ownId: 'own-k5' });
  const out = await post({ userId: 'u1', lessonId: 'grade_3_urdu_ch1_seg2', answers: { size: 'up30' } });
  expect(mockRequestOwn).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', lessonId: 'grade_3_urdu_ch1_seg2', segmentId: '' }));
  expect(out.body.renderId).toBe('own-k5');
});
