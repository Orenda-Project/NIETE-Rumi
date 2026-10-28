'use strict';
/**
 * The reviewed voice set (app_settings sa_voice_v4, OFF by default). ON, every clip key a battery carries is served from
 * sa/v4/<lang>/, whatever sa_voice_v2 and sa_voice_tashdeed say, and every one of them has its clip on disk. OFF, the
 * battery is exactly what sa_voice_v2 / sa_voice_tashdeed serve today, and every key it carries has a clip on disk too
 * (a line the reviewers changed has a new key, recorded in today's voices as well).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createSaEngineRouter, VOICE_V4_KEY } = require('../routes/sa-engine.routes');
const { SWITCHES } = require('../routes/sa-battery-switches');

const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const DASH = path.join(__dirname, '..');
const NAMES = fs.readdirSync(BATTERIES).filter((n) => /^sa\.(coach|game)\..+\.(en|ur)\.json$/.test(n));
const ALL_ON = Object.fromEntries(Object.keys(SWITCHES).map((k) => [k, () => true]));
const ALL_OFF = Object.fromEntries(Object.keys(SWITCHES).map((k) => [k, () => false]));

async function serve({ v2, tashdeed, v4, content }) {
  const app = express();
  app.use(createSaEngineRouter({ on: () => true, ...content, voiceV2: () => v2, voiceTashdeed: () => tashdeed,
    ...(v4 === undefined ? {} : { voiceV4: () => v4 }) }));
  app.use((req, res) => res.status(299).send('after'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

async function battery(base, name) {
  const res = await fetch(`${base}/sa/batteries/${name}`);
  expect(res.status).toBe(200);
  return res.text();
}
const keysOf = (text) => [...new Set(text.match(/sa\/v\d\/(en|ur)\/[0-9a-f]{12}\.mp3/g) || [])];

test('the switch is app_settings sa_voice_v4', () => {
  expect(VOICE_V4_KEY).toBe('sa_voice_v4');
});

test('OFF: every battery is served exactly as sa_voice_v2 / sa_voice_tashdeed serve it today', async () => {
  for (const [v2, tashdeed] of [[true, true], [true, false], [false, false]]) {
    const today = await serve({ v2, tashdeed, content: ALL_ON });
    const off = await serve({ v2, tashdeed, v4: false, content: ALL_ON });
    try {
      for (const name of NAMES) expect(await battery(off.base, name)).toBe(await battery(today.base, name));
    } finally { today.srv.close(); off.srv.close(); }
  }
});

test('ON: every clip key moves to sa/v4/<lang>/ and nothing else changes, whatever v2 and tashdeed say', async () => {
  for (const [v2, tashdeed] of [[true, true], [false, false]]) {
    const v1 = await serve({ v2: false, tashdeed: false, content: ALL_ON });
    const on = await serve({ v2, tashdeed, v4: true, content: ALL_ON });
    try {
      for (const name of NAMES) {
        const a = await battery(v1.base, name);
        const b = await battery(on.base, name);
        expect(b).not.toMatch(/"sa\/v[123]\//);
        expect(b).toBe(a.replace(/"sa\/v1\/(en|ur)\//g, '"sa/v4/$1/'));
      }
    } finally { v1.srv.close(); on.srv.close(); }
  }
});

test('every key a battery carries has its clip on disk: v4 ON, and OFF in every voice set the router can serve', async () => {
  const missing = [];
  for (const content of [ALL_ON, ALL_OFF]) {
    for (const [v2, tashdeed, v4] of [[false, false, true], [true, true, true], [false, false, false], [true, false, false], [true, true, false]]) {
      const s = await serve({ v2, tashdeed, v4, content });
      try {
        for (const name of NAMES) {
          for (const k of keysOf(await battery(s.base, name))) if (!fs.existsSync(path.join(DASH, k))) missing.push(`${name} ${k}`);
        }
      } finally { s.srv.close(); }
    }
  }
  expect([...new Set(missing)]).toEqual([]);
}, 120000);

test('ON: a v4 clip is served as audio', async () => {
  const s = await serve({ v2: true, tashdeed: true, v4: true, content: ALL_ON });
  try {
    const k = keysOf(await battery(s.base, NAMES.find((n) => n.endsWith('.ur.json'))))[0];
    expect(k).toMatch(/^sa\/v4\/ur\//);
    const res = await fetch(`${s.base}/${k}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/audio\/mpeg/);
  } finally { s.srv.close(); }
});
