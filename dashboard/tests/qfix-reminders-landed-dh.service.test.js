'use strict';
/**
 * A reminder tap that lands (web_quiz.push_landed, /q/ /h/ /j/ with ?from=push) carries the phone's device hash `dh`
 * when the page has the phone's wq_dv cookie, so a landing can be joined to the same phone's later sittings. `dh` is
 * the bot's own deviceHash (sha256('wqd|' + ref), 16 hex): never the raw ref, and nothing without a well-formed cookie.
 * The router with a fake bot (the network boundary); the bot's telemetry module with its DB faked. Invented values.
 */
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const http = require('http');
const express = require('express');
const R = require('../routes/web-quiz.routes');
const { deviceHash } = require('../../bot/shared/services/quiz/web-quiz-telemetry');

const REF = 'Zq3Lx9TbW0vK7pR2sN5mYe';
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

describe('push_landed carries the phone\'s device hash', () => {
  test.each([['/j/ABCD1234?from=push', 'class_link'], ['/h/tok.en?from=push', 'hub'], ['/q/ABC123?from=push', 'quiz']])('%s with the wq_dv cookie: dh = the bot\'s deviceHash', async (p, page) => {
    const [d] = await open(p, { cookie: `other=1; wq_dv=${REF}; x=y` });
    expect(d).toMatchObject({ page, kind: 'quiz_reminder', dh: deviceHash(REF) });
    expect(d.dh).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(d)).not.toContain(REF);
  });
  test('no cookie, or a malformed one: no dh, the rest as before', async () => {
    expect(await open('/j/ABCD1234?from=push')).toEqual([{ page: 'class_link', kind: 'quiz_reminder', reason: 'quiz_reminder' }]);
    expect(await open('/j/ABCD1234?from=push', { cookie: 'wq_dv=short' })).toEqual([{ page: 'class_link', kind: 'quiz_reminder', reason: 'quiz_reminder' }]);
  });
  test('no from=push: nothing logged, cookie or not', async () => {
    expect(await open('/j/ABCD1234', { cookie: `wq_dv=${REF}` })).toEqual([]);
  });
});
