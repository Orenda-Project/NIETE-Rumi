'use strict';
/**
 * The content and voice switches on a cold start (routes/sa-engine.routes.js): sa_practice_all_maths,
 * sa_passage_rotation and sa_voice_v2 are read like sa_engine (routes/sa-switch.js steady + warm), so the first battery
 * after a restart is served with the switches' stored values, never the reader's "false until the first read lands".
 * The engine keeps the first battery offline, so a cold miss would last the whole session.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createSaEngineRouter } = require('../routes/sa-engine.routes');
const { applySwitches } = require('../routes/sa-battery-switches');

const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const NAME = 'sa.coach.G3.A.ur.json';

/** A house-style reader: answers false until its first read lands (on.ready()), then the stored value. */
function coldReader(stored, ms = 30) {
  let val = false;
  let job = null;
  const on = () => {
    if (!job) job = new Promise((r) => setTimeout(() => { val = stored; r(); }, ms));
    return val;
  };
  on.ready = () => job || Promise.resolve();
  return on;
}

async function serve(opts) {
  const app = express();
  app.use(createSaEngineRouter(opts));
  app.use((req, res) => res.status(299).send('after'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

test('a fresh router with the three keys true in the store serves sa/v2 keys and practice on the first request', async () => {
  const { srv, base } = await serve({
    on: coldReader(true), practiceAllMaths: coldReader(true), passageRotation: coldReader(true), voiceV2: coldReader(true),
  });
  try {
    const res = await fetch(`${base}/sa/batteries/${NAME}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const want = JSON.stringify(applySwitches(JSON.parse(fs.readFileSync(path.join(BATTERIES, NAME), 'utf8')), { practiceAllMaths: true, passageRotation: true }))
      .replace(/"sa\/v1\/(en|ur)\//g, '"sa/v2/$1/');
    expect(text).not.toMatch(/"sa\/v1\/(en|ur)\//);
    expect(text).toBe(want);
  } finally { srv.close(); }
});

test('the three keys false in the store: the first request is served exactly as the file with the switches off', async () => {
  const { srv, base } = await serve({
    on: coldReader(true), practiceAllMaths: coldReader(false), passageRotation: coldReader(false), voiceV2: coldReader(false),
  });
  try {
    const res = await fetch(`${base}/sa/batteries/${NAME}`);
    const want = applySwitches(JSON.parse(fs.readFileSync(path.join(BATTERIES, NAME), 'utf8')), { practiceAllMaths: false, passageRotation: false });
    expect(await res.json()).toEqual(want);
  } finally { srv.close(); }
});
