'use strict';
/**
 * The voice-readiness gate (dashboard/sa/sa-offline.js SAE.prepare, RULING #14 + #11): 'clips' when every clip of the
 * session is on the phone; else 'tts' when the phone has a voice in the session's language; else 'none' (the surface
 * refuses the start). It also asks for persistent storage and keeps both answers for the sink.
 */
const { prepareSession, urls } = require('../sa/sa-offline');
const MINI = require('./fixtures/sa-battery.g3-ur.mini.json');

function ls() { const m = {}; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; }
const speech = (langs) => ({ getVoices: () => langs.map((lang) => ({ lang })) });
const storage = (ok) => ({ persist: async () => ok, persisted: async () => false });

test('every clip on the phone → clips; persist granted is kept', async () => {
  const n = urls(MINI, 'ur', '/').length;
  expect(n).toBeGreaterThan(0);
  const l = ls();
  const r = await prepareSession(MINI, { lang: 'ur', offline: async () => ({ ready: true, battery: true, clips: n, clips_missing: 0 }), speech: speech([]), storage: storage(true), localStorage: l });
  expect(r).toMatchObject({ clips_total: n, clips_cached: n, voice: 'clips', persisted: true, ready: true });
  expect(l.m).toEqual({ 'sa:voice': 'clips', 'sa:persisted': 'true' });
});

test('a clip missing but the phone speaks the language → tts', async () => {
  const n = urls(MINI, 'ur', '/').length;
  const r = await prepareSession(MINI, { lang: 'ur', offline: async () => ({ ready: true, battery: true, clips: n - 1, clips_missing: 1 }), speech: speech(['en-US', 'ur-PK']), storage: storage(false), localStorage: ls() });
  expect(r).toMatchObject({ clips_total: n, clips_cached: n - 1, voice: 'tts', persisted: false });
});

test('no clips and no voice in the language → none; no worker, no storage API never throw', async () => {
  const l = ls();
  const r = await prepareSession(MINI, { lang: 'ur', offline: async () => ({ ready: false, why: 'no_service_worker' }), speech: speech(['en-GB']), storage: null, localStorage: l });
  expect(r).toMatchObject({ clips_cached: 0, voice: 'none', persisted: false, ready: false });
  expect(l.m['sa:voice']).toBe('none');
  const e = await prepareSession({ tasks: [] }, { lang: 'en', offline: async () => ({ ready: true, clips: 0 }), speech: null, storage: null, localStorage: null });
  expect(e).toMatchObject({ clips_total: 0, voice: 'none' });
});
