'use strict';
/**
 * The offline sweep asks only for timing files that exist, and prompt_timings.json first.
 *
 * Before: sa-offline.js timingUrls() mapped EVERY v4 clip to a .json beside it and asked the service worker for all of
 * them, though only some clips have one (the rest answer 404 on every session page), and it queued
 * sa/v5/prompt_timings.json (the letter-sound picker's speech ends, which start its tap clock) behind that whole sweep.
 * After: dashboard/sa/timings.index.json lists the v4 clips that have a timing file (dashboard/scripts/sa-timings-index.js);
 * prepare() and prepVisit() read it once and ask only for those; when it cannot be read, no v4 timing is asked at all.
 * prompt_timings.json is asked on its own, before any clip.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const PT = '/sa/v5/prompt_timings.json';

function Channel() {
  const a = {}, b = {};
  a.postMessage = (data) => b.onmessage && b.onmessage({ data });
  b.postMessage = (data) => a.onmessage && a.onmessage({ data });
  this.port1 = a; this.port2 = b;
}

/** sa-offline.js loaded over a phone with a worker that records every list it is asked for, and a served index. */
function phone({ index, indexFails } = {}) {
  const asks = [];
  const fetched = [];
  const sw = { postMessage(msg, [port]) { asks.push(msg.urls.slice()); setTimeout(() => port.postMessage({ ok: true, missing: [], cached: msg.urls.length, bytes: 0 }), 1); } };
  const fetch = async (u) => {
    fetched.push(String(u));
    if (/timings\.index\.json/.test(String(u))) {
      if (indexFails === 'reject') throw new Error('offline');
      if (indexFails) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => index };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const reg = { active: sw, update: async () => {}, addEventListener() {} };
  const self = {
    navigator: { serviceWorker: { register: async () => reg, getRegistration: async () => reg, ready: Promise.resolve(reg), controller: sw } },
    MessageChannel: Channel, fetch,
  };
  const keep = global.self;
  global.self = self;
  let mod;
  try { jest.isolateModules(() => { mod = require('../sa/sa-offline'); }); } finally { global.self = keep; }
  return { mod, asks, fetched, sw };
}

const flat = (asks) => asks.reduce((a, u) => a.concat(u), []);
const v4json = (u) => /\/sa\/v4\/(ur|en)\/[^/]+\.json$/.test(u);
const clip = (u) => /\.mp3$/.test(u);

// A battery whose clips are v4 (some with a timing file in the index, some without) and one v5 picker prompt.
const B = {
  battery_id: 'b',
  lines: { welcome: { ur: 'x', audio: 'sa/v4/ur/aaaaaaaaaaa1.mp3' }, end: { ur: 'y', audio: 'sa/v4/ur/aaaaaaaaaaa2.mp3' } },
  tasks: [
    { id: 'ur.letter_pick10', instruction: { audio: { ur: 'sa/v4/ur/aaaaaaaaaaa3.mp3' } }, items: [{ id: 'p1', prompt_audio: 'sa/v5/ur/bbbbbbbbbbb1.mp3' }] },
    { id: 'ur.words4', instruction: { audio: { ur: 'sa/v4/ur/aaaaaaaaaaa4.mp3' } }, items: [] },
  ],
};
const INDEX = { ur: ['aaaaaaaaaaa1', 'aaaaaaaaaaa4'], en: [] };

describe('timingUrls(list, index): only the timing files the index lists, prompt_timings.json first', () => {
  const { timingUrls } = require('../sa/sa-offline');
  test('a v4 clip not in the index gets no .json; prompt_timings.json leads', () => {
    expect(timingUrls(['/sa/v4/ur/aaaaaaaaaaa1.mp3', '/sa/v4/ur/aaaaaaaaaaa2.mp3', '/sa/v5/ur/bbbbbbbbbbb1.mp3', '/sa/v4/en/aaaaaaaaaaa1.mp3'], INDEX))
      .toEqual([PT, '/sa/v4/ur/aaaaaaaaaaa1.json']);
  });
  test('no index: never the blind sweep, prompt_timings.json only', () => {
    expect(timingUrls(['/sa/v4/ur/aaaaaaaaaaa1.mp3', '/sa/v5/ur/bbbbbbbbbbb1.mp3'])).toEqual([PT]);
    expect(timingUrls(['/sa/v4/ur/aaaaaaaaaaa1.mp3'], null)).toEqual([]);
  });
  test('the committed index against every v4 clip on disk: exactly the timing files that exist, 0 unlisted', () => {
    const idx = JSON.parse(fs.readFileSync(path.join(SA, 'timings.index.json'), 'utf8'));
    const clips = [];
    const have = new Set();
    for (const lang of ['ur', 'en']) {
      for (const n of fs.readdirSync(path.join(SA, 'v4', lang))) {
        if (/\.mp3$/.test(n)) clips.push(`/sa/v4/${lang}/${n}`);
        if (/\.json$/.test(n)) have.add(`/sa/v4/${lang}/${n}`);
      }
    }
    const asked = timingUrls(clips, idx);
    expect(asked.filter((u) => !have.has(u))).toEqual([]);
    expect(new Set(asked)).toEqual(have);
  });
});

describe('dashboard/sa/timings.index.json is the folder and the lock', () => {
  const { build } = require('../scripts/sa-timings-index');
  test('committed index == the folder (rerun node dashboard/scripts/sa-timings-index.js) == the lock\'s v4 .json set', () => {
    const idx = JSON.parse(fs.readFileSync(path.join(SA, 'timings.index.json'), 'utf8'));
    expect(idx).toEqual(build());
    const lock = JSON.parse(fs.readFileSync(path.join(SA, 'clips.lock.json'), 'utf8'));
    const locked = Object.keys(lock.files).map((p) => /^dashboard\/sa\/v4\/(ur|en)\/([0-9a-f]{12})\.json$/.exec(p)).filter(Boolean).map((m) => `${m[1]}/${m[2]}`).sort();
    const listed = ['ur', 'en'].reduce((a, l) => a.concat(idx[l].map((k) => `${l}/${k}`)), []).sort();
    expect(listed).toEqual(locked);
    expect(listed.length).toBe(581);
  });
  test('the index is outside the lock\'s scope and the worker answers it network first (no SESSION tie)', () => {
    const { digest } = require('../scripts/sa-clips-lock');
    const { strategyFor } = require('../sa/sw');
    expect(Object.keys(digest())).not.toContain('dashboard/sa/timings.index.json');
    expect(strategyFor('https://p.test/sa/timings.index.json', 'GET', 'https://p.test')).toBe('core');
  });
});

describe('prepare() (the child\'s page): prompt_timings.json first, then only the indexed timings', () => {
  test('served index: the timing list asked == the index\'s files; prompt_timings.json before any v4 clip', async () => {
    const { mod, asks, fetched } = phone({ index: INDEX });
    const r = await mod.prepare({ battery_url: '/sa/batteries/x.json', battery: B, lang: 'ur', base: '/' });
    await new Promise((ok) => setTimeout(ok, 30));
    const all = flat(asks);
    expect(fetched.filter((u) => /timings\.index\.json/.test(u))).toEqual(['/sa/timings.index.json']);
    expect(all.filter(v4json)).toEqual(['/sa/v4/ur/aaaaaaaaaaa1.json', '/sa/v4/ur/aaaaaaaaaaa4.json']);
    expect(all.indexOf(PT)).toBeGreaterThanOrEqual(0);
    expect(asks.findIndex((l) => l.includes(PT))).toBeLessThan(asks.findIndex((l) => l.some(clip)));
    expect(all.filter((u) => u === PT)).toHaveLength(1);
    // prompt_timings.json is not a clip: it is never counted among the session's clips
    expect(r.clips).toBe(mod.urls(B, 'ur', '/').length);
    expect(r.clips_missing).toBe(0);
  });
  test.each([['404', true], ['refused', 'reject']])('index %s: prompt_timings.json only, no v4 timing', async (_n, fails) => {
    const { mod, asks } = phone({ indexFails: fails });
    await mod.prepare({ battery_url: '/sa/batteries/x.json', battery: B, lang: 'ur', base: '/' });
    await new Promise((ok) => setTimeout(ok, 30));
    const all = flat(asks);
    expect(all.filter(v4json)).toEqual([]);
    expect(all.filter((u) => u === PT)).toHaveLength(1);
  });
});

describe('prepVisit() (Get ready on the coach page): prompt_timings.json before the clips, then only the indexed timings', () => {
  const run = async (opts) => {
    const { mod, asks, fetched } = phone(opts);
    const msgs = [];
    const ask = async (m) => { msgs.push(m.urls.slice()); return { ok: true, cached: m.urls.length, missing: [], bytes: 0 }; };
    const r = await mod.prepVisit({ forms: ['sa.coach.G2.A.ur'], ask, readBattery: async () => B });
    return { r, msgs, asks, fetched, mod };
  };
  test('served index: prompt_timings.json right after the battery, before any clip; the sweep == the index\'s files', async () => {
    const { r, msgs, fetched, mod } = await run({ index: INDEX });
    expect(msgs[0]).toEqual(['/sa/batteries/sa.coach.G2.A.ur.json']);
    expect(msgs[1]).toEqual([PT]);
    expect(msgs.findIndex((l) => l.includes(PT))).toBeLessThan(msgs.findIndex((l) => l.some(clip)));
    expect(flat(msgs).filter(v4json)).toEqual(['/sa/v4/ur/aaaaaaaaaaa1.json', '/sa/v4/ur/aaaaaaaaaaa4.json']);
    expect(fetched.filter((u) => /timings\.index\.json/.test(u))).toEqual(['/sa/timings.index.json']);
    // not a file of the visit: the counts are the battery's own
    expect(r.total).toBe(1 + mod.urls(B, 'ur', '/').length + mod.ART.length);
    expect(r.ok).toBe(true);
  });
  test('index not served: prompt_timings.json only, no v4 timing', async () => {
    const { r, msgs } = await run({ indexFails: true });
    expect(flat(msgs).filter(v4json)).toEqual([]);
    expect(flat(msgs).filter((u) => u === PT)).toHaveLength(1);
    expect(r.ok).toBe(true);
  });
});
