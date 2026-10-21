'use strict';
/**
 * A busy tunnel refuses clips (429) on the visit path; no instruction may play silent.
 *   (A) the opening and transition lines (battery.lines: the welcome, the sound check and its help line, the coach and
 *       hand-back lines …) are asked for first, in their own list, so they are on the phone before the child reaches
 *       them, in every mode and every part
 *   (B) a clip that fails at play time is tried once more after 1.5 s; failing again, the phone's own voice says the
 *       line when it has one for the language, else the words stay on screen with the replay (onSilent), never a
 *       silent gap of more than 2 s
 */
const fs = require('fs');
const path = require('path');
const page = require('../sa/sa-page');

const DIR = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const FORMS = fs.readdirSync(DIR).filter((n) => /^sa\.coach\..+\.(en|ur)\.json$/.test(n));

function loadOffline(nav) {
  const prev = global.self;
  global.self = { navigator: nav, MessageChannel: FakeChannel };
  let mod;
  jest.isolateModules(() => { mod = require('../sa/sa-offline'); });
  global.self = prev;
  return mod;
}
function FakeChannel() {
  const port1 = {};
  this.port1 = port1;
  this.port2 = { postMessage(d) { port1.onmessage({ data: d }); } };
}
function worker(fail = []) {
  const asked = [];
  const sw = {
    postMessage(msg, [port]) {
      asked.push(msg.urls);
      const missing = msg.urls.filter((u) => fail.includes(u));
      port.postMessage({ ok: missing.length === 0, cached: msg.urls.length - missing.length, missing });
    },
  };
  return { asked, nav: { serviceWorker: { register: async () => ({}), ready: Promise.resolve({ active: sw }), controller: sw } } };
}
const lineKeys = (b, lang) => Object.keys(b.lines || {}).map((k) => b.lines[k].audio).map((a) => (typeof a === 'string' ? a : a && a[lang])).filter(Boolean).map((a) => `/${a}`);

describe('(A) the opening and transition lines are prepared first', () => {
  test.each(FORMS)('%s: every part, auto and manual: the first list asked for is every lines.* clip', async (name) => {
    const full = JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
    const lang = name.endsWith('.ur.json') ? 'ur' : 'en';
    const blocks = ['full', 'rdf', 'rdf_auto', 'rdf_manual'].filter((k) => k === 'full' || Array.isArray(full[k])).concat(Object.keys(full.blocks || {}));
    expect(blocks).toEqual(expect.arrayContaining(['rdf_auto', 'rdf_manual']));
    for (const block of blocks) {
      const battery = page.pick(full, block);
      const want = lineKeys(battery, lang);
      expect(want.length).toBeGreaterThan(5);
      for (const k of ['welcome', 'audio_check', 'audio_fail']) expect(want).toContain(`/${battery.lines[k].audio}`);
      const { nav, asked } = worker();
      const off = loadOffline(nav);
      const SAE = { prepare: (b, o) => off.prepareSession(b, Object.assign({ offline: off.prepare, speech: null, storage: null, localStorage: null }, o)) };
      const r = await page.prepareOf(SAE, battery, lang, `/sa/batteries/${name}`);
      // the lines' own list, before the battery file's and the task clips'
      expect(asked[0].slice().sort()).toEqual(want.slice().sort());
      // every clip of the part still asked for once, and counted
      const all = [].concat(...asked).filter((u) => u.endsWith('.mp3'));
      expect(new Set(all).size).toBe(all.length);
      expect(all.slice().sort()).toEqual(off.urls(battery, lang, '/'));
      expect(r.voice).toBe('clips');
    }
  });

  test('a line the worker could not keep counts as missing, as a task clip does', async () => {
    const b = { lines: { welcome: { text: 'hi', audio: 'sa/v1/ur/w.mp3' } }, tasks: [{ id: 't', instruction: { audio: 'sa/v1/ur/t.mp3' }, items: [] }] };
    const { nav } = worker(['/sa/v1/ur/w.mp3']);
    const off = loadOffline(nav);
    const r = await off.prepare({ battery_url: '/sa/batteries/x.json', battery: b, lang: 'ur', base: '/' });
    expect(r.clips).toBe(1);
    expect(r.clips_missing).toBe(1);
  });
});

const VOICE = path.join(__dirname, '..', 'sa', 'sa-voice.js');

/** An Audio whose n-th construction for a URL answers by `answers[n]` ('429' → onerror, 'ok' → plays and ends). */
function audioByTry(answers, log) {
  let n = 0;
  return class FakeAudio {
    constructor(src) { this.src = src; this.k = n++; log.push(['audio', src, Date.now()]); }
    play() {
      const how = answers[this.k] || 'ok';
      setTimeout(() => {
        if (how === '429') { if (this.onerror) this.onerror(new Error('429')); return; }
        if (this.onplaying) this.onplaying();
        setTimeout(() => { if (this.onended) this.onended(); }, 50);
      }, 20);
      return Promise.resolve();
    }
    pause() {}
  };
}
function speech(log, voices) {
  class Utter { constructor(text) { this.text = text; } }
  return { Utter, synth: { getVoices: () => voices, cancel() {}, speak(u) { log.push(['tts', u.text, u.lang, Date.now()]); setTimeout(() => u.onend && u.onend(), 50); } } };
}

describe('(B) a clip refused at play time', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
  afterEach(() => { jest.useRealTimers(); });

  async function run(answers, voices, lang = 'ur') {
    jest.resetModules();
    const log = [], silent = [];
    const sp = speech(log, voices);
    const v = require(VOICE).create({ lang, base: '/', Audio: audioByTry(answers, log), speechSynthesis: sp.synth, SpeechSynthesisUtterance: sp.Utter, onSilent: (e) => silent.push([e, Date.now()]) });
    let done = false;
    const p = v.speak({ ur: 'کیا آپ کو جگنو کی آواز آ رہی ہے؟', en: 'Can you hear Jugnu?' }, 'sa/v1/x/check.mp3').then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(10000);
    await p;
    return { log, silent, done };
  }

  test('429 once, then 200: the line plays, the second try 1.5 s after the first refusal', async () => {
    const { log, silent } = await run(['429', 'ok'], []);
    const tries = log.filter((x) => x[0] === 'audio');
    expect(tries).toHaveLength(2);
    expect(tries[1][2] - tries[0][2]).toBeGreaterThanOrEqual(1500);
    expect(tries[1][2] - tries[0][2]).toBeLessThan(2000);
    expect(log.some((x) => x[0] === 'tts')).toBe(false);
    expect(silent).toEqual([]);
  });

  test('429 twice, the phone has an Urdu voice: the phone says the line, within 2 s of the first refusal', async () => {
    const { log, silent } = await run(['429', '429'], [{ lang: 'ur-PK' }]);
    const tts = log.find((x) => x[0] === 'tts');
    expect(tts && tts.slice(1, 3)).toEqual(['کیا آپ کو جگنو کی آواز آ رہی ہے؟', 'ur-PK']);
    expect(tts[3] - 20).toBeLessThanOrEqual(2000 + 20);
    expect(silent).toEqual([]);
  });

  test('429 twice, no voice for the language: the words and the replay (onSilent), within 2 s, never a silent wait', async () => {
    const { log, silent } = await run(['429', '429'], [{ lang: 'en-US' }]);
    expect(log.some((x) => x[0] === 'tts')).toBe(false);
    expect(silent).toHaveLength(1);
    expect(silent[0][0]).toEqual({ text: 'کیا آپ کو جگنو کی آواز آ رہی ہے؟', lang: 'ur' });
    expect(silent[0][1] - 20).toBeLessThanOrEqual(2000 + 20);
  });

  test('English: the phone voice is one of the allowed English voices, never another en-*', async () => {
    const a = await run(['429', '429'], [{ lang: 'en-SG' }, { lang: 'en-IN' }], 'en');
    expect(a.log.find((x) => x[0] === 'tts').slice(1, 3)).toEqual(['Can you hear Jugnu?', 'en-IN']);
    const b = await run(['429', '429'], [{ lang: 'en-SG' }], 'en');
    expect(b.log.some((x) => x[0] === 'tts')).toBe(false);
    expect(b.silent).toHaveLength(1);
  });

  test('voices not loaded yet: no guess, the words and the replay', async () => {
    const { log, silent } = await run(['429', '429'], []);
    expect(log.some((x) => x[0] === 'tts')).toBe(false);
    expect(silent).toHaveLength(1);
  });
});
