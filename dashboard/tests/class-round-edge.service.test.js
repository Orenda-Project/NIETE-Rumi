/**
 * The class round's public edge (/r/:token/round, web_quiz_class_round): forwarded to the bot's
 * /api/internal/tr/round/* with the internal key. The bot is the network boundary: a fake fetch records what the
 * edge sent and plays back what the bot answers. No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createTeacherReportRouter } = require('../routes/teacher-report.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOK = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';

const botRes = (status, { body = '', location = null } = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (h) => ({ 'content-type': 'text/html; charset=utf-8', location }[h.toLowerCase()] || null) },
  text: async () => body,
  arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
});

let srv; let calls;
async function boot(answer) {
  calls = [];
  const app = express();
  app.use(createTeacherReportRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(url, init); } }));
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
function req(method, path, form = null, extra = {}) {
  return new Promise((resolve, reject) => {
    const data = form ? new URLSearchParams(form).toString() : null;
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method,
      headers: { ...extra, ...(data ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('GET /r/:token/round forwards to the bot round route with the key and lang, privately', async () => {
  await boot(() => botRes(200, { body: '<p>round</p>' }));
  const res = await req('GET', `/r/${TOK}/round?lang=ur&x=1`, null, { cookie: 'wq_dv=DeviceRefTeacher_00001' });
  expect(res.status).toBe(200);
  expect(res.body).toBe('<p>round</p>');
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(res.headers['set-cookie']).toBeUndefined();
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/round/${TOK}?lang=ur`);
  expect(calls[0].init.headers['x-api-key']).toBe(KEY);
});

test('POST next forwards only act/hold, and follows the bot\'s 303 back to /r/ only', async () => {
  await boot(() => botRes(303, { location: `/r/${TOK}/round?lang=en` }));
  const res = await req('POST', `/r/${TOK}/round/next?lang=en`, { act: 'hold', hold: '712', name: 'Asha', pos: 'x' });
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe(`/r/${TOK}/round?lang=en`);
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/round/${TOK}/next?lang=en`);
  expect(JSON.parse(calls[0].init.body)).toEqual({ act: 'hold', hold: '712' });
});

test('POST absent carries the position; a redirect anywhere else is refused', async () => {
  await boot(() => botRes(303, { location: 'https://elsewhere.test/' }));
  const res = await req('POST', `/r/${TOK}/round/absent`, { pos: '3' });
  expect(JSON.parse(calls[0].init.body)).toEqual({ pos: '3' });
  expect(res.status).toBe(502);
});

test('the bot\'s 404 (switch off) is passed through; a malformed token never reaches the bot; an unknown action is not routed', async () => {
  await boot(() => botRes(404, { body: '<p>missing</p>' }));
  expect((await req('GET', `/r/${TOK}/round`)).status).toBe(404);
  expect((await req('GET', '/r/not-a-token/round')).status).toBe(404);
  expect(calls).toHaveLength(1);
  expect((await req('POST', `/r/${TOK}/round/finish`, { act: 'hold' })).status).toBe(404);
  expect(calls).toHaveLength(1);
});

test('the ruling\'s actions are forwarded: declined {pos}, pause, resume, not-this-term (no body)', async () => {
  await boot(() => botRes(303, { location: `/r/${TOK}?tab=class&lang=en` }));
  for (const [act, form, sent] of [['declined', { pos: '2', hold: '9' }, { pos: '2', hold: '9' }], ['pause', {}, {}], ['resume', {}, {}], ['not-this-term', { x: '1' }, {}]]) {
    const res = await req('POST', `/r/${TOK}/round/${act}`, form);
    expect(res.status).toBe(303);
    const call = calls[calls.length - 1];
    expect(call.url).toBe(`${BOT}/api/internal/tr/round/${TOK}/${act}`);
    expect(JSON.parse(call.init.body)).toEqual(sent);
  }
});

// The hand-back answers only the phone the round page was opened on, so the round page needs to know that phone:
// a phone with no wq_dv cookie gets one here (the same cookie hub.js writes), and the bot gets it on this same call.
describe('the round page and the phone\'s wq_dv', () => {
  const DV = /^wq_dv=([A-Za-z0-9_-]{22}); Path=\/; Max-Age=2592000; SameSite=Lax$/;
  test('no wq_dv on the phone: the round page sets one and the bot gets it as x-wq-device', async () => {
    await boot(() => botRes(200, { body: '<p>round</p>' }));
    const res = await req('GET', `/r/${TOK}/round?lang=en`);
    expect(res.status).toBe(200);
    const set = (res.headers['set-cookie'] || []).filter((c) => c.startsWith('wq_dv='));
    expect(set).toHaveLength(1);
    const m = DV.exec(set[0]);
    expect(m).not.toBeNull();
    expect(calls[0].init.headers['x-wq-device']).toBe(m[1]);
    // two phones, two values
    const again = await req('GET', `/r/${TOK}/round?lang=en`);
    expect(DV.exec(again.headers['set-cookie'][0])[1]).not.toBe(m[1]);
  });

  test('a phone that has wq_dv keeps it: no Set-Cookie, the same value forwarded', async () => {
    await boot(() => botRes(200, { body: '<p>round</p>' }));
    const res = await req('GET', `/r/${TOK}/round?lang=en`, null, { cookie: 'a=1; wq_dv=DeviceRefTeacher_00001' });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(calls[0].init.headers['x-wq-device']).toBe('DeviceRefTeacher_00001');
  });

  test('golden: the bot\'s 404 (the round switch off), a POST and a bad token set no cookie', async () => {
    await boot((url) => (url.includes('/next') ? botRes(303, { location: `/r/${TOK}/round?lang=en` }) : botRes(404, { body: 'missing' })));
    const off = await req('GET', `/r/${TOK}/round?lang=en`);
    expect(off.status).toBe(404);
    expect(off.headers['set-cookie']).toBeUndefined();
    const post = await req('POST', `/r/${TOK}/round/next?lang=en`, { act: 'hold', hold: '712' });
    expect(post.status).toBe(303);
    expect(post.headers['set-cookie']).toBeUndefined();
    const bad = await req('GET', '/r/nope/round?lang=en');
    expect(bad.status).toBe(404);
    expect(bad.headers['set-cookie']).toBeUndefined();
  });
});
