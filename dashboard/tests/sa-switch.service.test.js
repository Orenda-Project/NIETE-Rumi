'use strict';
/**
 * The SA routers' switch (routes/sa-switch.js): the house reader (web-quiz-brotli-flag.js) answers OFF until its first
 * read lands and for 30 s after any failed read. For the engine's and the game's own FILES that meant the portal's page
 * once in a while (the game hung on a script that was HTML). steady() waits for the first read and, once ON was read,
 * holds ON through a failed read for holdMs; a real OFF still lands within holdMs.
 */
const { steady } = require('../routes/sa-switch');

function reader(script) {
  // script: the values successive reads land with ('on' | 'off' | 'fail'); answers like the house reader.
  let val = false; let reading = null; let i = 0;
  const on = () => {
    if (!reading) {
      const v = script[Math.min(i++, script.length - 1)];
      reading = Promise.resolve().then(() => { val = v === 'on'; reading = null; });
    }
    return val;
  };
  on.ready = () => reading || Promise.resolve();
  return on;
}

test('a cold reader: the first request waits for the first read', async () => {
  const s = steady(reader(['on']));
  expect(await s.whenReady()).toBe(true);
});

test('ON once read, a failed read (OFF for 30 s in the house reader) does not flap within the hold', async () => {
  let t = 0;
  const r = reader(['on', 'fail', 'fail']);
  const s = steady(r, { holdMs: 60000, now: () => t });
  expect(await s.whenReady()).toBe(true);
  t = 31000; r(); await r.ready();
  expect(r()).toBe(false); // the house reader flaps
  expect(s()).toBe(true); // ours holds
});

test('a real OFF lands once the hold has passed', async () => {
  let t = 0;
  const r = reader(['on', 'off', 'off']);
  const s = steady(r, { holdMs: 60000, now: () => t });
  await s.whenReady();
  t = 50000; r(); await r.ready();
  expect(s()).toBe(true);
  t = 70000;
  expect(s()).toBe(false);
});

test('never ON: OFF from the start (the OFF path is unchanged)', async () => {
  const s = steady(reader(['off']));
  expect(await s.whenReady()).toBe(false);
  expect(s()).toBe(false);
});

describe('both SA routers serve their own files through a flapping reader, never the portal\'s page', () => {
  const express = require('express');
  const { createSaEngineRouter } = require('../routes/sa-engine.routes');
  const { createSaGameRouter } = require('../routes/sa-game.routes');

  async function serve(router) {
    const app = express();
    app.use(router);
    app.use((req, res) => res.status(299).type('html').send('<!doctype html>portal'));
    const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    return { srv, base: `http://127.0.0.1:${srv.address().port}` };
  }
  // ON, then every other read fails (the house reader then answers OFF for a while)
  function flappy() {
    let n = 0; let val = false; let reading = null;
    const on = () => { if (!reading) reading = Promise.resolve().then(() => { val = n++ % 2 === 0; reading = null; }); return val; };
    on.ready = () => reading || Promise.resolve();
    return on;
  }

  test('engine /sa/*: 20 requests, every one the file', async () => {
    const { srv, base } = await serve(createSaEngineRouter({ on: flappy() }));
    try {
      const types = [];
      for (let i = 0; i < 20; i++) { const r = await fetch(`${base}/sa/sa-core.js`); types.push(`${r.status} ${(r.headers.get('content-type') || '').split(';')[0]}`); }
      expect(new Set(types)).toEqual(new Set(['200 application/javascript']));
    } finally { srv.close(); }
  });

  test('game /sa-game/a/game.js: 20 requests, every one the script', async () => {
    const { srv, base } = await serve(createSaGameRouter({ on: flappy(), botUrl: 'http://bot.invalid', apiKey: 'k', fetchImpl: async () => { throw new Error('no bot'); } }));
    try {
      const types = [];
      for (let i = 0; i < 20; i++) { const r = await fetch(`${base}/sa-game/a/game.js?v=1`); types.push(`${r.status} ${(r.headers.get('content-type') || '').split(';')[0]}`); }
      expect(new Set(types)).toEqual(new Set(['200 application/javascript']));
    } finally { srv.close(); }
  });
});

test('the game router: ON then OFF for more than the hold → the portal answers again (a real flip lands)', async () => {
  const express = require('express');
  const { createSaGameRouter } = require('../routes/sa-game.routes');
  let val = true; let t = 0;
  const on = () => val;
  const app = express();
  app.use(createSaGameRouter({ on, now: () => t, botUrl: 'http://bot.invalid', apiKey: 'k', fetchImpl: async () => { throw new Error('x'); } }));
  app.use((req, res) => res.status(299).send('portal'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    expect((await fetch(`${base}/sa-game/a/game.js`)).status).toBe(200);
    val = false; t = 30000;
    expect((await fetch(`${base}/sa-game/a/game.js`)).status).toBe(200); // within the hold: still the script
    t = 61000;
    expect((await fetch(`${base}/sa-game/a/game.js`)).status).toBe(299); // past it: OFF is real
  } finally { srv.close(); }
});
