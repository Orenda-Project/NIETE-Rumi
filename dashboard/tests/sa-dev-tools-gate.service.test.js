'use strict';
/**
 * The sandbox-only "Jump to…" (RULING #43, the tester's A01) is gated on the server (routes/sa-engine.routes.js): the
 * engine's pages load sa-dev.js (window.SA_DEV_TOOLS = true) only when SA_DEV_TOOLS=sandbox AND
 * RAILWAY_ENVIRONMENT_NAME=sandbox. With a production config, either one alone, or neither, the served HTML names
 * neither the flag nor the file, and the file is a 404: the control cannot be drawn.
 */
const express = require('express');
const { createSaEngineRouter, devToolsOn } = require('../routes/sa-engine.routes');

async function serve(env) {
  const app = express();
  app.use(createSaEngineRouter({ on: () => true, env }));
  app.use((req, res) => res.status(299).send('after'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

const CLOSED = [
  ['unset', {}],
  ['production', { SA_DEV_TOOLS: 'sandbox', RAILWAY_ENVIRONMENT_NAME: 'production' }],
  ['staging', { SA_DEV_TOOLS: 'sandbox', RAILWAY_ENVIRONMENT_NAME: 'staging' }],
  ['flag only', { SA_DEV_TOOLS: 'sandbox' }],
  ['env name only', { RAILWAY_ENVIRONMENT_NAME: 'sandbox' }],
  ['flag true', { SA_DEV_TOOLS: 'true', RAILWAY_ENVIRONMENT_NAME: 'sandbox' }],
];

test.each(CLOSED)('%s: no SA_DEV_TOOLS in the pages, sa-dev.js is a 404', async (_, env) => {
  expect(devToolsOn(env)).toBe(false);
  const { srv, base } = await serve(env);
  try {
    for (const p of ['/sa/play.html', '/sa/run.html']) {
      const res = await fetch(base + p);
      const body = await res.text();
      expect([p, res.status]).toEqual([p, 200]);
      expect(body).not.toMatch(/SA_DEV_TOOLS|sa-dev\.js/);
    }
    expect((await fetch(`${base}/sa/sa-dev.js`)).status).toBe(404);
  } finally { srv.close(); }
});

test('the process env with a production config: closed', () => {
  const keys = ['SA_DEV_TOOLS', 'RAILWAY_ENVIRONMENT_NAME'];
  const keep = keys.map((k) => [k, process.env[k]]);
  try {
    process.env.SA_DEV_TOOLS = 'sandbox';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    expect(devToolsOn()).toBe(false);
  } finally {
    keep.forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
});

test('both set to sandbox: the pages load sa-dev.js first, and it sets the flag', async () => {
  const env = { SA_DEV_TOOLS: 'sandbox', RAILWAY_ENVIRONMENT_NAME: 'sandbox' };
  expect(devToolsOn(env)).toBe(true);
  const { srv, base } = await serve(env);
  try {
    for (const p of ['/sa/play.html', '/sa/run.html']) {
      const res = await fetch(base + p);
      expect(res.headers.get('content-type')).toMatch(/html/);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      const body = await res.text();
      const at = body.indexOf('<script src="./sa-dev.js"></script>');
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(body.indexOf('./sa-core.js'));
    }
    const js = await fetch(`${base}/sa/sa-dev.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(await js.text()).toBe('window.SA_DEV_TOOLS = true;\n');
  } finally { srv.close(); }
});

test('switch off: the gate never answers, everything falls through', async () => {
  const app = express();
  app.use(createSaEngineRouter({ on: () => false, env: { SA_DEV_TOOLS: 'sandbox', RAILWAY_ENVIRONMENT_NAME: 'sandbox' } }));
  app.use((req, res) => res.status(299).send('after'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    for (const p of ['/sa/play.html', '/sa/sa-dev.js']) expect((await fetch(`http://127.0.0.1:${srv.address().port}${p}`)).status).toBe(299);
  } finally { srv.close(); }
});
