'use strict';
/**
 * Round 8, sa_r8_switch_hold: a failed switch read keeps the last value read (routes/web-quiz-brotli-flag.js keepOnError),
 * so a database outage longer than the reader's 30 s + sa-switch.js's 60 s hold no longer serves a battery with the
 * content switches OFF (no passage variants, the v1 voice set). The service worker keeps that battery for every later
 * child on the phone, so one outage cost a whole morning of rotation.
 *
 * Only the database client is mocked; the router's own default readers do the reads.
 */
const express = require('express');

const mockStore = { sa_engine: true, sa_passage_rotation: true, sa_voice_v2: true };
let mockDown = null; // null: the database answers; 'throw' | 'error': every read fails that way
jest.mock('../config/supabase', () => ({
  from: () => {
    const q = { _key: null };
    q.select = () => q;
    q.eq = (_col, val) => { q._key = val; return q; };
    q.maybeSingle = async () => {
      if (mockDown === 'throw') throw new Error('connection terminated');
      if (mockDown === 'error') return { data: null, error: { message: 'timeout' } };
      return { data: q._key in mockStore ? { value: mockStore[q._key] } : null, error: null };
    };
    return q;
  },
}));

const NAME = 'sa.coach.G3.A.ur.json';
let t = 0;

async function serve() {
  jest.spyOn(Date, 'now').mockImplementation(() => t);
  const { createSaEngineRouter } = require('../routes/sa-engine.routes');
  const app = express();
  app.use(createSaEngineRouter());
  app.use((req, res) => res.status(299).send('after'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

/** One battery at clock `at`; the reads it starts land before the next. */
async function battery(base, at) {
  t = at;
  const res = await fetch(`${base}/sa/batteries/${NAME}`);
  const text = await res.text();
  await settle();
  return { status: res.status, text, switches: res.headers.get('x-sa-switches') };
}

beforeEach(() => { jest.resetModules(); t = 1e6; mockDown = null; });
afterEach(() => { jest.restoreAllMocks(); delete mockStore.sa_r8_switch_hold; });

describe.each(['throw', 'error'])('the database fails reads (%s) after the switches were read ON', (how) => {
  test('sa_r8_switch_hold ON: the battery still carries the variants and the voice set', async () => {
    mockStore.sa_r8_switch_hold = true;
    const { srv, base } = await serve();
    try {
      const first = await battery(base, t);
      expect(first.text).toMatch(/"variants"/);
      expect(first.text).toMatch(/"sa\/v2\/ur\//);
      expect(first.switches).toBe('fresh');
      mockDown = how;
      await battery(base, t + 31e3); // the reads this starts fail
      const later = await battery(base, t + 200e3); // past the reader's 30 s and the router's 60 s hold
      expect(later.status).toBe(200);
      expect(later.text).toMatch(/"variants"/);
      expect(later.text).toMatch(/"sa\/v2\/ur\//);
      expect(later.text).not.toMatch(/"sa\/v1\/ur\//);
      expect(later.switches).toBe('held');
      mockDown = null; // the database is back: the next read is fresh again
      await battery(base, t + 31e3);
      expect((await battery(base, t + 1e3)).switches).toBe('fresh');
    } finally { srv.close(); }
  });

  test('sa_r8_switch_hold absent (OFF): unchanged, the failed reads answer OFF and no header is sent', async () => {
    const { srv, base } = await serve();
    try {
      expect((await battery(base, t)).text).toMatch(/"variants"/);
      mockDown = how;
      await battery(base, t + 31e3);
      const later = await battery(base, t + 200e3);
      expect(later.text).not.toMatch(/"variants"/);
      expect(later.switches).toBeNull();
    } finally { srv.close(); }
  });
});

test('hold ON, a key with no row is a real OFF: read fresh, never held', async () => {
  mockStore.sa_r8_switch_hold = true;
  const { srv, base } = await serve();
  try {
    await battery(base, t); // the hold switch and the rest are read ON
    delete mockStore.sa_passage_rotation; // no row: the switch is OFF, and that is a successful read
    await battery(base, t + 31e3);
    const later = await battery(base, t + 200e3);
    expect(later.text).not.toMatch(/"variants"/);
    expect(later.switches).toBe('fresh');
  } finally { srv.close(); mockStore.sa_passage_rotation = true; }
});

test('keepOnError, a switch whose first read failed: OFF and state unread (nothing to keep); fresh once a read lands', async () => {
  jest.spyOn(Date, 'now').mockImplementation(() => t);
  const { createBrotliFlag } = require('../routes/web-quiz-brotli-flag');
  const on = createBrotliFlag({ key: 'sa_passage_rotation', keepOnError: () => true });
  mockDown = 'throw';
  on();
  await on.ready();
  expect(on()).toBe(false);
  expect(on.state()).toBe('unread');
  mockDown = null;
  t += 31e3;
  on();
  await on.ready();
  expect(on()).toBe(true);
  expect(on.state()).toBe('fresh');
});
