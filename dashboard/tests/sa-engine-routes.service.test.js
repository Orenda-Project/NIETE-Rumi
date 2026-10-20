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
    expect((await fetch(`${base}/sa/nope.js`)).status).toBe(299);
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
