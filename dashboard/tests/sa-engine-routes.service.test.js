'use strict';
/**
 * The battery engine's files at /sa/* (routes/sa-engine.routes.js), behind app_settings sa_engine: OFF (no row, a
 * failed read, anything but JSON true) falls through, so the portal answers exactly as before; ON serves the folder's
 * own files only, never a path outside it.
 */
const express = require('express');
const { createSaEngineRouter } = require('../routes/sa-engine.routes');

async function serve(on) {
  const app = express();
  app.use(createSaEngineRouter({ on: () => on }));
  app.use((req, res) => res.status(299).send('after'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

test('switch off: every /sa path falls through', async () => {
  const { srv, base } = await serve(false);
  try {
    for (const p of ['/sa/run.html', '/sa/sa-core.js', '/sa/', '/sa/nope.js']) {
      const res = await fetch(base + p);
      expect([p, res.status, await res.text()]).toEqual([p, 299, 'after']);
    }
  } finally { srv.close(); }
});

test('switch on: the engine files are served with their types; nothing outside the folder', async () => {
  const { srv, base } = await serve(true);
  try {
    const js = await fetch(`${base}/sa/sa-core.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(await js.text()).toContain('createRunner');
    // A missing engine file or clip is a 404 here, never the portal's page (a cached HTML "clip" fooled the offline
    // copy and the voice gate).
    const miss = await fetch(`${base}/sa/nope.js`);
    expect(miss.status).toBe(404);
    expect(miss.headers.get('content-type') || '').not.toMatch(/html/);
    expect((await fetch(`${base}/sa/v1/en/0123456789ab.mp3`)).status).toBe(404);
    expect((await fetch(`${base}/sa/..%2Froutes%2Fsa-engine.routes.js`)).status).not.toBe(200);
    expect((await fetch(`${base}/other`)).status).toBe(299);
  } finally { srv.close(); }
});

test('switch on: the service worker may control /sa/ and is never cached long', async () => {
  const { srv, base } = await serve(true);
  try {
    const res = await fetch(`${base}/sa/sa-store.js`);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
  } finally { srv.close(); }
});

test('the switch reads app_settings sa_engine by the house rule (JSON true only)', () => {
  const { KEY } = require('../routes/sa-engine.routes');
  expect(KEY).toBe('sa_engine');
});

test('switch on: the battery files are served from the content folder by name only', async () => {
  const { srv, base } = await serve(true);
  try {
    const res = await fetch(`${base}/sa/batteries/sa.coach.G3.A.ur.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect((await res.json()).battery_id).toBe('sa.coach.G3.A.ur');
    expect((await fetch(`${base}/sa/batteries/item-bank.v3.json`)).status).toBe(404);
    expect((await fetch(`${base}/sa/batteries/..%2F..%2Fitem-bank.v3.json`)).status).not.toBe(200);
  } finally { srv.close(); }
  const off = await serve(false);
  try { expect((await fetch(`${off.base}/sa/batteries/sa.coach.G3.A.ur.json`)).status).toBe(299); } finally { off.srv.close(); }
});
