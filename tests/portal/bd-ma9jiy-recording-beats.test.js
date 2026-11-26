/**
 * bd-ma9jiy (queue #262) — the recorder's heartbeat reaches us (portal lib/recordingBeat.ts → POST /funnel/recording).
 * One batch (up to 600 one-second samples, compact columns) → ONE row `recording.beats` with the per-recording numbers a
 * reader wants (seconds offline / hidden / not in front, failed saves, storage and battery at their lowest, network
 * types, the recording's ids) and the samples themselves as one compact string; each event (start, resume, cut, stop,
 * save_failed, save_to_phone, resend…) → its own `recording.event` row. The user is the SESSION's; ids are checked.
 */
const http = require('http');
const express = require('express');

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const COLS = ['dt', 's', 'ms', 'sz', 'kb', 'st', 'on', 'vis', 'foc', 'ok', 'e', 'q', 'b', 'c', 'n'];

describe('POST /funnel/recording — the recorder heartbeat', () => {
  let emitted;
  let servers = [];
  beforeEach(() => {
    jest.resetModules();
    emitted = [];
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  });
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function app(session = { id: 'sess-1', portalUserId: USER }) {
    const a = express();
    a.use((req, _res, next) => { req.session = session; next(); });
    a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({}));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    return srv;
  }
  const post = (srv, body) => new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/portal/funnel/recording', method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject); req.write(data); req.end();
  });

  const row = (i, over = {}) => {
    const r = { dt: i * 1000, s: 100 + i, ms: (100 + i) * 1000, sz: 4100, kb: 400 + i * 4, st: 'r', on: 1, vis: 1, foc: 1, ok: 1, e: null, q: 812 - i, b: 40, c: 0, n: '4g', ...over };
    return COLS.map((k) => r[k]);
  };

  test('a batch → one recording.beats row: offline / hidden / background seconds, failed saves, lowest storage, the ids', async () => {
    const rows = [row(0), row(1, { on: 0 }), row(2, { on: 0, vis: 0 }), row(3, { foc: 0 }), row(4, { ok: 0, e: 'QuotaExceededError' }), row(5, { b: 38, n: '3g' })];
    const res = await post(await app(), {
      v: 1, rid: 'a3f1c2d4-1111-4222-8333-944455556666', kind: 'obs', visitId: 'b1c2d3e4-1111-4222-8333-944455556666', teacherExtId: 'T-123',
      b: 'whatsapp-iab', t0: Date.now() - 6000, cols: COLS, rows, ev: [],
    });
    expect(res.status).toBe(204);
    const beats = emitted.filter((x) => x.e === 'recording.beats');
    expect(beats).toHaveLength(1);
    expect(beats[0].d).toEqual(expect.objectContaining({
      userId: USER, recordingId: 'a3f1c2d4-1111-4222-8333-944455556666', kind: 'obs', visitId: 'b1c2d3e4-1111-4222-8333-944455556666',
      teacherExtId: 'T-123', samples: 6, seqFrom: 100, seqTo: 105, recordedMsTo: 105000,
      offlineSamples: 2, hiddenSamples: 1, backgroundSamples: 1, saveFailed: 1, saveErrors: 'QuotaExceededError',
      storageMinMb: 807, batteryMin: 38, batteryMax: 40, charging: false, nets: '4g,3g', kbTo: 420, final: false,
    }));
    expect(typeof beats[0].d.beats).toBe('string');
    expect(beats[0].d.beats.split(';')).toHaveLength(6);
  });

  // bd-ma9jiy (queue #262; the operator 26 Nov ~15:10): every row says what the recording belongs to — a teacher's DC
  // attempt (made at Start) as the coach's visit and the debrief's observation do — so recordingId <-> observation is on
  // every event and every batch in Axiom.
  test('a teacher DC recording: its attemptId on every beats and event row', async () => {
    const res = await post(await app(), {
      v: 1, rid: 'a3f1c2d4-1111-4222-8333-944455556666', kind: 'dc', attemptId: 'att-0f1e2d3c-4b5a', b: 'whatsapp-iab', t0: Date.now() - 2000,
      cols: COLS, rows: [row(0), row(1)], ev: [{ k: 'start', dt: 0 }],
    });
    expect(res.status).toBe(204);
    const rows = emitted.filter((x) => x.e === 'recording.beats' || x.e === 'recording.event');
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.d.attemptId === 'att-0f1e2d3c-4b5a' && x.d.recordingId === 'a3f1c2d4-1111-4222-8333-944455556666')).toBe(true);
  });

  test('each event is a recording.event row (a cut carries its gap)', async () => {
    const res = await post(await app(), {
      v: 1, rid: 'a3f1c2d4-1111-4222-8333-944455556666', kind: 'dc', t0: Date.now(), cols: COLS, rows: [],
      ev: [{ k: 'cut', dt: 0, gapS: 312, lastVis: 0, lastOn: 1, lastBattery: 12 }, { k: 'resume', dt: 5, ms: 1200000, s: 1200 }],
    });
    expect(res.status).toBe(204);
    const ev = emitted.filter((x) => x.e === 'recording.event');
    // telemetry.logEvent spreads the row's fields over { event }: a field named `event` would rename the row (seen on
    // sandbox 25 Nov: rows came in as "start", "cut"). The event's own name is `recEvent`.
    expect(ev.every((x) => !('event' in x.d))).toBe(true);
    expect(ev.map((x) => x.d.recEvent)).toEqual(['cut', 'resume']);
    expect(ev[0].d).toEqual(expect.objectContaining({ userId: USER, recordingId: 'a3f1c2d4-1111-4222-8333-944455556666', kind: 'dc', gapS: 312, lastVis: 0, lastBattery: 12 }));
  });

  // bd-91htd2 (queue #292) — a stopped recording reopened is a `reopen`, not a `cut` (207 of 235 "cuts" on 26 Nov were
  // stopped ones reopened); it must reach the log, with its age.
  test('reopen is a recording.event row with its age', async () => {
    await post(await app(), {
      v: 1, rid: 'a3f1c2d4-1111-4222-8333-944455556666', kind: 'dc', t0: Date.now(), cols: COLS, rows: [],
      ev: [{ k: 'reopen', dt: 0, ageS: 5400, finished: true, ms: 1740000 }],
    });
    const ev = emitted.filter((x) => x.e === 'recording.event');
    expect(ev.map((x) => x.d.recEvent)).toEqual(['reopen']);
    expect(ev[0].d).toEqual(expect.objectContaining({ ageS: 5400, finished: true }));
  });

  // bd-q261rec (queue #261) — how the screen was held when the recording started: native / wakelock / wakelock_refused / none.
  test('keep_awake is a recording.event row with its mode', async () => {
    await post(await app(), {
      v: 1, rid: 'a3f1c2d4-1111-4222-8333-944455556666', kind: 'obs', t0: Date.now(), cols: COLS, rows: [],
      ev: [{ k: 'keep_awake', dt: 0, mode: 'wakelock_refused' }],
    });
    const ev = emitted.filter((x) => x.e === 'recording.event');
    expect(ev.map((x) => x.d.recEvent)).toEqual(['keep_awake']);
    expect(ev[0].d.mode).toBe('wakelock_refused');
  });

  test('no session: 401, nothing logged; a bad kind or a malformed id: 400, nothing logged', async () => {
    expect((await post(await app({}), { v: 1, rid: 'x', kind: 'dc', cols: COLS, rows: [] })).status).toBe(401);
    const srv = await app();
    expect((await post(srv, { v: 1, rid: 'a3f1c2d4-1111-4222-8333-944455556666', kind: 'video', cols: COLS, rows: [row(0)] })).status).toBe(400);
    expect((await post(srv, { v: 1, rid: '<script>', kind: 'dc', cols: COLS, rows: [row(0)] })).status).toBe(400);
    expect((await post(srv, 'not json')).status).toBe(400);
    expect(emitted).toEqual([]);
  });
});
