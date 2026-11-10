'use strict';
/**
 * bd-snkn32.19 (spec item 13) — GET /api/internal/lp612/own/pages?lesson_id|segment_id&from&to: her book's page text
 * for "Make my own". Real Express over HTTP; lp-own-book stubbed. The route adds no rule: each outcome is one status.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const mockPagesFor = jest.fn();
jest.mock('../../bot/shared/services/lp-own-book', () => ({ pagesFor: (...a) => mockPagesFor(...a) }));
const mockOwnSections = jest.fn();
jest.mock('../../bot/shared/services/lp-own-sections', () => ({ ownSectionsLive: (...a) => mockOwnSections(...a) }));
jest.mock('../../bot/shared/services/lp612-own.service', () => ({}));
jest.mock('../../bot/shared/services/lp612-own-change', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let srv;
beforeEach(async () => {
  process.env = { ...ENV, INTERNAL_API_KEY: 'k' };
  mockPagesFor.mockReset();
  const a = express();
  a.use('/api/internal', require('../../bot/shared/routes/internal-lp612-own.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
});
afterEach(async () => { await new Promise((r) => srv.close(r)); });
afterAll(() => { process.env = ENV; });

const get = (query, key = 'k') => new Promise((resolve, reject) => {
  http.get({
    host: '127.0.0.1', port: srv.address().port, path: `/api/internal/lp612/own/pages?${query}`, agent: false,
    headers: { 'x-api-key': key },
  }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  }).on('error', reject);
});

test('needs the internal key', async () => {
  expect((await get('lesson_id=l&from=1&to=2', 'wrong')).status).toBe(401);
  expect(mockPagesFor).not.toHaveBeenCalled();
});

test('passes the lesson and range through; 200 with her pages and the missing ones', async () => {
  mockPagesFor.mockResolvedValue({ outcome: 'ok', loaded: true, pages: [{ page: 42, text: 'Force' }], missing: [43] });
  const out = await get('lesson_id=g3_maths_d4&from=42&to=43');
  expect(mockPagesFor).toHaveBeenCalledWith({ lessonId: 'g3_maths_d4', segmentId: undefined, from: '42', to: '43' });
  expect(out).toEqual({ status: 200, body: { success: true, loaded: true, pages: [{ page: 42, text: 'Force' }], missing: [43] } });
});

test('a segment with no range; a book not loaded is still 200, loaded false', async () => {
  mockPagesFor.mockResolvedValue({ outcome: 'ok', loaded: false, pages: [], missing: [] });
  const out = await get('segment_id=grade_8_science.c01.p001-003');
  expect(mockPagesFor).toHaveBeenCalledWith({ lessonId: undefined, segmentId: 'grade_8_science.c01.p001-003', from: undefined, to: undefined });
  expect(out).toEqual({ status: 200, body: { success: true, loaded: false, pages: [], missing: [] } });
});

test.each([['bad_request', 400], ['not_found', 404]])('%s → %i', async (outcome, status) => {
  mockPagesFor.mockResolvedValue({ outcome, error: 'x' });
  const out = await get('lesson_id=l&from=1&to=20');
  expect(out.status).toBe(status);
  expect(out.body.success).toBe(false);
  expect(out.body.pages).toBeUndefined();
});

test('a throw is a 500 with no pages', async () => {
  mockPagesFor.mockRejectedValue(new Error('db down'));
  const out = await get('lesson_id=l&from=1&to=2');
  expect(out.status).toBe(500);
  expect(out.body.pages).toBeUndefined();
});

test('an over-long id is refused before the book is read', async () => {
  expect((await get(`lesson_id=${'x'.repeat(201)}&from=1&to=2`)).status).toBe(400);
  expect(mockPagesFor).not.toHaveBeenCalled();
});

describe('GET /lp612/own/:ownId/sections (spec item 7)', () => {
  const at = (path, key = 'k') => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path, agent: false, headers: { 'x-api-key': key } }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
    }).on('error', reject);
  });
  beforeEach(() => mockOwnSections.mockReset());

  test('needs the internal key and a user', async () => {
    expect((await at('/api/internal/lp612/own/o1/sections?userId=u1', 'wrong')).status).toBe(401);
    expect((await at('/api/internal/lp612/own/o1/sections')).status).toBe(400);
    expect(mockOwnSections).not.toHaveBeenCalled();
  });
  test('200 with her cards; not hers or not ready is 404', async () => {
    mockOwnSections.mockResolvedValueOnce({ outcome: 'ok', band: 'k5', changed: null, sections: [{ part: 'hook', text: 'Sing' }] });
    const ok = await at('/api/internal/lp612/own/o1/sections?userId=u1');
    expect(mockOwnSections).toHaveBeenCalledWith({ ownId: 'o1', userId: 'u1' });
    expect(ok).toEqual({ status: 200, body: { success: true, band: 'k5', changed: null, sections: [{ part: 'hook', text: 'Sing' }] } });
    mockOwnSections.mockResolvedValueOnce({ outcome: 'not_found' });
    expect((await at('/api/internal/lp612/own/o1/sections?userId=u2')).status).toBe(404);
    mockOwnSections.mockRejectedValueOnce(new Error('r2 down'));
    expect((await at('/api/internal/lp612/own/o1/sections?userId=u1')).status).toBe(500);
  });
});
