'use strict';
/**
 * Round 8, two additions sa-ux-r8 asked for in this lane's files (board 15:26Z / 15:28Z):
 *  - sa-voice.js speak.audio(): the <audio> playing now (a clip line), else null — the screens light the instruction's
 *    words from it (item 32, sa_r8_highlight).
 *  - sa-engine.js: with ui.r8_reading_position the engine listens on the story (the recorder's onVoice → runner.voice(),
 *    and runner.voiceWatch(rec.ear)) even when sa_silence_repeat is OFF, so the story's voiced seconds never depend on it.
 */
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const voiceMod = require('../sa/sa-voice');

describe('sa-voice speak.audio()', () => {
  test('null when nothing plays; the playing clip\'s <audio> while it plays; null again after it ends', async () => {
    const made = [];
    function Audio(src) { this.src = src; made.push(this); this.play = () => Promise.resolve(); this.pause = () => {}; }
    const v = voiceMod.create({ lang: 'ur', base: '/', Audio, speechSynthesis: null });
    expect(typeof v.speak.audio).toBe('function');
    expect(v.speak.audio()).toBeNull();
    const p = v.speak({ ur: 'سلام' }, { ur: 'sa/v4/ur/abc.mp3' });
    await Promise.resolve(); await Promise.resolve();
    expect(v.speak.audio()).toBe(made[0]);
    made[0].onended();
    await p;
    expect(v.speak.audio()).toBeNull();
  });
});

describe('the engine listens on the story with r8_reading_position, whatever sa_silence_repeat says', () => {
  const { start } = require('../sa/sa-engine');
  const tick = (ms = 15) => new Promise((res) => setTimeout(res, ms));
  async function boot(ui) {
    const store = await storeMod.open({ idb: null });
    let voiceCb = null;
    const ear = () => 'running';
    const battery = { battery_id: 'b', ui, tasks: [{ id: 'ur.story', mode: 'record', response: 'record', subtask: 'oral_reading_fluency', lang: 'ur', time_limit_s: 60, passage: { text: 'x' }, items: [] }] };
    let hooks = null;
    const fakeRec = { ready: async () => true, start: () => true, stop: async () => null, recording: () => false, onSilence: () => () => {}, ear,
      onVoice: (cb) => { voiceCb = cb; return () => {}; } };
    let t = 0;
    const e = await start({ mount: {}, battery, mode: 'proctored', lang: 'ur', session_id: 's-story', audio_check: false, warmup: false, now: () => t }, {
      core, store: { open: async () => store }, ui: { mount: (el, o) => { hooks = o; return {}; } },
      voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) },
      rec: { create: () => fakeRec }, micState: () => 'ok', now: () => t,
    });
    const r = e.runner;
    const watched = [];
    if (r.voiceWatch) { const w = r.voiceWatch.bind(r); r.voiceWatch = (x) => { watched.push(x); return w(x); }; }
    r.start(); r.instructionDone(); r.begin();
    hooks.onRecordStart(r.view().task);
    await tick();
    return { voice: () => voiceCb, watched, ear };
  }
  test('ON (silence repeat OFF): onVoice is watched on the story and the runner watches the ear', async () => {
    const x = await boot({ r8_reading_position: true });
    expect(typeof x.voice()).toBe('function');
    expect(x.watched).toEqual([x.ear]);
  });
  test('OFF: no watch on the story (as before)', async () => {
    const x = await boot({});
    expect(x.voice()).toBeNull();
  });
});

describe('the v4 clips\' word timings (sa/v4/<lang>/<key>.json) go on the phone too, best effort', () => {
  const { prepVisit, timingUrls } = require('../sa/sa-offline');
  const B = { tasks: [{ id: 'ur.x', instruction: { audio: { ur: 'sa/v4/ur/aaa111.mp3', en: 'sa/v4/en/bbb222.mp3' } }, items: [{ id: 'i1', prompt_audio: 'sa/v1/ur/ccc333.mp3' }] }] };
  test('timingUrls: one .json beside each v4 clip only', () => {
    expect(timingUrls(['/sa/v4/ur/aaa111.mp3', '/sa/v1/ur/ccc333.mp3', '/sa/v4/en/bbb222.mp3'])).toEqual(['/sa/v4/ur/aaa111.json', '/sa/v4/en/bbb222.json']);
  });
  test('prepVisit asks for them after everything else; a timing the server does not have is not "missing"', async () => {
    const msgs = [];
    const ask = async (m) => { msgs.push(m); const missing = m.urls.filter((u) => u.endsWith('.json') && u.includes('/v4/')); return { ok: !missing.length, cached: m.urls.length - missing.length, missing, bytes: 0 }; };
    const r = await prepVisit({ forms: ['sa.coach.G3.A.ur'], ask, readBattery: async () => B });
    expect(msgs[msgs.length - 1].urls).toEqual(['/sa/v4/ur/aaa111.json']);
    expect(r.ok).toBe(true);
    expect(r.missing).toBe(0);
  });
});
