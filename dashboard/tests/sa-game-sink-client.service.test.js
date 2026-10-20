'use strict';
/**
 * The game sink (dashboard/sa/sink-game.js): the engine's calls become the big flight's token routes with the run
 * token, the phone's device ref (wq_d) as x-wq-device, a spoken answer's recording carrying its question, and a refused
 * call throwing (the sync keeps it for later). A fake fetch; nothing leaves the test.
 */
const Sink = require('../sa/sink-game');

function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const a = answers.shift() || { status: 200, body: {} };
    return { ok: a.status < 300, status: a.status, json: async () => a.body };
  };
  return { f, calls };
}

const DEV = 'AbCdEfGhIjKlMnOpQrStUv';
let store = {};
beforeEach(() => {
  store = { wq_d: JSON.stringify(DEV) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => (k in store ? store[k] : null), setItem: () => {} } });
});

test('batch, presign, register and status go to the token routes with the run token and the device ref', async () => {
  const { f, calls } = fakeFetch([
    { status: 200, body: { ok: true, acked_to: 9, ackedTo: 9 } },
    { status: 200, body: { url: 'https://r2.example/u', key: 'k1' } },
    { status: 200, body: { ok: true } },
    { status: 200, body: { status: 'in_progress', tasks_done: ['ur.letters'], last_seq: 9 } },
  ]);
  const s = Sink.create({ st: 'run.tok', session_id: 'S-1', fetchImpl: f });
  expect(await s.putBatch({ session_id: 'local', seq_from: 1, seq_to: 9, events: [{ seq: 1 }], results: [] })).toEqual({ ok: true, acked_to: 9 });
  expect(await s.presignAudio({ task_id: 'ur.story_comp/q2', mime: 'audio/webm', bytes: 10 })).toEqual({ url: 'https://r2.example/u', key: 'k1' });
  expect(await s.registerAudio({ task_id: 'ur.story', key: 'k1', bytes: 10, duration_ms: 60000 })).toEqual({ ok: true });
  expect(await s.status()).toEqual({ status: 'in_progress', tasks_done: ['ur.letters'], last_seq: 9 });
  expect(calls.map((c) => [c.method, c.url])).toEqual([
    ['POST', '/api/sa-game/s/batch'],
    ['POST', '/api/sa-game/s/audio/presign'],
    ['POST', '/api/sa-game/s/audio/register'],
    ['GET', '/api/sa-game/s/status?st=run.tok'],
  ]);
  // the coach sink's wire shapes, with the run token and the server's session id
  expect(calls[0].body).toEqual({ st: 'run.tok', sessionId: 'S-1', seqFrom: 1, seqTo: 9, events: [{ seq: 1 }], results: [] });
  expect(calls[1].body).toEqual({ st: 'run.tok', taskId: 'ur.story_comp', itemId: 'q2', mime: 'audio/webm', bytes: 10 });
  expect(calls[2].body).toEqual({ st: 'run.tok', taskId: 'ur.story', key: 'k1', bytes: 10, durationMs: 60000 });
  calls.forEach((c) => expect(c.headers['x-wq-device']).toBe(DEV));
});

test('the device ref: {id} form too; a malformed or missing one sends no header (never minted here)', async () => {
  const { f, calls } = fakeFetch([]);
  store = { wq_d: JSON.stringify({ id: DEV }) };
  await Sink.create({ st: 'x', session_id: 's', fetchImpl: f }).status();
  store = { wq_d: '"short"' };
  await Sink.create({ st: 'x', session_id: 's', fetchImpl: f }).status();
  store = { wq_d: '{not json' };
  await Sink.create({ st: 'x', session_id: 's', fetchImpl: f }).status();
  expect(calls[0].headers['x-wq-device']).toBe(DEV);
  expect(calls[1].headers['x-wq-device']).toBeUndefined();
  expect(calls[2].headers['x-wq-device']).toBeUndefined();
});

test('ackedTo (the coach shape) is read; the engine option name fetch works too', async () => {
  const { f } = fakeFetch([{ status: 200, body: { ackedTo: 4 } }]);
  expect(await Sink.create({ st: 'x', session_id: 's', fetch: f }).putBatch({ seq_from: 1, seq_to: 9, events: [], results: [] })).toEqual({ ok: true, acked_to: 4 });
});

test('a switched-off route or a bad token throws with its status, so the sync keeps the data; status() answers null', async () => {
  const { f } = fakeFetch([{ status: 404, body: { off: true } }, { status: 401, body: {} }, { status: 503, body: {} }, { status: 404, body: { off: true } }]);
  const s = Sink.create({ st: 'x', session_id: 's', fetchImpl: f });
  await expect(s.putBatch({ seq_from: 1, seq_to: 1, events: [], results: [] })).rejects.toMatchObject({ status: 404 });
  await expect(s.presignAudio({ task_id: 'ur.story', mime: 'audio/webm', bytes: 1 })).rejects.toMatchObject({ status: 401 });
  await expect(s.registerAudio({ task_id: 'ur.story', key: 'k', bytes: 1, duration_ms: 1 })).rejects.toMatchObject({ status: 503 });
  expect(await s.status()).toBeNull();
});

test('forGame: opens its run once on first use, with the engine run number, then uses the run token', async () => {
  const { f, calls } = fakeFetch([
    { status: 200, body: { session_id: 'S-9', st: 'tok9' } },
    { status: 200, body: { ok: true, ackedTo: 2 } },
    { status: 200, body: { ok: true, ackedTo: 4 } },
  ]);
  const boot = { token: 'hub.tok', kid: '0123456789abcdef', form: 'game.G23', lang: 'ur' };
  const s = Sink.forGame(boot, 'urdu', undefined, { fetchImpl: f });
  expect(await s.putBatch({ session_id: 'g.0123456789abcdef.game.G23.urdu.3', seq_from: 1, seq_to: 2, events: [], results: [] })).toEqual({ ok: true, acked_to: 2 });
  await s.putBatch({ session_id: 'g.0123456789abcdef.game.G23.urdu.3', seq_from: 3, seq_to: 4, events: [], results: [] });
  expect(calls.map((c) => c.url)).toEqual(['/api/sa-game/s/session', '/api/sa-game/s/batch', '/api/sa-game/s/batch']);
  expect(calls[0].body).toEqual({ t: 'hub.tok', kid: '0123456789abcdef', part: 'urdu', form: 'game.G23', lang: 'ur', n: 3 });
  expect(calls[1].body.st).toBe('tok9');
  expect(calls[1].body.sessionId).toBe('S-9');
});

test('forGame: a refused open is tried again on the next call', async () => {
  const { f, calls } = fakeFetch([
    { status: 503, body: { error: 'unavailable' } },
    { status: 200, body: { session_id: 'S-2', st: 'tok2' } },
    { status: 200, body: { ok: true, acked_to: 1 } },
  ]);
  const s = Sink.forGame({ token: 'h', kid: '0123456789abcdef', form: 'game.G1', lang: 'en' }, 'maths', 1, { fetchImpl: f });
  await expect(s.putBatch({ seq_from: 1, seq_to: 1, events: [], results: [] })).rejects.toMatchObject({ status: 503 });
  expect(await s.putBatch({ seq_from: 1, seq_to: 1, events: [], results: [] })).toEqual({ ok: true, acked_to: 1 });
  expect(calls.filter((c) => c.url.endsWith('/session'))).toHaveLength(2);
});

test('the play page asks with the session id only: the run token the map kept for it (sg.st.<id>), else no sink', async () => {
  expect(Sink.create({ session_id: 'S-9' })).toBeNull();
  store['sg.st.S-9'] = 'kept.tok';
  const { f, calls } = fakeFetch([{ status: 200, body: { ok: true, ackedTo: 2 } }]);
  const s = Sink.create({ session_id: 'S-9', fetchImpl: f });
  await s.putBatch({ seq_from: 1, seq_to: 2, events: [], results: [] });
  expect(calls[0].body.st).toBe('kept.tok');
});
