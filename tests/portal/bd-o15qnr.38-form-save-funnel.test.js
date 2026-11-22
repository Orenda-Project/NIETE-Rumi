/**
 * bd-o15qnr.38 (queue #219) — the v7 Feedback Form's save now has a time limit (portal coach/reports/saveTry.ts), and
 * the page reports how its save went, so the next "stuck on Saving" is visible from the phone's side too (on 22 Nov the
 * server logs showed only the 1 s save, nothing of the 45 s the phone waited). POST /funnel/coach-flow takes:
 *   form.save_slow   no answer for a few seconds
 *   form.save_retry  a try was lost and the same answers were sent once more
 *   form.save_lost   both tries lost: "Not saved", the answers kept on the phone
 * Anything else is still a 400 and logs nothing.
 */
const http = require('http');
const express = require('express');

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const JOURNEY = 'j_0123456789abcdef';

describe('POST /funnel/coach-flow — the v7 form save actions', () => {
  let emitted;
  let servers = [];
  beforeEach(() => {
    jest.resetModules();
    emitted = [];
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  });
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function app() {
    const a = express();
    a.use((req, _res, next) => { req.session = { id: 'sess-1', portalUserId: USER, appJourney: { id: JOURNEY, at: Date.now(), feature: 'coach_observe' } }; next(); });
    a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({}));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    return srv;
  }
  const post = (srv, body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/portal/funnel/coach-flow', method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject); req.write(data); req.end();
  });

  test.each(['form.save_slow', 'form.save_retry', 'form.save_lost'])('%s → app_funnel.coach_flow', async (a) => {
    const res = await post(await app(), { a });
    expect(res.status).toBe(204);
    const row = emitted.find((x) => x.e === 'app_funnel.coach_flow');
    expect(row.d).toEqual(expect.objectContaining({ userId: USER, journeyId: JOURNEY, action: a, level: null }));
  });

  test('a made-up form action is still a 400 and logs nothing', async () => {
    const res = await post(await app(), { a: 'form.save_anything' });
    expect(res.status).toBe(400);
    expect(emitted).toEqual([]);
  });

  test('the portal tracker and the server name the same three actions', () => {
    const fs = require('fs');
    const path = require('path');
    const track = fs.readFileSync(path.join(__dirname, '../../portal/src/portal/coach/flow/track.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const a of ['form.save_slow', 'form.save_retry', 'form.save_lost']) expect(track).toContain(`"${a}"`);
  });
});
