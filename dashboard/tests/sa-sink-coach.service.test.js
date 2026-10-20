'use strict';
/**
 * The coach sink (dashboard/sa/sink-coach.js): the engine's calls become the portal relay's routes, in its field
 * names, with the cookie; a spoken answer's recording carries its question; a refused call throws (the sync retries).
 */
const { create, linked } = require('../sa/sink-coach');

function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, method: init.method || 'GET', cred: init.credentials, body: init.body ? JSON.parse(init.body) : null });
    const a = answers.shift() || { status: 200, body: {} };
    return { ok: a.status < 300, status: a.status, json: async () => a.body };
  };
  return { f, calls };
}

test('batch, presign and register go to the relay with its names and the cookie', async () => {
  const { f, calls } = fakeFetch([{ status: 200, body: { ackedTo: 7 } }, { status: 200, body: { url: 'https://r2/u', key: 'k1', expiresIn: 600 } }, { status: 200, body: { ok: true } }]);
  const s = create({ fetch: f, localStorage: null });
  expect(await s.putBatch({ session_id: 'S 1', seq_from: 1, seq_to: 9, events: [{ seq: 1 }], results: [] })).toEqual({ ok: true, acked_to: 7 });
  expect(await s.presignAudio({ session_id: 'S 1', task_id: 'ur.story_comp/ur.story.q2', mime: 'audio/webm', bytes: 10 })).toEqual({ url: 'https://r2/u', key: 'k1' });
  await s.registerAudio({ session_id: 'S 1', task_id: 'ur.story', key: 'k1', bytes: 10, duration_ms: 60000 });
  expect(calls.map((c) => [c.url, c.method, c.cred])).toEqual([
    ['/api/portal/leader/child-test/sa/session/S%201/batch', 'POST', 'include'],
    ['/api/portal/leader/child-test/sa/session/S%201/presign', 'POST', 'include'],
    ['/api/portal/leader/child-test/sa/session/S%201/register', 'POST', 'include'],
  ]);
  expect(calls[0].body).toEqual({ seqFrom: 1, seqTo: 9, events: [{ seq: 1 }], results: [], device: { mic_ok: false } });
  expect(calls[1].body).toEqual({ taskId: 'ur.story_comp', itemId: 'ur.story.q2', mime: 'audio/webm', bytes: 10 });
  expect(calls[2].body).toEqual({ taskId: 'ur.story', key: 'k1', bytes: 10, durationMs: 60000 });
});

test('a signed-out coach or a switched-off route throws, so the sync keeps it for later', async () => {
  const { f } = fakeFetch([{ status: 401, body: {} }, { status: 404, body: {} }]);
  const s = create({ fetch: f });
  await expect(s.putBatch({ session_id: 'x', seq_from: 1, seq_to: 1, events: [], results: [] })).rejects.toMatchObject({ status: 401 });
  await expect(s.presignAudio({ session_id: 'x', task_id: 't', mime: 'audio/webm', bytes: 1 })).rejects.toMatchObject({ status: 404 });
});

test('a linked phone: the token routes, no cookie, same paths underneath', async () => {
  const { f, calls } = fakeFetch([{ status: 200, body: { ackedTo: 2 } }]);
  await linked('tok_ABCDEFGHIJKLMNOP.x', { fetch: f }).putBatch({ session_id: 's1', seq_from: 1, seq_to: 2, events: [], results: [] });
  expect(calls[0]).toMatchObject({ url: '/api/portal/leader/child-test/sa/link/tok_ABCDEFGHIJKLMNOP.x/session/s1/batch', cred: 'omit' });
});

test('every batch carries the phone\'s device fields (mic check, storage, voice); a presign skip comes through', async () => {
  const m = { 'sa:mic_ok': JSON.stringify({ mic_ok: true, mic_rms: 0.31, at: 1 }), 'sa:persisted': 'true', 'sa:voice': 'tts' };
  const ls = { getItem: (k) => (k in m ? m[k] : null) };
  const { f, calls } = fakeFetch([{ status: 200, body: { ackedTo: 1 } }, { status: 200, body: { skip: true, reason: 'audio_off' } }, { status: 200, body: { ackedTo: 2 } }]);
  const s = create({ fetch: f, localStorage: ls });
  await s.putBatch({ session_id: 's', seq_from: 1, seq_to: 1, events: [], results: [] });
  expect(calls[0].body.device).toEqual({ mic_ok: true, mic_rms: 0.31, persisted: true, voice: 'tts' });
  expect(await s.presignAudio({ session_id: 's', task_id: 't', mime: 'audio/webm', bytes: 1 })).toEqual({ skip: true, reason: 'audio_off' });
  // the game's own mic check keeps two keys
  m['sa:mic_ok'] = '1'; m['sa:mic_rms'] = '0.2'; delete m['sa:persisted'];
  await s.putBatch({ session_id: 's', seq_from: 2, seq_to: 2, events: [], results: [] });
  expect(calls[2].body.device).toEqual({ mic_ok: true, mic_rms: 0.2, voice: 'tts' });
});
