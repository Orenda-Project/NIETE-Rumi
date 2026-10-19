/**
 * The quiz page in a grown-up's chosen language (app_settings web_quiz_return_lang; the bot names it on the quiz answer
 * as `child_lang: 'en'|'ur'`, only for the child the link's `k` names and only for a grown-up's choice): /q/<code>?k=<chip>
 * opens in that language (lang/dir and the boot's ui_lang), before the link's ?lang. The edge passes `k` (the chip's
 * shape only) to the bot's quiz call. No child_lang: today's page, byte for byte.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const CHIP = '0123456789abcdef';
const QUIZ = (extra) => ({ quiz: { id: 'q', code: 'AB12CD', topic: 'Plants', lang: 'en', dir: 'ltr', grade: '3', n: 1, questions: [{ qid: 'q1', text: 'a?', options: [{ slot: 'A', text: 'x' }] }] }, cls: { label: 'Class 3', teacher: null, chips: [] }, live: {}, ...extra });
function serve(body) {
  const urls = [];
  const app = express();
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async (url) => { urls.push(url); return { status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }; } }));
  return new Promise((r) => { const s = app.listen(0, () => { s.urls = urls; r(s); }); });
}
function get(srv, path) {
  return new Promise((resolve) => http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, html: d })); }));
}
const bootOf = (html) => JSON.parse(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'));
const quizCalls = (srv) => srv.urls.filter((u) => u.includes('/api/internal/wq/quiz/'));

describe('the edge: the quiz page opens in a grown-up\'s chosen language (child_lang)', () => {
  test('child_lang ur + /q/<code>?k=<chip> on an English quiz: an Urdu page (lang, rtl, ui_lang ur)', async () => {
    const srv = await serve(QUIZ({ child_lang: 'ur' }));
    try {
      const r = await get(srv, `/q/AB12CD?k=${CHIP}`);
      expect(r.status).toBe(200);
      expect(r.html).toMatch(/<html[^>]*\slang="ur"[^>]*\sdir="rtl"/);
      expect(bootOf(r.html).ui_lang).toBe('ur');
    } finally { srv.close(); }
  });
  test('the grown-up\'s choice beats the link\'s ?lang', async () => {
    const srv = await serve(QUIZ({ child_lang: 'ur', page_lang: true }));
    try {
      const r = await get(srv, `/q/AB12CD?k=${CHIP}&lang=en`);
      expect(r.html).toMatch(/<html[^>]*\slang="ur"[^>]*\sdir="rtl"/);
      expect(bootOf(r.html).ui_lang).toBe('ur');
    } finally { srv.close(); }
  });
  test('child_lang en on an Urdu quiz: an English page', async () => {
    const srv = await serve({ ...QUIZ({ child_lang: 'en' }), quiz: { ...QUIZ().quiz, lang: 'ur', dir: 'rtl' } });
    try {
      const r = await get(srv, `/q/AB12CD?k=${CHIP}&lang=ur`);
      expect(r.html).toMatch(/<html[^>]*\slang="en"[^>]*\sdir="ltr"/);
      expect(bootOf(r.html).ui_lang).toBe('en');
    } finally { srv.close(); }
  });
  test('the fast first page: fixed to Urdu, boots with ui_lang ur', async () => {
    const srv = await serve(QUIZ({ child_lang: 'ur', fast: true }));
    try {
      await get(srv, '/q/AB12CD'); // the bot's first answer teaches the edge that the fast page is on
      const r = await get(srv, `/q/AB12CD?k=${CHIP}&lang=en`);
      expect(r.status).toBe(200);
      expect(r.html).toMatch(/h\.lang="ur";h\.dir="rtl"|<html[^>]*\slang="ur"/);
      expect(bootOf(r.html).ui_lang).toBe('ur');
    } finally { srv.close(); }
  });
  test.each([['absent', {}], ['not en/ur', { child_lang: 'fr' }], ['not a string', { child_lang: true }]])('no child_lang (%s): today\'s page, byte for byte', async (_n, extra) => {
    const a = await serve(QUIZ(extra));
    const b = await serve(QUIZ());
    try {
      for (const path of [`/q/AB12CD?k=${CHIP}`, `/q/AB12CD?k=${CHIP}&lang=ur`]) {
        const x = await get(a, path);
        const y = await get(b, path);
        // two servers, two ports: the page's own origin is the one difference that is not the page
        const host = (h) => h.replace(/127\.0\.0\.1:\d+/g, 'HOST');
        expect(host(x.html.replace(/,"child_lang":(?:"fr"|true)/, ''))).toBe(host(y.html));
        expect(x.html).toMatch(/<html[^>]*\slang="en"/);
        expect(bootOf(x.html)).not.toHaveProperty('ui_lang');
      }
    } finally { a.close(); b.close(); }
  });
  test('no child_lang, fast first page: today\'s bytes', async () => {
    const srv = await serve(QUIZ({ fast: true }));
    try {
      await get(srv, '/q/AB12CD');
      const a = await get(srv, `/q/AB12CD?k=${CHIP}`);
      const b = await get(srv, `/q/AB12CD?k=${CHIP}`);
      expect(a.html).toBe(b.html);
      expect(bootOf(a.html)).not.toHaveProperty('ui_lang');
    } finally { srv.close(); }
  });
});

describe('the edge passes the chip to the bot\'s quiz call', () => {
  test('a k request: the quiz call carries k= (plain and fast paths); none without k', async () => {
    const srv = await serve(QUIZ({}));
    try {
      await get(srv, '/q/AB12CD');
      await get(srv, `/q/AB12CD?k=${CHIP}`);
      expect(quizCalls(srv)).toEqual(['http://bot.test/api/internal/wq/quiz/AB12CD', `http://bot.test/api/internal/wq/quiz/AB12CD?k=${CHIP}`]);
    } finally { srv.close(); }
    const fast = await serve(QUIZ({ fast: true }));
    try {
      await get(fast, '/q/AB12CD');
      await get(fast, `/q/AB12CD?k=${CHIP}&lang=ur`);
      expect(quizCalls(fast)).toEqual(['http://bot.test/api/internal/wq/quiz/AB12CD', `http://bot.test/api/internal/wq/quiz/AB12CD?k=${CHIP}`]);
    } finally { fast.close(); }
  });
  test('beside a teacher\'s ?p=: both ride, p first', async () => {
    const srv = await serve(QUIZ({}));
    try {
      await get(srv, `/q/AB12CD?p=tok&k=${CHIP}`);
      expect(quizCalls(srv)).toEqual([`http://bot.test/api/internal/wq/quiz/AB12CD?p=tok&k=${CHIP}`]);
    } finally { srv.close(); }
  });
  test('a k that is not a chip\'s shape is never passed on', async () => {
    const srv = await serve(QUIZ({}));
    try {
      for (const k of ['abc', `${CHIP}0`, 'ABCDEF0123456789', '%26x%3D1', '']) await get(srv, `/q/AB12CD?k=${k}`);
      await get(srv, `/q/AB12CD?k=${CHIP}&k=${CHIP}`);
      expect(quizCalls(srv).every((u) => u === 'http://bot.test/api/internal/wq/quiz/AB12CD')).toBe(true);
    } finally { srv.close(); }
  });
  test('the class table and the league never pass k', async () => {
    const srv = await serve(QUIZ({}));
    try {
      await get(srv, `/q/AB12CD/class?k=${CHIP}`);
      await get(srv, `/q/AB12CD/schools?k=${CHIP}`);
      expect(quizCalls(srv).every((u) => !u.includes('k='))).toBe(true);
    } finally { srv.close(); }
  });
});
