'use strict';
/**
 * Round 8 item 32: every spoken v4 line (instructions, battery lines, questions, feedback, problems, checks) has its word
 * timings beside the clip, sa/v4/<lang>/<key>.json, in the storybook read-along's shape that sa-ui.js reads under
 * sa_r8_highlight: { v: 1, key, lang, text, audio: { url, ms }, words: [{ i, t, s_ms, e_ms }] }, words in the order of
 * text.split(/\s+/), times in order and inside the clip. Served by the engine router like the clip itself.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createSaEngineRouter } = require('../routes/sa-engine.routes');
const { voiceManifest } = require('../../bot/shared/services/child-test/sa/voice-manifest');

const DASH = path.join(__dirname, '..');
const BANK = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'item-bank.sa.v1.json');
const ROLES = new Set(['instruction', 'battery', 'question', 'feedback', 'problem', 'check']);
const rows = voiceManifest(JSON.parse(fs.readFileSync(BANK, 'utf8'))).filter((r) => ROLES.has(r.role));
const v4 = (key) => key.replace(/^sa\/v1\//, 'sa/v4/');

test('the bank has spoken lines to time', () => {
  expect(rows.length).toBeGreaterThan(300);
});

test('every spoken v4 line has its timing file, in the read-along shape, words as printed and times in order', () => {
  const bad = [];
  for (const r of rows) {
    const url = v4(r.key);
    const file = path.join(DASH, url.replace(/\.mp3$/, '.json'));
    if (!fs.existsSync(file)) { bad.push(`${url}: no timing file`); continue; }
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const printed = r.text.trim().split(/\s+/);
    const ok = d.v === 1 && d.key === path.basename(url, '.mp3') && d.lang === r.lang && d.text === r.text.trim()
      && d.audio && d.audio.url === url && d.audio.ms > 0 && Array.isArray(d.words)
      && d.words.length === printed.length
      && d.words.every((w, i) => w.i === i && w.t === printed[i] && w.s_ms <= w.e_ms && w.e_ms <= d.audio.ms
        && (i === 0 || w.s_ms >= d.words[i - 1].s_ms));
    if (!ok) bad.push(`${url}: shape`);
  }
  expect(bad).toEqual([]);
});

test('the router serves a timing file next to its clip', async () => {
  const app = express();
  app.use(createSaEngineRouter({ on: () => true, voiceV4: () => true }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    for (const lang of ['ur', 'en']) {
      const url = v4(rows.find((r) => r.lang === lang && r.role === 'instruction').key).replace(/\.mp3$/, '.json');
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/${url}`);
      expect(res.status).toBe(200);
      expect((await res.json()).v).toBe(1);
    }
  } finally { srv.close(); }
});
