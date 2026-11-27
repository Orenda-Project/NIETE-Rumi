/**
 * The practice door at the public edge (A/B test ict-quiz-practice-door): POST /api/wq/practice/start and /finish go
 * to the bot's internal /api/internal/wq/practice/* with the body untouched and the bot's answer (404 while the
 * switch is off) passed back; wq-practice.js rides the page's ?v= so a phone never runs it against an old wq.js.
 * The bot is the network boundary.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createWebQuizRouter, assetVersion } = require('../routes/web-quiz.routes');

const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });

function post(srv, p, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method: 'POST', agent: false,
      headers: { host: 'portal.example', 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/129 Mobile' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    r.write(JSON.stringify(body));
    r.end();
  });
}

let srv; let calls; let answer;
beforeEach(async () => {
  calls = [];
  answer = () => jsonRes(200, { topics: ['Naming words'], rounds_left: 3 });
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', logEvent: () => {}, fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(url); } }));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
});
afterEach(() => new Promise((r) => srv.close(r)));

describe('the forwards', () => {
  test.each(['start', 'finish'])('POST /api/wq/practice/%s → the bot\'s internal route, body untouched, answer passed back, no-store', async (k) => {
    const body = { st: 'tok', topics: ['Naming words'], round_id: 'r1', answers: { p1: 'A' } };
    const r = await post(srv, `/api/wq/practice/${k}`, body);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ topics: ['Naming words'], rounds_left: 3 });
    expect(r.headers['cache-control']).toMatch(/no-store/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`http://bot.test/api/internal/wq/practice/${k}`);
    expect(JSON.parse(calls[0].init.body)).toEqual(body);
  });
  test('the switch off (the bot answers 404): the edge answers 404', async () => {
    answer = () => jsonRes(404, { error: 'not_found' });
    expect((await post(srv, '/api/wq/practice/start', { st: 'tok' })).status).toBe(404);
  });
});

describe('the asset version', () => {
  afterEach(() => jest.restoreAllMocks());
  test('a change to wq-practice.js alone changes the version', () => {
    const before = assetVersion();
    const real = fs.readFileSync;
    jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...a) => (path.basename(String(p)) === 'wq-practice.js' ? Buffer.from('changed') : real(p, ...a)));
    expect(assetVersion()).not.toBe(before);
  });
});
