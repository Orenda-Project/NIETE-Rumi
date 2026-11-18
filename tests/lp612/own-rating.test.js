'use strict';
/**
 * bd-snkn32.11 (queue #134 C) — her rating of her own plan: 1-5 and, optionally, what was confusing (max 300 chars).
 * Saved on her own plan's row only (by id AND her user id, ready plans only); a shelf plan opened by someone else, or a
 * plan still being made, is not_found. The service with a fake query builder; the route over real Express.
 */
const http = require('http');
const express = require('express');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/middleware/require-internal-key', () => ({ requireInternalKey: (_q, _s, n) => n() }));

const { createOwnRating, parseRating } = require('../../bot/shared/services/lp612-own-rating');

function fakeFrom(answer = { data: [{ id: 'own-1' }], error: null }) {
  const calls = { update: null, eq: [], table: null };
  const b = {
    update: (v) => { calls.update = v; return b; },
    eq: (k, v) => { calls.eq.push([k, v]); return b; },
    select: () => Promise.resolve(answer),
  };
  return { calls, from: (t) => { calls.table = t; return b; } };
}
const NOW = '2026-11-18T06:00:00.000Z';

describe('parseRating', () => {
  it('a whole number 1-5, the note trimmed and capped; empty note is null', () => {
    expect(parseRating({ rating: 4, confusing: '  the We Do  ' })).toEqual({ rating: 4, confusing: 'the We Do' });
    expect(parseRating({ rating: '5', confusing: '' })).toEqual({ rating: 5, confusing: null });
    expect(parseRating({ rating: 3, confusing: 'x'.repeat(400) }).confusing).toHaveLength(300);
  });
  it.each([[0], [6], [2.5], ['four'], [null], [undefined]])('%p is not a rating', (rating) => {
    expect(parseRating({ rating })).toBeNull();
  });
});

describe('rate', () => {
  it('updates her ready plan by id AND her user id, with when', async () => {
    const f = fakeFrom();
    const out = await createOwnRating({ from: f.from, now: () => NOW }).rate('own-1', 'u1', { rating: 4, confusing: 'the We Do' });
    expect(out).toEqual({ outcome: 'saved' });
    expect(f.calls.table).toBe('niete_lp612_own_plans');
    expect(f.calls.update).toEqual({ teacher_rating: 4, teacher_confusing: 'the We Do', teacher_rated_at: NOW, updated_at: NOW });
    expect(f.calls.eq).toEqual([['id', 'own-1'], ['user_id', 'u1'], ['status', 'ready']]);
  });
  it('not hers, not ready, or no such plan: not_found', async () => {
    const f = fakeFrom({ data: [], error: null });
    expect(await createOwnRating({ from: f.from, now: () => NOW }).rate('own-1', 'u2', { rating: 4 })).toEqual({ outcome: 'not_found' });
  });
  it('a bad rating or no user: bad_request, nothing written', async () => {
    const f = fakeFrom();
    const r = createOwnRating({ from: f.from, now: () => NOW });
    expect(await r.rate('own-1', 'u1', { rating: 9 })).toEqual({ outcome: 'bad_request' });
    expect(await r.rate('own-1', '', { rating: 3 })).toEqual({ outcome: 'bad_request' });
    expect(f.calls.update).toBeNull();
  });
  it('a database error: error (never a throw)', async () => {
    const f = fakeFrom({ data: null, error: { message: 'boom' } });
    expect(await createOwnRating({ from: f.from, now: () => NOW, log: jest.fn() }).rate('own-1', 'u1', { rating: 2 })).toEqual({ outcome: 'error' });
  });
});

describe('POST /api/internal/lp612/own/:ownId/rating', () => {
  let srv; let rate;
  beforeEach(async () => {
    jest.resetModules();
    rate = jest.fn(async () => ({ outcome: 'saved' }));
    jest.doMock('../../bot/shared/services/lp612-own-rating', () => ({ ...jest.requireActual('../../bot/shared/services/lp612-own-rating'), rate: (...a) => rate(...a) }));
    const a = express(); a.use(express.json());
    a.use('/api/internal', require('../../bot/shared/routes/internal-lp612-own-rating.routes'));
    srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  });
  afterEach(async () => new Promise((r) => srv.close(r)));
  const post = (body, id = 'own-1') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: `/api/internal/lp612/own/${id}/rating`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s) }));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });

  it('saved → 200, with her user id from the body the portal set', async () => {
    expect(await post({ userId: 'u1', rating: 5, confusing: 'n' })).toEqual({ status: 200, body: { success: true } });
    expect(rate).toHaveBeenCalledWith('own-1', 'u1', { rating: 5, confusing: 'n' });
  });
  it.each([['bad_request', 400], ['not_found', 404], ['error', 500]])('%s → %i', async (outcome, status) => {
    rate.mockResolvedValue({ outcome });
    expect((await post({ userId: 'u1', rating: 5 })).status).toBe(status);
  });
});
