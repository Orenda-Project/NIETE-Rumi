'use strict';
/**
 * Every engine line sa-ui says through copyLine() (RULING #31d: every line Jugnu can say has a clip) has its clip in the
 * second voice set, under the build's own key rule (sa/v1/<lang>/<sha1(lang|text)[0,12]>.mp3, served under sa/v2/ with
 * sa_voice_v2 ON). The bank's lines carry the same keys, so a line wired there plays in the new voice.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { COPY } = require('../sa/sa-ui');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sa', 'sa-ui.js'), 'utf8');
const NAMES = [...new Set([...SRC.matchAll(/copyLine\('([a-z_]+)'\)/g)].map((m) => m[1]))].sort();
const key = (lang, text) => `sa/v2/${lang}/${crypto.createHash('sha1').update(`${lang}|${text}`).digest('hex').slice(0, 12)}.mp3`;

test('sa-ui says its own lines through copyLine', () => {
  expect(NAMES).toEqual(expect.arrayContaining(['all_done', 'give_coach', 'right']));
});

test('every copyLine text has a v2 clip with sound, in both languages', () => {
  const missing = [];
  for (const name of NAMES) {
    for (const lang of ['en', 'ur']) {
      const text = COPY[lang][name];
      const f = path.join(__dirname, '..', key(lang, text));
      if (!text || !fs.existsSync(f) || fs.statSync(f).size <= 500) missing.push(`${name}.${lang}`);
    }
  }
  expect(missing).toEqual([]);
});
