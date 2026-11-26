/**
 * bd-2z5fuc (queue #305, P0 26 Nov) — the coaching breakdown's body is bigger than the bot's global JSON limit.
 *
 * The portal's coaching report page (GET /api/portal/coaching-session/:id) posts the session's whole analysis_data to
 * the bot's POST /api/internal/coaching/breakdown. The bot's one app-level express.json() has body-parser's default
 * 100kb limit; on 26 Nov a session's body was 105,504 bytes, so the bot answered 413 PayloadTooLargeError, the portal
 * answered 500, and the teacher's report page would not open (137 times, one teacher). analysis_data grew that day
 * (p50 52 KB -> 75 KB), so more sessions cross 100kb.
 *
 * The fix gives THAT route its own JSON limit, and only for a caller with the internal key; every other route, and
 * a caller without the key, keeps the 100kb default.
 */
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

const KEY = 'test-internal-key';
const { mountInternalJsonLimits, INTERNAL_JSON_LIMITS } = require('../../shared/routes/internal-json-limits');

/** The bot's own order: the route limits first, then the global parser, then the routes. */
function app() {
  const a = express();
  mountInternalJsonLimits(a, { verify: (req, _res, buf) => { req.rawBody = buf; } });
  a.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  const echo = (req, res) => res.json({ bytes: req.rawBody ? req.rawBody.length : 0, keys: Object.keys(req.body || {}) });
  a.post('/api/internal/coaching/breakdown', echo);
  a.post('/api/internal/other', echo);
  a.post('/webhook', echo);
  // Express's default handler answers a body-parser error with its status (413).
  return a;
}

function post(server, url, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path: url, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers },
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

/** A body of about `bytes` UTF-8 bytes, Urdu text like a real report (3 bytes a character). */
function analysisOf(bytes) {
  const urdu = 'استاد نے بچوں سے سوال پوچھا ';
  const unit = Buffer.byteLength(urdu);
  return { v3_fico: { evidence: urdu.repeat(Math.ceil(bytes / unit)) }, overall_percentage: 61 };
}

describe('internal JSON limits (bd-2z5fuc)', () => {
  let server;
  const before = process.env.INTERNAL_API_KEY;
  beforeAll((done) => { process.env.INTERNAL_API_KEY = KEY; server = app().listen(0, '127.0.0.1', done); });
  afterAll((done) => { process.env.INTERNAL_API_KEY = before; server.close(done); });

  test('the breakdown route carries the size of the session that failed on 26 Nov (105,504 bytes)', async () => {
    const r = await post(server, '/api/internal/coaching/breakdown', { analysisData: analysisOf(105_504), language: 'en' }, { 'x-api-key': KEY });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).keys).toEqual(['analysisData', 'language']);
    expect(JSON.parse(r.body).bytes).toBeGreaterThan(102_400);
  });

  test('…and room to grow: a 600 KB analysis still answers 200', async () => {
    const r = await post(server, '/api/internal/coaching/breakdown', { analysisData: analysisOf(600_000) }, { 'x-api-key': KEY });
    expect(r.status).toBe(200);
  });

  test('without the internal key the breakdown route keeps the 100kb default', async () => {
    const r = await post(server, '/api/internal/coaching/breakdown', { analysisData: analysisOf(105_504) });
    expect(r.status).toBe(413);
  });

  test('with a wrong key it keeps the 100kb default', async () => {
    const r = await post(server, '/api/internal/coaching/breakdown', { analysisData: analysisOf(105_504) }, { 'x-api-key': 'nope' });
    expect(r.status).toBe(413);
  });

  test('every other route keeps the 100kb default, key or no key', async () => {
    expect((await post(server, '/api/internal/other', { analysisData: analysisOf(105_504) }, { 'x-api-key': KEY })).status).toBe(413);
    expect((await post(server, '/webhook', { entry: analysisOf(105_504) })).status).toBe(413);
  });

  test('a small body on the breakdown route is parsed once, rawBody kept', async () => {
    const r = await post(server, '/api/internal/coaching/breakdown', { analysisData: { a: 1 } }, { 'x-api-key': KEY });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ bytes: Buffer.byteLength(JSON.stringify({ analysisData: { a: 1 } })), keys: ['analysisData'] });
  });

  test('the limit is above 100kb and bounded (never unlimited)', () => {
    const limit = INTERNAL_JSON_LIMITS['/api/internal/coaching/breakdown'];
    expect(limit).toBe('1mb');
  });

  test('whatsapp-bot.js mounts the route limits BEFORE its global express.json', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8');
    const mount = src.indexOf('mountInternalJsonLimits(app');
    const global = src.indexOf('app.use(express.json(');
    expect(mount).toBeGreaterThan(-1);
    expect(global).toBeGreaterThan(-1);
    expect(mount).toBeLessThan(global);
  });
});
