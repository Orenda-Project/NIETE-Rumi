'use strict';
/**
 * A reminder tap that lands from a QA walk (the user agent carries "QFIXQA") marks its push_landed row qa: true, inside
 * data_json beside dh, the same test the bot applies to remind_step / push_subscribed / push_opened / push_delivered, so
 * a funnel read drops a walk's landing exactly. Any other user agent: the row is byte-identical to before.
 * The router with a fake bot (the network boundary). Invented values.
 */
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const http = require('http');
const express = require('express');
const R = require('../routes/web-quiz.routes');
const { deviceHash } = require('../../bot/shared/services/quiz/web-quiz-telemetry');

const REF = 'Zq3Lx9TbW0vK7pR2sN5mYe';
const WALK = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 QFIXQA';
const CHILD = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';
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
  return events.filter(([e]) => e === 'web_quiz.push_landed').map(([, d]) => d);
}

const PAGES = [['/j/ABCD1234?from=push', 'class_link'], ['/h/tok.en?from=push', 'hub'], ['/q/ABC123?from=push', 'quiz']];

describe('push_landed marks a QA walk', () => {
  test.each(PAGES)('%s from a QFIXQA user agent: qa true inside data_json', async (p, page) => {
    const [d] = await open(p, { 'user-agent': WALK });
    expect(d).toMatchObject({ page, kind: 'quiz_reminder', reason: 'quiz_reminder' });
    expect(d.qa).toBeUndefined(); // never a new top-level log field
    expect(JSON.parse(d.data_json)).toEqual({ qa: true });
  });
  test('a walk with the wq_dv cookie: dh and qa together', async () => {
    const [d] = await open('/j/ABCD1234?from=push', { 'user-agent': WALK, cookie: `wq_dv=${REF}` });
    expect(JSON.parse(d.data_json)).toEqual({ dh: deviceHash(REF), qa: true });
  });
  test.each(PAGES)('%s from a child\'s phone: no qa, the row as before', async (p, page) => {
    expect(await open(p, { 'user-agent': CHILD })).toEqual([{ page, kind: 'quiz_reminder', reason: 'quiz_reminder' }]);
    const [d] = await open(p, { 'user-agent': CHILD, cookie: `wq_dv=${REF}` });
    expect(JSON.parse(d.data_json)).toEqual({ dh: deviceHash(REF) });
  });
  test('no from=push: nothing logged, walk or not', async () => {
    expect(await open('/j/ABCD1234', { 'user-agent': WALK })).toEqual([]);
  });
});
