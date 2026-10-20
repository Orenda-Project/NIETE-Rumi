/**
 * web_quiz_code_trim (app_settings, default OFF; read only for a link whose code fails the code check).
 * A class link pasted with a space, a full stop or a language word after the code ("AB12CD ", "AB12CD.", "AB12CD ur")
 * answered "This quiz has closed" (404) before the bot was asked. ON: the edge sends the child to the clean link
 * (302 to /q/AB12CD, `?lang=ur` for an Urdu word when the link names no language), with no bot call. A code that
 * stays wrong after the trim is the closed page as today. OFF: every answer is today's, byte for byte, and the
 * switch is never read for a good code.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const HOST = 'portal.example';

let srv;
let calls;
let flagReads;
const get = (p) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, headers: { host: HOST } }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
  });
  r.on('error', reject); r.end();
});
async function boot(trim) {
  calls = []; flagReads = 0;
  const opts = { botUrl: BOT, apiKey: KEY, canonicalBase: '', fetchImpl: async (u) => { calls.push(String(u)); return { status: 404, ok: false, headers: { get: () => 'application/json' }, text: async () => '{"error":"not_found"}' }; } };
  if (trim !== undefined) opts.codeTrimOn = async () => { flagReads += 1; return trim; };
  const app = express(); app.set('trust proxy', 1); app.use(createWebQuizRouter(opts));
  await new Promise((r) => { srv = app.listen(0, r); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())).then(() => { srv = null; }));

const FIXED = [
  ['a trailing space', '/q/AB12CD%20', '/q/AB12CD'],
  ['two trailing spaces and a full stop', '/q/AB12CD%20%20.', '/q/AB12CD'],
  ['a leading space', '/q/%20AB12CD', '/q/AB12CD'],
  ['lower case with a space', '/q/ab12cd%20', '/q/AB12CD'],
  ['an English word', '/q/AB12CD%20en', '/q/AB12CD'],
  ['an Urdu word', '/q/AB12CD%20ur', '/q/AB12CD?lang=ur'],
  ['an Urdu word in full', '/q/AB12CD%20Urdu', '/q/AB12CD?lang=ur'],
  ['an Urdu word, the link already names English', '/q/AB12CD%20ur?lang=en', '/q/AB12CD?lang=en'],
  ['a space before ?p=', '/q/AB12CD%20?p=abc', '/q/AB12CD?p=abc'],
  ['the class table with a space', '/q/AB12CD%20/class', '/q/AB12CD/class'],
  ['the schools table with an Urdu word', '/q/AB12CD%20ur/schools', '/q/AB12CD/schools?lang=ur'],
];
const STILL_WRONG = [
  ['two codes', '/q/AB12CD%20EF34GH'],
  ['a code too short', '/q/AB1%20'],
  ['a word that is not a language', '/q/AB12CD%20please'],
  ['a slash in the code', '/q/AB12CD%2Fx'],
  ['a long paste', `/q/AB12CD${'%20'.repeat(60)}x`],
];

describe('ON: a pasted code with a space or a language word reaches its door', () => {
  test.each(FIXED)('%s: 302 to the clean link, no bot call', async (_n, from, to) => {
    await boot(true);
    const res = await get(from);
    expect(res.status).toBe(302);
    expect(res.location).toBe(to);
    expect(calls).toEqual([]);
  });

  test.each(STILL_WRONG)('%s: the closed page, as today', async (_n, from) => {
    await boot(undefined);
    const today = await get(from);
    srv.close(); srv = null;
    await boot(true);
    const res = await get(from);
    expect([res.status, res.body]).toEqual([today.status, today.body]);
    expect(res.status).toBe(404);
  });

  test('a good code never reads the switch', async () => {
    await boot(true);
    await get('/q/AB12CD');
    await get('/q/AB12CD/class');
    expect(flagReads).toBe(0);
  });
});

describe('OFF: today, byte for byte', () => {
  test.each([...FIXED.map(([n, f]) => [n, f]), ...STILL_WRONG])('%s', async (_n, from) => {
    await boot(undefined);
    const today = await get(from);
    srv.close(); srv = null;
    await boot(false);
    const off = await get(from);
    expect([off.status, off.location, off.body]).toEqual([today.status, today.location, today.body]);
    expect(off.status).toBe(404);
    expect(calls).toEqual([]);
  });
});
