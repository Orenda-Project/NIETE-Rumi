'use strict';
/**
 * The coach sink (dashboard/sa/sink-coach.js): the engine's calls become the portal relay's routes, in its field
 * names, with the cookie; a spoken answer's recording carries its question; a refused call throws (the sync retries).
 */
const { create } = require('../sa/sink-coach');

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
  const s = create({ fetch: f });
  expect(await s.putBatch({ session_id: 'S 1', seq_from: 1, seq_to: 9, events: [{ seq: 1 }], results: [] })).toEqual({ ok: true, acked_to: 7 });
  expect(await s.presignAudio({ session_id: 'S 1', task_id: 'ur.story_comp/ur.story.q2', mime: 'audio/webm', bytes: 10 })).toEqual({ url: 'https://r2/u', key: 'k1' });
  await s.registerAudio({ session_id: 'S 1', task_id: 'ur.story', key: 'k1', bytes: 10, duration_ms: 60000 });
  expect(calls.map((c) => [c.url, c.method, c.cred])).toEqual([
    ['/api/portal/leader/child-test/sa/session/S%201/batch', 'POST', 'include'],
    ['/api/portal/leader/child-test/sa/session/S%201/presign', 'POST', 'include'],
    ['/api/portal/leader/child-test/sa/session/S%201/register', 'POST', 'include'],
  ]);
  expect(calls[0].body).toEqual({ seqFrom: 1, seqTo: 9, events: [{ seq: 1 }], results: [] });
  expect(calls[1].body).toEqual({ taskId: 'ur.story_comp', itemId: 'ur.story.q2', mime: 'audio/webm', bytes: 10 });
  expect(calls[2].body).toEqual({ taskId: 'ur.story', key: 'k1', bytes: 10, durationMs: 60000 });
});

test('a signed-out coach or a switched-off route throws, so the sync keeps it for later', async () => {
  const { f } = fakeFetch([{ status: 401, body: {} }, { status: 404, body: {} }]);
  const s = create({ fetch: f });
  await expect(s.putBatch({ session_id: 'x', seq_from: 1, seq_to: 1, events: [], results: [] })).rejects.toMatchObject({ status: 401 });
  await expect(s.presignAudio({ session_id: 'x', task_id: 't', mime: 'audio/webm', bytes: 1 })).rejects.toMatchObject({ status: 404 });
});
