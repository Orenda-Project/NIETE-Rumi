'use strict';
/**
 * The order of shared/services/first-touch/mounts.js never decides who answers: each line's own mount function, run
 * forwards and reversed (every pair swapped) on two bare apps with a marker router standing in for its routes,
 * answers every request under its mount path by that line's router alone, and a path under none falls through to
 * what is mounted after the list. (Each real router answers its switch-off 404 {off:true} under its own path.)
 */
const path = require('path');
const express = require('express');
const MOUNTS = require('../../shared/services/first-touch/mounts');

const FT = path.join(__dirname, '../../shared/services/first-touch');
const marker = (name) => { const r = express.Router(); r.use((req, res) => res.status(200).send(`${name} ${req.url}`)); return r; };

async function answers(entries) {
  const app = express();
  for (const [name, file, mount] of entries) expect(require(path.join(FT, file))[mount](app, () => marker(name))).toBe(true);
  app.use((req, res) => res.status(299).send('after the list'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const out = {};
    for (const [name, file] of entries) {
      const res = await fetch(`${base}${require(path.join(FT, file)).MOUNT_PATH}/x`);
      out[name] = { status: res.status, body: await res.text() };
    }
    const other = await fetch(`${base}/api/internal/not-a-mount/x`);
    out.other = { status: other.status, body: await other.text() };
    return out;
  } finally { srv.close(); }
}

test('forwards and reversed answer the same, each mount path by its own line', async () => {
  const fwd = await answers(MOUNTS);
  expect(await answers([...MOUNTS].reverse())).toEqual(fwd);
  for (const [name] of MOUNTS) expect(fwd[name]).toEqual({ status: 200, body: `${name} /x` });
  expect(fwd.other).toEqual({ status: 299, body: 'after the list' });
});
