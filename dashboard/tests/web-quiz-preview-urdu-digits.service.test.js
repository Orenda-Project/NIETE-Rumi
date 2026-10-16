/**
 * The Urdu link preview of a quiz (/q/<CODE>, its og:title and og:description) in Urdu digits (U+06F0–06F9) while the
 * finish card's switch is on (web_quiz_card_v3, carried by the bot as `card_v3: true`): a class group shows the
 * teacher's link and a child's card link side by side, one digit system. Off, the preview is today's, byte for byte.
 * The bot is the network boundary; the edge's three paths: the page, the card link (?k=), a crawler's preview fetch.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const { urDigits } = require('../public/wq/wq-digits');

const TOK = 'Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
const WA = 'WhatsApp/2.24.20.89 A';
const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
const quiz = (lang, extra = {}) => ({ quiz: { id: 'q', code: 'AB12CD', topic: lang === 'ur' ? 'پودے کے حصے' : 'Plants', lang, dir: lang === 'ur' ? 'rtl' : 'ltr', n: 5, questions: [] },
  cls: { label: lang === 'ur' ? 'جماعتیں 1، 3، 5' : 'Classes 1, 3, 5', chips: [] }, live: {}, video: null, preview: false, brand: 'niete', art: { class: null, invite: null, schools: null }, ...extra });
const facts = (lang, extra = {}) => ({ quiz: { lang, topic: lang === 'ur' ? 'پودے کے حصے' : 'Plants', n: 5 }, cls: { label: lang === 'ur' ? 'جماعتیں 1، 3، 5' : 'Classes 1, 3, 5' }, challenge: null, art: {}, brand: 'niete', invited: false, ...extra });

function req(srv, path, { ua = 'Mozilla/5.0 (Linux; Android 13) Chrome/129 Mobile' } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET', headers: { host: 'portal.example', 'user-agent': ua, 'x-forwarded-proto': 'https' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.end();
  });
}
const meta = (html, p) => ((new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(html) || [])[1] || '').replace(/&amp;/g, '&');
const title = (html) => (/<title>([^<]*)<\/title>/.exec(html) || [])[1];

let srv; let page; let og;
beforeEach(async () => {
  page = quiz('ur'); og = null;
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', logEvent: () => {}, fetchImpl: async (url) => {
    if (/\/api\/internal\/wq\/og\//.test(url)) return og ? jsonRes(200, og) : jsonRes(404, { error: 'not_found' });
    if (/\/api\/internal\/wq\/card\/[^/]+$/.test(url)) return jsonRes(404, { error: 'not_found' });
    return jsonRes(200, page);
  } }));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));

describe('the helper (one for the edge and the pages)', () => {
  test('urDigits: every ASCII digit to its Urdu digit, nothing else touched', () => {
    expect(urDigits('جماعتیں 1، 3، 5 · 10 سوال')).toBe('جماعتیں ۱، ۳، ۵ · ۱۰ سوال');
    expect(urDigits(0)).toBe('۰');
    expect(urDigits('')).toBe('');
    expect(urDigits(null)).toBe('');
  });
});

describe('switch on (the bot carries card_v3: true): an Urdu preview counts in Urdu digits', () => {
  test('the quiz page\'s own head', async () => {
    page = quiz('ur', { card_v3: true });
    const r = await req(srv, '/q/AB12CD');
    expect(meta(r.body, 'title')).toBe('پودے کے حصے · جماعتیں ۱، ۳، ۵ کا کوئز');
    expect(meta(r.body, 'description')).toMatch(/^۵ سوال · /);
    expect(title(r.body)).toBe('پودے کے حصے · جماعتیں ۱، ۳، ۵ کا کوئز');
  });
  test('a child\'s card link (?k=) and a link-preview fetch from the facts', async () => {
    page = quiz('ur', { card_v3: true });
    const a = await req(srv, `/q/AB12CD?k=${TOK}`);
    expect(meta(a.body, 'title') + meta(a.body, 'description')).not.toMatch(/[0-9]/);
    og = facts('ur', { card_v3: true });
    const b = await req(srv, '/q/AB12CD', { ua: WA });
    expect(meta(b.body, 'title')).toBe('پودے کے حصے · جماعتیں ۱، ۳، ۵ کا کوئز');
    expect(meta(b.body, 'description')).toMatch(/^۵ سوال · /);
  });
  test('an English preview keeps its digits', async () => {
    page = quiz('en', { card_v3: true });
    const r = await req(srv, '/q/AB12CD');
    expect(meta(r.body, 'title')).toBe('Plants · Classes 1, 3, 5 quiz');
    expect(meta(r.body, 'description')).toMatch(/^5 questions · /);
  });
});

describe('switch off: today\'s preview', () => {
  test.each([['absent', {}], ['the string "true"', { card_v3: 'true' }], ['false', { card_v3: false }]])('card_v3 %s: Western digits as today', async (_, extra) => {
    page = quiz('ur', extra);
    const r = await req(srv, '/q/AB12CD');
    expect(meta(r.body, 'title')).toBe('پودے کے حصے · جماعتیں 1، 3، 5 کا کوئز');
    expect(meta(r.body, 'description')).toMatch(/^5 سوال · /);
    og = facts('ur', extra);
    const b = await req(srv, '/q/AB12CD', { ua: WA });
    expect(meta(b.body, 'title')).toBe('پودے کے حصے · جماعتیں 1، 3، 5 کا کوئز');
  });
  test('the facts a preview keeps say nothing new while off', () => {
    const Preview = require('../routes/web-quiz-preview');
    expect(Preview.ogFacts(quiz('ur'))).not.toHaveProperty('card_v3');
    expect(Preview.ogFacts(quiz('ur', { card_v3: 'true' }))).not.toHaveProperty('card_v3');
    expect(Preview.ogFacts(quiz('ur', { card_v3: true })).card_v3).toBe(true);
  });
});
