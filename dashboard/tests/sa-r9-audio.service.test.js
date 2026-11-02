'use strict';
/**
 * Round 9, item 2 (switch sa_r9_audio, battery.ui.r9_audio): "on some phones the sound comes out very low, fine on tablets".
 * An open microphone with echo cancellation puts an Android phone in its call mode (Chromium sets MODE_IN_COMMUNICATION
 * while any such input stream is open) and Jugnu then plays at call volume; the recorder held one open from the first
 * screen to the last. ON, the recorder asks for the microphone once (the permission), closes it, opens it for each
 * recording only and closes it when that recording ends: Jugnu speaks with no microphone open. OFF, as before.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const storeMod = require('../sa/sa-store');
const rec = require('../sa/sa-rec');
const core = require('../sa/sa-core');
const { start } = require('../sa/sa-engine');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

class FakeMR {
  static isTypeSupported(t) { return t === 'audio/webm'; }
  constructor(stream) { this.stream = stream; FakeMR.made.push(this); }
  start() { this.started = true; }
  emit(data) { this.ondataavailable({ data }); }
  stop() { if (this.onstop) this.onstop(); }
}
FakeMR.made = [];

/** A browser microphone: each getUserMedia opens a stream of one track; live() counts the tracks still open. */
function mics() {
  const streams = [];
  const gum = async (c) => {
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
    const s = { constraints: c, getTracks: () => [track] };
    streams.push(s);
    return s;
  };
  return { gum, streams, live: () => streams.filter((s) => s.getTracks()[0].readyState === 'live').length };
}
const tick = () => new Promise((ok) => setImmediate(ok));

async function recorder(extra) {
  const m = mics();
  const s = await storeMod.open({ idb: null });
  let t = 0;
  const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: m.gum, now: () => (t += 100), taps: false, ...extra });
  return { r, m, s };
}

describe('sa-rec idle_release (sa_r9_audio ON)', () => {
  beforeEach(() => { FakeMR.made = []; });

  test('ready() asks once and closes the microphone: no stream is open while Jugnu speaks', async () => {
    const { r, m } = await recorder({ idle_release: true });
    expect(await r.ready()).toBe(true);
    expect(m.streams.length).toBe(1);
    expect(m.live()).toBe(0);
    expect(r.stream()).toBeNull();
  });

  test('each recording opens the microphone, records on it, and closes it when it ends', async () => {
    const { r, m, s } = await recorder({ idle_release: true });
    await r.ready();
    expect(r.start('t1')).toBe(true);
    await tick();
    expect(m.streams.length).toBe(2);
    expect(m.live()).toBe(1);
    expect(FakeMR.made[0].stream).toBe(m.streams[1]);
    expect(m.streams[1].constraints).toEqual({ audio: { echoCancellation: true, noiseSuppression: true } });
    FakeMR.made[0].emit({ size: 3, id: 'a' });
    const meta = await r.stop();
    expect(meta).toMatchObject({ task_id: 't1', parts: 1, mime: 'audio/webm' });
    expect(m.live()).toBe(0);
    expect((await s.chunks('x', 't1')).map((c) => !!c.final)).toEqual([false, true]);
    // the next recording opens its own, and its stop closes it too
    expect(r.start('t2')).toBe(true);
    await tick();
    expect(m.live()).toBe(1);
    await r.stop();
    expect(m.live()).toBe(0);
  });

  test('a discard closes the microphone as well', async () => {
    const { r, m } = await recorder({ idle_release: true });
    await r.ready();
    r.start('t1');
    await tick();
    expect(await r.discard()).toBeNull();
    expect(m.live()).toBe(0);
  });

  test('stopped before the microphone opened: resolves null, no recorder, and the late stream is closed', async () => {
    const { r, m } = await recorder({ idle_release: true });
    await r.ready();
    expect(r.start('t1')).toBe(true);
    expect(await r.stop()).toBeNull();
    await tick();
    expect(FakeMR.made.length).toBe(0);
    expect(m.live()).toBe(0);
    expect(r.recording()).toBe(false);
  });

  test('a stop followed at once by the next start never closes the new recording\'s microphone', async () => {
    const { r, m } = await recorder({ idle_release: true });
    await r.ready();
    r.start('t1');
    await tick();
    const done = r.stop();
    r.start('t2');
    await done;
    await tick();
    expect(m.live()).toBe(1);
    expect(FakeMR.made[1].stream.getTracks()[0].readyState).toBe('live');
  });

  test('a refused microphone at the recording: no throw, stop() resolves null', async () => {
    let n = 0;
    const s = await storeMod.open({ idb: null });
    const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, taps: false, idle_release: true,
      getUserMedia: async () => { if (++n > 1) throw new Error('denied'); return { getTracks: () => [{ stop() {} }] }; } });
    await r.ready();
    expect(r.start('t1')).toBe(true);
    await tick();
    expect(await r.stop()).toBeNull();
    expect(r.recording()).toBe(false);
  });

  test('no permission (ready() not yet true): start() is false, as before', async () => {
    const { r } = await recorder({ idle_release: true });
    expect(r.start('t1')).toBe(false);
  });

  test('the mercy ear hears the recording\'s microphone once it opens: mercy 12 s and stop 20 s after it opens', async () => {
    const clock = { t: 0 };
    const fns = new Map(); let h = 0;
    const iv = { set: (f) => { fns.set(++h, f); return h; }, clear: (k) => { fns.delete(k); } };
    const connected = [];
    class AC {
      createAnalyser() { return { fftSize: 2048, getByteTimeDomainData(buf) { buf.fill(128); } }; }
      createMediaStreamSource(st) { return { connect() { connected.push(st); }, disconnect() {} }; }
      close() { return Promise.resolve(); }
    }
    const m = mics();
    const s = await storeMod.open({ idb: null });
    const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: m.gum, now: () => clock.t, AudioContext: AC,
      interval: iv, taps: false, localStorage: null, idle_release: true });
    await r.ready();
    r.start('ur.story');
    const fired = [];
    r.onSilence({ after_s: 12, total_s: 20 }, (e) => fired.push(e));
    const run = (ms) => { for (let x = 0; x < ms; x += 100) { clock.t += 100; [...fns.values()].forEach((f) => f()); } };
    run(3000); // the microphone has not opened yet: the watch has not begun
    await tick();
    expect(connected).toEqual([m.streams[1]]);
    run(11900);
    expect(fired).toEqual([]);
    run(100);
    expect(fired).toEqual([{ kind: 'mercy', silence_s: 12 }]);
    run(8000);
    expect(fired.map((e) => e.kind)).toEqual(['mercy', 'early_stop_silence']);
  });
});

describe('sa-rec without idle_release (sa_r9_audio OFF): today\'s microphone', () => {
  beforeEach(() => { FakeMR.made = []; });
  test('one stream from ready() on, kept open between recordings until release()', async () => {
    const { r, m } = await recorder({});
    await r.ready();
    expect(m.live()).toBe(1);
    expect(r.start('t1')).toBe(true);
    expect(FakeMR.made[0].stream).toBe(m.streams[0]);
    await r.stop();
    expect(m.live()).toBe(1);
    expect(m.streams.length).toBe(1);
    r.release();
    expect(m.live()).toBe(0);
  });
});

describe('the engine passes the switch to the recorder', () => {
  const b = (ui) => ({ battery_id: 'm', ...(ui ? { ui } : {}), tasks: [{ id: 'story', mode: 'record', time_limit_s: 60, passage: { text: 'a' }, items: [{ id: 'w', target: 'a', line: 1 }] }] });
  async function made(ui) {
    const seen = [];
    const deps = {
      core,
      store: { open: () => storeMod.open({ idb: null }) },
      ui: { mount: () => ({ destroy() {} }) },
      voice: { create: () => ({ speak: () => Promise.resolve(), stop() {}, setMuted() {} }) },
      rec: { create: (o) => { seen.push(o); return { ready: async () => true, start: () => true, stop: async () => null, release() {}, recording: () => false }; } },
      now: (() => { let t = 0; return () => (t += 100); })(),
    };
    await start({ mount: {}, battery: b(ui), mode: 'game', lang: 'ur', audio_check: false, warmup: false }, deps);
    return seen[0];
  }
  test('ON: idle_release true', async () => { expect((await made({ r9_audio: true })).idle_release).toBe(true); });
  test('OFF: no idle_release', async () => { expect((await made(null)).idle_release).toBeUndefined(); });
});

describe('the switch sa_r9_audio', () => {
  const BATTERY = { battery_id: 'b', tasks: [{ id: 'ur.letters', items: [] }] };
  test('named, and ON puts battery.ui.r9_audio; OFF leaves the battery as it was', () => {
    expect(SWITCHES.r9Audio).toBe('sa_r9_audio');
    expect(applySwitches(BATTERY, { r9Audio: true }).ui).toEqual({ r9_audio: true });
    expect(applySwitches(BATTERY, { r9Audio: false })).toEqual(BATTERY);
  });
  async function served(r9Audio) {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off, r9Audio }));
    const srv = app.listen(0);
    try {
      const name = fs.readdirSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa')).find((n) => /^sa\.coach\..*\.ur\.json$/.test(n));
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/${name}`);
      return r.json();
    } finally { srv.close(); }
  }
  test('the engine route serves it ON, and not OFF', async () => {
    expect((await served(() => true)).ui.r9_audio).toBe(true);
    const off = await served(() => false);
    expect(off.ui && off.ui.r9_audio).toBeFalsy();
  });
});
