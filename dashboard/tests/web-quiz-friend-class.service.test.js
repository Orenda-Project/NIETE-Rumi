/**
 * A friend who played a challenge is not in the challenger's class: their card offers neither the
 * class table nor "Share to class group", and /q/<challenge code>/class is not a page.
 */
const http = require('http');
const express = require('express');
const { page, flush } = require('./wq-page-harness');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const kid = { chip: 'c1', first: 'Omar', animal: 'owl' };
const done = { wq_s_TEST: { st: 'st1', child: kid, answers: {}, queue: [], result: { card: { first: 'Omar', animal: 'owl', correct: 4, total: 5 }, challenge_code: 'CH12AB' } } };
const CH = { first: 'Ali', correct: 3, total: 5 };

describe('the friend\'s card', () => {
  test('no "See my class", no "Share to class group"; Challenge and School league stay', () => {
    const p = page({ lang: 'en', store: done, challenge: CH });
    p.wq.card();
    expect(p.html()).not.toContain('id="wq-class"');
    expect(p.html()).not.toContain('id="wq-share"');
    expect(p.html()).toContain('id="wq-chal"');
    expect(p.html()).toContain('id="wq-schools"');
  });
  test('a class card keeps both', () => {
    const p = page({ lang: 'en', store: done });
    p.wq.card();
    expect(p.html()).toContain('id="wq-class"');
    expect(p.html()).toContain('id="wq-share"');
  });
  test('the "done" screen after the last answer has no class button for a friend', async () => {
    const p = page({ lang: 'en', challenge: CH, store: { wq_s_TEST: { st: 'st1', child: kid, answers: { q1: { slot: 'A', ok: true } }, queue: [] } },
      api: { '/finish': { score: { correct: 1, total: 1, pct: 100 }, counted: true, card: { first: 'Omar', correct: 1, total: 1 } } } });
    p.wq.results();
    await flush(); await flush();
    expect(p.moment()).toBe('M9');
    expect(p.html()).not.toContain('id="wq-class"');
  });
});

describe('the edge: /q/<challenge code>/class', () => {
  const QUIZ = (extra) => ({ quiz: { id: 'q', code: 'CH12AB', topic: 'Plants', lang: 'en', dir: 'ltr', grade: '3', n: 1, questions: [] }, cls: { label: null, teacher: null, chips: [] }, live: {}, ...extra });
  function serve(body) {
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }) }));
    return new Promise((r) => { const s = app.listen(0, () => r(s)); });
  }
  function get(srv, path) {
    return new Promise((resolve) => http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }));
  }
  test('a friend\'s challenge code has no class page (404); the quiz page itself still opens', async () => {
    const srv = await serve(QUIZ({ invited: true, challenge: { first: 'Ali', correct: 3, total: 5 } }));
    try {
      expect(await get(srv, '/q/CH12AB/class')).toBe(404);
      expect(await get(srv, '/q/CH12AB')).toBe(200);
    } finally { srv.close(); }
  });
});
