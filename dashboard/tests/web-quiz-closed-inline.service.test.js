/**
 * web_quiz_closed_inline (app_settings, default OFF; JSON boolean true only).
 * Today a fast first page whose link turns out expired / closed / unreachable sends the head, then a script that asks
 * again (`nf=1`): a SECOND document load. ON: the closed page is written into the same stream (one load), through the
 * router's closedHtml (the same tap and the same language order as every other closed page). The head is already
 * sent when the bot answers, so that one answer's status stays 200; the words are the page's truth. A forged link
 * (no flush) and an `nf=1` hop already answer directly with their own status and the closed page, with the switch
 * ON or OFF: pinned here. OFF: byte-identical to the router with no switch at all.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderClosedPage, assetVersion } = require('../routes/web-quiz.routes');
const ChatTap = require('../../bot/shared/services/first-touch/chat-tap');
const Sw = require('../lib/closed-inline-switch');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ k: 'h', ids: ['a'], exp: 9999999999 })}.AbCdEfGhIjKlMnOpQrStUv`;
const TOKEN_UR = `${b64({ k: 'h', ids: ['a'], exp: 9999999999, l: 'ur' })}.AbCdEfGhIjKlMnOpQrStUv`;
const HOST = 'portal.example';

const jsonRes = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
const HUB = () => ({ lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef', teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true });
const QUIZ = () => ({ quiz: { id: 'q-1', code: 'AB12CD', topic: 'Parts', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1, questions: [{ qid: 'x1', i: 1, text: 'Which?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }] }, cls: { label: 'Class 3', teacher: 'T', chips: [] }, live: {}, video: null, preview: false, brand: 'niete', rt: false, fast: true });

let srv;
let calls;
const get = (p, headers = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, headers: { host: HOST, ...headers } }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  r.on('error', reject); r.end();
});
// The bot answers the first call with a fast payload (teaches the edge `fast`), then each `after` answer in turn.
async function boot({ inline, learn, after }) {
  const queue = [learn, ...after]; calls = [];
  const opts = { botUrl: BOT, apiKey: KEY, canonicalBase: '', wayBackOn: () => true, fetchImpl: async (u) => { calls.push(String(u)); return queue.shift(); } };
  if (inline !== undefined) opts.closedInlineOn = () => inline;
  const app = express(); app.set('trust proxy', 1); app.use(createWebQuizRouter(opts));
  await new Promise((r) => { srv = app.listen(0, r); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())).then(() => { srv = null; }));

const mainOf = (html) => html.match(/<main id="wq"[\s\S]*<\/main>/)[0];
const inlineMain = (body) => JSON.parse(body.match(/outerHTML=("(?:[^"\\]|\\.)*")/)[1]);
const back = () => ChatTap.chatHref(String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '') || null);
const closed = (lang, kind) => renderClosedPage({ lang, kind, origin: `http://${HOST}`, assetV: assetVersion(), brandKey: 'niete', ui: null, back: back() });
const tapText = (l) => ChatTap.backText(l).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

describe('ON: the expired / closed hop after the head went is ONE document load', () => {
  it('/h/ expired: no second ask, the closed page words and the tap are in the stream', async () => {
    await boot({ inline: true, learn: jsonRes(200, HUB()), after: [jsonRes(401, { error: 'bad_token' })] });
    await get(`/h/${TOKEN}`);
    const res = await get(`/h/${TOKEN}`);
    expect(res.body).not.toMatch(/nf=1/);
    expect(res.body).not.toMatch(/location\.replace/);
    expect(res.headers.location).toBeUndefined();
    expect(inlineMain(res.body)).toBe(mainOf(closed('en', 'hub')));
    expect(inlineMain(res.body)).toMatch(/data-tap="open_whatsapp"/);
    expect(res.body.trimEnd().endsWith('</html>')).toBe(true);
    expect(calls.length).toBe(2); // one bot call for the one load
  });
  it('/h/ expired, a token-only Urdu link (no ?lang=, English phone): Urdu words and the tap', async () => {
    await boot({ inline: true, learn: jsonRes(200, HUB()), after: [jsonRes(401, { error: 'bad_token' })] });
    await get(`/h/${TOKEN_UR}`);
    const res = await get(`/h/${TOKEN_UR}`);
    expect(inlineMain(res.body)).toBe(mainOf(closed('ur', 'hub')));
    expect(inlineMain(res.body)).toContain(tapText('ur'));
    expect(res.body).toMatch(/h\.lang="ur"/);
    expect(res.body).toMatch(/h\.dir="rtl"/);
  });
  it('/h/ expired with ?lang=en on an Urdu token: English', async () => {
    await boot({ inline: true, learn: jsonRes(200, HUB()), after: [jsonRes(401, { error: 'bad_token' })] });
    await get(`/h/${TOKEN_UR}?lang=en`);
    const res = await get(`/h/${TOKEN_UR}?lang=en`);
    expect(inlineMain(res.body)).toBe(mainOf(closed('en', 'hub')));
    expect(inlineMain(res.body)).toContain(tapText('en'));
  });
  it('/h/ the bot away after the head went: the off page inline, no tap', async () => {
    await boot({ inline: true, learn: jsonRes(200, HUB()), after: [jsonRes(503, { error: 'web_quiz_off' })] });
    await get(`/h/${TOKEN}`);
    const res = await get(`/h/${TOKEN}`);
    expect(res.body).not.toMatch(/nf=1/);
    expect(inlineMain(res.body)).toBe(mainOf(closed('en', 'off')));
    expect(inlineMain(res.body)).not.toMatch(/data-tap/);
  });
  it('/q/ closed (410, the bot says Urdu): one load, Urdu words and the tap', async () => {
    await boot({ inline: true, learn: jsonRes(200, QUIZ()), after: [jsonRes(410, { error: 'closed', lang: 'ur' })] });
    await get('/q/AB12CD');
    const res = await get('/q/AB12CD');
    expect(res.body).not.toMatch(/nf=1/);
    expect(inlineMain(res.body)).toBe(mainOf(closed('ur', 'closed')));
    expect(inlineMain(res.body)).toContain(tapText('ur'));
  });
  it('/q/ closed with ?lang=en: English wins over the bot\'s word', async () => {
    await boot({ inline: true, learn: jsonRes(200, QUIZ()), after: [jsonRes(410, { error: 'closed', lang: 'ur' })] });
    await get('/q/AB12CD?lang=en');
    const res = await get('/q/AB12CD?lang=en');
    expect(inlineMain(res.body)).toBe(mainOf(closed('en', 'closed')));
  });
  it('/q/ unknown (404): the closed page inline', async () => {
    await boot({ inline: true, learn: jsonRes(200, QUIZ()), after: [jsonRes(404, { error: 'not_found' })] });
    await get('/q/AB12CD');
    const res = await get('/q/ZZ99ZZ');
    expect(res.body).not.toMatch(/nf=1/);
    expect(inlineMain(res.body)).toBe(mainOf(closed('en', 'closed')));
  });
  it('forged /h/ (no flush): one response, status 401, the closed page body, no redirect', async () => {
    await boot({ inline: true, learn: jsonRes(200, HUB()), after: [] });
    const res = await get('/h/not-a-token');
    expect(res.status).toBe(401);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toBe(closed('en', 'hub'));
  });
  it('/h/ and /q/ with nf=1: one response with the real status and the closed page', async () => {
    await boot({ inline: true, learn: jsonRes(200, HUB()), after: [jsonRes(401, { error: 'bad_token' }), jsonRes(410, { error: 'closed', lang: 'ur' })] });
    await get(`/h/${TOKEN}`);
    const h = await get(`/h/${TOKEN}?nf=1`);
    expect(h.status).toBe(401);
    expect(h.headers.location).toBeUndefined();
    expect(h.body).toBe(closed('en', 'hub'));
    const q = await get('/q/AB12CD?nf=1');
    expect(q.status).toBe(410);
    expect(q.body).toBe(closed('ur', 'closed'));
  });
  it('a quiz that is open is untouched (the hub and the quiz still stream their page)', async () => {
    await boot({ inline: true, learn: jsonRes(200, HUB()), after: [jsonRes(200, HUB())] });
    await get(`/h/${TOKEN}`);
    const res = await get(`/h/${TOKEN}`);
    expect(res.body).not.toMatch(/outerHTML/);
    expect(res.body).toMatch(/hub\.js/);
  });
});

describe('OFF (absent, false): today\'s bytes', () => {
  const run = async (inline) => {
    await boot({ inline, learn: jsonRes(200, HUB()), after: [jsonRes(401, { error: 'bad_token' }), jsonRes(401, { error: 'bad_token' })] });
    await get(`/h/${TOKEN_UR}`);
    const res = await get(`/h/${TOKEN_UR}`);
    const again = await get(`/h/${TOKEN_UR}?nf=1`);
    await new Promise((r) => srv.close(r)); srv = null;
    return { res, again };
  };
  it('expired hop asks again (nf=1) and that hop is a 401 with the closed page; same bytes with the switch absent, false, or unreadable', async () => {
    const absent = await run(undefined);
    expect(absent.res.body).toMatch(/location\.replace\(location\.pathname\+\(location\.search\?location\.search\+"&":"\?"\)\+"nf=1"/);
    expect(absent.res.body).not.toMatch(/outerHTML/);
    expect(absent.again.status).toBe(401);
    expect(absent.again.body).toBe(closed('ur', 'hub'));
    const off = await run(false);
    expect(off.res.body).toBe(absent.res.body);
    expect(off.res.headers['content-type']).toBe(absent.res.headers['content-type']);
    expect(off.again.body).toBe(absent.again.body);
    expect(off.again.status).toBe(absent.again.status);
  });
  it('/q/ closed after the head: asks again, as today', async () => {
    await boot({ inline: false, learn: jsonRes(200, QUIZ()), after: [jsonRes(410, { error: 'closed', lang: 'ur' })] });
    await get('/q/AB12CD');
    const res = await get('/q/AB12CD');
    expect(res.body).toMatch(/nf=1/);
    expect(res.body).not.toMatch(/outerHTML/);
  });
});

describe('the switch read (closed-inline-switch)', () => {
  const client = (value, error = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error }) }) }) }) });
  it.each([[true, true], ['true', false], [1, false], [{ on: true }, false], [false, false], [undefined, false]])('value %j -> %s', async (v, want) => {
    const s = Sw.createClosedInlineSwitch();
    expect(await s.on(client(v))).toBe(want);
  });
  it('no client, a read error: OFF', async () => {
    const s = Sw.createClosedInlineSwitch();
    expect(await s.on(null)).toBe(false);
    expect(await s.on(client(true, new Error('x')))).toBe(false);
  });
  it('reads the closed_inline row', () => { expect(Sw.INLINE_KEY).toBe('web_quiz_closed_inline'); });
});

describe('ON, a closed class link the bot says this phone may be known on (`known: true`, web_quiz_link_known_child)', () => {
  it('/q/ closed after the head: asks again (the nf=1 page draws the way home), never inlined without it', async () => {
    await boot({ inline: true, learn: jsonRes(200, QUIZ()), after: [jsonRes(410, { error: 'expired', lang: 'en', known: true })] });
    await get('/q/AB12CD');
    const res = await get('/q/AB12CD');
    expect(res.body).toMatch(/nf=1/);
    expect(res.body).not.toMatch(/outerHTML/);
  });
  it('/q/ closed without `known`: still one load (the inline page)', async () => {
    await boot({ inline: true, learn: jsonRes(200, QUIZ()), after: [jsonRes(410, { error: 'expired', lang: 'en' })] });
    await get('/q/AB12CD');
    const res = await get('/q/AB12CD');
    expect(res.body).not.toMatch(/nf=1/);
    expect(inlineMain(res.body)).toBe(mainOf(closed('en', 'closed')));
  });
});
