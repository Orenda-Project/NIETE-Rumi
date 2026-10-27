'use strict';
/**
 * Round 7b (the tester's 27 Oct list): one app_settings switch per item, each OFF by default.
 *   Engine switches (JSON true only; the battery file carries battery.ui.<flag> while ON, nothing while OFF):
 *     sa_back_button, sa_end_test_restart, sa_end_section, sa_silence_repeat, sa_under20_move_on, sa_t_sound_ta,
 *     sa_say_then_next, sa_story_scroll, sa_audio_gated_next, sa_tick_prompt
 *   Portal switches (GET /sa/switches, true or a list of user ids): endTestRestart, endSection, dashFilters.
 */
const express = require('express');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const R7B = {
  backButton: ['sa_back_button', 'back_button'],
  endTestRestart: ['sa_end_test_restart', 'end_test_restart'],
  endSection: ['sa_end_section', 'end_section'],
  silenceRepeat: ['sa_silence_repeat', 'silence_repeat'],
  under20MoveOn: ['sa_under20_move_on', 'under20_move_on'],
  tSoundTa: ['sa_t_sound_ta', 't_sound_ta'],
  sayThenNext: ['sa_say_then_next', 'say_then_next'],
  storyScroll: ['sa_story_scroll', 'story_scroll'],
  audioGatedNext: ['sa_audio_gated_next', 'audio_gated_next'],
  tickPrompt: ['sa_tick_prompt', 'tick_prompt'],
};
const BATTERY = { battery_id: 'b', tasks: [{ id: 'ur.letters', items: [] }] };

describe('the battery switches (sa-battery-switches.js)', () => {
  for (const [name, [key, flag]] of Object.entries(R7B)) {
    test(`${key}: named, and ON puts battery.ui.${flag}`, () => {
      expect(SWITCHES[name]).toBe(key);
      expect(applySwitches(BATTERY, { [name]: true }).ui).toEqual({ [flag]: true });
    });
  }
  test('all OFF: no ui key, the battery as before', () => {
    const out = applySwitches(BATTERY, Object.fromEntries(Object.keys(R7B).map((k) => [k, false])));
    expect(out).toEqual(BATTERY);
    expect('ui' in out).toBe(false);
  });
});

describe('the engine route reads them from app_settings', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  test('each ON reader reaches the served battery', async () => {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const on = () => true;
    const off = () => false;
    const readers = Object.fromEntries(Object.keys(R7B).map((k) => [k, on]));
    const app = express();
    app.use(createSaEngineRouter({ on, practiceAllMaths: off, passageRotation: off, voiceV2: off, ...readers }));
    const srv = app.listen(0);
    try {
      const name = fs.readdirSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa')).find((n) => /^sa\.coach\..*\.ur\.json$/.test(n));
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/${name}`);
      const body = await r.json();
      for (const [, flag] of Object.values(R7B)) expect(body.ui && body.ui[flag]).toBe(true);
    } finally { srv.close(); }
    void os;
  });
});

describe('GET /sa/switches (portal, per coach)', () => {
  const rows = {};
  jest.resetModules();
  jest.doMock('../config/supabase', () => ({
    from: (table) => {
      const q = { _eq: null };
      q.select = () => q;
      q.eq = (_col, val) => { q._eq = val; return q; };
      q.maybeSingle = async () => {
        if (table === 'users') return { data: { id: q._eq, role: 'coach' }, error: null };
        if (table === 'app_settings') return { data: q._eq in rows ? { value: rows[q._eq] } : null, error: null };
        return { data: null, error: null };
      };
      return q;
    },
  }));
  async function switches() {
    const app = express();
    app.use((req, _res, next) => { req.session = { portalUserId: 'coach-1' }; next(); });
    app.use('/', require('../routes/portal-child-test.routes'));
    const srv = app.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/switches`);
      return { status: r.status, body: await r.json() };
    } finally { srv.close(); }
  }
  beforeEach(() => { for (const k of Object.keys(rows)) delete rows[k]; rows.portal_child_test_sa = true; });
  test('ON (true or a list naming the coach): endTestRestart, endSection, dashFilters', async () => {
    rows.sa_end_test_restart = true;
    rows.sa_end_section = ['coach-1'];
    rows.sa_dash_filters = true;
    const r = await switches();
    expect(r.status).toBe(200);
    expect(r.body.switches).toEqual(expect.objectContaining({ endTestRestart: true, endSection: true, dashFilters: true }));
  });
  test('OFF: no rows → all three false', async () => {
    const r = await switches();
    expect(r.body.switches).toEqual(expect.objectContaining({ endTestRestart: false, endSection: false, dashFilters: false }));
  });
});
