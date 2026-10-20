'use strict';
/**
 * The big flight's bot route (/api/internal/sagame/page/:token, sa-game/routes.js + page.js; switch sa_game, default OFF).
 * Off: 404 {off:true} before the child is looked up. On: the hub's own child check (kidFromHub); no child → 401; a
 * child → their language and the game form for their grade. The internal key is required. Invented ids only.
 */
const http = require('http');
const express = require('express');

const mockOn = jest.fn();
jest.mock('../../shared/services/sa-game/flag', () => ({ on: (...a) => mockOn(...a) }));
const mockWho = jest.fn();
jest.mock('../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: (...a) => mockWho(...a) }));
const mockGrade = jest.fn();
jest.mock('../../shared/services/quiz/web-quiz-challenge', () => ({ gradeOf: (...a) => mockGrade(...a) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const { createRouter } = require('../../shared/services/sa-game/routes');
const Page = require('../../shared/services/sa-game/page');

let server;
let base;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'test-key';
  const app = express();
  app.use('/api/internal/sagame', createRouter());
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/internal/sagame`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { mockOn.mockReset(); mockWho.mockReset(); mockGrade.mockReset().mockResolvedValue(3); });

const get = (path, key = 'test-key') => fetch(base + path, { headers: { 'x-api-key': key, 'x-wq-device': 'dev-1' } });

test('no key: 401, nothing read', async () => {
  const r = await get('/page/tok.sig?kid=0123456789abcdef', 'wrong');
  expect(r.status).toBe(401);
  expect(mockOn).not.toHaveBeenCalled();
});

test('switch off: 404 {off:true}, the child is never looked up', async () => {
  mockOn.mockResolvedValue(false);
  const r = await get('/page/tok.sig?kid=0123456789abcdef');
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ off: true });
  expect(mockWho).not.toHaveBeenCalled();
});

test('on, a link that is not a child on this phone: 401', async () => {
  mockOn.mockResolvedValue(true);
  mockWho.mockResolvedValue(null);
  const r = await get('/page/tok.sig?kid=0123456789abcdef');
  expect(r.status).toBe(401);
  expect(mockWho).toHaveBeenCalledWith('tok.sig', '0123456789abcdef', 'dev-1');
});

test('on, a child: language and the form for the grade, no id or name', async () => {
  mockOn.mockResolvedValue(true);
  mockWho.mockResolvedValue({ studentId: 'kid-1', grade: '3', lang: 'ur', rootId: null });
  const r = await get('/page/tok.sig?kid=0123456789abcdef');
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, lang: 'ur', grade: '3', form: 'game.G23' });
  const en = await (await get('/page/tok.sig?kid=0123456789abcdef&lang=en')).json();
  expect(en.lang).toBe('en');
});

test('a thrown read: 503, never a 500', async () => {
  mockOn.mockResolvedValue(true);
  mockWho.mockRejectedValue(new Error('db down'));
  const r = await get('/page/tok.sig?kid=0123456789abcdef');
  expect(r.status).toBe(503);
});

test('formOf: the Challenge bands; unknown or outside 1–5 has no form', () => {
  expect(Page.formOf('1')).toBe('game.G1');
  expect(Page.formOf('2')).toBe('game.G23');
  expect(Page.formOf(3)).toBe('game.G23');
  expect(Page.formOf('5')).toBe('game.G45');
  expect(Page.formOf('6')).toBeNull();
  expect(Page.formOf(null)).toBeNull();
  expect(Page.formOf('')).toBeNull();
});

test('the grade is the Challenge\'s server-side chain, not the hub\'s; unknown or outside 1–5: 403 not_eligible', async () => {
  mockOn.mockResolvedValue(true);
  mockWho.mockResolvedValue({ studentId: 'kid-1', grade: '3', lang: 'en' });
  mockGrade.mockResolvedValue(5);
  expect((await (await get('/page/tok.sig?kid=0123456789abcdef')).json()).form).toBe('game.G45');
  expect(mockGrade).toHaveBeenCalledWith({ studentId: 'kid-1' });
  for (const g of [null, 6]) {
    mockGrade.mockResolvedValue(g);
    const r = await get('/page/tok.sig?kid=0123456789abcdef');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'not_eligible', lang: 'en' });
  }
});
