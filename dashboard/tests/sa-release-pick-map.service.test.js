'use strict';
/**
 * The release pick map: the bytes a child hears for each letter whose re-made take the content owner did not clear by
 * ear. Such an item keeps the bytes production already serves, in every voice set a battery is served in.
 *
 * Read the way a phone reads it: the battery comes from /sa/batteries/<name> (v1, sa_voice_v2 or sa_voice_v4), the
 * item's clip key is taken from it, and that clip is fetched from the same router. The sha256 of the bytes served must
 * be the pinned production take. Each battery is read with every content switch OFF, every one ON, and every one ON but
 * the letter-sound picker (production today), so a switch cannot route around the pin.
 *
 * - The English letter names e, B, t and d keep production's take: their re-made v4 takes failed the ear check.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createSaEngineRouter } = require('../routes/sa-engine.routes');
const { SWITCHES } = require('../routes/sa-battery-switches');

const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const NAMES = fs.readdirSync(BATTERIES).filter((n) => /^sa\.(coach|game)\..+\.(en|ur)\.json$/.test(n));
const ALL_OFF = Object.fromEntries(Object.keys(SWITCHES).map((k) => [k, () => false]));
const ALL_ON = Object.fromEntries(Object.keys(SWITCHES).map((k) => [k, () => true]));
const PICKER_OFF = { ...ALL_ON, r28LetterPick: () => false };
const VOICES = { v1: { v2: false, v4: false }, v2: { v2: true, v4: false }, v4: { v2: false, v4: true } };

// The English letter-names items whose re-made take failed the ear check: production's take, per voice set.
const LETTERS = {
  e: { v1: '9f774f3e671518ee2bbf9f3f5bf85ea11b657362398763ccb2e1978ae878b73e',
    v2: '610c7f768ab7eaf5ab11554d631b61e2dd34264cc5d2c3343ac28654e51c3dc7',
    v4: 'a0dfe1653becadc6db672d0d45076d9558df9b9ac75401ffc27adb81dcbcc2c8' },
  B: { v1: '6f60f296ed6cb9a8162a5c141a60ede6bfc3d2b42a7546d8473659eb162d8154',
    v2: 'c193a3a9607d62a0bbf44ad09dc203289117c73b7ce8d454882b476b81d059de',
    v4: '48bad128b909ed8861566375ac3bde10d417d63b70e37b7c0e03e78735387dad' },
  t: { v1: '6658bf337403eaefa0ba2ecc4e0b573c0e93991a038f86182252e2dd031cc701',
    v2: 'd41ee226cca903d3e10f81b59a8c85e1ec4a52100bf1b9f607c2aa2b30e8b133',
    v4: '7d7153cdb25a3b73176711d15473ebbe0897d475703e5a1c2011941dfbab0d16' },
  d: { v1: '2a16042089e228f0d9ffe4218381bd2a1ca765811f30fb0514b971d20c90036b',
    v2: '05d7b3ed1be181fa9422d75feb8f34607f8c060b11a30119991fe4245d2baad7',
    v4: '4f06089ead80179981f46295a584a0cd2eb07d436ced19407466da4522a8d550' },
};

async function serve({ v2, v4 }, content) {
  const app = express();
  app.use(createSaEngineRouter({ on: () => true, ...content, voiceV2: () => v2, voiceTashdeed: () => false,
    voiceV4: () => v4 }));
  app.use((req, res) => res.status(299).send('after'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

async function json(base, name) {
  const res = await fetch(`${base}/sa/batteries/${name}`);
  expect(res.status).toBe(200);
  return res.json();
}

async function shaOf(base, key) {
  const res = await fetch(`${base}/${key}`);
  expect([key, res.status]).toEqual([key, 200]);
  return crypto.createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
}

describe.each(Object.keys(VOICES))('voice set %s', (voice) => {
  let apps;
  beforeAll(async () => { apps = await Promise.all([ALL_OFF, ALL_ON, PICKER_OFF].map((c) => serve(VOICES[voice], c))); });
  afterAll(() => apps.forEach((a) => a.srv.close()));

  test("the English letter names e, B, t and d play production's take", async () => {
    const seen = new Set();
    for (const app of apps) for (const name of NAMES) {
      for (const t of (await json(app.base, name)).tasks || []) {
        if (t.id !== 'en.letters') continue;
        for (const it of t.items.filter((x) => LETTERS[x.target])) {
          expect([name, it.id, it.prompt_audio, await shaOf(app.base, it.prompt_audio)])
            .toEqual([name, it.id, it.prompt_audio, LETTERS[it.target][voice]]);
          seen.add(it.target);
        }
      }
    }
    // every letter is read from a served battery, so a renamed item cannot pass by being skipped
    expect([...seen].sort()).toEqual(Object.keys(LETTERS).sort());
  });
});
