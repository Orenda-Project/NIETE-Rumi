'use strict';
/**
 * The Urdu narrations voiced with tashdeed (app_settings sa_voice_tashdeed, OFF by default). ON together with
 * sa_voice_v2, an Urdu clip that has a tashdeed take on disk (sa/v3/ur/<key>.mp3, same voice, same key) is served from
 * sa/v3/ur/; every other key stays as sa_voice_v2 serves it. OFF, or with sa_voice_v2 OFF, nothing changes.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createSaEngineRouter, VOICE_TASHDEED_KEY } = require('../routes/sa-engine.routes');

const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const DASH = path.join(__dirname, '..');
const NAMES = fs.readdirSync(BATTERIES).filter((n) => /^sa\.(coach|game)\..+\.(en|ur)\.json$/.test(n));
const V3 = path.join(DASH, 'sa', 'v3', 'ur');
const TAKES = new Set(fs.existsSync(V3) ? fs.readdirSync(V3).filter((n) => /^[0-9a-f]{12}\.mp3$/.test(n)) : []);

async function serve({ v2, tashdeed }) {
  const app = express();
  app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: () => true, passageRotation: () => true, voiceV2: () => v2, voiceTashdeed: () => tashdeed }));
  app.use((req, res) => res.status(299).send('after'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

async function battery(base, name) {
  const res = await fetch(`${base}/sa/batteries/${name}`);
  expect(res.status).toBe(200);
  return res.text();
}

test('the switch is app_settings sa_voice_tashdeed', () => {
  expect(VOICE_TASHDEED_KEY).toBe('sa_voice_tashdeed');
});

test('there are tashdeed takes on disk', () => {
  expect(TAKES.size).toBeGreaterThanOrEqual(10);
});

test('OFF, or ON without sa_voice_v2: every battery is served exactly as without the switch', async () => {
  for (const v2 of [true, false]) {
    const plain = await serve({ v2, tashdeed: false });
    const on = await serve({ v2: false, tashdeed: true });
    try {
      for (const name of NAMES) {
        const a = await battery(plain.base, name);
        expect(a).not.toMatch(/"sa\/v3\//);
        if (!v2) expect(await battery(on.base, name)).toBe(a);
      }
    } finally { plain.srv.close(); on.srv.close(); }
  }
});

test('ON with sa_voice_v2: exactly the Urdu keys with a take move to sa/v3/ur, the rest is the v2 battery', async () => {
  const v2 = await serve({ v2: true, tashdeed: false });
  const on = await serve({ v2: true, tashdeed: true });
  let moved = 0;
  try {
    for (const name of NAMES) {
      const before = await battery(v2.base, name);
      const text = await battery(on.base, name);
      for (const m of text.matchAll(/"sa\/v3\/(en|ur)\/([0-9a-f]{12}\.mp3)"/g)) {
        expect(m[1]).toBe('ur');
        expect(TAKES.has(m[2])).toBe(true);
        moved += 1;
      }
      for (const m of text.matchAll(/"sa\/v2\/ur\/([0-9a-f]{12}\.mp3)"/g)) expect(TAKES.has(m[1])).toBe(false);
      expect(text.replace(/"sa\/v3\/ur\//g, '"sa/v2/ur/')).toBe(before);
    }
    expect(moved).toBeGreaterThan(0);
  } finally { v2.srv.close(); on.srv.close(); }
});

test('every tashdeed take is served as audio', async () => {
  const { srv, base } = await serve({ v2: true, tashdeed: true });
  try {
    for (const n of TAKES) {
      const res = await fetch(`${base}/sa/v3/ur/${n}`);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).length).toBeGreaterThan(500);
    }
  } finally { srv.close(); }
});
