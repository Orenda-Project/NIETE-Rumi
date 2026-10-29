'use strict';
/**
 * Round 8 (the reviewer's 28 Oct list), the child's screens: one app_settings switch per item, each OFF by default.
 * JSON true only; the battery file carries battery.ui.r8_<flag> while ON, nothing while OFF (byte-identical battery).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const R8 = {
  r8ReadingNoDone: ['sa_r8_reading_no_done', 'r8_reading_no_done'],
  r8CompWaitNext: ['sa_r8_comp_wait_next', 'r8_comp_wait_next'],
  r8PracticeAutoplay: ['sa_r8_practice_autoplay', 'r8_practice_autoplay'],
  r8LatinDigits: ['sa_r8_latin_digits', 'r8_latin_digits'],
  r8MissingNumber: ['sa_r8_missing_number', 'r8_missing_number'],
  r8Layout: ['sa_r8_layout', 'r8_layout'],
  r8StorySnap: ['sa_r8_story_snap', 'r8_story_snap'],
  r8Nudges: ['sa_r8_nudges', 'r8_nudges'],
  r8Highlight: ['sa_r8_highlight', 'r8_highlight'],
  r8LangSwitch: ['sa_r8_lang_switch', 'r8_lang_switch'],
  r8ReadingPosition: ['sa_r8_reading_position', 'r8_reading_position'],
  r8TimeupContinue: ['sa_r8_timeup_continue', 'r8_timeup_continue'],
  // the microphone check on an iPhone: the meter's AudioContext made inside the tap (dashboard/sa/sa-mic.js)
  r8IosMic: ['sa_r8_ios_mic', 'r8_ios_mic'],
};
const BATTERY = { battery_id: 'b', tasks: [{ id: 'ur.letters', items: [] }] };

describe('round 8 battery switches (sa-battery-switches.js)', () => {
  for (const [name, [key, flag]] of Object.entries(R8)) {
    test(`${key}: named, and ON puts battery.ui.${flag}`, () => {
      expect(SWITCHES[name]).toBe(key);
      expect(applySwitches(BATTERY, { [name]: true }).ui).toEqual({ [flag]: true });
    });
  }
  test('all OFF: no ui key, the battery as before', () => {
    const out = applySwitches(BATTERY, Object.fromEntries(Object.keys(R8).map((k) => [k, false])));
    expect(out).toEqual(BATTERY);
  });
});

describe('the engine route reads the round 8 switches', () => {
  async function served(readers) {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off, ...readers }));
    const srv = app.listen(0);
    try {
      const name = fs.readdirSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa')).find((n) => /^sa\.coach\..*\.ur\.json$/.test(n));
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/${name}`);
      return r.json();
    } finally { srv.close(); }
  }
  test('each ON reader reaches the served battery', async () => {
    const body = await served(Object.fromEntries(Object.keys(R8).map((k) => [k, () => true])));
    for (const [, flag] of Object.values(R8)) expect(body.ui && body.ui[flag]).toBe(true);
  });
  test('each OFF: no r8 flag on the served battery', async () => {
    const body = await served(Object.fromEntries(Object.keys(R8).map((k) => [k, () => false])));
    for (const [, flag] of Object.values(R8)) expect(body.ui && body.ui[flag]).toBeFalsy();
  });
});
