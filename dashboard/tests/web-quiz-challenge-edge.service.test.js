/**
 * The Challenge at the edge: /c/:token server-renders the page shell from the bot's menu, and the
 * /api/wq/ch/* calls are forwarded to the bot's /api/internal/wq/ch/*. The bot is the faked boundary.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const TOKEN = `${'a'.repeat(40)}.${'b'.repeat(22)}`;

function jsonRes(status, body) {
  return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function server(answer) {
  const calls = [];
  const app = express();
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(url, init); } }));
  return new Promise((r) => { const srv = app.listen(0, () => r({ srv, calls })); });
}
function req(srv, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const CT9 = `${'g'.repeat(40)}.${'h'.repeat(22)}`;
const MENU = { lang: 'ur', form: 'G3', exercises: [{ id: 'bigger', name: 'کون سا بڑا ہے؟', mins: 2, done: false, last: null }] };

test('GET /c/:token renders the shell with the menu as boot JSON and the challenge script; Urdu page', async () => {
  const { srv, calls } = await server(() => jsonRes(200, MENU));
  try {
    const r = await req(srv, 'GET', `/c/${TOKEN}?kid=0123456789abcdef&lang=ur`);
    expect(r.status).toBe(200);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/ch/${TOKEN}?kid=0123456789abcdef&lang=ur`);
    expect(r.body).toContain('<html lang="ur" dir="rtl">');
    expect(r.body).toMatch(/<script src="\/wq\/wq-challenge\.js\?v=[0-9a-f]{10}" defer><\/script>/);
    const boot = JSON.parse(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(r.body)[1]);
    expect(boot).toMatchObject({ token: TOKEN, kid: '0123456789abcdef', menu: MENU, mascot: 'جگنو' });
    expect(r.body).toContain('جگنو کا چیلنج');
    expect(r.body).not.toMatch(/EGRA|EGMA|assessment/i);
  } finally { srv.close(); }
});

test('a malformed token never reaches the bot; not eligible gets its own note', async () => {
  const { srv, calls } = await server(() => jsonRes(403, { error: 'not_eligible' }));
  try {
    expect((await req(srv, 'GET', '/c/nope')).status).toBe(404);
    expect(calls).toHaveLength(0);
    const r = await req(srv, 'GET', `/c/${TOKEN}`);
    expect(r.status).toBe(403);
    expect(r.body).toContain('This challenge is for classes 2 to 5.');
  } finally { srv.close(); }
});

test('the /api/wq/ch/* calls forward to the bot; result/<ct> is the poll, not an exercise', async () => {
  const { srv, calls } = await server(() => jsonRes(200, { ok: 1 }));
  try {
    await req(srv, 'GET', `/api/wq/ch/result/${CT9}`);
    await req(srv, 'GET', `/api/wq/ch/${TOKEN}/read?lang=en`);
    await req(srv, 'POST', '/api/wq/ch/upload', { ct: 'CT9', type: 'audio/webm', size: 10 });
    await req(srv, 'POST', '/api/wq/ch/result', { ct: 'CT9', key: 'k' });
    expect(calls.map((c) => `${c.init.method} ${c.url.replace(BOT, '')}`)).toEqual([
      `GET /api/internal/wq/ch/result/${CT9}`,
      `GET /api/internal/wq/ch/${TOKEN}/read?lang=en`,
      'POST /api/internal/wq/ch/upload',
      'POST /api/internal/wq/ch/result',
    ]);
    expect(JSON.parse(calls[2].init.body)).toEqual({ ct: 'CT9', type: 'audio/webm', size: 10 });
  } finally { srv.close(); }
});

test('a classroom behind one carrier IP is not throttled together: upload/result limits are per challenge token', async () => {
  const { srv } = await server(() => jsonRes(200, { ok: 1 }));
  try {
    const many = await Promise.all(Array.from({ length: 70 }, (_, i) => req(srv, 'POST', '/api/wq/ch/result', { ct: `${'c'.repeat(30)}${i}.${'d'.repeat(22)}`, key: 'k' })));
    expect(many.filter((r) => r.status === 429)).toHaveLength(0);
    const same = await Promise.all(Array.from({ length: 25 }, () => req(srv, 'POST', '/api/wq/ch/upload', { ct: `${'e'.repeat(30)}.${'f'.repeat(22)}`, type: 'audio/webm', size: 1 })));
    expect(same.filter((r) => r.status === 429).length).toBeGreaterThan(0);
  } finally { srv.close(); }
});

test('a malformed token on the challenge API never reaches the bot', async () => {
  const { srv, calls } = await server(() => jsonRes(200, { ok: 1 }));
  try {
    expect((await req(srv, 'GET', '/api/wq/ch/nope')).status).toBe(404);
    expect((await req(srv, 'GET', '/api/wq/ch/nope/read')).status).toBe(404);
    expect((await req(srv, 'GET', '/api/wq/ch/result/nope')).status).toBe(404);
    expect(calls).toHaveLength(0);
  } finally { srv.close(); }
});

// A forwarded hub link: the phone's device_ref rides in the wq_dv cookie (written by the hub page) and reaches
// the bot as x-wq-device; the bot refuses another phone with 403 other_device.
function reqCookie(srv, path, cookie) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path, headers: cookie ? { cookie } : {} }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    }).on('error', reject);
  });
}

test('the wq_dv cookie reaches the bot as x-wq-device on the page and on the API; a malformed one is dropped', async () => {
  const { srv, calls } = await server(() => jsonRes(200, MENU));
  try {
    await reqCookie(srv, `/c/${TOKEN}?kid=0123456789abcdef`, 'a=1; wq_dv=FamilyPhoneDeviceRef_1');
    expect(calls[0].init.headers['x-wq-device']).toBe('FamilyPhoneDeviceRef_1');
    await reqCookie(srv, `/api/wq/ch/${TOKEN}/bigger?kid=0123456789abcdef`, 'wq_dv=FamilyPhoneDeviceRef_1');
    expect(calls[1].init.headers['x-wq-device']).toBe('FamilyPhoneDeviceRef_1');
    await reqCookie(srv, `/c/${TOKEN}`, 'wq_dv=not-a-ref');
    expect(calls[2].init.headers['x-wq-device']).toBeUndefined();
  } finally { srv.close(); }
});

test('another phone (bot 403 other_device): a neutral note naming nobody, in the page language', async () => {
  const { srv } = await server(() => jsonRes(403, { error: 'other_device' }));
  try {
    const en = await reqCookie(srv, `/c/${TOKEN}?kid=0123456789abcdef&lang=en`);
    expect(en.status).toBe(403);
    expect(en.body).toContain('Ask the child this link was sent to to open it.');
    const ur = await reqCookie(srv, `/c/${TOKEN}?kid=0123456789abcdef&lang=ur`);
    expect(ur.body).toContain('جس بچے کو یہ لنک بھیجا گیا تھا، اُس سے کہیں کہ اسے کھولے۔');
    expect(ur.body).not.toMatch(/رہا|رہی/);
  } finally { srv.close(); }
});
