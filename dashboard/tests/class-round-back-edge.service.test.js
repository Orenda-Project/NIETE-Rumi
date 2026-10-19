/**
 * The class round's hand-back at the edge: GET /c/:token/back asks the bot where this turn's phone goes back to
 * (the bot keeps the teacher's report token server-side, keyed by the turn) and answers 303 there. Anything else
 * (an unknown or expired key, the bot down or odd) is a 303 to the turn's own page, the Home the end card had; never
 * an error page, never a 5xx. The bot is the faked boundary.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const TT = `${'a'.repeat(40)}.${'b'.repeat(22)}`;
const RT = `${'r'.repeat(60)}.${'s'.repeat(22)}`;

function jsonRes(status, body) {
  return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function server(answer) {
  const calls = [];
  const app = express();
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(url, init); } }));
  return new Promise((r) => { const srv = app.listen(0, () => r({ srv, calls })); });
}
// a fresh profile: no cookie, no stored device, nothing but the URL
function get(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    r.on('error', reject); r.end();
  });
}

test('/c/<tt>/back 303s to /r/<tok>/round, from a fresh profile (no cookie, no device)', async () => {
  const { srv, calls } = await server(() => jsonRes(200, { to: `/r/${RT}/round?lang=ur` }));
  try {
    const r = await get(srv, `/c/${TT}/back?lang=ur`);
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe(`/r/${RT}/round?lang=ur`);
    expect(r.headers['cache-control']).toMatch(/no-store/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/ch/${TT}/back?lang=ur`);
    expect(calls[0].init.headers).not.toHaveProperty('x-wq-device');
  } finally { srv.close(); }
});

test('an unknown/expired back key -> 303 to the turn\'s own page (Home), no 5xx', async () => {
  const answers = [() => jsonRes(200, { to: null }), () => jsonRes(500, { error: 'server_error' }), () => jsonRes(503, { error: 'unavailable' }),
    () => { throw new Error('ECONNREFUSED'); }, () => jsonRes(200, { to: 'https://elsewhere.test/r/x/round' }), () => jsonRes(200, { to: `/r/${RT}/pdf` })];
  for (const a of answers) {
    const { srv } = await server(a);
    try {
      const r = await get(srv, `/c/${TT}/back?lang=en`);
      expect(r.status).toBe(303);
      expect(r.headers.location).toBe(`/c/${TT}?lang=en`);
    } finally { srv.close(); }
  }
});

test('no lang: English; a malformed token never reaches the bot and is not a 5xx', async () => {
  const { srv, calls } = await server(() => jsonRes(200, { to: null }));
  try {
    const r = await get(srv, `/c/${TT}/back`);
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe(`/c/${TT}?lang=en`);
    const bad = await get(srv, '/c/nope/back');
    expect(bad.status).toBe(404);
    expect(calls).toHaveLength(1);
  } finally { srv.close(); }
});

test('the bot off (no bot url): 303 home, never an error page', async () => {
  const app = express();
  app.use(createWebQuizRouter({ botUrl: '', apiKey: '', fetchImpl: async () => { throw new Error('never'); } }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const r = await get(srv, `/c/${TT}/back?lang=ur`);
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe(`/c/${TT}?lang=ur`);
  } finally { srv.close(); }
});

test('the phone\'s wq_dv cookie goes to the bot as x-wq-device (the bot answers only the phone the round page was opened on)', async () => {
  const { srv, calls } = await server(() => jsonRes(200, { to: null }));
  try {
    const r = await get(srv, `/c/${TT}/back?lang=en`, { cookie: 'wq_dv=DeviceRefTeacher_00001' });
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe(`/c/${TT}?lang=en`);
    expect(calls[0].init.headers['x-wq-device']).toBe('DeviceRefTeacher_00001');
  } finally { srv.close(); }
});
