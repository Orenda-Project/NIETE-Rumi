/**
 * Harness for the child pages' response headers and bytes (tests/child-csp.service.test.js, page-csp-ratchet).
 *
 * The real web quiz router and the real join router, with a fake bot (fetchImpl) at the network boundary. A row may
 * first "teach" the router (a quiz or hub page whose payload says fast: true, so the next page is the streamed one).
 * run(row, { routerOpts }) → { status, headers, body, sha, length } of the measured request (Date normalised).
 */
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const { createQuizJoinRouter } = require('../routes/quiz-join.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const HUB_TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const JOIN_TOKEN = 'eyJrIjoiam9pbiJ9.AbCdEfGhIjKlMnOpQrStUv';
// a hub whose answer has the designed wait on (web_quiz_wait_ux: its constant inline style and script in the frame)
const HUB_WAIT_TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJ3Il0sImV4cCI6OTk5OTk5OTk5OX0.WaItWaItWaItWaItWaItWa';

const QUIZ = (code, lang, fast) => ({
  quiz: {
    id: `q-${code}`, code, topic: lang === 'ur' ? 'پودے کے حصے' : 'Parts of a plant', lang, dir: lang === 'ur' ? 'rtl' : 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  video: null, preview: false, brand: 'niete', rt: false, ...(fast ? { fast: true } : {}),
});
const HUB = (lang, fast, wait) => ({
  lang, kids: [{ chip: '0123456789abcdef', first: 'Sana Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...(fast ? { fast: true } : {}), ...(wait ? { wait_ux: true } : {}),
});

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The fake bot: `fast` decides the payloads' fast flag. */
function botFetch({ fast }) {
  return async (url) => {
    const u = String(url);
    let m = /\/api\/internal\/wq\/quiz\/([A-Z0-9]+)/.exec(u);
    if (m && m[1].startsWith('ZZ')) return json(404, { error: 'not_found' });   // a closed code
    if (m) return json(200, QUIZ(m[1], m[1].startsWith('UR') ? 'ur' : 'en', fast));
    // an Urdu hub: the streamed head guessed English (no Accept-Language), so the fixes' inline line is sent
    if (/\/api\/internal\/wq\/hub\//.test(u)) return json(200, HUB('ur', fast, u.includes('WaItWaIt')));
    m = /\/api\/internal\/wq\/join\/page\/(.+)$/.exec(u);
    if (m) return m[1].startsWith('eyJrIjoiam9pbiJ9') ? json(200, { ok: true, lang: 'en', earlyTap: true }) : json(410, { lang: 'en' });
    return json(404, { error: 'not_found' });
  };
}

// [name, router ('wq' | 'join'), method, path, { teach?: path, body?: {type, text} }]
const ROWS = [
  ['hub.closed', 'wq', 'GET', '/h/not-a-token', {}],
  ['hub.page', 'wq', 'GET', `/h/${HUB_TOKEN}`, {}],
  ['hub.flushed', 'wq', 'GET', `/h/${HUB_TOKEN}`, { teach: `/h/${HUB_TOKEN}` }],
  ['hub.wait', 'wq', 'GET', `/h/${HUB_WAIT_TOKEN}`, {}],
  ['hub.wait.flushed', 'wq', 'GET', `/h/${HUB_WAIT_TOKEN}`, { teach: `/h/${HUB_WAIT_TOKEN}` }],
  ['quiz.closed', 'wq', 'GET', '/q/x', {}],
  ['quiz.page', 'wq', 'GET', '/q/AB12CD', {}],
  ['quiz.flushed', 'wq', 'GET', '/q/UR12CD', { teach: '/q/AB12CD' }],
  ['quiz.flushed.again', 'wq', 'GET', '/q/ZZ99ZZ', { teach: '/q/AB12CD' }],
  ['quiz.class', 'wq', 'GET', '/q/AB12CD/class', {}],
  ['quiz.schools', 'wq', 'GET', '/q/AB12CD/schools', {}],
  ['challenge.closed', 'wq', 'GET', '/c/not-a-token', {}],
  ['card.closed', 'wq', 'GET', '/k/x', {}],
  ['classlink.closed', 'wq', 'GET', '/j/x', {}],
  ['join.page', 'join', 'GET', `/quiz/join/${JOIN_TOKEN}`, {}],
  ['join.note', 'join', 'GET', '/quiz/join/eyJrIjoieDEyMzQifQ.AbCdEfGhIjKlMnOpQrStUv', {}],
  ['report.post', 'wq', 'POST', '/api/wq/csp-report', { body: { type: 'application/csp-report', text: '{"csp-report":{"effective-directive":"script-src-elem","blocked-uri":"inline"}}' } }],
];

function normalise(headers) {
  const out = {};
  Object.keys(headers).sort().forEach((k) => {
    if (k === 'date' || k === 'connection' || k === 'keep-alive') return;
    out[k] = k === 'ratelimit-reset' ? 'N' : headers[k];
  });
  return out;
}

function request(port, method, path, body, extra = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'portal.example', ...extra };
    if (body) { headers['content-type'] = body.type; headers['content-length'] = Buffer.byteLength(body.text); }
    const r = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: normalise(res.headers), body: raw.toString('utf8'), sha: crypto.createHash('sha256').update(raw).digest('hex'), length: raw.length });
      });
    });
    r.on('error', reject);
    if (body) r.write(body.text);
    r.end();
  });
}

function appFor(kind, opts) {
  const app = express();
  app.set('trust proxy', 1);
  if (kind === 'join') app.use(createQuizJoinRouter(opts));
  else app.use(createWebQuizRouter(opts));
  app.use((req, res) => res.status(200).type('html').send('<!doctype html><title>SPA</title>'));
  return app;
}

/** One row on a fresh router; `routerOpts` go to the router (e.g. childCspOn, logEvent). */
async function run(row, { routerOpts = {} } = {}) {
  const [, kind, method, path, o] = row;
  const fetchImpl = botFetch({ fast: Boolean(o.teach) });
  const app = appFor(kind, { botUrl: BOT, apiKey: KEY, fetchImpl, logEvent: () => {}, ...routerOpts });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    if (o.teach) await request(srv.address().port, 'GET', o.teach, null);
    return await request(srv.address().port, method, path, o.body || null);
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

/**
 * One router kept up for several requests (a rate limit): serve(kind, routerOpts) →
 * { send(method, path, body?, headers?) → as run(), close() }.
 */
async function serve(kind, routerOpts = {}) {
  const app = appFor(kind, { botUrl: BOT, apiKey: KEY, fetchImpl: botFetch({ fast: false }), logEvent: () => {}, ...routerOpts });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return {
    send: (method, path, body = null, headers = {}) => request(srv.address().port, method, path, body, headers),
    close: () => new Promise((r) => srv.close(r)),
  };
}

/** A golden row: everything but the body text. */
const goldenOf = (got) => ({ status: got.status, headers: got.headers, sha: got.sha, length: got.length });

module.exports = { ROWS, run, serve, goldenOf, HUB_TOKEN, HUB_WAIT_TOKEN, JOIN_TOKEN };
