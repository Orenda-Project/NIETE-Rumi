/**
 * A missing page asset under /wq/ is a 404, not a 500.
 *
 * The page's files are served with express.static({fallthrough: false}), which
 * hands a missing file on as an error with status 404. The portal's last-resort
 * error handler answers every error 500, so a page cached before a deploy that
 * asked for a renamed file read as a server failure in the error monitors.
 * The real router runs on an ephemeral port behind an app-level handler like
 * the portal's own (everything it sees is a 500).
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

function get(srv, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    }).on('error', reject);
  });
}

let srv;
beforeEach(async () => {
  const app = express();
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => { throw new Error('no bot in this test'); } }));
  app.use((err, req, res, next) => res.status(500).send('Server Error')); // the portal's own last resort
  srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
});
afterEach(() => new Promise((r) => srv.close(r)));

test('a missing /wq/ file: 404, not cached, not the portal error page', async () => {
  for (const path of ['/wq/wq-gone.js', '/wq/art/subject-gone-1.webp']) {
    const res = await get(srv, path);
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).not.toMatch(/Server Error/);
  }
});

test('an existing /wq/ file is still served with its long cache', async () => {
  const res = await get(srv, '/wq/wq.js');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/javascript/);
  expect(res.headers['cache-control']).toMatch(/immutable/);
});
