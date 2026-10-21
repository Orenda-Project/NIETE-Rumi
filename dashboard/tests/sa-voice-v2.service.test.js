'use strict';
/**
 * The second voice set (app_settings sa_voice_v2, OFF by default): ON, a battery is served with its clip keys under
 * sa/v2/ instead of sa/v1/ (the form's keys and the clip names do not change, the base moves), so the phone fetches and
 * keeps the new clips under new addresses; OFF, the battery is served byte for byte as before (the content switches'
 * view of the file on disk).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createSaEngineRouter, VOICE_V2_KEY } = require('../routes/sa-engine.routes');
const { applySwitches } = require('../routes/sa-battery-switches');

const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const DASH = path.join(__dirname, '..');
const NAMES = fs.readdirSync(BATTERIES).filter((n) => /^sa\.(coach|game)\..+\.(en|ur)\.json$/.test(n));

// Every content switch ON, so the keys of practice_v2 and variants[] are served too.
const CONTENT = { practiceAllMaths: true, passageRotation: true };
const asBefore = (name) => JSON.stringify(applySwitches(JSON.parse(fs.readFileSync(path.join(BATTERIES, name), 'utf8')), CONTENT));

async function serve(v2, voiceV2 = () => v2) {
  const app = express();
  app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: () => true, passageRotation: () => true, voiceV2 }));
  app.use((req, res) => res.status(299).send('after'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

function keys(x, out = new Set()) {
  if (typeof x === 'string') { if (/^sa\/v[12]\/(en|ur)\/[0-9a-f]{12}\.mp3$/.test(x)) out.add(x); }
  else if (Array.isArray(x)) x.forEach((v) => keys(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => keys(v, out));
  return out;
}

test('the switch is app_settings sa_voice_v2', () => {
  expect(VOICE_V2_KEY).toBe('sa_voice_v2');
});

test('OFF: every battery is served byte for byte as before', async () => {
  const { srv, base } = await serve(false);
  try {
    for (const name of NAMES) {
      const res = await fetch(`${base}/sa/batteries/${name}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(asBefore(name));
    }
  } finally { srv.close(); }
});

test('ON: every clip key moves to sa/v2 and nothing else changes', async () => {
  const { srv, base } = await serve(true);
  try {
    for (const name of NAMES) {
      const res = await fetch(`${base}/sa/batteries/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/json/);
      expect(res.headers.get('cache-control')).toMatch(/no-cache/);
      const text = await res.text();
      expect(text).not.toMatch(/"sa\/v1\/(en|ur)\//);
      expect(text).toMatch(/"sa\/v2\/(en|ur)\/[0-9a-f]{12}\.mp3"/);
      expect(text.replace(/"sa\/v2\//g, '"sa/v1/')).toBe(asBefore(name));
    }
  } finally { srv.close(); }
});

test('ON: every clip a battery names is on disk under sa/v2, an mp3 with sound, and served', async () => {
  const want = new Set();
  for (const name of NAMES) keys(JSON.parse(fs.readFileSync(path.join(BATTERIES, name), 'utf8')), want);
  const v2 = [...want].map((k) => k.replace(/^sa\/v1\//, 'sa/v2/'));
  const missing = v2.filter((k) => {
    const f = path.join(DASH, k);
    if (!fs.existsSync(f) || fs.statSync(f).size <= 500) return true;
    const head = fs.readFileSync(f).subarray(0, 3);
    return !(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0));
  });
  expect(missing).toEqual([]);
  const { srv, base } = await serve(true);
  try {
    const res = await fetch(`${base}/${v2[0]}`);
    expect(res.status).toBe(200);
  } finally { srv.close(); }
});

test('a failed or missing switch read is OFF', async () => {
  const { srv, base } = await serve(null, () => { throw new Error('db down'); });
  try {
    const res = await fetch(`${base}/sa/batteries/${NAMES[0]}`);
    expect(await res.text()).toBe(asBefore(NAMES[0]));
  } finally { srv.close(); }
});
