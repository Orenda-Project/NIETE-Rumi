'use strict';
/**
 * Round 9 (the reviewer's 2 Nov list), the test screens: one app_settings switch per item, each OFF by default.
 * JSON true only; the battery file carries battery.ui.r9_<flag> while ON, nothing while OFF (byte-identical battery).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const R8 = {
  // item 4: the per-question waits doubled, never under 30 s (the measured one-minute parts unchanged)
  r9QuestionTime: ['sa_r9_question_time', 'r9_question_time'],
  // item 6: the story's questions written on the screen as well as spoken
  r9CompText: ['sa_r9_comp_text', 'r9_comp_text'],
  // item 7: a scroll cue on a screen whose content runs past the bottom
  r9ScrollCue: ['sa_r9_scroll_cue', 'r9_scroll_cue'],
  // item 3: coach-led RDF, Skip instructions on the instruction screens
  r9SkipInstructions: ['sa_r9_skip_instructions', 'r9_skip_instructions'],
};
const BATTERY = { battery_id: 'b', tasks: [{ id: 'ur.letters', items: [] }] };

describe('round 9 battery switches (sa-battery-switches.js)', () => {
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

describe('the engine route reads the round 9 switches', () => {
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
  test('each OFF: no r9 flag on the served battery', async () => {
    const body = await served(Object.fromEntries(Object.keys(R8).map((k) => [k, () => false])));
    for (const [, flag] of Object.values(R8)) expect(body.ui && body.ui[flag]).toBeFalsy();
  });
});
