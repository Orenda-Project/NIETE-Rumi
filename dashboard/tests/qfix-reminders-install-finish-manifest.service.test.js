/**
 * c2: the finish screen's install manifest. GET /q/<code>/manifest.webmanifest answers the base Jugnu manifest with one
 * fixed id (so every finish-screen install is the SAME app to Chrome: no second icon, no re-offer after the next quiz;
 * qa-design 181359), start_url /q/<code>?from=hs (reopening a finished link on that phone lands on that child's hub
 * through link_home) and scope '/'. A malformed code is a 404. The bot is never asked.
 */
const http = require('http');
const express = require('express');
const R = require('../routes/web-quiz.routes');

function get(srv, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example' } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: b }));
    });
    r.on('error', reject); r.end();
  });
}
async function withRouter(fn) {
  const calls = [];
  const app = express();
  app.use(R.createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'test-internal-key', fetchImpl: (u) => { calls.push(u); return Promise.reject(new Error('no bot here')); } }));
  const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await fn(srv, calls); } finally { await new Promise((r) => srv.close(r)); }
}

test('a code: the base manifest with a fixed id, start_url back to that quiz from the home screen, scope /', async () => {
  await withRouter(async (srv, calls) => {
    const r = await get(srv, '/q/AB12CD/manifest.webmanifest');
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/application\/manifest\+json/);
    const m = JSON.parse(r.body);
    expect(m).toMatchObject({ name: 'Jugnu', short_name: 'Jugnu', display: 'standalone', id: '/wq/jugnu', start_url: '/q/AB12CD?from=hs', scope: '/' });
    expect(m.icons.length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });
});
test('two codes: the same id (one app)', async () => {
  await withRouter(async (srv) => {
    const a = JSON.parse((await get(srv, '/q/AB12CD/manifest.webmanifest')).body);
    const b = JSON.parse((await get(srv, '/q/ZZ99YY/manifest.webmanifest')).body);
    expect(a.id).toBe(b.id);
    expect(a.start_url).not.toBe(b.start_url);
  });
});
test.each(['/q/ab%3Cx/manifest.webmanifest', '/q/A/manifest.webmanifest', '/q/AAAAAAAAAAAAAAAAAAAAAAAAA/manifest.webmanifest'])('%s: 404', async (p) => {
  await withRouter(async (srv) => { expect((await get(srv, p)).status).toBe(404); });
});
