'use strict';
/**
 * Round 10 (the reviewers' 6 Nov list), the test screens: one app_settings switch per item, each OFF by default.
 * JSON true only; the battery file carries battery.ui.r10_<flag> while ON, nothing while OFF (byte-identical battery).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const R10 = {
  // audio 1: "say each one out loud, then press Next" heard once per task (the instruction), not again after it
  r10HintOnce: ['sa_r10_hint_once', 'r10_hint_once'],
  // timing 1: Next works at once when a practice section ends
  r10PracticeNext: ['sa_r10_practice_next', 'r10_practice_next'],
  // layout 1: an Urdu word centred in its button or bubble, the whole Nastaliq glyph inside the box
  r10UrduFit: ['sa_r10_urdu_fit', 'r10_urdu_fit'],
  // layout 2: maths numbers sized to the space they have, a 3-digit number as large as its box allows
  r10NumberFit: ['sa_r10_number_fit', 'r10_number_fit'],
};
const BATTERY = { battery_id: 'b', tasks: [{ id: 'ur.letters', items: [] }] };

describe('round 10 battery switches (sa-battery-switches.js)', () => {
  for (const [name, [key, flag]] of Object.entries(R10)) {
    test(`${key}: named, and ON puts battery.ui.${flag}`, () => {
      expect(SWITCHES[name]).toBe(key);
      expect(applySwitches(BATTERY, { [name]: true }).ui).toEqual({ [flag]: true });
    });
  }
  test('all OFF: no ui key, the battery as before', () => {
    const out = applySwitches(BATTERY, Object.fromEntries(Object.keys(R10).map((k) => [k, false])));
    expect(out).toEqual(BATTERY);
  });
});

describe('the engine route reads the round 10 switches', () => {
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
    const body = await served(Object.fromEntries(Object.keys(R10).map((k) => [k, () => true])));
    for (const [, flag] of Object.values(R10)) expect(body.ui && body.ui[flag]).toBe(true);
  });
  test('each OFF: no r10 flag on the served battery', async () => {
    const body = await served(Object.fromEntries(Object.keys(R10).map((k) => [k, () => false])));
    for (const [, flag] of Object.values(R10)) expect(body.ui && body.ui[flag]).toBeFalsy();
  });
});
