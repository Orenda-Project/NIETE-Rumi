/**
 * The audio check's words carry their clips: the battery names them (check_words, both languages, the clip keys of the
 * one voice), the engine hands them to the screens, and every clip is on disk in both voice sets. Without this the
 * check's words fall back to the phone's own voice, which a phone without an English voice does not have.
 */
const fs = require('fs');
const path = require('path');
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const { start } = require('../sa/sa-engine');

const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const DASH = path.join(__dirname, '..');
const NAMES = fs.readdirSync(BATTERIES).filter((n) => /^sa\..+\.(en|ur)\.json$/.test(n));

test('every runtime battery names six check words, each with a picture and a clip in both languages', () => {
  expect(NAMES.length).toBeGreaterThan(0);
  for (const name of NAMES) {
    const b = JSON.parse(fs.readFileSync(path.join(BATTERIES, name), 'utf8'));
    expect(b.check_words.map((w) => w.en)).toEqual(['cat', 'sun', 'fish', 'ball', 'mango', 'house']);
    for (const w of b.check_words) {
      expect(w.pic).toBeTruthy();
      expect(w.audio.en).toMatch(/^sa\/v1\/en\/[0-9a-f]{12}\.mp3$/);
      expect(w.audio.ur).toMatch(/^sa\/v1\/ur\/[0-9a-f]{12}\.mp3$/);
    }
  }
});

test('every check word clip is on disk under sa/v1 and sa/v2, an mp3 with sound', () => {
  const b = JSON.parse(fs.readFileSync(path.join(BATTERIES, NAMES[0]), 'utf8'));
  const missing = [];
  for (const w of b.check_words) {
    for (const lang of ['en', 'ur']) {
      for (const k of [w.audio[lang], w.audio[lang].replace(/^sa\/v1\//, 'sa/v2/')]) {
        const f = path.join(DASH, k);
        if (!fs.existsSync(f) || fs.statSync(f).size <= 500) missing.push(`${k} ${w[lang]}`);
      }
    }
  }
  expect(missing).toEqual([]);
});

test('the engine hands the battery\'s check words to the screens', async () => {
  let uiOpts = null;
  const words = [{ pic: 'a', en: 'cat', ur: 'x', audio: { en: 'sa/v1/en/0.mp3', ur: 'sa/v1/ur/0.mp3' } },
    { pic: 'b', en: 'sun', ur: 'y', audio: { en: 'sa/v1/en/1.mp3', ur: 'sa/v1/ur/1.mp3' } }];
  const battery = { battery_id: 'b1', check_words: words, tasks: [{ id: 't1', mode: 'tap', items: [{ id: 'i1', target: 'a', options: ['a', 'b'] }] }] };
  const shared = await storeMod.open({ idb: null });
  await start({ mount: {}, battery, mode: 'game', lang: 'en', session_id: 'sess-cw' }, {
    core, store: { open: () => Promise.resolve(shared) },
    ui: { mount: (el, o) => { uiOpts = o; return { destroy() {} }; } },
    voice: { create: () => ({ speak: () => Promise.resolve(), stop() {}, setMuted() {} }) },
    now: (() => { let t = 0; return () => (t += 100); })(),
  });
  expect(uiOpts.check_words).toEqual(words);
});
