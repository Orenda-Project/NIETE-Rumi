'use strict';
/**
 * The child reminder's funnel at the edge and in the browser (web_quiz_push_remind):
 *  - delivered: the worker (sw.js) tells the bot it showed a reminder (POST /api/wqpush/delivered {tag}), never for the
 *    "Reminders are on." test push; the edge relays the op like the others;
 *  - landed: a quiz page opened from a reminder (?from=push) logs web_quiz.push_landed at the edge; a link preview never.
 * sw.js runs in a small fake worker scope; the router with a fake bot. Invented values.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { createPushRemindRouter } = require('../routes/push-remind.routes');
const R = require('../routes/web-quiz.routes');

const SW_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'sw.js'), 'utf8');

function worker() {
  const ls = {}; const posts = []; const shown = [];
  const self = {
    addEventListener(n, fn) { ls[n] = fn; },
    registration: { showNotification: async (t, o) => { shown.push([t, o]); }, pushManager: { getSubscription: async () => null } },
    clients: { claim: async () => {}, openWindow: async () => null },
    skipWaiting() {},
  };
  const ctx = { self, fetch: async (p, init) => { posts.push([p, JSON.parse(init.body)]); return { ok: true }; }, Promise, JSON, String, Uint8Array, atob, indexedDB: undefined };
  vm.createContext(ctx);
  vm.runInContext(SW_SRC, ctx);
  return {
    posts, shown,
    async push(d) { let w; ls.push({ data: { json: () => d }, waitUntil(p) { w = p; } }); await w; },
  };
}

describe('delivered: the worker reports a shown reminder', () => {
  test('a reminder: shown, then POST /api/wqpush/delivered with its tag', async () => {
    const w = worker();
    await w.push({ t: 'Jugnu', b: "Today's quiz is ready. Tap to play.", url: '/q/ABC123?from=push', tag: 'jugnu-remind', lang: 'en' });
    expect(w.shown).toHaveLength(1);
    expect(w.posts).toEqual([['/api/wqpush/delivered', { tag: 'jugnu-remind', shown: true }]]);
  });
  test('the test push ("Reminders are on."): shown, nothing reported', async () => {
    const w = worker();
    await w.push({ t: 'Jugnu', b: 'Reminders are on.', tag: 'jugnu-remind', lang: 'en', test: true });
    expect(w.shown).toHaveLength(1);
    expect(w.posts).toEqual([]);
  });
  test('the edge relays delivered to the bot like the other ops', async () => {
    const calls = [];
    const app = express();
    app.use(createPushRemindRouter({
      botUrl: 'http://bot.test', apiKey: 'k', on: () => true, logEvent: () => {},
      fetchImpl: async (url, init) => { calls.push({ url, body: init.body ? JSON.parse(init.body) : null }); return { status: 200, headers: { get: () => 'application/json' }, text: async () => '{"ok":1}' }; },
    }));
    const srv = await new Promise((r) => { const x = http.createServer(app).listen(0, () => r(x)); });
    try {
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/wqpush/delivered`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tag: 'jugnu-remind' }) });
      expect(res.status).toBe(200);
      expect(calls[calls.length - 1]).toEqual({ url: 'http://bot.test/api/internal/wqpush/delivered', body: { tag: 'jugnu-remind' } });
    } finally { await new Promise((r) => srv.close(r)); }
  });
});

describe('landed: a quiz page opened from a reminder', () => {
  const jsonRes = (body) => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
  const QUIZ = { lang: 'en', brand: 'niete', title: 'Plants', questions: [] };
  async function open(p, headers = {}) {
    const events = [];
    const app = express();
    app.set('trust proxy', 1);
    app.use(R.createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: () => Promise.resolve(jsonRes(QUIZ)), logEvent: (e, d) => events.push([e, d]) }));
    const srv = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
    try {
      await new Promise((resolve, reject) => {
        const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, headers: { host: 'portal.example', ...headers } }, (res) => { res.resume(); res.on('end', resolve); });
        rq.on('error', reject); rq.end();
      });
    } finally { await new Promise((r) => srv.close(r)); }
    return events.filter(([e]) => e === 'web_quiz.push_landed');
  }
  test('/q/<code>?from=push: one push_landed {page: quiz}', async () => {
    expect(await open('/q/ABC123?from=push')).toEqual([['web_quiz.push_landed', { page: 'quiz', kind: 'quiz_reminder', reason: 'quiz_reminder' }]]);
  });
  test('/h/<token>?from=push (the generic reminder\'s tap): push_landed {page: hub}', async () => {
    const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
    expect(await open(`/h/${TOKEN}?from=push`)).toEqual([['web_quiz.push_landed', { page: 'hub', kind: 'quiz_reminder', reason: 'quiz_reminder' }]]);
  });
  test('without from=push, or a link-preview fetch: nothing', async () => {
    expect(await open('/q/ABC123')).toEqual([]);
    expect(await open('/q/ABC123?from=push', { 'user-agent': 'WhatsApp/2.23.20.0 A' })).toEqual([]);
  });
});
