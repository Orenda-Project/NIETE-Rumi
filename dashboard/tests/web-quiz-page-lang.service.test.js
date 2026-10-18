/**
 * The quiz page in the child's language (app_settings web_quiz_page_lang; the bot names it on the quiz answer as
 * `page_lang: true`): /q/<code>?lang=ur on an English quiz is an Urdu page (lang/dir and the boot's ui_lang), so the
 * page's own words follow the child while the questions stay in the quiz's language. Off: today's page, byte for byte.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const QUIZ = (extra) => ({ quiz: { id: 'q', code: 'AB12CD', topic: 'Plants', lang: 'en', dir: 'ltr', grade: '3', n: 1, questions: [{ qid: 'q1', text: 'a?', options: [{ slot: 'A', text: 'x' }] }] }, cls: { label: 'Class 3', teacher: null, chips: [] }, live: {}, ...extra });
function serve(body) {
  const app = express();
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }) }));
  return new Promise((r) => { const s = app.listen(0, () => r(s)); });
}
function get(srv, path) {
  return new Promise((resolve) => http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, html: d })); }));
}
const bootOf = (html) => JSON.parse(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'));

describe('the edge: the quiz page opens in the link\'s language (page_lang)', () => {
  test('on: /q/<code>?lang=ur on an English quiz is an Urdu page (rtl, ui_lang ur); ?k and ?via ride along', async () => {
    const srv = await serve(QUIZ({ page_lang: true }));
    try {
      for (const path of ['/q/AB12CD?lang=ur', '/q/AB12CD?k=abc&via=videos&lang=ur', '/q/AB12CD?k=abc&to=q&lang=ur']) {
        const r = await get(srv, path);
        expect(r.status).toBe(200);
        expect(r.html).toMatch(/<html[^>]*\slang="ur"[^>]*\sdir="rtl"/);
        expect(bootOf(r.html).ui_lang).toBe('ur');
      }
    } finally { srv.close(); }
  });
  test('on, but no lang or a lang that is not en/ur: the quiz\'s own language, no ui_lang', async () => {
    const srv = await serve(QUIZ({ page_lang: true }));
    try {
      for (const path of ['/q/AB12CD', '/q/AB12CD?lang=fr', '/q/AB12CD?k=abc']) {
        const r = await get(srv, path);
        expect(r.html).toMatch(/<html[^>]*\slang="en"/);
        expect(bootOf(r.html)).not.toHaveProperty('ui_lang');
      }
    } finally { srv.close(); }
  });
  test.each([['absent', {}], ['false', { page_lang: false }], ['the string "true"', { page_lang: 'true' }]])('off (%s): /q/<code>?lang=ur is today\'s page, byte for byte', async (_n, extra) => {
    const srv = await serve(QUIZ(extra));
    try {
      const a = await get(srv, '/q/AB12CD?lang=ur');
      const b = await get(srv, '/q/AB12CD');
      expect(a.html).toBe(b.html);
      expect(a.html).toMatch(/<html[^>]*\slang="en"/);
    } finally { srv.close(); }
  });
  test('on, the fast first page (head sent before the bot answers): the page is fixed to Urdu and boots with ui_lang ur', async () => {
    const srv = await serve(QUIZ({ page_lang: true, fast: true }));
    try {
      await get(srv, '/q/AB12CD'); // the bot's first answer teaches the edge that the fast page is on
      const r = await get(srv, '/q/AB12CD?k=abc&via=videos&lang=ur');
      expect(r.status).toBe(200);
      expect(r.html).toMatch(/h\.lang="ur";h\.dir="rtl"|<html[^>]*\slang="ur"/);
      expect(bootOf(r.html).ui_lang).toBe('ur');
    } finally { srv.close(); }
  });
  test('off, the fast first page: ?lang=ur changes nothing', async () => {
    const srv = await serve(QUIZ({ fast: true }));
    try {
      await get(srv, '/q/AB12CD');
      const a = await get(srv, '/q/AB12CD?lang=ur');
      const b = await get(srv, '/q/AB12CD');
      expect(a.html).toBe(b.html);
      expect(bootOf(a.html)).not.toHaveProperty('ui_lang');
    } finally { srv.close(); }
  });
});
