'use strict';
/**
 * The reminder funnel's meters tell the truth (web_quiz_push_remind):
 *  - delivered is posted AFTER showNotification settles and says whether it showed ({shown, err}); a rejected show
 *    still settles the push event (no unhandled rejection, Chrome keeps the worker);
 *  - a tap that opens the class's standing link (/j/<code>?from=push, the class-named reminder's url) is a landed step
 *    like /q/ and /h/ (web_quiz.push_landed {page: class_link}); a link preview never.
 * sw.js runs in a small fake worker scope; the router with a fake bot (the network boundary). Invented values.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const express = require('express');
const R = require('../routes/web-quiz.routes');

const SW_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'sw.js'), 'utf8');

function worker(show) {
  const ls = {}; const log = [];
  const self = {
    addEventListener(n, fn) { ls[n] = fn; },
    registration: { showNotification: (t) => show(t, log), pushManager: { getSubscription: async () => null } },
    clients: { claim: async () => {}, openWindow: async () => null },
    skipWaiting() {},
  };
  const ctx = { self, fetch: async (p, init) => { log.push(['post', p, JSON.parse(init.body)]); return { ok: true }; }, Promise, JSON, String, Uint8Array, atob, indexedDB: undefined };
  vm.createContext(ctx);
  vm.runInContext(SW_SRC, ctx);
  return { log, push(d) { let w; ls.push({ data: { json: () => d }, waitUntil(p) { w = p; } }); return w; } };
}
const REM = { t: 'Jugnu', b: 'Class 3 has a new quiz', url: '/j/ABCD1234?from=push', tag: 'jugnu-remind', lang: 'en' };

describe('delivered: posted after the show settles, with shown', () => {
  test('shown: the post comes after the notification drew, {tag, shown: true}', async () => {
    const w = worker((t, log) => new Promise((r) => setImmediate(() => { log.push(['shown', t]); r(); })));
    await w.push(REM);
    expect(w.log).toEqual([['shown', 'Jugnu'], ['post', '/api/wqpush/delivered', { tag: 'jugnu-remind', shown: true }]]);
  });
  test('a rejected show: {tag, shown: false, err: <name>}, and the event still settles', async () => {
    const w = worker(() => Promise.reject(new TypeError('No notification permission has been granted for this origin.')));
    await w.push(REM); // a rejection here fails the test: the event must settle
    expect(w.log).toHaveLength(1);
    expect(w.log[0]).toEqual(['post', '/api/wqpush/delivered', { tag: 'jugnu-remind', shown: false, err: 'TypeError' }]);
  });
  test('the test push: shown, nothing posted (as before)', async () => {
    const w = worker(async () => {});
    await w.push({ ...REM, test: true });
    expect(w.log).toEqual([]);
  });
});

describe('landed: the class link opened from a reminder', () => {
  const jsonRes = (body) => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
  async function open(p, headers = {}) {
    const events = [];
    const app = express();
    app.set('trust proxy', 1);
    app.use(R.createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: () => Promise.resolve(jsonRes({ off: true })), logEvent: (e, d) => events.push([e, d]) }));
    const srv = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
    try {
      await new Promise((resolve, reject) => {
        const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, headers: { host: 'portal.example', ...headers } }, (res) => { res.resume(); res.on('end', resolve); });
        rq.on('error', reject); rq.end();
      });
    } finally { await new Promise((r) => srv.close(r)); }
    return events.filter(([e]) => e === 'web_quiz.push_landed');
  }
  test('/j/<code>?from=push: one push_landed {page: class_link}', async () => {
    expect(await open('/j/ABCD1234?from=push')).toEqual([['web_quiz.push_landed', { page: 'class_link', kind: 'quiz_reminder', reason: 'quiz_reminder' }]]);
  });
  test('without from=push, or a link-preview fetch: nothing', async () => {
    expect(await open('/j/ABCD1234')).toEqual([]);
    expect(await open('/j/ABCD1234?from=push', { 'user-agent': 'WhatsApp/2.23.20.0 A' })).toEqual([]);
  });
});

// One noun on every child surface (the class line and the hub tile say quiz): the worker's own fallback, used when a payload has no body.
describe('the worker\'s fallback text says quiz', () => {
  test.each([['en', 'A quiz is waiting for you.'], ['ur', 'ایک کوئز آپ کا انتظار کر رہا ہے۔']])('%s: "%s"', async (lang, b) => {
    let body = null;
    // read the options the worker passed to showNotification
    const ls = {};
    const self = { addEventListener(n, fn) { ls[n] = fn; }, registration: { showNotification: async (t, o) => { body = o.body; } }, clients: {}, skipWaiting() {} };
    const ctx = { self, fetch: async () => ({ ok: true }), Promise, JSON, String, Uint8Array, atob };
    vm.createContext(ctx); vm.runInContext(SW_SRC, ctx);
    let p; ls.push({ data: { json: () => ({ tag: 'jugnu-remind', lang, url: '/h/x?from=push' }) }, waitUntil(x) { p = x; } });
    await p;
    expect(body).toBe(b);
  });
});
